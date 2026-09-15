"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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
                    className="rounded-3xl border border-[#eee3d2] bg-white p-5 shadow-sm"
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
