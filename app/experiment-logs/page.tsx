"use client";

import { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { accountKey, csvDateTime, jstDate, researchRows, toCsv, type ResearchSession, type ResearchTable } from "./research-csv";
import { READING_BACKGROUND_OPTIONS, READING_FONT_LABELS, READING_HIGHLIGHT_LABELS, type ReaderSettings, type ReadingHighlight } from "../reading-settings";

type ReadingSession = ResearchSession;

type ReadingEvent = {
  id: string;
  userId?: string;
  sessionId?: string;
  type?: string;
  createdAt?: number;
  paragraphIndex?: number;
  percent?: number;
  layoutMode?: string;
  groupId?: string;
  reactionEmoji?: string;
  reactionComment?: string;
  action?: string;
  workId?: string;
  fromParagraphIndex?: number;
  toParagraphIndex?: number;
  targetParagraphIndex?: number;
  movementDistance?: number;
  bookmarkSlot?: number;
  lookupStartedAt?: number;
  lookupEndedAt?: number;
  operationStartedAt?: number;
  operationEndedAt?: number;
  durationMs?: number;
  targetUserId?: string;
  targetPosition?: number;
  reactionId?: string;
  senderId?: string;
  recipientId?: string;
  firstDisplay?: boolean;
  speed?: number;
  speedBefore?: number;
  speedAfter?: number;
  hiddenAt?: number;
  resumedAt?: number;
  hiddenDurationMs?: number;
  fromMode?: string;
  toMode?: string;
  fromLayout?: string;
  toLayout?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  previousViewportWidth?: number;
  previousViewportHeight?: number;
  orientation?: string;
  previousOrientation?: string;
  changedSettings?: Array<keyof ReaderSettings>;
  settingsBefore?: ReaderSettings;
  settingsAfter?: ReaderSettings;
};

const getEventLabel = (type?: string) => {
  switch (type) {
    case "reading_start":
      return "読書開始";
    case "reading_end":
      return "読書終了";
    case "position":
      return "読書位置";
    case "reaction":
      return "リアクション";
    case "visibility_hidden":
      return "タブ離脱";
    case "visibility_visible":
      return "タブ復帰";
    case "layout_change":
      return "レイアウト変更";
    case "auto_scroll_on":
      return "自動スクロール ON";
    case "auto_scroll_off":
      return "自動スクロール OFF";
    case "reader_mode_shared":
      return "共有読みへ変更";
    case "reader_mode_solo":
      return "一人読みへ変更";
    case "bookmark_add":
      return "しおり追加";
    case "bookmark_delete":
      return "しおり削除";
    case "bookmark_jump":
      return "しおり移動";
    case "dictionary_lookup":
      return "辞書利用";
    case "reader_name_display":
      return "他者の名前表示";
    case "reaction_display":
      return "リアクション画面表示（閲覧確認ではない）";
    case "reading_backtrack":
      return "読書位置の後退";
    case "readhead_move":
      return "読書位置の移動操作";
    case "auto_scroll_speed_change":
      return "自動スクロール速度変更";
    case "viewport_change":
      return "画面サイズ・向き変更";
    case "reading_settings_change":
      return "読書設定変更";
    default:
      return type || "不明なイベント";
  }
};

const isStaleSession = (session: ReadingSession) => {
  if (session.endedAt) return false;
  if (!session.lastSeenAt) return false;

  const staleThresholdMs = 60 * 1000;

  return Date.now() - session.lastSeenAt > staleThresholdMs;
};

const formatDateTime = (timestamp?: number | null) => {
  if (!timestamp) return "未終了";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
};

const formatElapsedTime = (
  timestamp?: number,
  startedAt?: number,
) => {
  if (!timestamp || !startedAt) return "0秒";

  const seconds = Math.max(
    0,
    Math.floor((timestamp - startedAt) / 1000),
  );

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes <= 0) {
    return `${remainingSeconds}秒`;
  }

  return `${minutes}分${remainingSeconds}秒`;
};

