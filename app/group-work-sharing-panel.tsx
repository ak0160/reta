"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { parseSharedTextWork, prepareSharedTextWork, shareOwnedTextWork, saveSharedTextWork, type SharedTextWork } from "./group-work-sharing";

export default function GroupWorkSharingPanel({ uid, username, groupId, ownedWorkId, hasSelectedWork, onOpen, onMembershipLost, onGroupMembersChanged }: {
  uid: string; username: string; groupId: string; ownedWorkId: string | null; hasSelectedWork: boolean;
  onOpen: (work: SharedTextWork) => Promise<void>;
  onMembershipLost: () => void;
  onGroupMembersChanged: (memberIds: string[]) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [works, setWorks] = useState<SharedTextWork[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const callbacks = useRef({ onOpen, onMembershipLost, onGroupMembersChanged });
  callbacks.current = { onOpen, onMembershipLost, onGroupMembersChanged };
  const alive = useRef(false);
  const storageKey = `retaSharedWorkNotices_${uid}_${groupId}`;
  const noticeKey = (work: SharedTextWork) => `${work.workId}:${work.sharedAt}`;

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let stopWorks: (() => void) | undefined;
    let stopGroup: (() => void) | undefined;
    try { const data = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(data)) setDismissed(data.filter(v => typeof v === "string")); } catch { /* 通知は一覧から再度開ける */ }
    const stopConfig = onSnapshot(doc(db, "groupSharingAccess", "config"), snapshot => {
      if (cancelled) return;
      stopWorks?.(); stopGroup?.();
      setWorks([]);
      const ready = snapshot.data()?.enabled === true;
      setEnabled(ready);
      if (!ready) return;
      stopGroup = onSnapshot(doc(db, "groups", groupId), group => {
        if (cancelled) return;
        if (!group.exists() || !group.data().memberIds?.includes(uid)) {
          stopWorks?.(); setWorks([]); setEnabled(false);
          callbacks.current.onMembershipLost();
        } else {
          callbacks.current.onGroupMembersChanged(group.data().memberIds);
        }
      }, error => {
        setEnabled(false); setWorks([]);
        if (error.code === "permission-denied") callbacks.current.onMembershipLost();
        else setError("グループの所属を確認できません。");
      });
      stopWorks = onSnapshot(collection(db, "groupWorkShares", groupId, "works"), snapshot => {
        if (cancelled) return;
        try {
          const next = snapshot.docs.map(item => parseSharedTextWork(item.id, item.data()));
          setWorks(next.sort((a, b) => b.sharedAt - a.sharedAt));
          setError("");
        } catch { setWorks([]); setError("共有作品の情報を確認できません。"); }
      }, () => { setWorks([]); setError("共有作品を取得できません。グループの所属と通信状態を確認してください。"); });
    }, () => { setEnabled(false); setWorks([]); setError("グループ共有の設定を取得できませんでした。"); });
    return () => { cancelled = true; alive.current = false; stopConfig(); stopWorks?.(); stopGroup?.(); };
  }, [uid, groupId, storageKey]);

  function dismiss(work: SharedTextWork) {
    const next = [...new Set([...dismissed, noticeKey(work)])].slice(-500);
    setDismissed(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 保存失敗でも現在画面では閉じる */ }
  }
  async function open(work: SharedTextWork) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const verified = await prepareSharedTextWork(db, uid, groupId, work.workId);
      if (!alive.current) return;
      await callbacks.current.onOpen(verified);
      if (alive.current) dismiss(work);
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : "共有作品を開けませんでした。");
    } finally { if (alive.current) setBusy(false); }
  }
  const pending = works.filter(work => work.sharedBy !== uid && !dismissed.includes(noticeKey(work)));
  return <section className="mb-4 rounded-2xl border border-[#eee3df] bg-[#fffdfa] p-3 sm:p-4" aria-label="グループの共有作品">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-bold text-gray-900">グループで共有された作品</h2>
      {ownedWorkId && <button type="button" disabled={!enabled || busy} className="rounded-xl border border-[#eed5d8] px-3 py-2 text-xs font-bold text-[#a6445a] disabled:opacity-40" onClick={async () => {
        setBusy(true); setError(""); setNotice("");
        try {
          const added = await shareOwnedTextWork(db, uid, username, groupId, ownedWorkId);
          if (alive.current) setNotice(added ? "グループに共有しました。各参加者が選んで開けます。" : "この作品はすでに共有されています。");
        } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "共有に失敗しました。"); }
        finally { if (alive.current) setBusy(false); }
      }}>グループに共有</button>}
    </div>
    {!enabled && <p className="mt-2 text-xs text-gray-500">グループ共有は準備中です。</p>}
    {pending[0] && <div role="status" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 flex flex-wrap items-center gap-2 rounded-2xl border border-[#eed5d8] bg-[#fffdfa] p-3 text-xs shadow-sm lg:bottom-5 lg:left-auto lg:right-5 lg:max-w-md">
      <p className="min-w-0 flex-1 break-words line-clamp-2">{pending[0].sharedByName}さんが『{pending[0].title}』を共有しました{pending.length > 1 ? `（ほか${pending.length - 1}件）` : ""}</p>
      <button type="button" disabled={busy} onClick={() => void open(pending[0])} className="rounded-lg bg-[#a6445a] px-3 py-2 font-bold text-white disabled:opacity-40">この作品を開く</button>
      <button type="button" onClick={() => dismiss(pending[0])} className="px-2 py-2 text-gray-600">あとで</button>
    </div>}
    {enabled && <details className="mt-2" open={!hasSelectedWork}>
      <summary className="cursor-pointer py-1 text-xs font-semibold text-gray-600">共有作品一覧（{works.length}件）</summary>
      {works.length === 0 ? <p className="mt-2 text-xs text-gray-500">まだ共有作品はありません。</p> : <ul className="mt-2 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{works.map(work => <li key={work.workId} className="flex items-center justify-between gap-2 rounded-xl border border-[#eee3df] p-3">
        <div className="min-w-0"><p className="break-words text-sm font-bold">{work.title}</p><p className="break-words text-xs text-gray-500">{work.author} · 共有：{work.sharedByName}</p></div>
        <div className="flex shrink-0 flex-col gap-2">
        {work.ownerId !== uid && <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const added = await saveSharedTextWork(db, uid, groupId, work.workId);
            if (alive.current) setNotice(added ? "マイライブラリに保存しました。グループ退出後も読めます。" : "この作品は保存済みです。");
          } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "保存に失敗しました。"); }
          finally { if (alive.current) setBusy(false); }
        }} className="rounded-lg bg-[#fcf0f1] px-3 py-2 text-xs font-bold text-[#a6445a] disabled:opacity-40">マイライブラリに保存</button>}
        <button type="button" disabled={busy} onClick={() => void open(work)} className="shrink-0 rounded-lg border border-[#eed5d8] px-3 py-2 text-xs font-bold text-[#a6445a] disabled:opacity-40">開く</button></div>
      </li>)}</ul>}
    </details>}
    {notice && <p role="status" className="mt-2 text-xs text-[#a6445a]">{notice}</p>}
    {error && <p role="alert" className="mt-2 break-words text-xs text-red-700">{error}</p>}
  </section>;
}
