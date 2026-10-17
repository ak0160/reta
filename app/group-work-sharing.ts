import { collection, doc, getDocFromServer, runTransaction, setDoc, waitForPendingWrites, type Firestore } from "firebase/firestore";

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
  personalWorkId?: string;
};

export function parseSavedSharedWork(id: string, data: Record<string, unknown>): SavedSharedWork {
  if (data.workId !== id || ![data.title, data.author, data.ownerId, data.sourceGroupId].every(value => typeof value === "string") || typeof data.savedAt !== "number" || (data.personalWorkId !== undefined && (typeof data.personalWorkId !== "string" || !data.personalWorkId))) {
    throw new Error("保存した作品の情報が正しくありません。");
  }
  return data as unknown as SavedSharedWork;
}

export async function getSavedSharedWork(db: Firestore, uid: string, workId: string) {
  const snapshot = await getDocFromServer(doc(db, "savedSharedWorks", uid, "works", workId));
  return snapshot.exists() ? parseSavedSharedWork(workId, snapshot.data()) : null;
}

// 明示的な保存で受信者所有の独立した本文を作成する。共有中の元workIdは変えない。
export async function saveSharedTextWork(db: Firestore, uid: string, groupId: string, workId: string) {
  const previous = await getSavedSharedWork(db, uid, workId);
  if (!previous) await prepareSharedTextWork(db, uid, groupId, workId);
  await waitForPendingWrites(db);
  const personalWorkId = `text_${doc(collection(db, "works")).id}`;
  return runTransaction(db, async transaction => {
    const reference = doc(db, "savedSharedWorks", uid, "works", workId);
    const existing = await transaction.get(reference);
    const saved = existing.exists() ? parseSavedSharedWork(workId, existing.data()) : null;
    if (saved?.personalWorkId) return false;
    const source = await transaction.get(doc(db, "works", workId));
    const progress = await transaction.get(doc(db, "readingProgress", `${uid}_${workId}`));
    const data = source.data();
    if (!source.exists() || data?.type !== "text" || data?.workId !== workId || typeof data.rawText !== "string" || typeof data.title !== "string" || typeof data.author !== "string" || typeof data.ownerId !== "string" || (saved && saved.ownerId !== data.ownerId)) {
      throw new Error("元の共有作品が削除されているか、作品情報が一致しません。");
    }
    if (data.ownerId === uid) throw new Error("自分の作品はすでにライブラリにあります。");
    const now = Date.now();
    transaction.set(doc(db, "works", personalWorkId), {
      workId: personalWorkId, type: "text", title: data.title, author: data.author,
      rawText: data.rawText, sourceUrl: "", ownerId: uid, sourceWorkId: workId, updatedAt: now,
    });
    transaction.set(doc(db, "readingProgress", `${uid}_${personalWorkId}`), {
      ...(progress.exists() ? progress.data() : {
        username: "", layoutMode: "normal", currentParagraphIndex: 0, readingUnitsLength: 0,
        percent: 0, scrollLeft: 0, scrollTop: 0, bookmarks: [null, null, null, null],
      }),
      userId: uid, workId: personalWorkId, workType: "text", title: data.title, author: data.author,
      sourceUrl: "", storyKey: "", updatedAt: now,
    });
    transaction.set(reference, saved ? { ...saved, personalWorkId } : {
      workId, title: data.title, author: data.author, ownerId: data.ownerId,
      sourceGroupId: groupId, savedAt: now, personalWorkId,
    });
    return true;
  });
}

export type TextWorkRemoval = { kind: "owned" | "reference" };

export async function inspectTextWorkRemoval(db: Firestore, uid: string, workId: string): Promise<TextWorkRemoval> {
  try {
    const snapshot = await getDocFromServer(doc(db, "works", workId));
    if (!snapshot.exists()) return { kind: "reference" };
    const data = snapshot.data();
    if (data.type !== "text" || data.workId !== workId) throw new Error("TXT作品の情報が一致しません。");
    return { kind: data.ownerId === uid ? "owned" : "reference" };
  } catch (error) {
    // 退出後の共有本文を取得できなくても、本人の登録は削除できる。
    if ((error as { code?: string } | null)?.code === "permission-denied") return { kind: "reference" };
    throw error;
  }
}

export async function removeTextWorkFromLibrary(db: Firestore, uid: string, workId: string, removal: TextWorkRemoval) {
  return runTransaction(db, async transaction => {
    const reference = doc(db, "works", workId);
    const work = removal.kind === "owned" ? await transaction.get(reference) : null;
    const data = work?.data();
    if (work?.exists() && (data?.ownerId !== uid || data.type !== "text" || data.workId !== workId)) {
      throw new Error("作品の所有者が変わったため削除を中止しました。");
    }
    const sourceWorkId = removal.kind === "owned" && typeof data?.sourceWorkId === "string" ? data.sourceWorkId : workId;
    const savedRef = doc(db, "savedSharedWorks", uid, "works", sourceWorkId);
    const saved = await transaction.get(savedRef);
    // 元作品の履歴を外すだけの場合、別に保存した自分用コピーの登録は残す。
    if (saved.exists() && (!saved.data().personalWorkId || saved.data().personalWorkId === workId)) {
      transaction.delete(savedRef);
    }
    if (work?.exists()) transaction.delete(reference);
    transaction.delete(doc(db, "readingProgress", `${uid}_${workId}`));
    transaction.delete(doc(db, "sharedWorkAccess", uid, "works", workId));
  });
}
