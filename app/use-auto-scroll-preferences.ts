"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { DEFAULT_AUTO_SCROLL_SPEED, DEFAULT_AUTO_SCROLL_PRESETS, clampAutoScrollSpeed, normalizeAutoScrollPresets, type AutoScrollPresets } from "./auto-scroll-speed";

type Preferences = { speed: number; presets: AutoScrollPresets };
const defaults = (): Preferences => ({ speed: DEFAULT_AUTO_SCROLL_SPEED, presets: { ...DEFAULT_AUTO_SCROLL_PRESETS } });
function parsePreferences(data: unknown): Preferences {
  const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return { speed: typeof value.speed === "number" ? clampAutoScrollSpeed(value.speed) : DEFAULT_AUTO_SCROLL_SPEED, presets: normalizeAutoScrollPresets(value.presets) };
}
const storageKey = (uid: string) => `retaAutoScrollPreferences_v1_${uid}`;
function cache(uid: string, value: Preferences, pending: boolean) {
  try { localStorage.setItem(storageKey(uid), JSON.stringify({ ...value, pending })); }
  catch { /* ブラウザ保存が無効でも、Firestoreとの同期は継続する。 */ }
}

type Context = { uid: string; value: Preferences; dirty: boolean; ready: boolean; version: number; disposed: boolean; hasLocal: boolean; timer?: ReturnType<typeof setTimeout>; schedule: () => void };

export function useAutoScrollPreferences(uid: string | undefined) {
  const [stored, setStored] = useState<{ uid?: string; value: Preferences }>({ value: defaults() });
  const [message, setMessage] = useState("");
  const active = useRef<Context | null>(null);

  useEffect(() => {
    if (!uid) { active.current = null; setStored({ value: defaults() }); setMessage(""); return; }
    let initial = defaults();
    let pending = false;
    let hasLocal = false;
    try {
      const raw = localStorage.getItem(storageKey(uid));
      if (raw) {
        const parsed = JSON.parse(raw);
        initial = parsePreferences(parsed); pending = parsed?.pending === true; hasLocal = true;
      } else {
        const oldSpeed = localStorage.getItem(`retaAutoScrollSpeed_v1_${uid}`);
        if (oldSpeed !== null) { initial.speed = clampAutoScrollSpeed(Number(oldSpeed)); hasLocal = true; }
      }
    } catch { /* 壊れたローカル設定は既定値で開始する。 */ }
    const context: Context = { uid, value: initial, dirty: pending, ready: false, version: 0, disposed: false, hasLocal, schedule: () => {} };
    active.current = context;
    setStored({ uid, value: initial }); setMessage("設定を読み込み中…");
    const reference = doc(db, "readerPreferences", uid);
    context.schedule = () => {
      if (context.timer) clearTimeout(context.timer);
      if (!context.ready || context.disposed) return;
      context.timer = setTimeout(async () => {
        if (context.disposed || !context.dirty) return;
        const version = context.version;
        const value = context.value;
        try {
          await setDoc(reference, { ...value, updatedAt: Date.now() });
          if (context.disposed || version !== context.version) return;
          context.dirty = false;
          cache(uid, value, false);
          setMessage("アカウントに保存済み");
        } catch {
          if (!context.disposed) setMessage("同期できませんでした。設定はこの端末に保持しています。");
        }
      }, 350);
    };
    const stop = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
      if (context.disposed) return;
      // ローカルで編集中の値を、古いスナップショットで巻き戻さない。
      if (!context.dirty && snapshot.exists()) {
        context.value = parsePreferences(snapshot.data());
        setStored({ uid, value: context.value });
        cache(uid, context.value, false);
      }
      if (!snapshot.metadata.fromCache) {
        context.ready = true;
        // 旧ブラウザ内の設定は、クラウド未設定の場合だけ移行する。
        if (!snapshot.exists() && context.hasLocal && !context.dirty) {
          context.dirty = true; context.version++;
          cache(uid, context.value, true);
        }
        if (context.dirty) {
          setMessage("同期中…");
          if (!snapshot.metadata.hasPendingWrites) context.schedule();
        }
        else setMessage(snapshot.exists() ? "アカウントに保存済み" : "設定はアカウント別に保存されます");
      }
    }, () => {
      if (!context.disposed) setMessage("設定を同期できません。接続を確認してください。");
    });
    const reconnect = () => { if (context.dirty) context.schedule(); };
    window.addEventListener("online", reconnect);
    return () => {
      context.disposed = true;
      if (context.timer) clearTimeout(context.timer);
      stop(); window.removeEventListener("online", reconnect);
      if (active.current === context) active.current = null;
    };
  }, [uid]);

  const change = (update: Partial<Preferences>) => {
    const context = active.current;
    if (!uid || !context || context.uid !== uid || context.disposed) return;
    context.value = { ...context.value, ...update };
    context.dirty = true; context.hasLocal = true; context.version++;
    cache(uid, context.value, true);
    setStored({ uid, value: context.value });
    setMessage(context.ready ? "同期中…" : "接続後に設定を同期します");
    context.schedule();
  };
  const value = stored.uid === uid ? stored.value : defaults();
  return {
    speed: value.speed,
    presets: value.presets,
    syncMessage: stored.uid === uid ? message : "設定を読み込み中…",
    changeSpeed: (speed: number) => change({ speed: clampAutoScrollSpeed(speed) }),
    changePresets: (presets: AutoScrollPresets) => change({ presets: normalizeAutoScrollPresets(presets) }),
  };
}
