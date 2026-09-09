"use client";

import { dictionary } from "./dictionary";
import { stories, type StoryKey } from "./stories";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { auth, db } from "./firebase";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";

type ReadingGroup = {
  id: string;
  name: string;
  code: string;
  createdBy: string;
  createdAt: number;
  memberIds: string[];
};

type Participant = {
  id: string;
  name: string;
  groupId: string;
  workId: string;
  isReading: boolean;
  paragraphIndex: number;
  joinedAt: number;
  updatedAt: number;
};

type Reaction = {
  storyKey: StoryKey | "";
  groupId: string;
  workId?: string;
  workTitle?: string;
  workAuthor?: string;
  workType?: WorkType;
  sourceUrl?: string;
  emoji: string;
  comment: string;
  paragraphIndex: number;
  participantId: string;
  participantName: string;
  time: string;
  createdAt: number;
};

type ReaderMode = "reading" | "shared";
type LayoutMode = "normal" | "grouped" | "horizontal";
type LoadMode = "preset" | "url";
type WorkType = "preset" | "url";

type CurrentWork = {
  workId: string;
  type: WorkType;
  title: string;
  author: string;
  sourceUrl: string;
};

type Paragraph = {
  text: string;
  isHeading?: boolean;
};

type ReadingUnit = {
  unitIndex: number;
  paragraphIndex: number;
  groupIndexInParagraph: number;
  firstSentence: string;
  secondSentence: string;
  html: string;
  isHeading?: boolean;
};

type ReadingProgress = {
  storyKey: StoryKey;
  layoutMode: LayoutMode;
  currentParagraphIndex: number;
  scrollLeft: number;
  scrollTop?: number;
  readingUnitsLength: number;
  savedAt: number;
};

type UserReadingProgress = {
  docId?: string;
  userId: string;
  username: string;
  workId: string;
  workType: WorkType;
  title: string;
  author: string;
  sourceUrl: string;
  storyKey: StoryKey | "";
  layoutMode: LayoutMode;
  currentParagraphIndex: number;
  readingUnitsLength: number;
  percent: number;
  scrollLeft: number;
  scrollTop: number;
  updatedAt: number;
};

type StoryProgressSummary = {
  percent: number;
  savedAt: number;
  layoutMode: LayoutMode;
};

type LastReadingState = {
  workType: WorkType;
  workId: string;
  storyKey: StoryKey | "";
  sourceUrl: string;
  title: string;
  author: string;
  layoutMode: LayoutMode;
  currentParagraphIndex: number;
  readingUnitsLength: number;
  scrollLeft: number;
  scrollTop: number;
  savedAt: number;
};

const MAX_PARTICIPANTS = 3;
const ACTIVE_LIMIT_MS = 5 * 60 * 1000;

const PARTICIPANT_ID_KEY = "sharedReadingParticipantId_v10";
const PARTICIPANT_JOINED_AT_KEY = "sharedReadingParticipantJoinedAt_v10";

// v4にして、過去に残った7%・3%などの古い保存データは読まない。
const READING_PROGRESS_KEY_PREFIX = "sharedReadingProgress_v4";
const LAST_READING_STATE_KEY = "sharedReadingLastState_v4";

function isStoryKey(value: unknown): value is StoryKey {
  return typeof value === "string" && value in stories;
}

