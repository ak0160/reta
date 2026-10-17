"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { parseSavedSharedWork, saveSharedTextWork, type SavedSharedWork } from "./group-work-sharing";

export default function SavedSharedWorksPanel({ uid, onOpen, onDelete, onBeforeSave }: {
  uid: string;
  onOpen: (work: SavedSharedWork) => Promise<void>;
  onDelete: (work: SavedSharedWork) => Promise<void>;
  onBeforeSave: () => void;
}) {
  const [works, setWorks] = useState<SavedSharedWork[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setWorks([]);
    return onSnapshot(collection(db, "savedSharedWorks", uid, "works"), snapshot => {
      try {
        setWorks(snapshot.docs.map(item => parseSavedSharedWork(item.id, item.data())).sort((a, b) => b.savedAt - a.savedAt));
        setError("");
      } catch { setWorks([]); setError("保存作品の情報を確認できません。"); }
    }, () => { setWorks([]); setError("保存作品を取得できません。通信状態と保存機能のFirestore Rulesを確認してください。"); });
  }, [uid]);

  return <section className="my-4 rounded-2xl border border-[#eee3df] bg-[#fffdfa] p-4" aria-label="保存した共有作品">
    <h2 className="text-sm font-bold text-gray-900">共有から保存した自分の作品</h2>
    <p className="mt-2 text-xs leading-relaxed text-gray-500">自分用に保存した作品は、共有元が削除しても残ります。共有読書にはグループの元作品を開いてください。</p>
    {works.length === 0 && !error && <p className="mt-2 text-xs text-gray-500">まだ保存した共有作品はありません。</p>}
    <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{works.map(work => <li key={work.workId}>
      <button type="button" disabled={busy} className="w-full rounded-xl border border-[#eed5d8] bg-white p-3 text-left disabled:opacity-40" onClick={async () => {
        setBusy(true); setError("");
        try { await onOpen(work); }
        catch (error) { setError(error instanceof Error ? error.message : "作品を開けませんでした。"); }
        finally { setBusy(false); }
      }}><span className="block break-words text-sm font-bold text-[#a6445a]">{work.title}</span><span className="mt-1 block text-xs text-gray-500">{work.author}</span></button>
      <div className="mt-2 flex justify-end gap-2">
        {work.personalWorkId ? <button type="button" disabled={busy} className="rounded-lg px-3 py-2 text-xs text-[#a6445a] disabled:opacity-40" onClick={async () => {
          setBusy(true); setError("");
          try { await onDelete(work); }
          catch (error) { setError(error instanceof Error ? error.message : "削除できませんでした。"); }
          finally { setBusy(false); }
        }}>自分の作品を削除</button> : <button type="button" disabled={busy} className="rounded-lg border border-[#eed5d8] px-3 py-2 text-xs text-[#a6445a] disabled:opacity-40" onClick={async () => {
          setBusy(true); setError("");
          try { onBeforeSave(); await saveSharedTextWork(db, uid, work.sourceGroupId, work.workId); }
          catch (error) { setError(error instanceof Error ? error.message : "保存できませんでした。"); }
          finally { setBusy(false); }
        }}>自分の作品として保存</button>}
      </div>
    </li>)}</ul>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </section>;
}
