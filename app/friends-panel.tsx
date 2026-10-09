"use client";

import { useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { db } from "./firebase";

type Friendship = {
  id: string;
  fromUid: string;
  toUid: string;
  fromName: string;
  toName: string;
  status: "pending" | "accepted";
};

const buttonStyle = "rounded-xl border border-[#eee3df] px-3 py-2 text-sm font-medium text-[#a6445a] disabled:opacity-40";

export default function FriendsPanel({ uid, username }: { uid: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Friendship[]>([]);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<{ uid: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const token = ++operationRef.current;
    const dialog = dialogRef.current;
    dialog?.focus({ preventScroll: true });
    setLoading(true);
    setReady(false);
    setRecords([]);
    setFound(null);
    setError("");
    setMessage("");
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    // 管理者が専用ルールの反映後に設定する。未設定では申請を保存しない。
    getDoc(doc(db, "friendsAccess", "config")).then(snapshot => {
      if (cancelled) return;
      if (!snapshot.exists() || snapshot.data().enabled !== true) {
        setLoading(false);
        return;
      }
      unsubscribe = onSnapshot(
        query(collection(db, "friendships"), where("memberIds", "array-contains", uid)),
        snapshot => {
          if (cancelled) return;
          const next = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as Friendship)
            .filter(item => (item.fromUid === uid || item.toUid === uid) && (item.status === "pending" || item.status === "accepted"));
          setRecords(next.sort((a, b) => a.id.localeCompare(b.id)));
          setReady(true);
          setLoading(false);
        },
        () => {
          if (cancelled) return;
          setReady(false);
          setLoading(false);
          setRecords([]);
          setError("フレンド情報を取得できませんでした。権限設定・通信状態を確認してください。");
        },
      );
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
      setError("フレンド機能の設定を確認できませんでした。");
    });
    return () => {
      cancelled = true;
      if (operationRef.current === token) operationRef.current++;
      unsubscribe?.();
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open, uid]);

  async function perform(action: (active: () => boolean) => Promise<string>) {
    if (busy || !ready) return;
    const token = operationRef.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action(() => token === operationRef.current);
      if (token === operationRef.current) setMessage(result);
    } catch (error) {
      if (token === operationRef.current) setError(error instanceof Error ? error.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  const incoming = records.filter(item => item.status === "pending" && item.toUid === uid);
  const outgoing = records.filter(item => item.status === "pending" && item.fromUid === uid);
  const friends = records.filter(item => item.status === "accepted");

  return (
    <>
      <button ref={triggerRef} type="button" className={buttonStyle} onClick={() => setOpen(true)}>フレンド</button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6" onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Tab") {
            const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (first && last && (document.activeElement === dialogRef.current || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first))) {
              event.preventDefault();
              (event.shiftKey ? last : first).focus({ preventScroll: true });
            }
          }
        }}>
          <button type="button" className="absolute inset-0 bg-black/20" aria-label="フレンド画面を閉じる" onClick={() => setOpen(false)} />
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="reta-friends-title" tabIndex={-1} className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-[#eee3df] bg-[#fffdfa] p-5 shadow-lg outline-none">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="reta-friends-title" className="text-xl font-bold">フレンド</h2>
              <button type="button" className={buttonStyle} aria-label="閉じる" onClick={() => setOpen(false)}>×</button>
            </div>
            {loading ? <p className="text-sm text-gray-500">読み込み中…</p> : !ready ? <p className="rounded-2xl bg-[#fff3f5] p-4 text-sm leading-relaxed text-gray-600">フレンド機能は準備中です。専用のFirestoreルールと有効化設定を反映すると利用できます。</p> : (
              <>
                <form className="mb-5" onSubmit={event => {
                  event.preventDefault();
                  setFound(null);
                  void perform(async active => {
                    const name = search.trim();
                    if (!name) throw new Error("利用者名を入力してください。");
                    const snapshot = await getDoc(doc(db, "usernames", name));
                    const data = snapshot.data();
                    if (!snapshot.exists() || typeof data?.uid !== "string") throw new Error("その利用者名は見つかりませんでした。登録時の表記で入力してください。");
                    if (data.uid === uid) throw new Error("自分自身には申請できません。");
                    if (active()) setFound({ uid: data.uid, name });
                    return "利用者が見つかりました。";
                  });
                }}>
                  <label className="mb-2 block text-sm font-semibold" htmlFor="reta-friend-search">利用者名で検索</label>
                  <div className="flex gap-2">
                    <input id="reta-friend-search" value={search} onChange={event => { setSearch(event.target.value); setFound(null); }} disabled={busy} className="min-w-0 flex-1 rounded-xl border border-[#eee3df] bg-white px-3 py-2 text-sm" placeholder="登録時の利用者名" />
                    <button type="submit" disabled={busy} className={buttonStyle}>検索</button>
                  </div>
                </form>
                {found && <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-[#fff3f5] p-3">
                  <span className="break-all text-sm">{found.name}</span>
                  <button type="button" disabled={busy} className={buttonStyle} onClick={() => void perform(async active => {
                    const memberIds = [uid, found.uid].sort();
                    const reference = doc(db, "friendships", memberIds.join("__"));
                    await runTransaction(db, async transaction => {
                      const snapshot = await transaction.get(reference);
                      if (snapshot.exists()) throw new Error(snapshot.data().status === "accepted" ? "すでにフレンドです。" : "すでに申請があります。受信・送信欄を確認してください。");
                      transaction.set(reference, { memberIds, fromUid: uid, toUid: found.uid, fromName: username, toName: found.name, status: "pending", createdAt: Date.now(), updatedAt: Date.now() });
                    });
                    if (active()) setFound(null);
                    return "フレンド申請を送りました。";
                  })}>申請する</button>
                </div>}
                {([
                  ["フレンド一覧", friends],
                  ["届いた申請", incoming],
                  ["送った申請", outgoing],
                ] as const).map(([title, items]) => <section key={title} className="mb-5">
                  <h3 className="mb-2 text-sm font-bold">{title} <span className="text-gray-400">{items.length}</span></h3>
                  {items.length === 0 ? <p className="text-xs text-gray-500">{title === "フレンド一覧" ? "まだフレンドはいません。" : "申請はありません。"}</p> : <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#eee3df] p-3">
                    <span className="break-all text-sm font-medium">{item.fromUid === uid ? item.toName : item.fromName}</span>
                    <div className="flex gap-2">
                      {item.status === "pending" && item.toUid === uid && <button type="button" disabled={busy} className={buttonStyle} onClick={() => void perform(async () => {
                        await runTransaction(db, async transaction => {
                          const reference = doc(db, "friendships", item.id);
                          const snapshot = await transaction.get(reference);
                          if (!snapshot.exists() || snapshot.data().status !== "pending" || snapshot.data().toUid !== uid) throw new Error("申請が変更されています。もう一度確認してください。");
                          transaction.update(reference, { status: "accepted", updatedAt: Date.now() });
                        });
                        return "フレンド登録しました。";
                      })}>承認</button>}
                      <button type="button" disabled={busy} className={buttonStyle} onClick={() => {
                        const question = item.status === "accepted" ? "フレンドを解除しますか？" : item.fromUid === uid ? "申請を取り消しますか？" : "申請を拒否しますか？";
                        if (!window.confirm(question)) return;
                        void perform(async () => {
                          await deleteDoc(doc(db, "friendships", item.id));
                          return item.status === "accepted" ? "フレンドを解除しました。" : item.fromUid === uid ? "申請を取り消しました。" : "申請を拒否しました。";
                        });
                      }}>{item.status === "accepted" ? "解除" : item.fromUid === uid ? "取消" : "拒否"}</button>
                    </div>
                  </li>)}</ul>}
                </section>)}
                <p className="text-xs leading-relaxed text-gray-500">フレンド登録しても、読書履歴・本文・しおりはこの機能から共有されません。</p>
              </>
            )}
            {message && <p role="status" className="mt-3 text-sm text-[#a6445a]">{message}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