function getAozoraCanonicalInfo(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    if (!url.hostname.endsWith("aozora.gr.jp")) return null;

    const cardMatch = url.pathname.match(/^\/cards\/([^/]+)\/card(\d+)\.html$/);
    if (cardMatch) {
      const [, authorId, workNumber] = cardMatch;
      return {
        workId: `aozora_${authorId}_${workNumber}`,
        cardUrl: `https://www.aozora.gr.jp/cards/${authorId}/card${workNumber}.html`,
      };
    }

    const fileMatch = url.pathname.match(
      /^\/cards\/([^/]+)\/files\/(\d+)(?:_[^/]*)?\.html$/,
    );
    if (fileMatch) {
      const [, authorId, workNumber] = fileMatch;
      return {
        workId: `aozora_${authorId}_${workNumber}`,
        cardUrl: `https://www.aozora.gr.jp/cards/${authorId}/card${workNumber}.html`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getCanonicalSourceUrl(sourceUrl: string) {
  return getAozoraCanonicalInfo(sourceUrl)?.cardUrl ?? sourceUrl;
}

function createUrlWorkId(sourceUrl: string) {
  const canonicalInfo = getAozoraCanonicalInfo(sourceUrl);
  if (canonicalInfo) return canonicalInfo.workId;

  return `url_${btoa(encodeURIComponent(sourceUrl))
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_")}`;
}

function createPresetWorkId(storyKey: StoryKey) {
  return `preset_${storyKey}`;
}

function createPresetWork(storyKey: StoryKey): CurrentWork {
  const story = stories[storyKey];

  return {
    workId: createPresetWorkId(storyKey),
    type: "preset",
    title: story.title,
    author: story.author,
    sourceUrl: "textFile" in story ? story.textFile : storyKey,
  };
}

function getFallbackCurrentWork(storyKey: StoryKey): CurrentWork {
  return createPresetWork(storyKey);
}

function getReadingProgressKey(
  userId: string,
  storyKey: StoryKey,
  layoutMode: LayoutMode,
) {
  return `${READING_PROGRESS_KEY_PREFIX}_${userId}_${storyKey}_${layoutMode}`;
}

function getDisplayPercent(index: number, count: number) {
  if (count <= 1) return 0;

  // スクロール位置の自動判定だけで「完読」にはしない。
  // 完読ボタンを実装するまでは、最終位置でも最大99%として扱う。
  return Math.min(99, Math.round((index / (count - 1)) * 100));
}

function saveLastReadingState(
  userId: string,
  work: CurrentWork,
  storyKey: StoryKey | "",
  layoutMode: LayoutMode,
  currentParagraphIndex: number,
  readingUnitsLength: number,
  scrollLeft: number,
  scrollTop: number,
) {
  if (typeof window === "undefined" || !userId) return;

  const state: LastReadingState = {
    workType: work.type,
    workId: work.workId,
    storyKey,
    sourceUrl: work.sourceUrl,
    title: work.title,
    author: work.author,
    layoutMode,
    currentParagraphIndex,
    readingUnitsLength,
    scrollLeft,
    scrollTop,
    savedAt: Date.now(),
  };

  localStorage.setItem(
    `${LAST_READING_STATE_KEY}_${userId}`,
    JSON.stringify(state),
  );
}

function loadLastReadingState(userId: string) {
  if (typeof window === "undefined" || !userId) return null;

  const rawState = localStorage.getItem(
    `${LAST_READING_STATE_KEY}_${userId}`,
  );
  if (!rawState) return null;

  try {
    const state = JSON.parse(rawState) as LastReadingState;

    if (state.workType !== "preset" && state.workType !== "url") return null;
    if (typeof state.workId !== "string" || !state.workId) return null;
    if (typeof state.sourceUrl !== "string") return null;
    if (typeof state.title !== "string") return null;
    if (typeof state.author !== "string") return null;
    if (
      state.workType === "preset" &&
      !isStoryKey(state.storyKey)
    ) {
      return null;
    }
    if (
      state.workType === "url" &&
      state.storyKey !== ""
    ) {
      return null;
    }
    if (
      state.layoutMode !== "normal" &&
      state.layoutMode !== "grouped" &&
      state.layoutMode !== "horizontal"
    ) {
      return null;
    }

    state.currentParagraphIndex = Number(state.currentParagraphIndex ?? 0);
    state.readingUnitsLength = Number(state.readingUnitsLength ?? 0);
    state.scrollLeft = Number(state.scrollLeft ?? 0);
    state.scrollTop = Number(state.scrollTop ?? 0);

    return state;
  } catch (error) {
    console.error("前回読書状態の読み込み失敗", error);
    return null;
  }
}

function writeReadingProgress(
  userId: string,
  storyKey: StoryKey,
  layoutMode: LayoutMode,
  currentParagraphIndex: number,
  readingUnitsLength: number,
  scrollLeft: number,
  scrollTop = 0,
) {
  if (typeof window === "undefined" || !userId) return;
  if (readingUnitsLength <= 0) return;

  const safeIndex = Math.max(
    0,
    Math.min(currentParagraphIndex, readingUnitsLength - 1),
  );

  const progress: ReadingProgress = {
    storyKey,
    layoutMode,
    currentParagraphIndex: safeIndex,
    scrollLeft,
    scrollTop,
    readingUnitsLength,
    savedAt: Date.now(),
  };

  localStorage.setItem(
    getReadingProgressKey(userId, storyKey, layoutMode),
    JSON.stringify(progress),
  );

}

function loadReadingProgressFromStorage(
  userId: string,
  storyKey: StoryKey,
  layoutMode: LayoutMode,
) {
  if (typeof window === "undefined" || !userId) return null;

  const rawProgress = localStorage.getItem(
    getReadingProgressKey(userId, storyKey, layoutMode),
  );

  if (!rawProgress) return null;

  try {
    const progress = JSON.parse(rawProgress) as ReadingProgress;

    if (progress.storyKey !== storyKey) return null;
    if (progress.layoutMode !== layoutMode) return null;
    if (typeof progress.currentParagraphIndex !== "number") return null;

    return progress;
  } catch (error) {
    console.error("読書位置の読み込み失敗", error);
    return null;
  }
}

function loadProgressSummaryForStory(userId: string, storyKey: StoryKey) {
  if (typeof window === "undefined") return null;

  const summaries = (["normal", "grouped", "horizontal"] as LayoutMode[])
    .map((mode) => {
      const progress = loadReadingProgressFromStorage(userId, storyKey, mode);
      if (!progress) return null;

      const length = Math.max(1, Number(progress.readingUnitsLength || 1));
      const safeIndex = Math.max(
        0,
        Math.min(Number(progress.currentParagraphIndex || 0), length - 1),
      );
      const percent = getDisplayPercent(safeIndex, length);

      // 先頭は未読扱い。3%や7%のような古い初期表示はv4では読まない。
      if (safeIndex <= 0 || percent <= 0) return null;

      return {
        percent,
        savedAt: Number(progress.savedAt || 0),
        layoutMode: mode,
      } satisfies StoryProgressSummary;
    })
    .filter((item): item is StoryProgressSummary => item !== null)
    .sort((a, b) => b.savedAt - a.savedAt);

  return summaries[0] ?? null;
}

function loadAllStoryProgressSummaries(userId: string) {
  if (typeof window === "undefined" || !userId) {
    return {} as Partial<Record<StoryKey, StoryProgressSummary>>;
  }

  return Object.keys(stories).reduce(
    (summaryMap, key) => {
      const storyKey = key as StoryKey;
      const summary = loadProgressSummaryForStory(userId, storyKey);

      if (summary) {
        summaryMap[storyKey] = summary;
      }

      return summaryMap;
    },
    {} as Partial<Record<StoryKey, StoryProgressSummary>>,
  );
}

function createSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createParticipantId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `participant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPercent(index: number, count: number) {
  if (count <= 0) return 0;

  return Math.round(((index + 1) / count) * 100);
}

function getMapPercent(index: number, count: number) {
  if (count <= 1) return 0;

  return Math.round((index / (count - 1)) * 100);
}

function getDisplayName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) return "名前なし";
  if (trimmedName.length <= 5) return trimmedName;

  return `${trimmedName.slice(0, 5)}…`;
}

function normalizeParticipant(
  raw: Record<string, unknown>,
  id: string,
): Participant {
  const now = Date.now();

  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    groupId: typeof raw.groupId === "string" ? raw.groupId : "",
    workId: typeof raw.workId === "string" ? raw.workId : "",
    isReading: raw.isReading === true,
    paragraphIndex: Number(raw.paragraphIndex ?? 0),
    joinedAt: Number(raw.joinedAt ?? now),
    updatedAt: Number(raw.updatedAt ?? 0),
  };
}

function createGroupCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from({ length: 6 }, () => {
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");
}

function normalizeReadingGroup(
  raw: Record<string, unknown>,
  id: string,
): ReadingGroup {
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    code: typeof raw.code === "string" ? raw.code : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    createdAt: Number(raw.createdAt ?? 0),
    memberIds: Array.isArray(raw.memberIds)
      ? raw.memberIds.filter(
          (value): value is string => typeof value === "string",
        )
      : typeof raw.createdBy === "string" && raw.createdBy !== ""
        ? [raw.createdBy]
        : [],
  };
}

function normalizeReaction(raw: Record<string, unknown>): Reaction {
  return {
    storyKey:
      typeof raw.storyKey === "string" ? (raw.storyKey as StoryKey) : "",
    groupId: typeof raw.groupId === "string" ? raw.groupId : "",
    workId: typeof raw.workId === "string" ? raw.workId : undefined,
    workTitle: typeof raw.workTitle === "string" ? raw.workTitle : undefined,
    workAuthor: typeof raw.workAuthor === "string" ? raw.workAuthor : undefined,
    workType:
      raw.workType === "preset" || raw.workType === "url"
        ? raw.workType
        : undefined,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    emoji: typeof raw.emoji === "string" ? raw.emoji : "👍",
    comment: typeof raw.comment === "string" ? raw.comment : "",
    paragraphIndex: Number(raw.paragraphIndex ?? 0),
    participantId:
      typeof raw.participantId === "string" ? raw.participantId : "",
    participantName:
      typeof raw.participantName === "string"
        ? raw.participantName
        : "名前なし",
    time: typeof raw.time === "string" ? raw.time : "",
    createdAt: Number(raw.createdAt ?? 0),
  };
}

function normalizeUserReadingProgress(
  raw: Record<string, unknown>,
): UserReadingProgress {
  const rawLayoutMode = raw.layoutMode;
  const layoutMode: LayoutMode =
    rawLayoutMode === "grouped" || rawLayoutMode === "horizontal"
      ? rawLayoutMode
      : "normal";

  const rawWorkType = raw.workType;
  const workType: WorkType = rawWorkType === "url" ? "url" : "preset";

  const rawStoryKey = raw.storyKey;
  const storyKey = isStoryKey(rawStoryKey) ? rawStoryKey : "";

  return {
    userId: typeof raw.userId === "string" ? raw.userId : "",
    username: typeof raw.username === "string" ? raw.username : "名前なし",
    workId:
      workType === "url" && typeof raw.sourceUrl === "string"
        ? createUrlWorkId(raw.sourceUrl)
        : typeof raw.workId === "string"
          ? raw.workId
          : "",
    workType,
    title: typeof raw.title === "string" ? raw.title : "作品名なし",
    author: typeof raw.author === "string" ? raw.author : "作者不明",
    sourceUrl:
      typeof raw.sourceUrl === "string"
        ? getCanonicalSourceUrl(raw.sourceUrl)
        : "",
    storyKey,
    layoutMode,
    currentParagraphIndex: Number(raw.currentParagraphIndex ?? 0),
    readingUnitsLength: Number(raw.readingUnitsLength ?? 0),
    percent: Number(raw.percent ?? 0),
    scrollLeft: Number(raw.scrollLeft ?? 0),
    scrollTop: Number(raw.scrollTop ?? 0),
    updatedAt: Number(raw.updatedAt ?? 0),
  };
}

function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return "未保存";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function convertAozoraRuby(text: string) {
  let converted = text;

  converted = converted.replace(
    /｜([^《》]+)《([^《》]+)》/g,
    "<ruby>$1<rt>$2</rt></ruby>",
  );

  converted = converted.replace(
    /([一-龠々〆ヵヶ]+)《([^《》]+)》/g,
    "<ruby>$1<rt>$2</rt></ruby>",
  );

  return converted;
}

function highlightDictionaryWords(text: string) {
  let result = text;

  Object.keys(dictionary).forEach((word) => {
    result = result.replaceAll(
      word,
      `<button class="dict-word" data-word="${word}">${word}</button>`,
    );
  });

  return result;
}

function normalizeScannedJapaneseText(text: string) {
  return (
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")

      // OCRでよく入る「文 字 の 間 の 空 白」を削除
      .replace(/([ぁ-んァ-ヶ一-龠々ー])[ \t]+(?=[ぁ-んァ-ヶ一-龠々ー])/g, "$1")

      // 句読点・カッコ周りの空白を整理
      .replace(/\s+([、。！？!?）」』】）])/g, "$1")
      .replace(/([「『【（])\s+/g, "$1")

      // 英数字も、OCRで1文字ずつ空いたものだけ軽く戻す
      .replace(/([A-Za-z])[ \t]+(?=[A-Za-z])/g, "$1")
      .replace(/([0-9])[ \t]+(?=[0-9])/g, "$1")
  );
}

function normalizeForCompare(text: string) {
  return text
    .replace(/\s+/g, "")
    .replace(/[　]/g, "")
    .replace(/[「」『』【】（）()]/g, "")
    .replace(/[‐－―ー]/g, "-")
    .toLowerCase()
    .trim();
}

const HEADING_MAX_LENGTH = 30;
const HEADING_EXCLUDED_MARKS = /[、。！？!?「」『』【】（）()]/;
const SENTENCE_END_MARKS = /[。！？!?」』】）)]$/;
const KANJI_NUMERAL_PATTERN = /^[一二三四五六七八九十百千]+$/;

function normalizeHeadingText(line: string) {
  const trimmedLine = line.trim();

  // 数字のみ、または「一」「二」などの漢数字のみの行は章番号・節番号として扱う。
  if (/^\d+$/.test(trimmedLine) || KANJI_NUMERAL_PATTERN.test(trimmedLine)) {
    return trimmedLine;
  }

  // 「5武藤澄香」「5 武藤澄香」のような行は、表示上だけ数字と文字を分ける。
  const numberedHeading = trimmedLine.match(/^(\d+)\s*(\S(?:.*\S)?)$/);
  if (numberedHeading) {
    const headingBody = numberedHeading[2].replace(/\s+/g, "");
    return `${numberedHeading[1]} ${headingBody}`;
  }

  return trimmedLine.replace(/\s+/g, " ");
}

function isChapterHeading(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) return false;

  // 句読点や括弧を含む行は本文の可能性が高いため、子見出しにしない。
  if (HEADING_EXCLUDED_MARKS.test(trimmedLine)) return false;

  // 1, 2, 15 のような数字のみ。
  if (/^\d+$/.test(trimmedLine)) return true;

  // 一、二、三などの青空文庫の章番号。
  if (KANJI_NUMERAL_PATTERN.test(trimmedLine)) return true;

  // 5武藤澄香 / 5 武藤澄香 / 12 函館未来 など。
  if (/^\d+\s*\S/.test(trimmedLine)) {
    const headingBody = trimmedLine.replace(/^\d+\s*/, "").replace(/\s+/g, "");
    return headingBody.length > 0 && headingBody.length <= HEADING_MAX_LENGTH;
  }

  // 第1章 / 第5話 / 第10節 / 第2編 など。
  if (/^第[0-9０-９一二三四五六七八九十百千]+[章話節編部]$/.test(trimmedLine)) {
    return true;
  }

  return false;
}

function decorateText(text: string) {
  const rubyConverted = convertAozoraRuby(text);
  return highlightDictionaryWords(rubyConverted);
}

function stripAozoraNotes(line: string) {
  // ［＃〜］は字下げ・傍点・外字説明などの入力者注なので、本文表示からは外す。
  return line.replace(/［＃.*?］/g, "");
}

function removeAozoraGuideBlock(text: string) {
  // 青空文庫冒頭の「テキスト中に現れる記号について」の説明ブロックを除去する。
  return text.replace(/-{5,}[\s\S]*?-{5,}/g, "\n");
}

function cleanAozoraText(
  text: string,
  title: string,
  author: string,
): Paragraph[] {
  const unifiedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 「底本：」以降は青空文庫の書誌情報なので、読書本文には使わない。
  const beforeBibliography = unifiedText.split("底本：")[0];

  const withoutGuideBlock = removeAozoraGuideBlock(beforeBibliography);

  // txtの1行目はタイトル、2行目は著者として扱い、本文には絶対に表示しない。
  // 3行目以降だけを本文処理の対象にする。
  const bodyLines = withoutGuideBlock.split("\n").slice(2);

  const titleKey = normalizeForCompare(title);
  const authorKey = normalizeForCompare(author);

  const rawLines = bodyLines
    .map((line) => normalizeScannedJapaneseText(stripAozoraNotes(line)).trim())
    .filter(Boolean);

  const paragraphs: Paragraph[] = [];
  let buffer = "";

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;

    // Paragraph.text はHTML化しない。文分割が壊れないように、生テキストのまま持つ。
    paragraphs.push({
      text: trimmed,
    });

    buffer = "";
  };

  const shouldRemoveDuplicatedTitleOrAuthor = (line: string, index: number) => {
    const key = normalizeForCompare(line);

    if (!key) return true;
    if (isChapterHeading(line)) return false;

    // 1・2行目はすでに削除しているが、青空文庫などで本文側に再出現する場合だけ除外する。
    if (titleKey && key === titleKey) return true;
    if (authorKey && key === authorKey) return true;

    // 先頭付近だけ、タイトル＋著者がくっついた行も除外する。
    if (index <= 8) {
      const titleAndAuthor = `${titleKey}${authorKey}`;
      const authorAndTitle = `${authorKey}${titleKey}`;

      if (titleAndAuthor && key === titleAndAuthor) return true;
      if (authorAndTitle && key === authorAndTitle) return true;

      if (
        titleKey &&
        authorKey &&
        key.includes(titleKey) &&
        key.includes(authorKey) &&
        key.length <= titleKey.length + authorKey.length + 4
      ) {
        return true;
      }
    }

    return false;
  };

  rawLines.forEach((originalLine, index) => {
    if (shouldRemoveDuplicatedTitleOrAuthor(originalLine, index)) return;

    let line = originalLine;

    /*
      子見出しと本文が同じ行にくっついた場合にも対応する。
      例: 5武藤澄香「なんかあったかいものでも飲む？」
      → 見出し「5 武藤澄香」と本文「「なんか...」」に分ける。
    */
    const headingWithBody = line.match(
      /^(\d+)\s*([^、。！？!?「」『』【】（）()\d]{1,30})(?=「|『)/,
    );

    if (headingWithBody) {
      flushBuffer();

      const headingText = normalizeHeadingText(
        `${headingWithBody[1]} ${headingWithBody[2]}`,
      );

      paragraphs.push({
        text: headingText,
        isHeading: true,
      });

      line = line.slice(headingWithBody[0].length).trim();

      if (!line) return;
    }

    if (isChapterHeading(line)) {
      flushBuffer();

      paragraphs.push({
        text: normalizeHeadingText(line),
        isHeading: true,
      });

      return;
    }

    buffer += line;

    // OCR由来の途中改行は無視し、文末らしい記号で終わったら段落として確定する。
    if (SENTENCE_END_MARKS.test(line)) {
      flushBuffer();
    }
  });

  flushBuffer();

  return paragraphs;
}

const SENTENCE_TERMINATOR_CHARS = new Set(["。", "！", "？", "!", "?"]);
const SENTENCE_CLOSING_MARKS = new Set(["」", "』", "】", "）", ")"]);

function splitIntoSentences(rawText: string) {
  const trimmedText = rawText.trim();

  if (!trimmedText) return [];

  const sentences: string[] = [];
  let buffer = "";

  const pushSentence = () => {
    const sentence = buffer.trim();

    if (sentence) {
      sentences.push(sentence);
    }

    buffer = "";
  };

  for (let index = 0; index < trimmedText.length; index += 1) {
    const char = trimmedText[index];
    buffer += char;

    if (SENTENCE_TERMINATOR_CHARS.has(char)) {
      // 文末記号の直後に閉じ括弧が続く場合は、同じ文に含める。
      while (
        index + 1 < trimmedText.length &&
        SENTENCE_CLOSING_MARKS.has(trimmedText[index + 1])
      ) {
        index += 1;
        buffer += trimmedText[index];
      }

      pushSentence();
      continue;
    }

    // 「おはよう」 のように句点なしで閉じ括弧で終わる会話文も1文として扱う。
    if (SENTENCE_CLOSING_MARKS.has(char)) {
      pushSentence();
    }
  }

  if (buffer.trim()) {
    pushSentence();
  }

  return sentences;
}

function buildReadingUnits(paragraphs: Paragraph[]) {
  const units: ReadingUnit[] = [];
  let unitIndex = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.isHeading) {
      units.push({
        unitIndex,
        paragraphIndex,
        groupIndexInParagraph: 0,
        firstSentence: paragraph.text,
        secondSentence: "",
        html: paragraph.text,
        isHeading: true,
      });

      unitIndex += 1;
      return;
    }

    const sentences = splitIntoSentences(paragraph.text);

    for (
      let sentenceIndex = 0;
      sentenceIndex < sentences.length;
      sentenceIndex += 2
    ) {
      const firstSentence = sentences[sentenceIndex] ?? "";
      const secondSentence = sentences[sentenceIndex + 1] ?? "";

      units.push({
        unitIndex,
        paragraphIndex,
        groupIndexInParagraph: Math.floor(sentenceIndex / 2),
        firstSentence,
        secondSentence,
        html: `${firstSentence}${secondSentence}`,
      });

      unitIndex += 1;
    }
  });

  return units;
}

const AOZORA_PROXY_URLS = [
  (url: string) => url,
  (url: string) =>
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) =>
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

type LoadedAozoraText = {
  title: string;
  author: string;
  rawText: string;
  sourceUrl: string;
};

type AozoraSearchBook = {
  id: string;
  title: string;
  author: string;
  cardUrl: string;
  htmlUrl: string;
  firstLine: string;
  characters: number;
  updatedAt: string;
};

const RECENT_AOZORA_BOOKS_KEY = "sharedReadingRecentAozoraBooks_v1";
const AOZORA_BOOK_API_URL = "https://api.bungomail.com/v0/books";

async function fetchWithFallback(url: string) {
  let lastError: unknown = null;

  for (const createUrl of AOZORA_PROXY_URLS) {
    try {
      const response = await fetch(createUrl(url));

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("fetchWithFallback failed", lastError);
  throw new Error(
    "外部データの取得に失敗しました。時間をおいて再試行してください",
  );
}

async function fetchTextThroughProxy(url: string) {
  const response = await fetchWithFallback(url);
  const buffer = await response.arrayBuffer();

  try {
    return new TextDecoder("shift_jis").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function fetchJsonThroughProxy<T>(url: string): Promise<T> {
  const response = await fetchWithFallback(url);
  return (await response.json()) as T;
}

function normalizeAozoraBook(
  rawBook: Record<string, unknown>,
): AozoraSearchBook {
  const title = String(rawBook["作品名"] ?? "青空文庫作品");
  const author = String(rawBook["姓名"] ?? "作者不明");
  const id = String(rawBook["作品ID"] ?? `${title}-${author}`);

  return {
    id,
    title,
    author,
    cardUrl: String(rawBook["図書カードURL"] ?? ""),
    htmlUrl: String(rawBook["XHTML/HTMLファイルURL"] ?? ""),
    firstLine: String(rawBook["書き出し"] ?? ""),
    characters: Number(rawBook["文字数"] ?? 0),
    updatedAt: String(rawBook["最終更新日"] ?? ""),
  };
}

function escapeAozoraSearchPattern(keyword: string) {
  return keyword.replace(/[\/]/g, "").trim();
}

async function searchAozoraBooks(keyword: string) {
  const safeKeyword = keyword.trim().replace(/[\/]/g, "");
  if (!safeKeyword) return [];

  const rawSearchUrl = `${AOZORA_BOOK_API_URL}?作品名=/${encodeURIComponent(safeKeyword)}/&limit=12`;

  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawSearchUrl)}`;

  const response = await fetch(proxyUrl);

  if (!response.ok) {
    throw new Error(`検索に失敗しました: ${response.status}`);
  }

  const data = await response.json();

  return (data.books ?? [])
    .map(normalizeAozoraBook)
    .filter((book: AozoraSearchBook) => book.cardUrl || book.htmlUrl);
}

function loadRecentAozoraBooksFromStorage() {
  if (typeof window === "undefined") return [] as AozoraSearchBook[];

  try {
    const rawBooks = localStorage.getItem(RECENT_AOZORA_BOOKS_KEY);
    if (!rawBooks) return [];

    const books = JSON.parse(rawBooks) as AozoraSearchBook[];
    return Array.isArray(books) ? books.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecentAozoraBooksToStorage(books: AozoraSearchBook[]) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    RECENT_AOZORA_BOOKS_KEY,
    JSON.stringify(books.slice(0, 6)),
  );
}

function getAbsoluteAozoraUrl(href: string, baseUrl: string) {
  return new URL(href, baseUrl).toString();
}

function extractXhtmlUrlFromCard(cardHtml: string, cardUrl: string) {
  const documentObject = new DOMParser().parseFromString(cardHtml, "text/html");
  const links = Array.from(documentObject.querySelectorAll("a"));

  const xhtmlLink = links.find((link) => {
    const href = link.getAttribute("href") ?? "";
    const label = link.textContent ?? "";

    return (
      href.includes("files/") &&
      href.endsWith(".html") &&
      label.includes("XHTML")
    );
  });

  const fallbackHtmlLink = links.find((link) => {
    const href = link.getAttribute("href") ?? "";
    return href.includes("files/") && href.endsWith(".html");
  });

  const targetHref =
    xhtmlLink?.getAttribute("href") ?? fallbackHtmlLink?.getAttribute("href");

  if (!targetHref) return null;

  return getAbsoluteAozoraUrl(targetHref, cardUrl);
}

function decodeHtmlEntity(text: string) {
  if (typeof document === "undefined") {
    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function stripHtmlTags(html: string) {
  return decodeHtmlEntity(html.replace(/<[^>]+>/g, "")).trim();
}

function convertRubyHtmlToAozoraNotation(html: string) {
  return html.replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_, rubyInner) => {
    const withoutRp = rubyInner.replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, "");
    const rt = stripHtmlTags(
      withoutRp.match(/<rt[^>]*>([\s\S]*?)<\/rt>/i)?.[1] ?? "",
    );

    const base = stripHtmlTags(
      withoutRp
        .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "")
        .replace(/<rb[^>]*>/gi, "")
        .replace(/<\/rb>/gi, ""),
    );

    if (!base || !rt) return base || rt;

    return `｜${base}《${rt}》`;
  });
}

function htmlToPlainAozoraBody(mainHtml: string) {
  return decodeHtmlEntity(
    convertRubyHtmlToAozoraNotation(mainHtml)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<div[^>]*>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function parseAozoraXhtml(html: string, sourceUrl: string): LoadedAozoraText {
  const documentObject = new DOMParser().parseFromString(html, "text/html");

  const title =
    documentObject.querySelector("h1.title")?.textContent?.trim() ||
    documentObject.querySelector("title")?.textContent?.trim() ||
    "青空文庫作品";

  const author =
    documentObject.querySelector("h2.author")?.textContent?.trim() ||
    "作者不明";

  const mainTextElement = documentObject.querySelector(".main_text");

  if (!mainTextElement) {
    throw new Error("本文部分が見つかりませんでした");
  }

  const body = htmlToPlainAozoraBody(mainTextElement.innerHTML);

  return {
    title,
    author,
    rawText: `${title}\n${author}\n${body}`,
    sourceUrl,
  };
}

async function loadAozoraTextFromUrl(url: string): Promise<LoadedAozoraText> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new Error("URLの形式が正しくありません");
  }

  if (!parsedUrl.hostname.endsWith("aozora.gr.jp")) {
    throw new Error("青空文庫のURLだけ対応しています");
  }

  let targetUrl = parsedUrl.toString();

  if (targetUrl.includes("/card")) {
    const cardHtml = await fetchTextThroughProxy(targetUrl);
    const xhtmlUrl = extractXhtmlUrlFromCard(cardHtml, targetUrl);

    if (!xhtmlUrl) {
      throw new Error("図書カードからXHTML版のリンクを見つけられませんでした");
    }

    targetUrl = xhtmlUrl;
  }

  const html = await fetchTextThroughProxy(targetUrl);
  return parseAozoraXhtml(html, targetUrl);
}

