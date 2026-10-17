export type ResearchSession = {
  id: string;
  userId?: string;
  username?: string;
  groupId?: string;
  groupName?: string;
  workId?: string;
  workType?: string;
  title?: string;
  author?: string;
  sourceUrl?: string;
  mode?: "solo" | "shared";
  startedAt?: number;
  lastSeenAt?: number;
  endedAt?: number | null;
  startPercent?: number;
  endPercent?: number;
  activeDurationMs?: number;
};

type ResearchEvent = {
  sessionId?: string;
  type?: string;
  reactionComment?: string;
};

export type ResearchTable = "conditions" | "results" | "survey";

export const accountKey = (session: ResearchSession) => session.userId
  ? `uid:${session.userId}` : `legacy:${session.username || "名前なし"}`;

export function jstDate(timestamp?: number) {
  return timestamp === undefined || !Number.isFinite(timestamp)
    ? "" : new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function csvDateTime(timestamp?: number | null) {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(timestamp));
}

export function toCsv(rows: unknown[][]) {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    const safeText = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

// 手入力項目は空欄のままにし、未記録値を0や推定値に置き換えない。
export function researchRows(table: ResearchTable, experimentId: string, sessions: ResearchSession[], events: ResearchEvent[] = []) {
  const headers = ["実験回ID", "アカウント名", "参加者UID", "セッションID", "グループ名", "グループID", "実施日（日本時間）", "読書条件（手入力）"];
  const identity = (s: ResearchSession) => [experimentId, s.username, s.userId, s.id, s.groupName, s.groupId, jstDate(s.startedAt), ""];
  if (table === "conditions") return [
    [...headers, "実施順序（手入力）", "作品名", "作品ID", "使用端末（手入力）", "備考（手入力）"],
    ...sessions.map(s => [...identity(s), "", s.title, s.workId, "", ""]),
  ];
  if (table === "survey") return [
    [...headers, "集中できた（1〜5）", "楽しかった（1〜5）", "一緒に読んでいると感じた（1〜5）", "他者の情報で気が散った（1〜5）", "操作が分かりやすかった（1〜5）", "また使いたい（1〜5）", "良かった点", "改善してほしい点"],
    ...sessions.map(s => [...identity(s), "", "", "", "", "", "", "", ""]),
  ];
  const counts = new Map<string, { reactions: number; comments: number }>();
  for (const event of events) {
    if (!event.sessionId || event.type !== "reaction") continue;
    const count = counts.get(event.sessionId) ?? { reactions: 0, comments: 0 };
    count.reactions += 1;
    if (typeof event.reactionComment === "string" && event.reactionComment.trim()) count.comments += 1;
    counts.set(event.sessionId, count);
  }
  return [
    [...headers, "作品名", "作品ID", "記録上の読書モード", "開始日時（日本時間）", "終了日時（日本時間）", "終了記録", "実読書時間（秒・記録値）", "開始進捗（%）", "終了進捗（%・記録値）", "記録されたリアクション数", "コメント付きリアクション数", "中断・トラブル（手入力）"],
    ...sessions.map(s => [...identity(s), s.title, s.workId, s.mode === "shared" ? "共有" : s.mode === "solo" ? "ひとり" : "",
      csvDateTime(s.startedAt), csvDateTime(s.endedAt), s.endedAt == null ? "終了未記録" : "終了記録あり",
      s.activeDurationMs == null ? "" : s.activeDurationMs / 1000, s.startPercent, s.endPercent,
      counts.get(s.id)?.reactions ?? 0, counts.get(s.id)?.comments ?? 0, ""]),
  ];
}
