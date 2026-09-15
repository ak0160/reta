"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

type ReadingSession = {
  id: string;
  username?: string;
  title?: string;
  mode?: "solo" | "shared";
  startedAt?: number;
  endedAt?: number | null;
  startPercent?: number;
  endPercent?: number;
  activeDurationMs?: number;
};

type ReadingEvent = {
  id: string;
  sessionId?: string;
  type?: string;
  createdAt?: number;
  paragraphIndex?: number;
  percent?: number;
  layoutMode?: string;
  groupId?: string;
  reactionEmoji?: string;
  reactionComment?: string;
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
    default:
      return type || "不明なイベント";
  }
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

export default function ExperimentLogsPage() {
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<ReadingEvent[]>([]);
  const [isEventLoading, setIsEventLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEvents = async (sessionId: string) => {
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

      setEvents(loadedEvents);
    } catch (loadError) {
      console.error("読書イベント取得失敗", loadError);
    } finally {
      setIsEventLoading(false);
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

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;

  const positionEvents = events.filter(
    (event) => event.type === "position",
  );

  const sessionStartedAt = selectedSession?.startedAt;

  const chartPoints =
    sessionStartedAt !== undefined && positionEvents.length > 0
      ? [
          {
            elapsedSeconds: 0,
            percent: Math.max(
              0,
              Math.min(100, selectedSession?.startPercent ?? 0),
            ),
          },
          ...positionEvents.map((event) => ({
            elapsedSeconds: Math.max(
              0,
              ((event.createdAt ?? sessionStartedAt) - sessionStartedAt) / 1000,
            ),
            percent: Math.max(0, Math.min(100, event.percent ?? 0)),
          })),
        ]
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
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-400">
                    READING SESSIONS
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-700">
                    {sessions.length}件の読書セッション
                  </p>
                </div>
              </div>

              <div className="grid gap-4">
                {sessions.map((session) => (
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

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                          {formatDateTime(session.endedAt)}
                        </p>
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
                          {session.endPercent ?? 0}%
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
            </>
          )}
        </div>
      </div>
    </main>
  );
}