export default function Home() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const sessionIdRef = useRef("");

  const [readerMode, setReaderMode] = useState<ReaderMode>("reading");

  const [layoutMode, setLayoutMode] = useState<LayoutMode>("normal");

  const [loadMode, setLoadMode] = useState<LoadMode>("preset");

  const [aozoraUrl, setAozoraUrl] = useState("");
  const [aozoraSearchQuery, setAozoraSearchQuery] = useState("");
  const [aozoraSearchResults, setAozoraSearchResults] = useState<
    AozoraSearchBook[]
  >([]);
  const [recentAozoraBooks, setRecentAozoraBooks] = useState<
    AozoraSearchBook[]
  >([]);
  const [customTitle, setCustomTitle] = useState("");
  const [customAuthor, setCustomAuthor] = useState("");
  const [isLoadingAozora, setIsLoadingAozora] = useState(false);
  const [isSearchingAozora, setIsSearchingAozora] = useState(false);
  const [aozoraLoadError, setAozoraLoadError] = useState("");

  const [participantId, setParticipantId] = useState("");
  const [joinedAt, setJoinedAt] = useState(0);
  const [username, setUsername] = useState("");

  const [currentGroup, setCurrentGroup] = useState<ReadingGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [groupError, setGroupError] = useState("");

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [userReadingProgresses, setUserReadingProgresses] = useState<
    UserReadingProgress[]
  >([]);

  const [selectedStory, setSelectedStory] = useState<StoryKey>("wagahai");
  const [currentWork, setCurrentWork] = useState<CurrentWork>(() =>
    createPresetWork("wagahai"),
  );

  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);

  const [selectedWord, setSelectedWord] = useState("");
  const [searchWord, setSearchWord] = useState("");
  const [wikiMeaning, setWikiMeaning] = useState("");
  const [isSearchingMeaning, setIsSearchingMeaning] = useState(false);

  const [reactionEmoji, setReactionEmoji] = useState("👍");
  const [reactionComment, setReactionComment] = useState("");

  const [isAutoScroll, setIsAutoScroll] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(17);
  const [readingProgressNotice, setReadingProgressNotice] = useState("");
  const [returnIndex, setReturnIndex] = useState<number | null>(null);
  const [storyProgressSummaries, setStoryProgressSummaries] = useState<
    Partial<Record<StoryKey, StoryProgressSummary>>
  >({});

  // オート時はマーカーを飛ばさず、読書面を少しずつ横へ流す。
  // 数字を大きくすると速くなる。
  const AUTO_SCROLL_SPEED =
    layoutMode === "grouped"
      ? autoSpeed * 1.7
      : layoutMode === "horizontal"
        ? autoSpeed * 2.2
        : autoSpeed;

  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentParagraphIndexRef = useRef(0);
  const usernameRef = useRef("");
  const selectedStoryRef = useRef<StoryKey>("wagahai");
  const currentWorkRef = useRef<CurrentWork>(createPresetWork("wagahai"));
  const pendingResumeProgressRef = useRef<UserReadingProgress | null>(null);
  const pendingFreshStartWorkIdRef = useRef<string | null>(null);
  const layoutModeRef = useRef<LayoutMode>("normal");
  const readingUnitsLengthRef = useRef(0);
  const didLoadLastReadingStateRef = useRef(false);
  const isRestoringProgressRef = useRef(false);
  const textLoadRequestIdRef = useRef(0);
  const progressNoticeTimerRef = useRef<number | null>(null);
  const readingAreaRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  // Safariはリロード後に遅れてscrollイベントを発生させることがある。
  // この時刻までは中央判定・自動保存を完全に停止し、保存位置を固定する。
  const restoreGuardUntilRef = useRef(0);
  // リロード直後はブラウザの自動スクロール復元やDOM再配置による
  // scrollイベントを読書操作として扱わない。
  const isInitialProgressResolvedRef = useRef(false);
  const isPageLeavingRef = useRef(false);
  // 実際に復元・操作が完了した最後の安全な位置。終了時はこの値を保存する。
  const lastStableParagraphIndexRef = useRef(0);

  // モード切替時は、読書単位番号ではなく「段落番号」を基準に位置を引き継ぐ。
  // 通常段落・2文グループ・横書きでは読書単位の見え方が違うため、
  // unitIndexをそのまま使うと別の場所へ飛ぶことがある。
  const layoutSwitchTargetRef = useRef<{
    targetMode: LayoutMode;
    paragraphIndex: number;
  } | null>(null);

  const readingUnits = useMemo(() => {
    return buildReadingUnits(paragraphs);
  }, [paragraphs]);

  const readingUnitsByParagraph = useMemo(() => {
    const map = new Map<number, ReadingUnit[]>();

    readingUnits.forEach((unit) => {
      const current = map.get(unit.paragraphIndex) ?? [];
      current.push(unit);
      map.set(unit.paragraphIndex, current);
    });

    return map;
  }, [readingUnits]);

  const currentReadingUnit = readingUnits[currentParagraphIndex];

  const activeParagraphIndex = currentReadingUnit?.paragraphIndex ?? 0;

  const activeParticipants = useMemo(() => {
    const now = Date.now();

    return participants.filter((participant) => {
      const isSelf = participant.id === participantId;

      if (isSelf) {
        return participant.name.trim() !== "";
      }

      return (
        now - participant.updatedAt < ACTIVE_LIMIT_MS &&
        participant.name.trim() !== ""
      );
    });
  }, [participants, participantId]);

  const admittedParticipants = useMemo(() => {
    const self = activeParticipants.find(
      (participant) => participant.id === participantId,
    );

    const others = activeParticipants.filter(
      (participant) => participant.id !== participantId,
    );

    if (!self) {
      return others.slice(0, MAX_PARTICIPANTS);
    }

    return [self, ...others].slice(0, MAX_PARTICIPANTS);
  }, [activeParticipants, participantId]);

  const visibleParticipants = useMemo(() => {
    return admittedParticipants.filter(
      (participant) =>
        participant.workId === currentWork.workId &&
        participant.isReading,
    );
  }, [admittedParticipants, currentWork.workId]);

  const isAdmitted = useMemo(() => {
    return admittedParticipants.some(
      (participant) => participant.id === participantId,
    );
  }, [admittedParticipants, participantId]);

  const visibleReactions = useMemo(() => {
    if (!currentGroup) {
      return [];
    }

    return reactions
      .filter((reaction) => reaction.groupId === currentGroup.id)
      .filter((reaction) => {
        if (reaction.workId) {
          return reaction.workId === currentWork?.workId;
        }

        return (
          currentWork?.type === "preset" && reaction.storyKey === selectedStory
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [reactions, selectedStory, currentWork, currentGroup]);

  const createLoginEmail = (username: string) => {
    const safeName = username.trim().toLowerCase();

    return `${encodeURIComponent(safeName)}@shared-reading.local`;
  };

  const handleCreateGroup = async () => {
    if (!authUser) {
      setGroupError("ログインしてください");
      return;
    }

    const trimmedName = groupName.trim();

    if (!trimmedName) {
      setGroupError("グループ名を入力してください");
      return;
    }

    setGroupError("");

    try {
      let createdGroup: ReadingGroup | null = null;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = createGroupCode();

        const groupQuery = query(
          collection(db, "groups"),
          where("code", "==", code),
        );

        const groupSnapshot = await getDocs(groupQuery);

        if (!groupSnapshot.empty) {
          continue;
        }

        const groupRef = doc(collection(db, "groups"));
        const group: ReadingGroup = {
          id: groupRef.id,
          name: trimmedName,
          code,
          createdBy: authUser.uid,
          createdAt: Date.now(),
          memberIds: [authUser.uid],
        };

        await setDoc(groupRef, {
          name: group.name,
          code: group.code,
          createdBy: group.createdBy,
          createdAt: group.createdAt,
          memberIds: group.memberIds,
        });

        createdGroup = group;
        break;
      }

      if (!createdGroup) {
        setGroupError("グループコードの生成に失敗しました");
        return;
      }

      if (participantId && joinedAt) {
        const activeWork =
          currentWorkRef.current ??
          getFallbackCurrentWork(selectedStoryRef.current);

        await setDoc(
          doc(db, "participants", participantId),
          {
            name: usernameRef.current || "名前なし",
            userId: authUser.uid,
            groupId: createdGroup.id,
            workId: activeWork.workId,
            isReading: true,
            paragraphIndex: currentParagraphIndex,
            joinedAt,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }

      window.localStorage.setItem(
        `retaCurrentGroup_${authUser.uid}`,
        createdGroup.id,
      );

      setCurrentGroup(createdGroup);
      setGroupCode(createdGroup.code);
    } catch (error) {
      console.error("グループ作成失敗", error);
      setGroupError("グループを作成できませんでした");
    }
  };

  const handleJoinGroup = async () => {
    if (!authUser) {
      setGroupError("ログインしてください");
      return;
    }

    const normalizedCode = groupCode.trim().toUpperCase();

    if (!normalizedCode) {
      setGroupError("参加コードを入力してください");
      return;
    }

    setGroupError("");

    try {
      const groupQuery = query(
        collection(db, "groups"),
        where("code", "==", normalizedCode),
      );

      const groupSnapshot = await getDocs(groupQuery);

      if (groupSnapshot.empty) {
        setGroupError("この参加コードのグループは見つかりません");
        return;
      }

      const groupDoc = groupSnapshot.docs[0];
      const groupRef = doc(db, "groups", groupDoc.id);

      const joinResult = await runTransaction(db, async (transaction) => {
        const freshGroupSnap = await transaction.get(groupRef);

        if (!freshGroupSnap.exists()) {
          return {
            status: "not-found" as const,
            group: null,
          };
        }

        const freshGroup = normalizeReadingGroup(
          freshGroupSnap.data() as Record<string, unknown>,
          freshGroupSnap.id,
        );

        const alreadyMember = freshGroup.memberIds.includes(authUser.uid);

        if (
          !alreadyMember &&
          freshGroup.memberIds.length >= MAX_PARTICIPANTS
        ) {
          return {
            status: "full" as const,
            group: null,
          };
        }

        const nextMemberIds = alreadyMember
          ? freshGroup.memberIds
          : [...freshGroup.memberIds, authUser.uid];

        if (!alreadyMember) {
          transaction.update(groupRef, {
            memberIds: nextMemberIds,
          });
        }

        return {
          status: "ok" as const,
          group: {
            ...freshGroup,
            memberIds: nextMemberIds,
          },
        };
      });

      if (joinResult.status === "full") {
        setGroupError("このグループは3人参加しているため満員です");
        return;
      }

      if (joinResult.status === "not-found" || !joinResult.group) {
        setGroupError("このグループは見つかりません");
        return;
      }

      const group = joinResult.group;

      if (participantId && joinedAt) {
        const activeWork =
          currentWorkRef.current ??
          getFallbackCurrentWork(selectedStoryRef.current);

        await setDoc(
          doc(db, "participants", participantId),
          {
            name: usernameRef.current || "名前なし",
            userId: authUser.uid,
            groupId: group.id,
            workId: activeWork.workId,
            isReading: true,
            paragraphIndex: currentParagraphIndex,
            joinedAt,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }

      window.localStorage.setItem(
        `retaCurrentGroup_${authUser.uid}`,
        group.id,
      );

      setCurrentGroup(group);
      setGroupCode(group.code);
    } catch (error) {
      console.error("グループ参加失敗", error);

      setGroupError("グループに参加できませんでした");
    }
  };

  const handleRegister = async () => {
    const username = loginName.trim();

    if (!username) {
      setAuthError("利用者名を入力してください");
      return;
    }

    if (loginPassword.length < 6) {
      setAuthError("パスワードは6文字以上にしてください");
      return;
    }

    setIsAuthLoading(true);
    setAuthError("");

    try {
      const usernameDocRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameDocRef);

      if (usernameSnap.exists()) {
        setAuthError("この利用者名はすでに使われています");
        return;
      }

      const email = createLoginEmail(username);
      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        loginPassword,
      );

      await setDoc(doc(db, "users", result.user.uid), {
        uid: result.user.uid,
        username,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await setDoc(usernameDocRef, {
        uid: result.user.uid,
        username,
        createdAt: Date.now(),
      });

      setUsername(username);
      usernameRef.current = username;
      setParticipantId(result.user.uid);
    } catch (error) {
      console.error(error);
      setAuthError("新規登録に失敗しました。別の利用者名で試してください");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    const username = loginName.trim();

    if (!username) {
      setAuthError("利用者名を入力してください");
      return;
    }

    if (!loginPassword) {
      setAuthError("パスワードを入力してください");
      return;
    }

    setIsAuthLoading(true);
    setAuthError("");
    setSessionChecked(false);

    try {
      const email = createLoginEmail(username);
      const result = await signInWithEmailAndPassword(
        auth,
        email,
        loginPassword,
      );

      const sessionDocRef = doc(db, "activeSessions", result.user.uid);
      const now = Date.now();
      const sessionTimeoutMs = 5 * 60 * 1000;
      const sessionStorageKey = `retaActiveSession_${result.user.uid}`;
      const storedSessionId = window.localStorage.getItem(sessionStorageKey);
      const sessionId = storedSessionId || createSessionId();

      const sessionAcquired = await runTransaction(db, async (transaction) => {
        const sessionSnap = await transaction.get(sessionDocRef);

        if (sessionSnap.exists()) {
          const sessionData = sessionSnap.data();

          const existingSessionId =
            typeof sessionData.sessionId === "string"
              ? sessionData.sessionId
              : "";

          const updatedAt = Number(sessionData.updatedAt ?? 0);

          const isActive =
            existingSessionId !== "" &&
            now - updatedAt < sessionTimeoutMs;

          if (isActive && existingSessionId !== sessionId) {
            return false;
          }
        }

        transaction.set(
          sessionDocRef,
          {
            userId: result.user.uid,
            sessionId,
            updatedAt: now,
          },
          { merge: true },
        );

        return true;
      });

      if (!sessionAcquired) {
        await signOut(auth);

        setAuthError(
          "このアカウントは現在、ほかのブラウザまたは端末で利用中です。先にログアウトしてください",
        );

        return;
      }

      sessionIdRef.current = sessionId;
      window.localStorage.setItem(sessionStorageKey, sessionId);
      setSessionChecked(true);
    } catch (error) {
      console.error(error);
      setAuthError("利用者名またはパスワードが違います");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (participantId) {
      try {
        await deleteDoc(doc(db, "participants", participantId));
      } catch (error) {
        console.error("ログアウト時の参加者削除失敗", error);
      }
    }

    if (authUser && sessionIdRef.current) {
      try {
        const sessionDocRef = doc(db, "activeSessions", authUser.uid);
        const sessionSnap = await getDoc(sessionDocRef);

        if (
          sessionSnap.exists() &&
          sessionSnap.data().sessionId === sessionIdRef.current
        ) {
          await deleteDoc(sessionDocRef);
        }
      } catch (error) {
        console.error("ログアウト時のセッション削除失敗", error);
      }
    }

    if (authUser) {
      window.localStorage.removeItem(`retaActiveSession_${authUser.uid}`);
      window.localStorage.removeItem(`retaCurrentGroup_${authUser.uid}`);
    }

    sessionIdRef.current = "";
    setSessionChecked(false);
    setIsAutoScroll(false);

    await signOut(auth);
  };

  const handleLeaveGroup = async () => {
    if (!authUser || !currentGroup) return;

    try {
      const groupRef = doc(db, "groups", currentGroup.id);

      await runTransaction(db, async (transaction) => {
        const groupSnap = await transaction.get(groupRef);

        if (!groupSnap.exists()) {
          return;
        }

        const group = normalizeReadingGroup(
          groupSnap.data() as Record<string, unknown>,
          groupSnap.id,
        );

        const nextMemberIds = group.memberIds.filter(
          (memberId) => memberId !== authUser.uid,
        );

        transaction.update(groupRef, {
          memberIds: nextMemberIds,
        });
      });

      if (participantId) {
        await deleteDoc(doc(db, "participants", participantId));
      }

      window.localStorage.removeItem(
        `retaCurrentGroup_${authUser.uid}`,
      );

      setCurrentGroup(null);
      setGroupName("");
      setGroupCode("");
      setGroupError("");
      setParticipants([]);
    } catch (error) {
      console.error("グループ退会失敗", error);
      setGroupError("グループから退会できませんでした");
    }
  };

  const resetToBeginning = (nextMode: LayoutMode = layoutMode) => {
    const firstIndex = 0;

    setCurrentParagraphIndex(firstIndex);
    currentParagraphIndexRef.current = firstIndex;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToFocus(firstIndex, nextMode);
      });
    });
  };

  const getFirstUnitIndexInParagraph = (paragraphIndex: number) => {
    if (readingUnits.length <= 0) return 0;

    const safeParagraphIndex = Math.max(
      0,
      Math.min(paragraphIndex, paragraphs.length - 1),
    );

    const firstUnit =
      readingUnitsByParagraph.get(safeParagraphIndex)?.[0] ?? readingUnits[0];

    return Math.max(0, Math.min(firstUnit.unitIndex, readingUnits.length - 1));
  };

  const changeLayoutModeKeepingPosition = (nextMode: LayoutMode) => {
    if (nextMode === layoutModeRef.current) return;

    setIsAutoScroll(false);
    setReturnIndex(null);

    const currentUnit = readingUnits[currentParagraphIndexRef.current];
    const currentParagraphIndex =
      currentUnit?.paragraphIndex ?? activeParagraphIndex ?? 0;

    layoutSwitchTargetRef.current = {
      targetMode: nextMode,
      paragraphIndex: currentParagraphIndex,
    };

    const targetIndex = getFirstUnitIndexInParagraph(currentParagraphIndex);

    isRestoringProgressRef.current = true;
    isProgrammaticScrollRef.current = true;

    setCurrentParagraphIndex(targetIndex);
    currentParagraphIndexRef.current = targetIndex;
    updateLocalParticipant(targetIndex);

    writeReadingProgress(
      authUser?.uid ?? "",
      selectedStoryRef.current,
      layoutModeRef.current,
      currentParagraphIndexRef.current,
      readingUnits.length,
      readingAreaRef.current?.scrollLeft ?? 0,
      readingAreaRef.current?.scrollTop ?? 0,
    );

    setLayoutMode(nextMode);
  };

  const refreshStoryProgressSummaries = () => {
    setStoryProgressSummaries(
      loadAllStoryProgressSummaries(authUser?.uid ?? ""),
    );
  };

  const rememberRecentAozoraBook = (book: AozoraSearchBook) => {
    const nextBooks = [
      book,
      ...recentAozoraBooks.filter((recentBook) => recentBook.id !== book.id),
    ].slice(0, 6);

    setRecentAozoraBooks(nextBooks);
    saveRecentAozoraBooksToStorage(nextBooks);
  };
  const openLoadedAozoraText = (
    loadedText: LoadedAozoraText,
    preferredSourceUrl = loadedText.sourceUrl,
    preservePendingRestore = false,
  ) => {
    const canonicalSourceUrl = getCanonicalSourceUrl(preferredSourceUrl);

    const urlWork: CurrentWork = {
      workId: createUrlWorkId(canonicalSourceUrl),
      type: "url",
      title: loadedText.title,
      author: loadedText.author,
      sourceUrl: canonicalSourceUrl,
    };

    setCurrentWork(urlWork);
    currentWorkRef.current = urlWork;


    if (authUser) {
      void setDoc(
        doc(db, "works", urlWork.workId),
        {
          ...urlWork,
          updatedAt: Date.now(),
        },
        { merge: true },
      ).catch((error) => {
        console.error("URL作品情報の保存失敗", error);
      });
    }

    const cleanedParagraphs = cleanAozoraText(
      loadedText.rawText,
      loadedText.title,
      loadedText.author,
    );

    if (cleanedParagraphs.length === 0) {
      throw new Error("本文を整形できませんでした");
    }

    setCustomTitle(loadedText.title);
    setCustomAuthor(loadedText.author);
    setParagraphs(cleanedParagraphs);
    setSelectedWord("");
    setSearchWord("");
    setWikiMeaning("");
    setIsAutoScroll(false);
    setReturnIndex(null);

    paragraphRefs.current = [];

    // 履歴・リロードからの復元時は、ここで0番へ戻したり、
    // 300ms後に復元フラグを解除しない。
    // restoreReadingProgress側が保存位置への移動と復元終了を管理する。
    if (preservePendingRestore) {
      return;
    }

    setCurrentParagraphIndex(0);
    currentParagraphIndexRef.current = 0;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToFocus(0, layoutModeRef.current);

        window.setTimeout(() => {
          isRestoringProgressRef.current = false;
          isProgrammaticScrollRef.current = false;
          isInitialProgressResolvedRef.current = true;
          lastStableParagraphIndexRef.current = 0;
        }, 300);
      });
    });
  };

  const handleSearchAozoraBooks = async () => {
    const keyword = aozoraSearchQuery.trim();

    if (!keyword) {
      setAozoraLoadError("検索したい作品名を入力してください");
      return;
    }

    setIsSearchingAozora(true);
    setAozoraLoadError("");

    try {
      const books = await searchAozoraBooks(keyword);
      setAozoraSearchResults(books);

      if (books.length === 0) {
        setAozoraLoadError(
          "作品が見つかりませんでした。表記を少し変えて検索してください",
        );
      }
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "青空文庫の検索に失敗しました";

      setAozoraLoadError(
        message === "Load failed" || message === "Failed to fetch"
          ? "検索に失敗しました。通信状況を確認して、もう一度試してください"
          : message,
      );
    } finally {
      setIsSearchingAozora(false);
    }
  };

  const handleOpenAozoraBook = async (book: AozoraSearchBook) => {
    const targetUrl = book.cardUrl || book.htmlUrl;

    if (!targetUrl) {
      setAozoraLoadError("この作品のURLが見つかりませんでした");
      return;
    }

    setIsLoadingAozora(true);
    setAozoraLoadError("");
    isRestoringProgressRef.current = true;

    try {
      const loadedText = await loadAozoraTextFromUrl(targetUrl);
      const canonicalSourceUrl = getCanonicalSourceUrl(
        book.cardUrl || targetUrl,
      );

      const workId = createUrlWorkId(canonicalSourceUrl);
      const savedProgress = await loadReadingProgressFromFirestore(workId);

      if (savedProgress) {
        pendingResumeProgressRef.current = savedProgress;
        pendingFreshStartWorkIdRef.current = null;
        setLayoutMode(savedProgress.layoutMode);
        layoutModeRef.current = savedProgress.layoutMode;
      } else {
        pendingResumeProgressRef.current = null;
        pendingFreshStartWorkIdRef.current = workId;
      }

      openLoadedAozoraText(loadedText, canonicalSourceUrl, true);
      setAozoraUrl(canonicalSourceUrl);
      rememberRecentAozoraBook({
        ...book,
        id: createUrlWorkId(canonicalSourceUrl),
        cardUrl: canonicalSourceUrl,
        htmlUrl: loadedText.sourceUrl,
      });
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "青空文庫の読み込みに失敗しました";
      setAozoraLoadError(
        message === "Load failed" || message === "Failed to fetch"
          ? "読み込みに失敗しました。通信状況を確認して、もう一度試してください"
          : message,
      );
      isRestoringProgressRef.current = false;
    } finally {
      setIsLoadingAozora(false);
    }
  };

  const handleLoadAozoraUrl = async () => {
    const trimmedUrl = aozoraUrl.trim();

    if (!trimmedUrl) {
      setAozoraLoadError("青空文庫のURLを入力してください");
      return;
    }

    setIsLoadingAozora(true);
    setAozoraLoadError("");
    setIsAutoScroll(false);
    setReturnIndex(null);
    isRestoringProgressRef.current = true;

    try {
      const loadedText = await loadAozoraTextFromUrl(trimmedUrl);
      const canonicalSourceUrl = getCanonicalSourceUrl(trimmedUrl);

      const workId = createUrlWorkId(canonicalSourceUrl);
      const savedProgress = await loadReadingProgressFromFirestore(workId);

      if (savedProgress) {
        pendingResumeProgressRef.current = savedProgress;
        pendingFreshStartWorkIdRef.current = null;
        setLayoutMode(savedProgress.layoutMode);
        layoutModeRef.current = savedProgress.layoutMode;
      } else {
        pendingResumeProgressRef.current = null;
        pendingFreshStartWorkIdRef.current = workId;
      }

      openLoadedAozoraText(loadedText, canonicalSourceUrl, true);
      setAozoraUrl(canonicalSourceUrl);

      const recentBook: AozoraSearchBook = {
        id: createUrlWorkId(canonicalSourceUrl),
        title: loadedText.title,
        author: loadedText.author,
        cardUrl: canonicalSourceUrl,
        htmlUrl: loadedText.sourceUrl,
        firstLine: "",
        characters: 0,
        updatedAt: "",
      };

      rememberRecentAozoraBook(recentBook);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "青空文庫の読み込みに失敗しました";

      setAozoraLoadError(message);
      isRestoringProgressRef.current = false;
    } finally {
      setIsLoadingAozora(false);
    }
  };

  const loadReadingProgressFromFirestore = async (
    workId: string,
  ): Promise<UserReadingProgress | null> => {
    if (!authUser || !workId) return null;

    try {
      const progressDocId = `${authUser.uid}_${workId}`;
      const progressSnap = await getDoc(
        doc(db, "readingProgress", progressDocId),
      );

      if (!progressSnap.exists()) {
        return null;
      }

      const progress = normalizeUserReadingProgress(progressSnap.data());

      if (
        progress.userId !== authUser.uid ||
        progress.workId !== workId ||
        progress.readingUnitsLength <= 0
      ) {
        return null;
      }

      const safeIndex = Math.max(
        0,
        Math.min(
          progress.currentParagraphIndex,
          progress.readingUnitsLength - 1,
        ),
      );

      return {
        ...progress,
        docId: progressSnap.id,
        currentParagraphIndex: safeIndex,
        percent: getDisplayPercent(
          safeIndex,
          progress.readingUnitsLength,
        ),
      };
    } catch (error) {
      console.error("Firestoreからの読書位置取得失敗", error);
      return null;
    }
  };

  const handleSelectPresetStory = async (storyKey: StoryKey) => {
    const nextWork = createPresetWork(storyKey);

    setIsAutoScroll(false);
    setReturnIndex(null);
    setSelectedWord("");
    setSearchWord("");
    setWikiMeaning("");
    setCustomTitle("");
    setCustomAuthor("");
    setAozoraUrl("");
    setAozoraLoadError("");

    isRestoringProgressRef.current = true;
    isInitialProgressResolvedRef.current = false;

    const savedProgress = await loadReadingProgressFromFirestore(
      nextWork.workId,
    );

    if (savedProgress) {
      pendingResumeProgressRef.current = savedProgress;
      pendingFreshStartWorkIdRef.current = null;
      setLayoutMode(savedProgress.layoutMode);
      layoutModeRef.current = savedProgress.layoutMode;
    } else {
      pendingResumeProgressRef.current = null;
      pendingFreshStartWorkIdRef.current = nextWork.workId;
    }

    setLoadMode("preset");
    setSelectedStory(storyKey);
    selectedStoryRef.current = storyKey;
    setCurrentWork(nextWork);
    currentWorkRef.current = nextWork;
  };

  const handleOpenReadingProgress = async (progress: UserReadingProgress) => {
    setIsAutoScroll(false);
    setReturnIndex(null);
    setSelectedWord("");
    setSearchWord("");
    setWikiMeaning("");
    setLayoutMode(progress.layoutMode);
    pendingResumeProgressRef.current = progress;

    if (progress.workType === "preset" && isStoryKey(progress.storyKey)) {
      const nextWork = createPresetWork(progress.storyKey);
      setLoadMode("preset");
      setSelectedStory(progress.storyKey);
      setCurrentWork(nextWork);
      currentWorkRef.current = nextWork;
      setCustomTitle("");
      setCustomAuthor("");
      setAozoraUrl("");
      setAozoraLoadError("");
      return;
    }

    if (progress.workType === "url" && progress.sourceUrl) {
      setLoadMode("url");
      setAozoraUrl(progress.sourceUrl);
      setIsLoadingAozora(true);
      setAozoraLoadError("");
      isRestoringProgressRef.current = true;

      try {
        const canonicalSourceUrl = getCanonicalSourceUrl(progress.sourceUrl);
        const loadedText = await loadAozoraTextFromUrl(canonicalSourceUrl);
        setAozoraUrl(canonicalSourceUrl);
        openLoadedAozoraText(loadedText, canonicalSourceUrl, true);
      } catch (error) {
        console.error(error);
        setAozoraLoadError("履歴から作品を開けませんでした");
        pendingResumeProgressRef.current = null;
        isRestoringProgressRef.current = false;
      } finally {
        setIsLoadingAozora(false);
      }
    }
  };

  const showReadingProgressNotice = (message: string) => {
    setReadingProgressNotice(message);

    if (progressNoticeTimerRef.current !== null) {
      window.clearTimeout(progressNoticeTimerRef.current);
    }

    progressNoticeTimerRef.current = window.setTimeout(() => {
      setReadingProgressNotice("");
    }, 1800);
  };

  const saveReadingProgressToFirestore = (
    nextIndex: number,
    unitsLength: number,
    scrollLeft: number,
    scrollTop: number,
  ) => {
    if (!authUser) return;
    if (unitsLength <= 0) return;

    const activeWork =
      currentWorkRef.current ??
      getFallbackCurrentWork(selectedStoryRef.current);

    const safeIndex = Math.max(0, Math.min(nextIndex, unitsLength - 1));
    const progressDocId = `${authUser.uid}_${activeWork.workId}`;
    const percent = getDisplayPercent(safeIndex, unitsLength);

    void setDoc(
      doc(db, "readingProgress", progressDocId),
      {
        userId: authUser.uid,
        username: usernameRef.current || "名前なし",
        workId: activeWork.workId,
        workType: activeWork.type,
        title: activeWork.title,
        author: activeWork.author,
        sourceUrl: activeWork.sourceUrl,
        storyKey: activeWork.type === "preset" ? selectedStoryRef.current : "",
        layoutMode: layoutModeRef.current,
        currentParagraphIndex: safeIndex,
        readingUnitsLength: unitsLength,
        percent,
        scrollLeft,
        scrollTop,
        updatedAt: Date.now(),
      },
      { merge: true },
    ).catch((error) => {
      console.error("Firestoreへの読書位置保存失敗", error);
    });
  };

  const saveReadingProgress = (
    nextIndex = currentParagraphIndexRef.current,
  ) => {
    if (Date.now() < restoreGuardUntilRef.current) return;
    if (isRestoringProgressRef.current) return;
    if (!isInitialProgressResolvedRef.current) return;
    if (isPageLeavingRef.current) return;
    if (readingUnits.length <= 0) return;

    const scrollLeft = readingAreaRef.current?.scrollLeft ?? 0;
    const scrollTop = readingAreaRef.current?.scrollTop ?? 0;

    const activeWork = currentWorkRef.current;

    saveLastReadingState(
      authUser?.uid ?? "",
      activeWork,
      activeWork.type === "preset" ? selectedStoryRef.current : "",
      layoutModeRef.current,
      nextIndex,
      readingUnits.length,
      scrollLeft,
      scrollTop,
    );

    // localStorageの保存キーはプリセット作品用なので、URL作品の位置を
    // 選択中プリセット作品へ誤保存しない。
    if (currentWorkRef.current.type === "preset") {
      writeReadingProgress(
        authUser?.uid ?? "",
        selectedStoryRef.current,
        layoutModeRef.current,
        nextIndex,
        readingUnits.length,
        scrollLeft,
        scrollTop,
      );
    }

    saveReadingProgressToFirestore(
      nextIndex,
      readingUnits.length,
      scrollLeft,
      scrollTop,
    );

    refreshStoryProgressSummaries();
    showReadingProgressNotice("自動保存中");
  };

  const restoreReadingProgress = (
    progress: ReadingProgress,
    targetLayoutMode: LayoutMode,
  ) => {
    if (readingUnits.length <= 0) return;

    const savedLength = Math.max(1, Number(progress.readingUnitsLength || 1));
    const currentLength = Math.max(1, readingUnits.length);

    const savedRatio =
      savedLength <= 1
        ? 0
        : Math.max(
            0,
            Math.min(progress.currentParagraphIndex, savedLength - 1),
          ) /
          (savedLength - 1);

    const safeIndex = Math.max(
      0,
      Math.min(
        savedLength === currentLength
          ? progress.currentParagraphIndex
          : Math.round(savedRatio * (currentLength - 1)),
        currentLength - 1,
      ),
    );

    // Safariの遅延scrollイベントを含め、復元中の位置再判定を止める。
    const guardDuration = 3600;
    restoreGuardUntilRef.current = Date.now() + guardDuration;
    isRestoringProgressRef.current = true;
    isProgrammaticScrollRef.current = true;
    isInitialProgressResolvedRef.current = false;

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }

    setCurrentParagraphIndex(safeIndex);
    currentParagraphIndexRef.current = safeIndex;
    lastStableParagraphIndexRef.current = safeIndex;
    updateLocalParticipant(safeIndex);

    // 登録済み作品だけ、作品別のlocalStorageにも同じ正確な位置を保存する。
    if (currentWorkRef.current.type === "preset") {
      writeReadingProgress(
        authUser?.uid ?? "",
        selectedStoryRef.current,
        targetLayoutMode,
        safeIndex,
        readingUnits.length,
        progress.scrollLeft,
        progress.scrollTop ?? 0,
      );
    }

    const lockSavedPosition = () => {
      setCurrentParagraphIndex(safeIndex);
      currentParagraphIndexRef.current = safeIndex;
      lastStableParagraphIndexRef.current = safeIndex;
      lockViewportToProgress(safeIndex, targetLayoutMode);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lockSavedPosition();

        // Safariではフォント・縦書き・row-reverseの再配置が遅れるため、
        // 数回同じ位置へ固定して、途中のscrollイベントは読み捨てる。
        [100, 300, 700, 1200, 2000, 3000].forEach((delay) => {
          window.setTimeout(lockSavedPosition, delay);
        });

        if ("fonts" in document) {
          void document.fonts.ready.then(() => {
            lockSavedPosition();
          });
        }

        window.setTimeout(() => {
          lockSavedPosition();

          const activeWork = currentWorkRef.current;
          saveLastReadingState(
            authUser?.uid ?? "",
            activeWork,
            activeWork.type === "preset" ? selectedStoryRef.current : "",
            targetLayoutMode,
            safeIndex,
            readingUnits.length,
            readingAreaRef.current?.scrollLeft ?? 0,
            readingAreaRef.current?.scrollTop ?? 0,
          );

          refreshStoryProgressSummaries();
          restoreGuardUntilRef.current = 0;
          isRestoringProgressRef.current = false;
          isProgrammaticScrollRef.current = false;
          isInitialProgressResolvedRef.current = true;
        }, guardDuration);
      });
    });
  };

  useEffect(() => {
    if (!authUser || !sessionChecked || !sessionIdRef.current) return;

    const updateSession = async () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      try {
        const sessionDocRef = doc(db, "activeSessions", authUser.uid);
        const sessionSnap = await getDoc(sessionDocRef);

        if (
          !sessionSnap.exists() ||
          sessionSnap.data().sessionId !== sessionId
        ) {
          return;
        }

        await setDoc(
          sessionDocRef,
          {
            userId: authUser.uid,
            sessionId,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      } catch (error) {
        console.error("セッション更新失敗", error);
      }
    };

    void updateSession();

    const intervalId = window.setInterval(() => {
      void updateSession();
    }, 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser, sessionChecked]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthChecked(true);

      if (!user) {
        setUsername("");
        usernameRef.current = "";
        setParticipantId("");
        setJoinedAt(0);
        setUserReadingProgresses([]);
        pendingResumeProgressRef.current = null;
        pendingFreshStartWorkIdRef.current = null;
        didLoadLastReadingStateRef.current = false;
        return;
      }

      setParticipantId(user.uid);
      setJoinedAt(Date.now());

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();
        const username =
          typeof userData?.username === "string" ? userData.username : "";

        setUsername(username);
        usernameRef.current = username;
      } catch (error) {
        console.error("利用者情報の取得失敗", error);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authChecked || !authUser) {
      setCurrentGroup(null);
      return;
    }

    const restoreCurrentGroup = async () => {
      const storageKey = `retaCurrentGroup_${authUser.uid}`;
      const storedGroupId = window.localStorage.getItem(storageKey);

      if (!storedGroupId) {
        setCurrentGroup(null);
        return;
      }

      try {
        const groupSnap = await getDoc(doc(db, "groups", storedGroupId));

        if (!groupSnap.exists()) {
          window.localStorage.removeItem(storageKey);
          setCurrentGroup(null);
          return;
        }

        const group = normalizeReadingGroup(
          groupSnap.data() as Record<string, unknown>,
          groupSnap.id,
        );

        if (!group.memberIds.includes(authUser.uid)) {
          window.localStorage.removeItem(storageKey);
          setCurrentGroup(null);
          setGroupCode("");
          return;
        }

        setCurrentGroup(group);
        setGroupCode(group.code);
      } catch (error) {
        console.error("グループ復元失敗", error);
        setCurrentGroup(null);
      }
    };

    void restoreCurrentGroup();
  }, [authChecked, authUser]);

  useEffect(() => {
    if (!authChecked || !authUser || isAuthLoading) return;
    if (sessionChecked || sessionIdRef.current) return;

    const restoreBrowserSession = async () => {
      const sessionStorageKey = `retaActiveSession_${authUser.uid}`;
      const storedSessionId = window.localStorage.getItem(sessionStorageKey);

      // 単一セッション機能導入前から残っているログイン状態。
      // 所有しているセッションを確認できないため、一度ログアウトして再ログインしてもらう。
      if (!storedSessionId) {
        setAuthError(
          "ログイン状態を更新しました。もう一度ログインしてください",
        );
        await signOut(auth);
        return;
      }

      try {
        const sessionDocRef = doc(db, "activeSessions", authUser.uid);
        const sessionSnap = await getDoc(sessionDocRef);
        const now = Date.now();
        const sessionTimeoutMs = 5 * 60 * 1000;

        if (sessionSnap.exists()) {
          const data = sessionSnap.data();
          const existingSessionId =
            typeof data.sessionId === "string" ? data.sessionId : "";
          const updatedAt = Number(data.updatedAt ?? 0);
          const isActive =
            existingSessionId !== "" &&
            now - updatedAt < sessionTimeoutMs;

          if (isActive && existingSessionId !== storedSessionId) {
            window.localStorage.removeItem(sessionStorageKey);
            setAuthError(
              "このアカウントは現在、ほかのブラウザまたは端末で利用中です。先にログアウトしてください",
            );
            await signOut(auth);
            return;
          }
        }

        await setDoc(
          sessionDocRef,
          {
            userId: authUser.uid,
            sessionId: storedSessionId,
            updatedAt: now,
          },
          { merge: true },
        );

        sessionIdRef.current = storedSessionId;
        setSessionChecked(true);
      } catch (error) {
        console.error("ブラウザセッションの復元失敗", error);
        setAuthError("ログイン状態の確認に失敗しました");
        await signOut(auth);
      }
    };

    void restoreBrowserSession();
  }, [authChecked, authUser, sessionChecked, isAuthLoading]);

  useEffect(() => {
    if (!authChecked) return;
    if (didLoadLastReadingStateRef.current) return;

    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    refreshStoryProgressSummaries();

    const lastState = authUser
      ? loadLastReadingState(authUser.uid)
      : null;

    if (lastState) {
      setLayoutMode(lastState.layoutMode);
      layoutModeRef.current = lastState.layoutMode;

      if (
        lastState.workType === "preset" &&
        isStoryKey(lastState.storyKey)
      ) {
        setLoadMode("preset");
        setSelectedStory(lastState.storyKey);
        selectedStoryRef.current = lastState.storyKey;
        isRestoringProgressRef.current = true;
        isInitialProgressResolvedRef.current = false;

        pendingResumeProgressRef.current = {
          userId: auth.currentUser?.uid ?? "",
          username: usernameRef.current || "名前なし",
          workId: lastState.workId,
          workType: "preset",
          title: lastState.title,
          author: lastState.author,
          sourceUrl: lastState.sourceUrl,
          storyKey: lastState.storyKey,
          layoutMode: lastState.layoutMode,
          currentParagraphIndex: lastState.currentParagraphIndex,
          readingUnitsLength: lastState.readingUnitsLength,
          percent: getDisplayPercent(
            lastState.currentParagraphIndex,
            Math.max(1, lastState.readingUnitsLength),
          ),
          scrollLeft: lastState.scrollLeft,
          scrollTop: lastState.scrollTop,
          updatedAt: lastState.savedAt,
        };
      }

      if (lastState.workType === "url" && lastState.sourceUrl) {
        setLoadMode("url");
        setAozoraUrl(lastState.sourceUrl);
        isRestoringProgressRef.current = true;
        isInitialProgressResolvedRef.current = false;

        pendingResumeProgressRef.current = {
          userId: auth.currentUser?.uid ?? "",
          username: usernameRef.current || "名前なし",
          workId: lastState.workId,
          workType: "url",
          title: lastState.title,
          author: lastState.author,
          sourceUrl: lastState.sourceUrl,
          storyKey: "",
          layoutMode: lastState.layoutMode,
          currentParagraphIndex: lastState.currentParagraphIndex,
          readingUnitsLength: lastState.readingUnitsLength,
          percent: getDisplayPercent(
            lastState.currentParagraphIndex,
            Math.max(1, lastState.readingUnitsLength),
          ),
          scrollLeft: lastState.scrollLeft,
          scrollTop: lastState.scrollTop,
          updatedAt: lastState.savedAt,
        };

        void (async () => {
          try {
            const loadedText = await loadAozoraTextFromUrl(
              lastState.sourceUrl,
            );

            const urlWork: CurrentWork = {
              workId: lastState.workId,
              type: "url",
              title: lastState.title,
              author: lastState.author,
              sourceUrl: lastState.sourceUrl,
            };

            setCurrentWork(urlWork);
            currentWorkRef.current = urlWork;

            openLoadedAozoraText(
              loadedText,
              lastState.sourceUrl,
              true,
            );
          } catch (error) {
            console.error("前回のURL作品の復元に失敗", error);
            setAozoraLoadError("前回開いていたURL作品を復元できませんでした");
            isRestoringProgressRef.current = false;
            isInitialProgressResolvedRef.current = true;
          }
        })();
      }
    }

    setRecentAozoraBooks(loadRecentAozoraBooksFromStorage());

    didLoadLastReadingStateRef.current = true;
  }, [authChecked, authUser]);

  useEffect(() => {
    if (!authChecked || !authUser) return;

    setParticipantId(authUser.uid);
    setJoinedAt(Date.now());
  }, [authChecked, authUser]);

  useEffect(() => {
    currentParagraphIndexRef.current = currentParagraphIndex;
  }, [currentParagraphIndex]);

  // 現在開いている作品を参加者情報へ即時反映する。
  // 同じ作品を読んでいる参加者だけをリアルタイム表示するために使用する。
  useEffect(() => {
    if (!authUser || !participantId || !joinedAt) return;
    if (document.visibilityState !== "visible") return;

    void setDoc(
      doc(db, "participants", participantId),
      {
        name: usernameRef.current || "名前なし",
        userId: authUser.uid,
        workId: currentWork.workId,
        isReading: true,
        paragraphIndex: currentParagraphIndexRef.current,
        joinedAt,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  }, [participantId, joinedAt, authUser?.uid, currentWork.workId]);

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    selectedStoryRef.current = selectedStory;
  }, [selectedStory]);

  useEffect(() => {
    currentWorkRef.current = currentWork;
  }, [currentWork]);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    readingUnitsLengthRef.current = readingUnits.length;
  }, [readingUnits.length]);

  useEffect(() => {
    if (loadMode === "url") return;

    const story = stories[selectedStory];
    const presetWork = createPresetWork(selectedStory);
    setCurrentWork(presetWork);
    currentWorkRef.current = presetWork;

    if (authUser) {
      void setDoc(
        doc(db, "works", presetWork.workId),
        {
          ...presetWork,
          updatedAt: Date.now(),
        },
        { merge: true },
      ).catch((error) => {
        console.error("作品情報の保存失敗", error);
      });
    }

    const requestId = textLoadRequestIdRef.current + 1;
    textLoadRequestIdRef.current = requestId;

    const loadText = async () => {
      // 作品切り替え中の一瞬の0%・100%保存を防ぐ。
      isRestoringProgressRef.current = true;
      isInitialProgressResolvedRef.current = false;
      setCurrentParagraphIndex(0);
      currentParagraphIndexRef.current = 0;
      paragraphRefs.current = [];

      if (!("textFile" in story)) {
        if (textLoadRequestIdRef.current === requestId) {
          setParagraphs([]);
          isRestoringProgressRef.current = false;
        }
        return;
      }

      try {
        const response = await fetch(story.textFile);
        const rawText = await response.text();

        if (textLoadRequestIdRef.current !== requestId) return;

        const cleanedParagraphs = cleanAozoraText(
          rawText,
          story.title,
          story.author,
        );

        setParagraphs(cleanedParagraphs);
      } catch (error) {
        console.error("本文読み込み失敗", error);

        if (textLoadRequestIdRef.current === requestId) {
          setParagraphs([]);
          isRestoringProgressRef.current = false;
        }
      }
    };

    loadText();
  }, [selectedStory, loadMode, authUser]);

  useEffect(() => {
    if (readingUnits.length === 0) return;
    if (!didLoadLastReadingStateRef.current) return;

    const switchTarget = layoutSwitchTargetRef.current;

    if (switchTarget && switchTarget.targetMode === layoutMode) {
      const targetIndex = getFirstUnitIndexInParagraph(
        switchTarget.paragraphIndex,
      );

      layoutSwitchTargetRef.current = null;

      isRestoringProgressRef.current = true;
      isProgrammaticScrollRef.current = true;

      setCurrentParagraphIndex(targetIndex);
      currentParagraphIndexRef.current = targetIndex;
      updateLocalParticipant(targetIndex);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToFocus(targetIndex, layoutMode);

          window.setTimeout(
            () => {
              writeReadingProgress(
                authUser?.uid ?? "",
                selectedStoryRef.current,
                layoutMode,
                targetIndex,
                readingUnits.length,
                readingAreaRef.current?.scrollLeft ?? 0,
                readingAreaRef.current?.scrollTop ?? 0,
              );

              refreshStoryProgressSummaries();

              lastStableParagraphIndexRef.current = targetIndex;
              isRestoringProgressRef.current = false;
              isProgrammaticScrollRef.current = false;
              isInitialProgressResolvedRef.current = true;
            },
            layoutMode === "horizontal" ? 320 : 220,
          );
        });
      });

      return;
    }

    const pendingResumeProgress = pendingResumeProgressRef.current;

    if (
      pendingResumeProgress &&
      pendingResumeProgress.workId === currentWorkRef.current.workId
    ) {
      pendingResumeProgressRef.current = null;

      restoreReadingProgress(
        {
          storyKey: isStoryKey(pendingResumeProgress.storyKey)
            ? pendingResumeProgress.storyKey
            : selectedStory,
          layoutMode: pendingResumeProgress.layoutMode,
          currentParagraphIndex: pendingResumeProgress.currentParagraphIndex,
          scrollLeft: pendingResumeProgress.scrollLeft,
          scrollTop: pendingResumeProgress.scrollTop,
          readingUnitsLength: pendingResumeProgress.readingUnitsLength,
          savedAt: pendingResumeProgress.updatedAt,
        },
        pendingResumeProgress.layoutMode,
      );
      return;
    }

    const pendingFreshStartWorkId = pendingFreshStartWorkIdRef.current;

    if (
      pendingFreshStartWorkId &&
      pendingFreshStartWorkId === currentWorkRef.current.workId
    ) {
      pendingFreshStartWorkIdRef.current = null;

      resetToBeginning(layoutMode);
      lastStableParagraphIndexRef.current = 0;

      window.setTimeout(() => {
        isRestoringProgressRef.current = false;
        isProgrammaticScrollRef.current = false;
        isInitialProgressResolvedRef.current = true;
      }, 350);

      return;
    }

    // URL作品を新しく開いた場合は、選択中プリセット作品のlocalStorageを
    // 誤って適用しない。履歴から開いた場合は上のpendingResumeProgressで復元済み。
    if (currentWorkRef.current.type === "url") {
      resetToBeginning(layoutMode);
      lastStableParagraphIndexRef.current = 0;

      window.setTimeout(() => {
        isRestoringProgressRef.current = false;
        isProgrammaticScrollRef.current = false;
        isInitialProgressResolvedRef.current = true;
      }, 350);
      return;
    }

    const savedProgress = loadReadingProgressFromStorage(
      authUser?.uid ?? "",
      selectedStory,
      layoutMode,
    );

    if (savedProgress) {
      restoreReadingProgress(savedProgress, layoutMode);
      return;
    }

    resetToBeginning(layoutMode);
    lastStableParagraphIndexRef.current = 0;
    refreshStoryProgressSummaries();

    window.setTimeout(() => {
      isRestoringProgressRef.current = false;
      isProgrammaticScrollRef.current = false;
      isInitialProgressResolvedRef.current = true;
    }, 350);
  }, [
    readingUnits.length,
    selectedStory,
    layoutMode,
    paragraphs.length,
    readingUnitsByParagraph,
  ]);

  useEffect(() => {
    if (!currentGroup) {
      setParticipants([]);
      return;
    }

    const q = query(
      collection(db, "participants"),
      where("groupId", "==", currentGroup.id),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map((docData) =>
          normalizeParticipant(docData.data(), docData.id),
        )
        .filter((participant) =>
          currentGroup.memberIds.includes(participant.id),
        );

      setParticipants(data);
    });

    return () => unsubscribe();
  }, [currentGroup]);

  useEffect(() => {
    const handleLeave = () => {
      isPageLeavingRef.current = true;

      if (authUser && participantId) {
        void setDoc(
          doc(db, "participants", participantId),
          {
            isReading: false,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }

      // 読み込み・復元途中の値を終了時に保存しない。
      if (Date.now() < restoreGuardUntilRef.current) return;
      if (isRestoringProgressRef.current) return;
      if (!isInitialProgressResolvedRef.current) return;
      if (readingUnitsLengthRef.current <= 0) return;

      const scrollLeft = readingAreaRef.current?.scrollLeft ?? 0;
      const scrollTop = readingAreaRef.current?.scrollTop ?? 0;
      const stableIndex = Math.max(
        0,
        Math.min(
          lastStableParagraphIndexRef.current,
          readingUnitsLengthRef.current - 1,
        ),
      );

      // localStorageはプリセット作品だけに使う。
      if (currentWorkRef.current.type === "preset") {
        writeReadingProgress(
          authUser?.uid ?? "",
          selectedStoryRef.current,
          layoutModeRef.current,
          stableIndex,
          readingUnitsLengthRef.current,
          scrollLeft,
          scrollTop,
        );
      }

      saveReadingProgressToFirestore(
        stableIndex,
        readingUnitsLengthRef.current,
        scrollLeft,
        scrollTop,
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleLeave();
      } else {
        isPageLeavingRef.current = false;

        if (authUser && participantId) {
          const activeWork =
            currentWorkRef.current ??
            getFallbackCurrentWork(selectedStoryRef.current);

          void setDoc(
            doc(db, "participants", participantId),
            {
              name: usernameRef.current || "名前なし",
              userId: authUser.uid,
              groupId: currentGroup?.id ?? "",
              workId: activeWork.workId,
              isReading: true,
              paragraphIndex: currentParagraphIndexRef.current,
              joinedAt: joinedAt || Date.now(),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        }
      }
    };

    window.addEventListener("pagehide", handleLeave);
    window.addEventListener("beforeunload", handleLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      // React Strict Modeの検証用cleanupで読書位置を保存しない。
      window.removeEventListener("pagehide", handleLeave);
      window.removeEventListener("beforeunload", handleLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [participantId, currentGroup]);

  useEffect(() => {
    if (!currentGroup) {
      setReactions([]);
      return;
    }

    const q = query(
      collection(db, "reactions"),
      where("groupId", "==", currentGroup.id),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docData) =>
        normalizeReaction(docData.data()),
      );

      setReactions(data);
    });

    return () => unsubscribe();
  }, [currentGroup]);

  useEffect(() => {
    if (!authUser) {
      setUserReadingProgresses([]);
      return;
    }

    const q = query(collection(db, "readingProgress"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userProgresses = snapshot.docs
        .map((docData) => ({
          ...normalizeUserReadingProgress(docData.data()),
          docId: docData.id,
        }))
        .filter((progress) => progress.userId === authUser.uid)
        .filter((progress) => progress.workId.trim() !== "");

      const latestByWorkId = new Map<string, UserReadingProgress>();

      userProgresses.forEach((progress) => {
        const current = latestByWorkId.get(progress.workId);
        if (!current || progress.updatedAt > current.updatedAt) {
          latestByWorkId.set(progress.workId, progress);
        }
      });

      latestByWorkId.forEach((latest) => {
        const canonicalDocId = `${authUser.uid}_${latest.workId}`;

        if (latest.docId !== canonicalDocId) {
          void setDoc(
            doc(db, "readingProgress", canonicalDocId),
            {
              userId: latest.userId,
              username: latest.username,
              workId: latest.workId,
              workType: latest.workType,
              title: latest.title,
              author: latest.author,
              sourceUrl: latest.sourceUrl,
              storyKey: latest.storyKey,
              layoutMode: latest.layoutMode,
              currentParagraphIndex: latest.currentParagraphIndex,
              readingUnitsLength: latest.readingUnitsLength,
              percent: latest.percent,
              scrollLeft: latest.scrollLeft,
              scrollTop: latest.scrollTop,
              updatedAt: latest.updatedAt,
            },
            { merge: true },
          );
        }
      });

      userProgresses.forEach((progress) => {
        const canonicalDocId = `${authUser.uid}_${progress.workId}`;
        const latest = latestByWorkId.get(progress.workId);

        if (progress.docId && progress.docId !== canonicalDocId) {
          void deleteDoc(doc(db, "readingProgress", progress.docId));
          return;
        }
      });

      const data = Array.from(latestByWorkId.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8);

      setUserReadingProgresses(data);
    });

    return () => unsubscribe();
  }, [authUser]);

  const saveParticipantToFirestore = async (
    nextName: string,
    nextParagraphIndex: number,
  ) => {
    if (!authUser || !participantId || !joinedAt) return;

    const activeWork =
      currentWorkRef.current ??
      getFallbackCurrentWork(selectedStoryRef.current);

    await setDoc(
      doc(db, "participants", participantId),
      {
        name: nextName || usernameRef.current || "名前なし",
        userId: authUser.uid,
        groupId: currentGroup?.id ?? "",
        workId: activeWork.workId,
        isReading: true,
        paragraphIndex: nextParagraphIndex,
        joinedAt,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  };

  const updateLocalParticipant = (nextParagraphIndex: number) => {
    if (!participantId) return;

    const activeWork =
      currentWorkRef.current ??
      getFallbackCurrentWork(selectedStoryRef.current);

    setParticipants((prev) => {
      const exists = prev.some(
        (participant) => participant.id === participantId,
      );

      if (!exists) {
        return [
          ...prev,
          {
            id: participantId,
            name: usernameRef.current || "名前なし",
            groupId: currentGroup?.id ?? "",
            workId: activeWork.workId,
            isReading: true,
            paragraphIndex: nextParagraphIndex,
            joinedAt: joinedAt || Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      return prev.map((participant) =>
        participant.id === participantId
          ? {
              ...participant,
              name: usernameRef.current || participant.name,
              groupId: currentGroup?.id ?? participant.groupId,
              workId: activeWork.workId,
              isReading: true,
              paragraphIndex: nextParagraphIndex,
              updatedAt: Date.now(),
            }
          : participant,
      );
    });
  };

  const getFocusX = (mode: LayoutMode, areaRect: DOMRect) => {
    // 縦書き通常段落は文頭を少し右寄りへ。
    // 2文グループは画面中央へ。
    const ratio = mode === "grouped" ? 0.5 : 0.82;
    return areaRect.left + areaRect.width * ratio;
  };

  const getFocusY = (areaRect: DOMRect) => {
    // 横書き縦スクロールでは、画面中央より少し上を現在位置の基準にする。
    return areaRect.top + areaRect.height * 0.42;
  };

  // リロード復元時に、保存された読書単位を確実に画面内へ戻す。
  // flex-direction: row-reverse の横スクロールでは scrollLeft の正負が
  // ブラウザごとに異なるため、絶対座標を計算せずDOM要素を直接表示する。
  const lockViewportToProgress = (
    index: number,
    mode: LayoutMode = layoutModeRef.current,
  ) => {
    const readingArea = readingAreaRef.current;
    if (!readingArea || readingUnits.length <= 0) return false;

    const safeIndex = Math.max(0, Math.min(index, readingUnits.length - 1));
    const targetUnit = readingUnits[safeIndex];

    let targetElement = paragraphRefs.current[safeIndex];

    // 通常段落・横書きでは複数の読書単位が同じDOM段落を共有する。
    // 念のため、同じ段落に属する別の読書単位のrefも探す。
    if (!targetElement && targetUnit) {
      const unitsInSameParagraph =
        readingUnitsByParagraph.get(targetUnit.paragraphIndex) ?? [];

      for (const unit of unitsInSameParagraph) {
        const candidate = paragraphRefs.current[unit.unitIndex];
        if (candidate) {
          targetElement = candidate;
          break;
        }
      }
    }

    if (!targetElement) return false;

    isProgrammaticScrollRef.current = true;

    targetElement.scrollIntoView({
      behavior: "auto",
      block: mode === "horizontal" ? "center" : "nearest",
      inline: mode === "horizontal" ? "nearest" : "center",
    });

    requestAnimationFrame(() => {
      const areaRect = readingArea.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();

      if (mode === "horizontal") {
        const diff =
          targetRect.top + targetRect.height / 2 - getFocusY(areaRect);
        readingArea.scrollBy({ top: diff, left: 0, behavior: "auto" });
      } else {
        const targetPoint =
          mode === "normal"
            ? targetRect.right
            : targetRect.left + targetRect.width / 2;
        const diff = targetPoint - getFocusX(mode, areaRect);

        readingArea.scrollBy({ left: diff, top: 0, behavior: "auto" });
      }
    });

    return true;
  };

  const scrollToFocus = (index: number, mode: LayoutMode = layoutMode) => {
    lockViewportToProgress(index, mode);
  };

  const updateActiveUnitByCenter = () => {
    if (Date.now() < restoreGuardUntilRef.current) return;
    if (isProgrammaticScrollRef.current) return;
    if (isRestoringProgressRef.current) return;
    if (!isInitialProgressResolvedRef.current) return;
    if (isPageLeavingRef.current) return;

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      // requestAnimationFrameを予約した後に、URL作品の復元や
      // プログラムによるスクロールが始まる可能性があるため、
      // 実行直前にも状態を確認する。
      if (Date.now() < restoreGuardUntilRef.current) return;
      if (isProgrammaticScrollRef.current) return;
      if (isRestoringProgressRef.current) return;
      if (!isInitialProgressResolvedRef.current) return;
      if (isPageLeavingRef.current) return;

      const readingArea = readingAreaRef.current;
      if (!readingArea) return;

      const activeLayoutMode = layoutModeRef.current;
      const areaRect = readingArea.getBoundingClientRect();

      let nearestIndex = currentParagraphIndexRef.current;
      let nearestDistance = Infinity;

      paragraphRefs.current.forEach((element, index) => {
        if (!element) return;

        const rect = element.getBoundingClientRect();

        const targetPoint =
          activeLayoutMode === "horizontal"
            ? rect.top
            : activeLayoutMode === "normal"
              ? rect.right
              : rect.left + rect.width / 2;

        const focusPoint =
          activeLayoutMode === "horizontal"
            ? getFocusY(areaRect)
            : getFocusX(activeLayoutMode, areaRect);

        const distance = Math.abs(targetPoint - focusPoint);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      if (nearestIndex === currentParagraphIndexRef.current) return;

      // DOM位置の判定中に復元処理が始まった場合は、誤った段落を
      // 現在位置として保存しないよう、更新直前にも再確認する。
      if (Date.now() < restoreGuardUntilRef.current) return;
      if (isProgrammaticScrollRef.current) return;
      if (isRestoringProgressRef.current) return;
      if (!isInitialProgressResolvedRef.current) return;
      if (isPageLeavingRef.current) return;

      setCurrentParagraphIndex(nearestIndex);
      currentParagraphIndexRef.current = nearestIndex;
      lastStableParagraphIndexRef.current = nearestIndex;
      updateLocalParticipant(nearestIndex);
      saveReadingProgress(nearestIndex);

      if (isAdmitted) {
        saveParticipantToFirestore(usernameRef.current, nearestIndex);
      }
    });
  };

  const moveToParagraph = (
    nextIndex: number,
    mode: LayoutMode = layoutMode,
    options: { rememberReturnPoint?: boolean } = {},
  ) => {
    const safeIndex = Math.max(0, Math.min(nextIndex, readingUnits.length - 1));

    if (
      options.rememberReturnPoint &&
      returnIndex === null &&
      safeIndex !== currentParagraphIndexRef.current
    ) {
      setReturnIndex(currentParagraphIndexRef.current);
      showReadingProgressNotice("元の位置を一時保存しました");
    }

    setCurrentParagraphIndex(safeIndex);
    currentParagraphIndexRef.current = safeIndex;
    lastStableParagraphIndexRef.current = safeIndex;

    updateLocalParticipant(safeIndex);

    // キー操作やクリックによるスクロール中は、
    // onScroll側の中央判定でマーカーを上書きしない。
    isProgrammaticScrollRef.current = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToFocus(safeIndex, mode);
        saveReadingProgress(safeIndex);

        window.setTimeout(
          () => {
            isProgrammaticScrollRef.current = false;
          },
          layoutModeRef.current === "horizontal" ? 300 : 120,
        );
      });
    });

    if (isAdmitted) {
      saveParticipantToFirestore(usernameRef.current, safeIndex);
    }
  };

  const moveToNormalParagraph = (
    nextParagraphIndex: number,
    mode: LayoutMode = layoutMode,
    options: { rememberReturnPoint?: boolean } = {},
  ) => {
    const safeParagraphIndex = Math.max(
      0,
      Math.min(nextParagraphIndex, paragraphs.length - 1),
    );

    const firstUnit = readingUnitsByParagraph.get(safeParagraphIndex)?.[0];

    if (!firstUnit) return;

    moveToParagraph(firstUnit.unitIndex, mode, options);
  };

  useEffect(() => {
    if (!isAutoScroll) return;

    const readingArea = readingAreaRef.current;
    if (!readingArea) return;

    let animationId = 0;
    let lastTime = performance.now();
    let virtualScrollLeft = readingArea.scrollLeft;

    const updateReadingPositionForOthers = () => {
      const areaRect = readingArea.getBoundingClientRect();

      let nearestIndex = currentParagraphIndexRef.current;
      let nearestDistance = Infinity;

      paragraphRefs.current.forEach((element, index) => {
        if (!element) return;

        const rect = element.getBoundingClientRect();

        const targetPoint =
          layoutMode === "horizontal"
            ? rect.top
            : layoutMode === "normal"
              ? rect.right
              : rect.left + rect.width / 2;

        const focusPoint =
          layoutMode === "horizontal"
            ? getFocusY(areaRect)
            : getFocusX(layoutMode, areaRect);

        const distance = Math.abs(targetPoint - focusPoint);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      if (nearestIndex === currentParagraphIndexRef.current) return;

      setCurrentParagraphIndex(nearestIndex);
      currentParagraphIndexRef.current = nearestIndex;
      updateLocalParticipant(nearestIndex);
      saveReadingProgress(nearestIndex);

      if (isAdmitted) {
        saveParticipantToFirestore(usernameRef.current, nearestIndex);
      }
    };

    const smoothScroll = (now: number) => {
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;

      if (layoutMode === "horizontal") {
        readingArea.scrollBy({
          top: AUTO_SCROLL_SPEED * deltaTime,
          left: 0,
          behavior: "auto",
        });
      } else {
        virtualScrollLeft -= AUTO_SCROLL_SPEED * deltaTime;
        readingArea.scrollLeft = virtualScrollLeft;
      }

      updateReadingPositionForOthers();

      if (layoutMode !== "horizontal" && virtualScrollLeft <= 0) {
        setIsAutoScroll(false);
        return;
      }

      if (
        layoutMode === "horizontal" &&
        readingArea.scrollTop + readingArea.clientHeight >=
          readingArea.scrollHeight - 2
      ) {
        setIsAutoScroll(false);
        return;
      }

      animationId = requestAnimationFrame(smoothScroll);
    };

    animationId = requestAnimationFrame(smoothScroll);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isAutoScroll, layoutMode, isAdmitted, AUTO_SCROLL_SPEED]);

  const handleAddReaction = async () => {
    if (!authUser) return;

    const activeWork =
      currentWorkRef.current ??
      getFallbackCurrentWork(selectedStoryRef.current);

    if (!currentGroup) return;

    await addDoc(collection(db, "reactions"), {
      storyKey: selectedStoryRef.current,
      groupId: currentGroup.id,
      workId: activeWork.workId,
      workTitle: activeWork.title,
      workAuthor: activeWork.author,
      workType: activeWork.type,
      sourceUrl: activeWork.sourceUrl,
      emoji: reactionEmoji,
      comment: reactionComment,
      paragraphIndex: currentParagraphIndexRef.current,
      participantId: authUser.uid,
      participantName: usernameRef.current.trim() || "名前なし",
      userId: authUser.uid,
      username: usernameRef.current.trim() || "名前なし",
      time: new Date().toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: Date.now(),
    });

    setReactionComment("");
  };

  const fetchWikiMeaning = async (word: string) => {
    const trimmedWord = word.trim();

    if (!trimmedWord) return;

    setWikiMeaning("");

    if (dictionary[trimmedWord]) return;

    setIsSearchingMeaning(true);

    try {
      const response = await fetch(
        `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          trimmedWord,
        )}`,
      );

      if (!response.ok) {
        setWikiMeaning("");
        return;
      }

      const data = await response.json();
      setWikiMeaning(data.extract || "");
    } catch (error) {
      console.error("Wikipedia検索失敗", error);
      setWikiMeaning("");
    } finally {
      setIsSearchingMeaning(false);
    }
  };

  const handleSelectWord = (word: string) => {
    const trimmedWord = word.trim();

    if (!trimmedWord) return;

    setSelectedWord(trimmedWord);
    setSearchWord(trimmedWord);
    fetchWikiMeaning(trimmedWord);
  };

  const handleReaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    const isTyping =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (isTyping) return;

    const key = event.key.toLowerCase();

    if (key === "arrowleft") {
      event.preventDefault();

      if (layoutMode === "normal") {
        moveToNormalParagraph(activeParagraphIndex + 1, layoutMode);
      } else if (layoutMode === "horizontal") {
        moveToNormalParagraph(activeParagraphIndex + 1, "horizontal");
      } else {
        moveToParagraph(currentParagraphIndexRef.current + 1, layoutMode);
      }
    }

    if (key === "arrowright") {
      event.preventDefault();

      if (layoutMode === "normal") {
        moveToNormalParagraph(activeParagraphIndex - 1, layoutMode, {
          rememberReturnPoint: true,
        });
      } else if (layoutMode === "horizontal") {
        moveToNormalParagraph(activeParagraphIndex - 1, "horizontal", {
          rememberReturnPoint: true,
        });
      } else {
        moveToParagraph(currentParagraphIndexRef.current - 1, layoutMode, {
          rememberReturnPoint: true,
        });
      }
    }

    if (key === "arrowdown" && layoutMode === "horizontal") {
      event.preventDefault();
      moveToNormalParagraph(activeParagraphIndex + 1, "horizontal");
    }

    if (key === "arrowup" && layoutMode === "horizontal") {
      event.preventDefault();
      moveToNormalParagraph(activeParagraphIndex - 1, "horizontal", {
        rememberReturnPoint: true,
      });
    }

    if (key === "s") {
      event.preventDefault();
      setReaderMode("shared");
    }

    if (key === "r") {
      event.preventDefault();
      setReaderMode("reading");
    }

    if (key === "a") {
      event.preventDefault();
      setIsAutoScroll((prev) => !prev);
    }

    if (key === "b") {
      event.preventDefault();
      handleMarkReturnPoint();
    }

    if (key === "v") {
      event.preventDefault();
      handleReturnToSavedIndex();
    }
  };

  const handleMarkReturnPoint = () => {
    if (readingUnits.length <= 0) return;

    setReturnIndex(currentParagraphIndexRef.current);
    showReadingProgressNotice("ここに戻る位置を保存しました");
  };

  const handleReturnToSavedIndex = () => {
    if (returnIndex === null) return;

    const targetIndex = Math.max(
      0,
      Math.min(returnIndex, readingUnits.length - 1),
    );

    moveToParagraph(targetIndex, layoutModeRef.current);
    setReturnIndex(null);
    showReadingProgressNotice("元の位置へ戻りました");
  };

  const handleParagraphClick = (index: number) => {
    moveToParagraph(index, layoutMode);
  };

  const readingPercent = getPercent(currentParagraphIndex, readingUnits.length);

  const wordSelectHandlers = {
    onMouseUp: (event: React.MouseEvent<HTMLElement>) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (!selection || !selectedText) return;

      const target = event.currentTarget;

      if (!selection.anchorNode || !target.contains(selection.anchorNode)) {
        return;
      }

      handleSelectWord(selectedText);
      selection.removeAllRanges();
    },

    onClick: (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      const word = target.dataset.word;

      if (word) {
        handleSelectWord(word);
      }
    },
  };

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f1e8]">
        <p className="text-sm font-bold text-gray-500">読み込み中...</p>
      </main>
    );
  }

  if (authUser && !sessionChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f1e8]">
        <p className="text-sm font-bold text-gray-500">
          ログイン状態を確認しています...
        </p>
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f1e8] px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-[#eee3d2] bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.10)]">
          <p className="text-xs font-bold tracking-[0.3em] text-[#b98234]">
            SHARED READING
          </p>

          <h1 className="mt-3 text-3xl font-bold text-gray-950">
            共有読書システム
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            利用者名とパスワードを入力してください。ログイン後、一人読み・共有読みの読書データを同じ利用者として管理します。
          </p>

          <div className="mt-6 grid gap-4">
            <input
              value={loginName}
              onChange={(event) => {
                setLoginName(event.target.value);
                setAuthError("");
              }}
              placeholder="利用者名"
              className="rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#c79a53]"
            />

            <input
              type="password"
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.target.value);
                setAuthError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (authMode === "login") {
                    handleLogin();
                  } else {
                    handleRegister();
                  }
                }
              }}
              placeholder="パスワード（6文字以上）"
              className="rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#c79a53]"
            />

            {authError && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-500">
                {authError}
              </p>
            )}

            <button
              type="button"
              onClick={authMode === "login" ? handleLogin : handleRegister}
              disabled={isAuthLoading}
              className="rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {isAuthLoading
                ? "処理中..."
                : authMode === "login"
                  ? "ログイン"
                  : "新規登録"}
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
              className="rounded-2xl bg-[#fffaf0] px-4 py-3 text-sm font-bold text-[#b98234]"
            >
              {authMode === "login"
                ? "初めて使う場合は新規登録"
                : "登録済みの場合はログイン"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!currentGroup) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f1e8] px-4 py-8">
        <div className="w-full max-w-2xl rounded-[2rem] border border-[#eee3d2] bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.10)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.3em] text-[#b98234]">
                ReTA
              </p>
              <h1 className="mt-3 text-3xl font-bold text-gray-950">
                グループを選択
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                新しいグループを作るか、6桁の参加コードを入力してください。
                1つのグループには最大3人まで参加できます。
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
            >
              ログアウト
            </button>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <section className="rounded-3xl border border-[#eee3d2] bg-[#fffaf0] p-5">
              <p className="text-xs font-bold tracking-[0.18em] text-[#b98234]">
                CREATE GROUP
              </p>
              <h2 className="mt-2 text-xl font-bold text-gray-900">
                新しいグループを作る
              </h2>

              <input
                value={groupName}
                onChange={(event) => {
                  setGroupName(event.target.value);
                  setGroupError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateGroup();
                  }
                }}
                placeholder="グループ名"
                className="mt-5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#c79a53]"
              />

              <button
                type="button"
                onClick={() => void handleCreateGroup()}
                className="mt-3 w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white"
              >
                グループを作成
              </button>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-bold tracking-[0.18em] text-gray-400">
                JOIN GROUP
              </p>
              <h2 className="mt-2 text-xl font-bold text-gray-900">
                参加コードで入る
              </h2>

              <input
                value={groupCode}
                onChange={(event) => {
                  setGroupCode(event.target.value.toUpperCase());
                  setGroupError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleJoinGroup();
                  }
                }}
                maxLength={6}
                placeholder="6桁の参加コード"
                className="mt-5 w-full rounded-2xl border border-gray-200 px-4 py-3 text-center text-lg font-bold tracking-[0.3em] uppercase outline-none focus:border-[#c79a53]"
              />

              <button
                type="button"
                onClick={() => void handleJoinGroup()}
                className="mt-3 w-full rounded-2xl bg-[#c79a53] px-4 py-3 text-sm font-bold text-white"
              >
                グループに参加
              </button>
            </section>
          </div>

          {groupError && (
            <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-500">
              {groupError}
            </p>
          )}

          <div className="mt-6 rounded-2xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500">
            {username || "利用者"}でログイン中
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      tabIndex={0}
      onKeyDown={handleReaderKeyDown}
      className="min-h-screen bg-[#f5f1e8] px-4 py-6 outline-none"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 rounded-[1.75rem] border border-[#e9e1d5] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(30,41,59,0.06)] sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-3">
                <span className="h-7 w-1 rounded-full bg-[#c79a53]" />
                <p className="text-[0.7rem] font-bold tracking-[0.32em] text-[#a86f24]">
                  SHARED READING
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                <h1 className="font-serif text-3xl font-bold tracking-[-0.035em] text-gray-950 sm:text-4xl">
                  {customTitle || stories[selectedStory].title}
                </h1>
                <p className="pb-1 text-sm font-semibold text-gray-500 sm:text-base">
                  {customAuthor || stories[selectedStory].author}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="rounded-full bg-[#fff7e8] px-3 py-2 text-[#9a651f]">
                👥 {admittedParticipants.length}/{MAX_PARTICIPANTS}人参加
              </span>
              <span className="rounded-full bg-[#fff7e8] px-3 py-2 text-[#9a651f]">
                グループ：{currentGroup.name}
              </span>
              <span className="rounded-full border border-[#ead7b8] bg-white px-3 py-2 text-[#9a651f]">
                参加コード：{currentGroup.code}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-2 text-gray-600">
                {username || "利用者"}でログイン中
              </span>
              <button
                type="button"
                onClick={() => void handleLeaveGroup()}
                className="rounded-full border border-[#ead7b8] bg-white px-3 py-2 text-[#9a651f] transition hover:bg-[#fffaf0]"
              >
                グループを退会
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-gray-200 bg-white px-3 py-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
              >
                ログアウト
              </button>
            </div>
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-bold tracking-[0.28em] text-[#a86f24]">
                  READING HISTORY
                </p>
                <h2 className="mt-1 text-base font-bold text-gray-900">
                  最近読んだ作品
                </h2>
              </div>
              <span className="text-xs font-bold text-gray-400">
                {userReadingProgresses.length}件
              </span>
            </div>

            {userReadingProgresses.length === 0 ? (
              <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-bold text-gray-400">
                まだ読書履歴はありません。
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {userReadingProgresses.slice(0, 4).map((progress) => (
                  <button
                    key={progress.workId}
                    type="button"
                    onClick={() => handleOpenReadingProgress(progress)}
                    className="group min-w-0 rounded-2xl border border-[#eee7dc] bg-[#fffcf6] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#dcc7a7] hover:shadow-[0_8px_20px_rgba(30,41,59,0.07)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-950">
                          {progress.title}
                        </p>
                        <p className="mt-0.5 truncate text-[0.7rem] font-semibold text-gray-500">
                          {progress.author}
                        </p>
                      </div>
                      <span className="shrink-0 text-[0.65rem] font-black text-[#a86f24]">
                        {progress.percent}%
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-[#e5ac45]"
                        style={{
                          width: `${Math.max(0, Math.min(progress.percent, 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[0.65rem] font-semibold text-gray-400">
                      {formatUpdatedAt(progress.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            )}

            <details className="group mt-3 rounded-2xl border border-[#eee7dc] bg-[#fffaf0]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-gray-700">
                <span>＋ 別の作品を開く</span>
                <span className="text-xs text-gray-400 transition group-open:rotate-180">
                  ⌄
                </span>
              </summary>

              <div className="border-t border-[#eee7dc] p-4">
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[#eee6da] p-1">
                  {[
                    ["preset", "登録済み"],
                    ["url", "青空文庫URL"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setLoadMode(mode as LoadMode);
                        setAozoraLoadError("");
                      }}
                      className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                        loadMode === mode
                          ? "bg-white text-gray-950 shadow-sm"
                          : "text-gray-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {loadMode === "preset" && (
                  <select
                    value={selectedStory}
                    onChange={(event) => {
                      void handleSelectPresetStory(
                        event.target.value as StoryKey,
                      );
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-[#c79a53]"
                  >
                    {Object.entries(stories).map(([key, story]) => {
                      const storyKey = key as StoryKey;
                      const progress = storyProgressSummaries[storyKey];
                      return (
                        <option key={key} value={key}>
                          {story.title}{" "}
                          {progress ? `（${progress.percent}%）` : "（未読）"}
                        </option>
                      );
                    })}
                  </select>
                )}

                {loadMode === "url" && (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      type="url"
                      value={aozoraUrl}
                      onChange={(event) => {
                        setAozoraUrl(event.target.value);
                        setAozoraLoadError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleLoadAozoraUrl();
                        }
                      }}
                      placeholder="青空文庫の図書カードURL"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#c79a53]"
                    />
                    <button
                      type="button"
                      onClick={handleLoadAozoraUrl}
                      disabled={isLoadingAozora}
                      className="rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {isLoadingAozora ? "読み込み中" : "この本を読む"}
                    </button>
                  </div>
                )}

                {aozoraLoadError && (
                  <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-500">
                    {aozoraLoadError}
                  </p>
                )}
              </div>
            </details>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <section className="overflow-hidden rounded-[1.75rem] border border-[#e9e1d5] bg-[#fffdf8] shadow-[0_14px_34px_rgba(30,41,59,0.07)]">
            <div className="border-b border-gray-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-700">
                    {layoutMode === "normal"
                      ? readerMode === "reading"
                        ? "通常段落モード"
                        : "共有表示モード（通常段落）"
                      : layoutMode === "grouped"
                        ? readerMode === "reading"
                          ? "2文グループモード"
                          : "共有表示モード（2文グループ）"
                        : readerMode === "reading"
                          ? "横書きモード"
                          : "共有表示モード（横書き）"}
                  </p>
                </div>

                <div className="text-sm text-gray-500">
                  {currentParagraphIndex + 1}区切り目 ／ {readingPercent}%
                </div>
              </div>
            </div>

            <div
              ref={readingAreaRef}
              onScroll={updateActiveUnitByCenter}
              className={`relative h-[78vh] px-8 py-10 sm:px-12 lg:px-14 ${
                layoutMode === "horizontal"
                  ? "overflow-y-auto overflow-x-hidden"
                  : "overflow-x-auto overflow-y-hidden"
              }`}
            >
              {layoutMode === "horizontal" ? (
                <div className="horizontal-reading-content font-serif text-[1.3rem] leading-[2.2] tracking-[0.03em] text-gray-900">
                  {paragraphs.map((paragraph, index) => {
                    const paragraphUnits =
                      readingUnitsByParagraph.get(index) ?? [];

                    const isParagraphActive =
                      currentReadingUnit?.paragraphIndex === index;

                    const readersInParagraph = visibleParticipants.filter(
                      (participant) => {
                        const readerUnit =
                          readingUnits[participant.paragraphIndex];
                        return readerUnit?.paragraphIndex === index;
                      },
                    );

                    return (
                      <div
                        key={`${selectedStory}-horizontal-${index}`}
                        ref={(element) => {
                          paragraphUnits.forEach((unit) => {
                            paragraphRefs.current[unit.unitIndex] =
                              element as HTMLDivElement | null;
                          });
                        }}
                        onClick={(event) => {
                          wordSelectHandlers.onClick(event);

                          const firstUnit = paragraphUnits[0];
                          if (firstUnit) {
                            handleParagraphClick(firstUnit.unitIndex);
                          }
                        }}
                        className={`horizontal-reading-unit ${
                          isParagraphActive ? "is-active" : ""
                        } ${paragraph.isHeading ? "reading-heading-unit" : ""}`}
                        onMouseUp={wordSelectHandlers.onMouseUp}
                      >
                        <span
                          className="horizontal-reading-unit-inner"
                          dangerouslySetInnerHTML={{
                            __html: decorateText(paragraph.text),
                          }}
                        />

                        {readerMode === "shared" &&
                          readersInParagraph.length > 0 && (
                            <div className="reader-follow-badges marker-reader-badges horizontal-marker-reader-badges">
                              {readersInParagraph.map((reader) => (
                                <span
                                  key={reader.id}
                                  className={`reader-follow-badge ${
                                    reader.id === participantId ? "is-me" : ""
                                  }`}
                                >
                                  {getDisplayName(reader.name)}
                                </span>
                              ))}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`h-full font-serif text-[1.3rem] text-gray-900 ${
                    layoutMode === "normal"
                      ? "leading-[2.1] tracking-[0.03em]"
                      : "leading-[2.1] tracking-[0.03em]"
                  }`}
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "mixed",
                  }}
                >
                  {paragraphs.map((paragraph, index) => {
                    const paragraphUnits =
                      readingUnitsByParagraph.get(index) ?? [];

                    const isParagraphActive =
                      currentReadingUnit?.paragraphIndex === index;

                    const readersInParagraph = visibleParticipants.filter(
                      (participant) => {
                        const readerUnit =
                          readingUnits[participant.paragraphIndex];
                        return readerUnit?.paragraphIndex === index;
                      },
                    );

                    return (
                      <div
                        key={`${selectedStory}-${index}`}
                        onClick={() => {
                          const firstUnit = paragraphUnits[0];
                          if (firstUnit) {
                            handleParagraphClick(firstUnit.unitIndex);
                          }
                        }}
                        className={`relative transition ${
                          layoutMode === "normal"
                            ? `normal-reading-unit ml-8 py-4 ${
                                isParagraphActive ? "is-active" : ""
                              }`
                            : "grouped-paragraph-shell ml-8 py-4"
                        }`}
                      >
                        {layoutMode === "normal" ? (
                          <>
                            <p
                              ref={(element) => {
                                paragraphUnits.forEach((unit) => {
                                  paragraphRefs.current[unit.unitIndex] =
                                    element as HTMLDivElement | null;
                                });
                              }}
                              className={`leading-[2.1] ${
                                paragraph.isHeading
                                  ? "reading-heading-unit"
                                  : ""
                              }`}
                              {...wordSelectHandlers}
                              dangerouslySetInnerHTML={{
                                __html: decorateText(paragraph.text),
                              }}
                            />

                            {readerMode === "shared" &&
                              readersInParagraph.length > 0 && (
                                <div className="reader-follow-badges marker-reader-badges normal-marker-reader-badges">
                                  {readersInParagraph.map((reader) => (
                                    <span
                                      key={reader.id}
                                      className={`reader-follow-badge ${
                                        reader.id === participantId
                                          ? "is-me"
                                          : ""
                                      }`}
                                    >
                                      {getDisplayName(reader.name)}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </>
                        ) : (
                          <div
                            className="two-sentence-layout"
                            {...wordSelectHandlers}
                          >
                            {paragraphUnits.map((unit) => {
                              const isUnitActive =
                                currentParagraphIndex === unit.unitIndex;

                              const readersHere = visibleParticipants.filter(
                                (participant) =>
                                  participant.paragraphIndex === unit.unitIndex,
                              );

                              return (
                                <div
                                  key={unit.unitIndex}
                                  role="button"
                                  tabIndex={0}
                                  ref={(element) => {
                                    paragraphRefs.current[unit.unitIndex] =
                                      element;
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleParagraphClick(unit.unitIndex);
                                  }}
                                  className={`reading-unit ${
                                    unit.isHeading ? "reading-heading-unit" : ""
                                  } ${isUnitActive ? "is-active" : ""}`}
                                >
                                  <span
                                    className="reading-unit-inner"
                                    dangerouslySetInnerHTML={{
                                      __html: decorateText(unit.html),
                                    }}
                                  />

                                  {readerMode === "shared" &&
                                    readersHere.length > 0 && (
                                      <div className="reader-follow-badges marker-reader-badges grouped-marker-reader-badges">
                                        {readersHere.map((reader) => (
                                          <span
                                            key={reader.id}
                                            className={`reader-follow-badge ${
                                              reader.id === participantId
                                                ? "is-me"
                                                : ""
                                            }`}
                                          >
                                            {getDisplayName(reader.name)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 px-6 py-5">
              <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
                <span>読書マップ</span>

                <span>
                  {currentParagraphIndex + 1} / {readingUnits.length} 区切り
                </span>
              </div>

              <div className="relative h-5 rounded-full bg-gray-200">
                {visibleParticipants.map((participant) => {
                  const percent = getMapPercent(
                    participant.paragraphIndex,
                    readingUnits.length,
                  );

                  return (
                    <div
                      key={participant.id}
                      className="absolute top-[-8px] flex  flex-col items-center"
                      style={{
                        right: `${percent}%`,
                      }}
                      title={`${participant.name}：${
                        participant.paragraphIndex + 1
                      }区切り目`}
                    >
                      <div className="h-9 w-[3px] rounded-full bg-blue-400" />

                      <div className="mt-1 max-w-14 truncate text-[0.6rem] text-gray-500">
                        {getDisplayName(participant.name)}
                      </div>
                    </div>
                  );
                })}

                {visibleReactions.map((reaction, index) => {
                  if (reaction.paragraphIndex > currentParagraphIndex) {
                    return null;
                  }

                  const percent = getMapPercent(
                    reaction.paragraphIndex,
                    readingUnits.length,
                  );

                  return (
                    <div
                      key={`${reaction.createdAt}-${index}`}
                      className="absolute bottom-[-4px] h-3 w-3  rounded-full bg-pink-400"
                      style={{
                        right: `${percent}%`,
                      }}
                      title={`${reaction.emoji} ${
                        reaction.paragraphIndex + 1
                      }区切り目`}
                    />
                  );
                })}
              </div>

              <div className="mt-6 flex gap-4 text-xs text-gray-500">
                <span>青：参加者</span>
                <span>桃：リアクション</span>
              </div>
            </div>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
            <div className="rounded-[1.5rem] border border-[#e9e1d5] bg-white p-4 shadow-[0_10px_28px_rgba(30,41,59,0.06)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.65rem] font-bold tracking-[0.25em] text-[#a86f24]">
                    READING CONTROL
                  </p>
                  <h2 className="mt-1 text-base font-bold text-gray-900">
                    読書操作
                  </h2>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[0.65rem] font-bold text-gray-500">
                  {readingProgressNotice || "自動保存"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setReaderMode("reading")}
                  className={`rounded-lg px-3 py-2.5 text-xs font-bold transition ${readerMode === "reading" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500"}`}
                >
                  一人読み
                </button>
                <button
                  type="button"
                  onClick={() => setReaderMode("shared")}
                  className={`rounded-lg px-3 py-2.5 text-xs font-bold transition ${readerMode === "shared" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500"}`}
                >
                  みんなと読む
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => changeLayoutModeKeepingPosition("normal")}
                  className={`rounded-lg px-2 py-2.5 text-[0.7rem] font-bold transition ${layoutMode === "normal" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500"}`}
                >
                  通常段落
                </button>
                <button
                  type="button"
                  onClick={() => changeLayoutModeKeepingPosition("grouped")}
                  className={`rounded-lg px-2 py-2.5 text-[0.7rem] font-bold transition ${layoutMode === "grouped" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500"}`}
                >
                  2文
                </button>
                <button
                  type="button"
                  onClick={() => changeLayoutModeKeepingPosition("horizontal")}
                  className={`rounded-lg px-2 py-2.5 text-[0.7rem] font-bold transition ${layoutMode === "horizontal" ? "bg-white text-gray-950 shadow-sm" : "text-gray-500"}`}
                >
                  横書き
                </button>
              </div>

              <details className="group mt-3 rounded-xl border border-gray-100 bg-[#fffcf6]">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-xs font-bold text-gray-700">
                  <span>オート読書</span>
                  <span
                    className={
                      isAutoScroll ? "text-[#a86f24]" : "text-gray-400"
                    }
                  >
                    {isAutoScroll ? `${autoSpeed}px/秒` : "停止中"}
                  </span>
                </summary>
                <div className="border-t border-gray-100 px-3 pb-3 pt-3">
                  <input
                    type="range"
                    min="0"
                    max="45"
                    step="1"
                    value={isAutoScroll ? autoSpeed : 0}
                    onChange={(event) => {
                      const nextSpeed = Number(event.target.value);
                      if (nextSpeed <= 0) {
                        setIsAutoScroll(false);
                        return;
                      }
                      setAutoSpeed(nextSpeed);
                      setIsAutoScroll(true);
                    }}
                    className="w-full accent-[#d8a348]"
                    aria-label="オート読書速度"
                  />
                  <div className="mt-1 flex justify-between text-[0.62rem] font-bold text-gray-400">
                    <span>停止</span>
                    <span>ゆっくり</span>
                    <span>速い</span>
                  </div>
                </div>
              </details>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleMarkReturnPoint}
                  className="rounded-xl bg-gray-100 px-3 py-2.5 text-xs font-bold text-gray-700 transition hover:bg-gray-200"
                >
                  ここに戻る
                </button>
                <button
                  type="button"
                  onClick={handleReturnToSavedIndex}
                  disabled={returnIndex === null}
                  className="rounded-xl bg-[#f3cf7a] px-3 py-2.5 text-xs font-bold text-gray-800 transition disabled:cursor-not-allowed disabled:opacity-35"
                >
                  元の位置へ
                </button>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[#eadfce] bg-[#fffaf0] p-4 shadow-[0_10px_28px_rgba(30,41,59,0.05)]">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xl" aria-hidden="true">
                  ⌨️
                </span>
                <div>
                  <p className="text-[0.62rem] font-bold tracking-[0.22em] text-[#a86f24]">
                    KEYBOARD
                  </p>
                  <h2 className="text-sm font-bold text-gray-900">
                    キーボード操作
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[0.72rem] text-gray-600">
                <div className="flex items-center gap-2">
                  <kbd className="min-w-12 rounded-lg border border-[#dfd3c2] bg-white px-2 py-1 text-center font-bold text-gray-800 shadow-sm">
                    ← →
                  </kbd>
                  <span>前後へ移動</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="min-w-12 rounded-lg border border-[#dfd3c2] bg-white px-2 py-1 text-center font-bold text-gray-800 shadow-sm">
                    A
                  </kbd>
                  <span>オート切替</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="min-w-12 rounded-lg border border-[#dfd3c2] bg-white px-2 py-1 text-center font-bold text-gray-800 shadow-sm">
                    R / S
                  </kbd>
                  <span>一人・共有</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="min-w-12 rounded-lg border border-[#dfd3c2] bg-white px-2 py-1 text-center font-bold text-gray-800 shadow-sm">
                    B / V
                  </kbd>
                  <span>位置保存・復帰</span>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-[#e9e1d5] bg-white p-5 shadow-[0_10px_28px_rgba(30,41,59,0.06)]">
              <h2 className="mb-3 text-lg font-bold">用語検索</h2>

              <input
                type="text"
                value={searchWord}
                onChange={(event) => {
                  const nextWord = event.target.value;
                  setSearchWord(nextWord);
                  setSelectedWord(nextWord);
                }}
                onBlur={() => {
                  fetchWikiMeaning(searchWord);
                }}
                placeholder="調べたい言葉を入力"
                className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
              />

              {searchWord ? (
                <>
                  <div className="mb-2 font-bold">{selectedWord}</div>

                  {dictionary[searchWord] ? (
                    <p className="text-sm leading-loose text-gray-700">
                      {dictionary[searchWord]}
                    </p>
                  ) : isSearchingMeaning ? (
                    <p className="text-sm text-gray-500">
                      意味を調べています...
                    </p>
                  ) : wikiMeaning ? (
                    <p className="text-sm leading-loose text-gray-700">
                      {wikiMeaning}
                    </p>
                  ) : (
                    <p className="text-sm leading-loose text-gray-500">
                      自作辞書・Wikipediaでは見つかりませんでした。
                    </p>
                  )}

                  <div className="mt-4 grid gap-2">
                    <a
                      href={`https://kotobank.jp/word/${encodeURIComponent(
                        searchWord,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-bold"
                    >
                      コトバンクで詳しく見る
                    </a>

                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        searchWord + " 意味",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-bold"
                    >
                      Googleで調べる
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  本文中の言葉をなぞるか、検索欄に入力してください
                </p>
              )}
            </div>

            {readerMode === "shared" && (
              <>
                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">ログイン中の利用者</h2>
                  <div className="rounded-2xl bg-[#fffaf0] px-4 py-3 text-sm font-bold text-gray-800">
                    {username || "利用者"}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-400">
                    共有読みの参加者名とリアクション名には、ログイン中の利用者名を使用します。
                  </p>
                </div>

                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">参加者</h2>

                  <div className="space-y-3">
                    {visibleParticipants.map((participant) => (
                      <div
                        key={participant.id}
                        className="rounded-2xl bg-gray-50 px-3 py-2 text-sm"
                      >
                        <div className="font-bold">{participant.name}</div>

                        <div className="mt-1 text-xs text-gray-500">
                          {participant.paragraphIndex + 1}区切り目 ／{" "}
                          {getPercent(
                            participant.paragraphIndex,
                            readingUnits.length,
                          )}
                          %
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">リアクション</h2>

                  <div className="mb-4 rounded-2xl bg-yellow-50 p-3">
                    <p className="mb-2 text-xs text-gray-500">
                      今の区切りにリアクション
                    </p>

                    <div className="mb-2 flex gap-2">
                      {["👍", "😮", "😢", "❤️", "🤔"].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setReactionEmoji(emoji)}
                          className={`rounded-xl px-3 py-2 text-lg ${
                            reactionEmoji === emoji
                              ? "bg-yellow-300"
                              : "bg-white"
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={reactionComment}
                      onChange={(event) =>
                        setReactionComment(event.target.value)
                      }
                      placeholder="コメントを書く"
                      className="h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
                    />

                    <button
                      type="button"
                      onClick={handleAddReaction}
                      className="mt-2 w-full rounded-xl bg-yellow-300 px-4 py-2 text-sm font-bold text-gray-800"
                    >
                      追加する
                    </button>
                  </div>

                  <div className="space-y-2">
                    {visibleReactions.map((reaction, index) => (
                      <div
                        key={`${reaction.createdAt}-${index}`}
                        className="rounded-xl bg-gray-50 px-3 py-2 text-sm"
                      >
                        <div>
                          {reaction.participantName}：{reaction.emoji}
                          <span className="ml-2 text-xs text-gray-400">
                            {reaction.paragraphIndex + 1}区切り目
                          </span>
                        </div>

                        {reaction.comment && (
                          <div className="mt-1 text-gray-600">
                            {reaction.comment}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