const formatDuration = (durationMs?: number) => {
  if (!durationMs) return "0秒";

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}秒`;
  }

  return `${minutes}分${seconds}秒`;
};

const getActionLabel = (action?: string) => {
  const labels: Record<string, string> = {
    name_visible_in_reading_area: "本文表示領域に名前が表示",
    reaction_rendered_on_screen: "画面内に表示",
    speed_change: "速度調整",
    scroll_backward: "スクロールによる後退",
    reading_mode_change: "読書方法の切替",
    layout_change: "レイアウト切替",
    already_active_at_session_start: "セッション開始時に再生中",
    bookmark_add: "しおり追加",
    bookmark_delete: "しおり削除",
    bookmark_jump: "しおりから移動",
    paragraph_click: "段落クリック",
    return_to_position: "元の位置へ戻る",
    keyboard_arrowleft: "キーボードで次へ移動",
    keyboard_arrowright: "キーボードで前へ移動",
    keyboard_arrowup: "キーボードで前へ移動",
    keyboard_arrowdown: "キーボードで次へ移動",
    resize: "画面サイズ変更",
    orientation_change: "端末の向き変更",
    reading_settings_change: "読書設定の変更",
  };
  return action ? labels[action] ?? action : "";
};

const getSettingsLabel = (settings?: ReaderSettings) => {
  if (!settings) return "";
  const background = READING_BACKGROUND_OPTIONS.find(option => option.value === settings.background)?.label ?? settings.background;
  const highlightColor = settings.highlightColor ?? "yellow";
  return `${READING_FONT_LABELS[settings.font] ?? settings.font}・${Math.round(settings.fontSizePx)}px・${background}・行間${settings.lineSpacing.toFixed(2)}×・文字間隔${settings.letterSpacing.toFixed(2)}×・段落間隔${(settings.paragraphSpacing ?? 1).toFixed(2)}×・${getHighlightLabel(highlightColor)}${highlightColor === "none" ? "" : ` ${Math.round(settings.highlightOpacity * 100)}%`}`;
};

const getHighlightLabel = (value?: string) => {
  const key = value && value in READING_HIGHLIGHT_LABELS ? value as ReadingHighlight : "yellow";
  return READING_HIGHLIGHT_LABELS[key];
};

const getEventDetailsLabel = (event: ReadingEvent) => {
  const details: string[] = [];
  const actionLabel = getActionLabel(event.action);
  if (actionLabel) details.push(actionLabel);
  if (event.fromParagraphIndex !== undefined || event.toParagraphIndex !== undefined) {
    details.push(`${event.fromParagraphIndex ?? "?"} → ${event.toParagraphIndex ?? "?"}段落`);
  }
  if (event.targetParagraphIndex !== undefined) details.push(`対象 ${event.targetParagraphIndex}段落`);
  if (event.targetUserId) details.push(`対象UID ${event.targetUserId}`);
  if (event.reactionId) details.push(`リアクションID ${event.reactionId}`);
  if (event.senderId || event.recipientId) details.push(`送信者 ${event.senderId ?? "?"} → 受信者 ${event.recipientId ?? "?"}`);
  if (event.bookmarkSlot !== undefined) details.push(`しおり ${event.bookmarkSlot}`);
  if (event.speedBefore !== undefined || event.speedAfter !== undefined) {
    details.push(`速度 ${event.speedBefore ?? "?"} → ${event.speedAfter ?? "?"}`);
  } else if (event.speed !== undefined) details.push(`速度 ${event.speed}`);
  if (event.durationMs !== undefined) details.push(`所要 ${formatDuration(event.durationMs)}`);
  if (event.operationStartedAt !== undefined || event.operationEndedAt !== undefined) {
    details.push(`操作時刻 ${formatDateTime(event.operationStartedAt)} → ${formatDateTime(event.operationEndedAt)}`);
  }
  if (event.hiddenAt !== undefined || event.resumedAt !== undefined) {
    details.push(`タブ ${formatDateTime(event.hiddenAt)} → ${formatDateTime(event.resumedAt)}`);
  }
  if (event.hiddenDurationMs !== undefined) details.push(`非表示 ${formatDuration(event.hiddenDurationMs)}`);
  if (event.fromLayout || event.toLayout) details.push(`レイアウト ${event.fromLayout ?? "?"} → ${event.toLayout ?? "?"}`);
  if (event.fromMode || event.toMode) details.push(`読書方法 ${event.fromMode ?? "?"} → ${event.toMode ?? "?"}`);
  if (event.viewportWidth !== undefined && event.viewportHeight !== undefined) {
    details.push(`画面 ${event.viewportWidth}×${event.viewportHeight} (${event.orientation ?? "向き不明"})`);
  }
  if (event.settingsBefore || event.settingsAfter) {
    const settingLabels: Record<keyof ReaderSettings, string> = {
      font: "フォント", fontSizePx: "文字サイズ", background: "背景色",
      lineSpacing: "行間", letterSpacing: "文字間隔", paragraphSpacing: "段落間隔", highlightOpacity: "ハイライトの濃さ",
      highlightColor: "ハイライトカラー",
    };
    if (event.changedSettings?.length) details.push(`変更項目：${event.changedSettings.map(key => settingLabels[key]).join("、")}`);
    details.push(`設定：${getSettingsLabel(event.settingsBefore)} → ${getSettingsLabel(event.settingsAfter)}`);
  }
  return details.join(" / ");
};

function downloadFile(rows: unknown[][], filename: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExperimentLogsPage() {
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<ReadingEvent[]>([]);
  const [isEventLoading, setIsEventLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [experimentId, setExperimentId] = useState("");
  const [exportAccount, setExportAccount] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportUntil, setExportUntil] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const exportBusyRef = useRef(false);
  const eventRequestRef = useRef(0);

  const loadEvents = async (sessionId: string) => {
    const requestId = ++eventRequestRef.current;
    setSelectedSessionId(sessionId);
    setIsEventLoading(true);
    setEvents([]);

    try {
      const eventQuery = query(
        collection(db, "readingEvents"),
        where("sessionId", "==", sessionId),
      );

      const snapshot = await getDocs(eventQuery);

      const loadedEvents = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as ReadingEvent[];

      loadedEvents.sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
      );

      if (requestId === eventRequestRef.current) setEvents(loadedEvents);
    } catch (loadError) {
      console.error("読書イベント取得失敗", loadError);
    } finally {
      if (requestId === eventRequestRef.current) setIsEventLoading(false);
    }
  };

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const snapshot = await getDocs(collection(db, "readingSessions"));

        const loadedSessions = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as ReadingSession[];

        loadedSessions.sort(
          (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
        );

        setSessions(loadedSessions);
      } catch (loadError) {
        console.error("実験ログ取得失敗", loadError);
        setError("実験ログを取得できませんでした。");
      } finally {
        setIsLoading(false);
      }
    };

    void loadSessions();
  }, []);

  // 同じ表示名でも、UIDが違うアカウントのログは混ぜない。
  const sessionsByUser = new Map<string, ReadingSession[]>();
  for (const session of sessions) {
    const accountKey = session.userId
      ? `uid:${session.userId}`
      : `legacy:${session.username || "名前なし"}`;
    const accountSessions = sessionsByUser.get(accountKey) ?? [];
    accountSessions.push(session);
    sessionsByUser.set(accountKey, accountSessions);
  }

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;

  const downloadCsv = () => {
    if (!selectedSession || isEventLoading || events.length === 0) return;
    const headers = [
      "日時（日本時間）", "日時（Unixミリ秒）", "参加者", "参加者UID", "イベント種類", "イベント種別コード",
      "イベントID", "セッションID", "作品名", "著者", "作品ID", "作品種類", "作品URL", "読書モード",
      "段落インデックス（0始まり）", "進捗（%）", "レイアウト", "グループID", "リアクション", "コメント",
      "操作", "移動元段落", "移動先段落", "対象段落", "移動距離", "しおり番号", "辞書開始時刻", "辞書終了時刻",
      "操作開始時刻（Unixミリ秒）", "操作終了時刻（Unixミリ秒）", "所要時間ms", "対象参加者UID", "対象読書位置", "リアクションID", "送信者UID",
      "受信者UID", "セッション内初回表示", "速度", "変更前速度", "変更後速度", "タブ非表示時刻（Unixミリ秒）", "タブ復帰時刻（Unixミリ秒）",
      "非表示時間ms", "変更前読書方法", "変更後読書方法", "変更前レイアウト", "変更後レイアウト", "画面幅", "画面高さ",
      "変更前画面幅", "変更前画面高さ", "画面向き", "変更前画面向き", "変更設定項目",
      "設定変更前（JSON）", "設定変更後（JSON）", "ハイライトカラー変更前", "ハイライトカラー変更後", "段落間隔変更前", "段落間隔変更後",
      "セッション開始日時（日本時間）", "セッション終了日時（日本時間）", "イベント記録（JSON）", "セッション記録（JSON）",
    ];
    const rows = events.map(event => [
      csvDateTime(event.createdAt), event.createdAt, selectedSession.username, event.userId ?? selectedSession.userId,
      getEventLabel(event.type), event.type, event.id, event.sessionId ?? selectedSession.id,
      selectedSession.title, selectedSession.author, selectedSession.workId, selectedSession.workType,
      selectedSession.sourceUrl, selectedSession.mode, event.paragraphIndex, event.percent, event.layoutMode,
      event.groupId, event.reactionEmoji, event.reactionComment,
      event.action, event.fromParagraphIndex, event.toParagraphIndex, event.targetParagraphIndex, event.movementDistance,
      event.bookmarkSlot, event.lookupStartedAt, event.lookupEndedAt, event.operationStartedAt, event.operationEndedAt,
      event.durationMs, event.targetUserId, event.targetPosition, event.reactionId, event.senderId, event.recipientId,
      event.firstDisplay, event.speed, event.speedBefore, event.speedAfter, event.hiddenAt, event.resumedAt,
      event.hiddenDurationMs, event.fromMode, event.toMode, event.fromLayout, event.toLayout, event.viewportWidth,
      event.viewportHeight, event.previousViewportWidth, event.previousViewportHeight, event.orientation,
      event.previousOrientation, event.changedSettings?.join(";"), JSON.stringify(event.settingsBefore ?? ""),
      JSON.stringify(event.settingsAfter ?? ""), getHighlightLabel(event.settingsBefore?.highlightColor), getHighlightLabel(event.settingsAfter?.highlightColor),
      event.settingsBefore?.paragraphSpacing ?? "", event.settingsAfter?.paragraphSpacing ?? "",
      csvDateTime(selectedSession.startedAt),
      csvDateTime(selectedSession.endedAt), JSON.stringify(event), JSON.stringify(selectedSession),
    ]);
    downloadFile([headers, ...rows], `reta-experiment-events-${selectedSession.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`);
  };

  const exportSessions = sessions.filter(session => {
    const date = jstDate(session.startedAt);
    return (!exportAccount || accountKey(session) === exportAccount)
      && (!exportFrom || (date !== "" && date >= exportFrom))
      && (!exportUntil || (date !== "" && date <= exportUntil));
  });
  const invalidRange = Boolean(exportFrom && exportUntil && exportFrom > exportUntil);

  const downloadResearchTable = async (table: ResearchTable) => {
    if (exportBusyRef.current || !experimentId.trim() || !exportSessions.length || invalidRange) return;
    exportBusyRef.current = true;
    setExportBusy(true);
    setExportMessage("");
    // 操作開始時の対象を固定し、途中でフィルターを変更しても混ざらないようにする。
    const selected = [...exportSessions];
    const id = experimentId.trim();
    try {
      const recordedEvents: ReadingEvent[] = [];
      if (table === "results") {
        // 必要なセッションのみ取得。書き込みや全イベントの一括取得は行わない。
        for (let index = 0; index < selected.length; index += 30) {
          const ids = selected.slice(index, index + 30).map(session => session.id);
          const snapshot = await getDocs(query(collection(db, "readingEvents"), where("sessionId", "in", ids)));
          recordedEvents.push(...snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as ReadingEvent));
        }
      }
      downloadFile(researchRows(table, id, selected, recordedEvents), `reta-${table}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`);
      setExportMessage(`${selected.length}件のセッションを出力しました。手入力欄はNumbersで記入してください。`);
    } catch (error) {
      console.error("実験用CSV出力失敗", error);
      setExportMessage("CSVを出力できませんでした。通信状態とアクセス権を確認して再度お試しください。取得に失敗した件数を0として出力することはありません。");
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };


  const downloadResearchExcel = async () => {
    if (exportBusyRef.current || !experimentId.trim() || !exportSessions.length || invalidRange) return;

    exportBusyRef.current = true;
    setExportBusy(true);
    setExportMessage("");

    const selected = [...exportSessions];
    const id = experimentId.trim();

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      const recordedEvents: ReadingEvent[] = [];

      for (let index = 0; index < selected.length; index += 30) {
        const ids = selected.slice(index, index + 30).map(session => session.id);
        const snapshot = await getDocs(
          query(collection(db, "readingEvents"), where("sessionId", "in", ids))
        );
        recordedEvents.push(
          ...snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
          }) as ReadingEvent)
        );
      }

      const addSheet = (name: string, rows: unknown[][]) => {
        const sheet = workbook.addWorksheet(name);
        rows.forEach(row => {
          sheet.addRow(row.map(value => {
            if (value === null || value === undefined) return "";
            if (typeof value === "number" || typeof value === "boolean") return value;
            const text = String(value);
            return /^[=+@\\-\\t\\r\\n]/.test(text) ? "'" + text : text;
          }));
        });

        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        sheet.columns.forEach(column => { column.width = 22; });
      };

      addSheet("参加者・条件", researchRows("conditions", id, selected, recordedEvents));
      addSheet("読書結果", researchRows("results", id, selected, recordedEvents));
      addSheet("アンケート", researchRows("survey", id, selected, recordedEvents));

      const sessionMap = new Map(selected.map(session => [session.id, session]));

      const base = (event: ReadingEvent) => {
        const session = sessionMap.get(event.sessionId ?? "");
        return [
          id,
          session?.username ?? "",
          event.userId ?? session?.userId ?? "",
          event.sessionId ?? "",
          session?.title ?? "",
          session?.mode === "shared" ? "共有" : "ひとり",
          csvDateTime(event.createdAt),
          event.createdAt ?? "",
          event.paragraphIndex ?? "",
          event.percent ?? "",
          event.layoutMode ?? "",
          event.groupId ?? ""
        ];
      };

      const headers = [
      "実験回ID", "アカウント名", "参加者UID", "セッションID",
        "作品名", "記録上の読書モード", "日時（日本時間）",
        "Unix時刻（ミリ秒）", "段落番号（0始まり）",
        "進捗率（%）", "レイアウト", "グループID"
      ];

      const sorted = [...recordedEvents].sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
      );

      addSheet("読書位置推移", [
        headers,
        ...sorted.filter(event => event.type === "position")
          .map(event => base(event))
      ]);

      addSheet("操作履歴", [
        [...headers, "操作", "イベント種別", "移動元段落", "移動先段落", "対象段落", "移動距離", "しおり番号",
          "辞書開始時刻（Unixミリ秒）", "辞書終了時刻（Unixミリ秒）", "所要時間ms", "操作開始時刻（Unixミリ秒）", "操作終了時刻（Unixミリ秒）",
          "対象参加者UID", "対象読書位置", "リアクションID",
          "送信者UID", "受信者UID", "セッション内初回表示", "速度", "変更前速度", "変更後速度", "非表示時間ms",
          "タブ非表示時刻（Unixミリ秒）", "タブ復帰時刻（Unixミリ秒）", "変更前読書方法", "変更後読書方法", "変更前レイアウト", "変更後レイアウト", "画面幅", "画面高さ", "画面向き",
          "変更設定項目", "設定変更前（JSON）", "設定変更後（JSON）", "ハイライトカラー変更前", "ハイライトカラー変更後", "段落間隔変更前", "段落間隔変更後",
          "絵文字", "コメント", "イベントID"],
        ...sorted.filter(event => event.type !== "position")
          .map(event => [
            ...base(event),
            getEventLabel(event.type),
            event.type ?? "",
            event.fromParagraphIndex ?? "",
            event.toParagraphIndex ?? "",
            event.targetParagraphIndex ?? "",
            event.movementDistance ?? "",
            event.bookmarkSlot ?? "",
            event.lookupStartedAt ?? "",
            event.lookupEndedAt ?? "",
            event.durationMs ?? "",
            event.operationStartedAt ?? "",
            event.operationEndedAt ?? "",
            event.targetUserId ?? "",
            event.targetPosition ?? "",
            event.reactionId ?? "",
            event.senderId ?? "",
            event.recipientId ?? "",
            event.firstDisplay ?? "",
            event.speed ?? "",
            event.speedBefore ?? "",
            event.speedAfter ?? "",
            event.hiddenDurationMs ?? "",
            event.hiddenAt ?? "",
            event.resumedAt ?? "",
            event.fromMode ?? "",
            event.toMode ?? "",
            event.fromLayout ?? "",
            event.toLayout ?? "",
            event.viewportWidth ?? "",
            event.viewportHeight ?? "",
            event.orientation ?? "",
            event.changedSettings?.join(";") ?? "",
            event.settingsBefore ? JSON.stringify(event.settingsBefore) : "",
            event.settingsAfter ? JSON.stringify(event.settingsAfter) : "",
            getHighlightLabel(event.settingsBefore?.highlightColor),
            getHighlightLabel(event.settingsAfter?.highlightColor),
            event.settingsBefore?.paragraphSpacing ?? "",
            event.settingsAfter?.paragraphSpacing ?? "",
            event.reactionEmoji ?? "",
            event.reactionComment ?? "",
            event.id
          ])
      ]);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reta-experiment-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setExportMessage(`${selected.length}件のセッションをExcelに出力しました。`);
    } catch (error) {
      console.error("Excel出力失敗", error);
      setExportMessage("Excel出力に失敗しました。通信状態とアクセス権を確認してください。");
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };

  const positionEvents = events.filter(
    (event) => event.type === "position",
  );

  const sessionStartedAt = selectedSession?.startedAt;

  const lastPositionEvent =
    positionEvents.length > 0
      ? positionEvents[positionEvents.length - 1]
      : null;

  const estimatedEndPercent =
    selectedSession && isStaleSession(selectedSession)
      ? (lastPositionEvent?.percent ?? selectedSession.endPercent ?? 0)
      : null;

  const chartPoints =
    sessionStartedAt !== undefined && selectedSession
      ? (() => {
          const points = [
            {
              elapsedSeconds: 0,
              percent: Math.max(
                0,
                Math.min(100, selectedSession.startPercent ?? 0),
              ),
            },
            ...positionEvents.map((event) => ({
              elapsedSeconds: Math.max(
                0,
                ((event.createdAt ?? sessionStartedAt) - sessionStartedAt) / 1000,
              ),
              percent: Math.max(0, Math.min(100, event.percent ?? 0)),
            })),
          ];

          const finalTime =
            selectedSession.endedAt ??
            lastPositionEvent?.createdAt ??
            selectedSession.lastSeenAt ??
            sessionStartedAt;

          const finalPercent = selectedSession.endedAt
            ? selectedSession.endPercent ?? selectedSession.startPercent ?? 0
            : estimatedEndPercent ?? selectedSession.startPercent ?? 0;

          const finalElapsedSeconds = Math.max(
            0,
            (finalTime - sessionStartedAt) / 1000,
          );

          const lastPoint = points[points.length - 1];

          if (
            finalElapsedSeconds > lastPoint.elapsedSeconds ||
            finalPercent !== lastPoint.percent
          ) {
            points.push({
              elapsedSeconds: finalElapsedSeconds,
              percent: Math.max(0, Math.min(100, finalPercent)),
            });
          }

          return points;
        })()
      : [];

  const chartMaxSeconds = Math.max(
    1,
    ...chartPoints.map((point) => point.elapsedSeconds),
  );

  const chartPolylinePoints = chartPoints
    .map((point) => {
      const x = 55 + (point.elapsedSeconds / chartMaxSeconds) * 715;
      const y = 220 - point.percent * 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <main className="min-h-screen bg-[#f5f1e8] p-6">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold tracking-[0.25em] text-[#b98234]">
          ReTA RESEARCH
        </p>

        <h1 className="mt-2 text-3xl font-bold text-gray-950">
          実験ログ
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          ReTAで記録した読書セッションと読書行動を確認します。
        </p>

        <div className="mt-6">
          {isLoading && (
            <div className="rounded-3xl bg-white p-6">
              <p className="text-sm text-gray-500">
                ログを読み込んでいます...
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-3xl bg-white p-6">
              <p className="text-sm font-bold text-red-500">{error}</p>
            </div>
          )}

          {!isLoading && !error && (
            <>
              <details className="mb-6 rounded-3xl border border-[#eed5d8] bg-[#fffdfa] p-4 sm:p-5">
                <summary className="cursor-pointer font-bold text-[#a6445a]">Numbers用の実験データを出力</summary>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">
                  アカウント名と実験回IDで照合する3表です。各表は1セッションにつき1行で出力します。
                  同じアカウントを再利用する場合は実施日で絞り、対象件数を確認してください。絞り込みはCSVのみに適用されます。
                </p>
                <fieldset disabled={exportBusy} className="mt-4 grid gap-3 sm:grid-cols-2 disabled:opacity-60">
                  <label className="grid gap-1 text-sm font-bold text-gray-700">
                    実験回ID（必須）
                    <input value={experimentId} onChange={event => setExperimentId(event.target.value)} placeholder="例：E01" className="min-w-0 rounded-xl border border-[#eed5d8] bg-white px-3 py-2 font-normal" />
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-gray-700">
                    対象アカウント
                    <select value={exportAccount} onChange={event => setExportAccount(event.target.value)} className="min-w-0 rounded-xl border border-[#eed5d8] bg-white px-3 py-2 font-normal">
                      <option value="">全アカウント</option>
                      {Array.from(sessionsByUser.entries()).map(([key, items]) => <option key={key} value={key}>{items[0].username || "名前なし"}{items[0].userId ? `（UID末尾：${items[0].userId.slice(-6)}）` : "（UID未記録）"}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-gray-700">
                    開始日（日本時間・任意）
                    <input type="date" value={exportFrom} onChange={event => setExportFrom(event.target.value)} className="min-w-0 rounded-xl border border-[#eed5d8] bg-white px-3 py-2 font-normal" />
                  </label>
                  <label className="grid gap-1 text-sm font-bold text-gray-700">
                    終了日（日本時間・任意）
                    <input type="date" value={exportUntil} onChange={event => setExportUntil(event.target.value)} className="min-w-0 rounded-xl border border-[#eed5d8] bg-white px-3 py-2 font-normal" />
                  </label>
                </fieldset>
                <p className="mt-3 text-sm font-bold text-[#a6445a]">対象：{exportSessions.length}件のセッション</p>
                {invalidRange && <p role="alert" className="mt-2 text-sm text-red-700">終了日は開始日以降にしてください。</p>}
                <button
                  type="button"
                  disabled={exportBusy || !experimentId.trim() || !exportSessions.length || invalidRange}
                  onClick={() => void downloadResearchExcel()}
                  className="mt-3 min-h-11 rounded-xl bg-[#a6445a] px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  Excel・Numbers共通ダウンロード（5シート）
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    ["conditions", "① 参加者・条件表"],
                    ["results", "② 読書結果表"],
                    ["survey", "③ アンケート表"],
                  ] as const).map(([table, label]) => <button key={table} type="button"
                    disabled={exportBusy || !experimentId.trim() || !exportSessions.length || invalidRange}
                    onClick={() => void downloadResearchTable(table)}
                    className="min-h-11 rounded-xl border border-[#eed5d8] bg-[#fcf0f1] px-4 py-2 text-sm font-bold text-[#a6445a] disabled:cursor-not-allowed disabled:opacity-40">{label}</button>)}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  実験回IDはCSVだけに付けるラベルで、ログから実験回を自動判定するものではありません。
                  読書条件・実施順序・端末・アンケート回答は手入力です。記録上の読書モードはグループ所属に基づくため、実験条件とは別の列です。
                  アンケートは1：そう思わない〜5：そう思う。同条件で複数セッションがある場合は、回答をどの行に記入するか揃えてください。
                  全CSVはUTF-8 BOM付きです。元のイベントCSVも下のボタンから残せます。
                </p>
                <p role="status" aria-live="polite" className="mt-2 text-sm text-[#a6445a]">{exportBusy ? "CSVを準備しています…" : exportMessage}</p>
              </details>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-400">
                    READING SESSIONS
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-700">
                    {sessions.length}件の読書セッション
                  </p>
                </div>
                <div className="text-right">
                  <button type="button" onClick={downloadCsv}
                    disabled={!selectedSession || isEventLoading || events.length === 0}
                    className="rounded-xl border border-[#eee3d2] bg-white px-4 py-2 text-sm font-bold text-[#9a651f] disabled:cursor-not-allowed disabled:opacity-40">
                    表示中のイベントをCSVでダウンロード
                  </button>
                  <p className="mt-1 text-xs text-gray-500">セッションを選択すると、そのイベントを出力できます（日本時間）。</p>
                </div>
              </div>

              <div className="grid gap-8">
                {Array.from(sessionsByUser.entries()).map(
                  ([accountKey, userSessions]) => (
                    <details key={accountKey} className="rounded-3xl border border-[#eee3d2] bg-white p-4 sm:p-5"
                      onToggle={event => {
                        if (!event.currentTarget.open && userSessions.some(session => session.id === selectedSessionId)) {
                          // 閉じたアカウントのイベントやCSVを表示対象に残さない。
                          eventRequestRef.current += 1;
                          setSelectedSessionId(null);
                          setEvents([]);
                          setIsEventLoading(false);
                        }
                      }}>
                      <summary className="flex cursor-pointer items-center gap-3 rounded-xl py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a6445a]">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fff7e8] text-sm font-bold text-[#9a651f]">
                          {(userSessions[0].username || "名前なし").slice(0, 1)}
                        </div>
                        <span className="flex-1 text-base font-bold">
                          {userSessions[0].username || "名前なし"}
                        </span>
                        <span aria-hidden="true" className="text-[#a6445a]">⌄</span>
                      </summary>

                      <p className="mb-3 mt-4 text-xs text-gray-500">{userSessions.length}件のセッション。作品を選ぶとイベントと進捗グラフを表示します。</p>
                      <div className="grid gap-4">
                        {userSessions.map((session) => (
                  <article
                    key={session.id}
                    onClick={() => void loadEvents(session.id)}
                    className="cursor-pointer rounded-3xl border border-[#eee3d2] bg-white p-5 shadow-sm transition hover:border-[#d9b77f] hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-gray-950">
                          {session.title || "作品名なし"}
                        </h2>

                        <p className="mt-1 text-sm text-gray-500">
                          利用者：{session.username || "名前なし"}
                        </p>
                      </div>

                      <span className="rounded-full bg-[#fff7e8] px-3 py-1 text-xs font-bold text-[#9a651f]">
                        {session.mode === "shared" ? "共有読み" : "一人読み"}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">
                          開始日時
                        </p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {formatDateTime(session.startedAt)}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">
                          終了日時
                        </p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {isStaleSession(session)
                            ? "終了未記録"
                            : formatDateTime(session.endedAt)}
                        </p>

                        {isStaleSession(session) && (
                          <p className="mt-1 text-xs text-gray-400">
                            最終確認：{formatDateTime(session.lastSeenAt)}
                          </p>
                        )}
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">
                          実読書時間
                        </p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {formatDuration(session.activeDurationMs)}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">
                          読書進捗
                        </p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {session.startPercent ?? 0}% →{" "}
                          {selectedSessionId === session.id &&
                          estimatedEndPercent !== null
                            ? `${estimatedEndPercent}%（推定）`
                            : `${session.endPercent ?? 0}%`}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">開始時の画面表示領域</p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {session.viewportWidth && session.viewportHeight
                            ? `${session.viewportWidth} × ${session.viewportHeight}px（${session.orientation === "landscape" ? "横向き" : "縦向き"}）`
                            : "記録なし（既存ログ）"}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-400">セッション開始時の読書設定</p>
                        <p className="mt-1 text-sm font-bold text-gray-700">
                          {session.readerSettings
                            ? getSettingsLabel(session.readerSettings as ReaderSettings)
                            : "記録なし（既存ログ）"}
                        </p>
                      </div>
                    </div>

                    {selectedSessionId === session.id && (
                      <div className="mt-5 border-t border-gray-100 pt-5">
                        {!isEventLoading && chartPoints.length > 0 && (
                          <div className="mb-6">
                            <p className="text-xs font-bold tracking-wider text-gray-400">
                              READING PROGRESS
                            </p>

                            <p className="mt-1 text-sm text-gray-500">
                              読書開始からの進捗推移
                            </p>

                            <div className="mt-3 overflow-x-auto rounded-2xl bg-gray-50 p-4">
                              <svg
                                viewBox="0 0 800 260"
                                className="h-[260px] min-w-[600px] w-full"
                                role="img"
                                aria-label="読書進捗グラフ"
                              >
                                <line
                                  x1="55"
                                  y1="20"
                                  x2="55"
                                  y2="220"
                                  stroke="currentColor"
                                  className="text-gray-300"
                                />
                                <line
                                  x1="55"
                                  y1="220"
                                  x2="770"
                                  y2="220"
                                  stroke="currentColor"
                                  className="text-gray-300"
                                />

                                {[0, 25, 50, 75, 100].map((percent) => {
                                  const y = 220 - percent * 2;

                                  return (
                                    <g key={percent}>
                                      <line
                                        x1="55"
                                        y1={y}
                                        x2="770"
                                        y2={y}
                                        stroke="currentColor"
                                        className="text-gray-200"
                                      />
                                      <text
                                        x="45"
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-gray-400 text-[11px]"
                                      >
                                        {percent}%
                                      </text>
                                    </g>
                                  );
                                })}

                                {chartPolylinePoints && (
                                  <>
                                    <polyline
                                      points={chartPolylinePoints}
                                      fill="none"
                                      stroke="#b98234"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />

                                    {chartPoints.map((point, index) => {
                                      const x =
                                        55 +
                                        (point.elapsedSeconds /
                                          chartMaxSeconds) *
                                          715;
                                      const y = 220 - point.percent * 2;

                                      return (
                                        <circle
                                          key={index}
                                          cx={x}
                                          cy={y}
                                          r="4"
                                          fill="#b98234"
                                        />
                                      );
                                    })}
                                  </>
                                )}

                                <text
                                  x="55"
                                  y="242"
                                  className="fill-gray-400 text-[11px]"
                                >
                                  0秒
                                </text>

                                <text
                                  x="770"
                                  y="242"
                                  textAnchor="end"
                                  className="fill-gray-400 text-[11px]"
                                >
                                  {formatElapsedTime(
                                    (selectedSession?.startedAt ?? 0) +
                                      chartMaxSeconds * 1000,
                                    selectedSession?.startedAt,
                                  )}
                                </text>
                              </svg>
                            </div>
                          </div>
                        )}

                        <p className="text-xs font-bold tracking-wider text-gray-400">
                          READING EVENTS
                        </p>

                        {isEventLoading ? (
                          <p className="mt-3 text-sm text-gray-500">
                            イベントを読み込んでいます...
                          </p>
                        ) : events.length === 0 ? (
                          <p className="mt-3 text-sm text-gray-500">
                            このセッションのイベントはありません。
                          </p>
                        ) : (
                          <div className="mt-3 grid gap-2">
                            {events.map((event) => (
                              <div
                                key={event.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3"
                              >
                                <div>
                                  <p className="text-sm font-bold text-gray-800">
                                    {getEventLabel(event.type)}
                                    {event.reactionEmoji
                                      ? ` ${event.reactionEmoji}`
                                      : ""}
                                  </p>

                                  <p className="mt-1 text-xs text-gray-500">
                                    {formatDateTime(event.createdAt)}
                                  </p>
                                  {getEventDetailsLabel(event) && (
                                    <p className="mt-1 max-w-2xl break-all text-xs text-gray-500">
                                      {getEventDetailsLabel(event)}
                                    </p>
                                  )}
                                </div>

                                <div className="text-right text-xs text-gray-500">
                                  <p>
                                    進捗 {event.percent ?? 0}%
                                  </p>
                                  <p>
                                    段落 {event.paragraphIndex ?? 0}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                        ))}
                      </div>
                    </details>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
