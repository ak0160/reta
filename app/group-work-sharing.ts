import { doc, getDocFromServer, runTransaction, setDoc, type Firestore } from "firebase/firestore";

export type SharedTextWork = {
  workId: string;
  title: string;
  author: string;
  ownerId: string;
  sharedBy: string;
  sharedByName: string;
  sharedAt: number;
};

export function parseSharedTextWork(id: string, data: Record<string, unknown>): SharedTextWork {
  if (data.workId !== id || data.type !== "text" ||
    ![data.title, data.author, data.ownerId, data.sharedBy, data.sharedByName].every(value => typeof value === "string") ||
    data.sharedBy !== data.ownerId || typeof data.sharedAt !== "number") {
    throw new Error("共有作品の情報が正しくありません。");
  }
  return data as unknown as SharedTextWork;
}

// 本文はworksの1文書だけ。アクセス文書は参照先グループのみを保持し、Rulesが毎回所属を検証する。
export async function prepareSharedTextWork(db: Firestore, uid: string, groupId: string, workId: string) {
  const config = await getDocFromServer(doc(db, "groupSharingAccess", "config"));
  if (config.data()?.enabled !== true) throw new Error("グループ共有はまだ有効化されていません。");
  const reference = doc(db, "groupWorkShares", groupId, "works", workId);
  const snapshot = await getDocFromServer(reference);
  if (!snapshot.exists()) throw new Error("この作品はグループで共有されていません。");
  const shared = parseSharedTextWork(workId, snapshot.data());
  await setDoc(doc(db, "sharedWorkAccess", uid, "works", workId), { groupId });
  const work = await getDocFromServer(doc(db, "works", workId));
  if (!work.exists()) throw new Error("共有作品が削除されています。");
  const data = work.data();
  if (data.workId !== workId || data.type !== "text" || typeof data.rawText !== "string" || data.ownerId !== shared.ownerId || typeof data.title !== "string" || typeof data.author !== "string") {
    throw new Error("共有情報とTXT作品が一致しません。");
  }
  return { ...shared, title: data.title as string, author: data.author as string };
}

export async function shareOwnedTextWork(db: Firestore, uid: string, username: string, groupId: string, workId: string) {
  return runTransaction(db, async transaction => {
    const config = await transaction.get(doc(db, "groupSharingAccess", "config"));
    const group = await transaction.get(doc(db, "groups", groupId));
    const work = await transaction.get(doc(db, "works", workId));
    const reference = doc(db, "groupWorkShares", groupId, "works", workId);
    const existing = await transaction.get(reference);
    if (config.data()?.enabled !== true) throw new Error("グループ共有はまだ有効化されていません。");
    if (!group.data()?.memberIds?.includes(uid)) throw new Error("このグループに所属していません。");
    const data = work.data();
    if (!work.exists() || data?.ownerId !== uid || data?.type !== "text" || data?.workId !== workId || typeof data?.rawText !== "string") {
      throw new Error("自分で追加したTXT作品だけ共有できます。");
    }
    if (existing.exists()) return false;
    transaction.set(reference, {
      workId, type: "text", title: data.title, author: data.author, ownerId: uid,
      sharedBy: uid, sharedByName: username || "利用者", sharedAt: Date.now(),
    });
    return true;
  });
}


export type SavedSharedWork = {
  workId: string;
  title: string;
  author: string;
  ownerId: string;
  sourceGroupId: string;
  savedAt: number;
};

export function parseSavedSharedWork(id: string, data: Record<string, unknown>): SavedSharedWork {
  if (data.workId !== id || ![data.title, data.author, data.ownerId, data.sourceGroupId].every(value => typeof value === "string") || typeof data.savedAt !== "number") {
    throw new Error("保存した作品の情報が正しくありません。");
  }
  return data as unknown as SavedSharedWork;
}

export async function getSavedSharedWork(db: Firestore, uid: string, workId: string) {
  const snapshot = await getDocFromServer(doc(db, "savedSharedWorks", uid, "works", workId));
  return snapshot.exists() ? parseSavedSharedWork(workId, snapshot.data()) : null;
}

// 明示的な保存だけが退出後の閲覧権限になる。本文とworkIdは複製しない。
export async function saveSharedTextWork(db: Firestore, uid: string, groupId: string, workId: string) {
  const shared = await prepareSharedTextWork(db, uid, groupId, workId);
  return runTransaction(db, async transaction => {
    const reference = doc(db, "savedSharedWorks", uid, "works", workId);
    const existing = await transaction.get(reference);
    if (existing.exists()) {
      const saved = parseSavedSharedWork(workId, existing.data());
      if (saved.ownerId !== shared.ownerId) throw new Error("保存情報と作品が一致しません。");
      return false;
    }
    transaction.set(reference, {
      workId, title: shared.title, author: shared.author, ownerId: shared.ownerId,
      sourceGroupId: groupId, savedAt: Date.now(),
    });
    return true;
  });
}
