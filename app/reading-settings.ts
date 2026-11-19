export type ReadingFont = "mincho" | "gothic" | "rounded";
export type ReadingBackground = "white" | "ivory" | "sepia" | "dark";
export type ReadingHighlight = "none" | "yellow" | "blue" | "pink" | "green";

export type ReaderSettings = {
  font: ReadingFont;
  fontSizePx: number;
  background: ReadingBackground;
  lineSpacing: number;
  letterSpacing: number;
  paragraphSpacing: number;
  highlightOpacity: number;
  highlightColor: ReadingHighlight;
};

export const READER_SETTINGS_KEY = "retaReaderSettingsV1";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  font: "mincho",
  fontSizePx: 20.8,
  background: "ivory",
  lineSpacing: 1,
  letterSpacing: 1,
  paragraphSpacing: 1,
  highlightOpacity: 0.28,
  highlightColor: "yellow",
};

const fonts: ReadingFont[] = ["mincho", "gothic", "rounded"];
const backgrounds: ReadingBackground[] = ["white", "ivory", "sepia", "dark"];
const highlights: ReadingHighlight[] = ["none", "yellow", "blue", "pink", "green"];

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeReaderSettings(value: unknown): ReaderSettings {
  if (!value || typeof value !== "object") return DEFAULT_READER_SETTINGS;
  const raw = value as Record<string, unknown>;
  return {
    font: fonts.includes(raw.font as ReadingFont) ? raw.font as ReadingFont : DEFAULT_READER_SETTINGS.font,
    fontSizePx: clamp(raw.fontSizePx, 20, 26, DEFAULT_READER_SETTINGS.fontSizePx),
    background: backgrounds.includes(raw.background as ReadingBackground)
      ? raw.background as ReadingBackground
      : DEFAULT_READER_SETTINGS.background,
    lineSpacing: clamp(raw.lineSpacing, 0.75, 1.5, DEFAULT_READER_SETTINGS.lineSpacing),
    letterSpacing: clamp(raw.letterSpacing, 0.5, 1.6, DEFAULT_READER_SETTINGS.letterSpacing),
    paragraphSpacing: clamp(raw.paragraphSpacing, 0, 1.5, DEFAULT_READER_SETTINGS.paragraphSpacing),
    highlightOpacity: clamp(raw.highlightOpacity, 0.08, 0.55, DEFAULT_READER_SETTINGS.highlightOpacity),
    // Older saved preferences have no color field and keep the existing yellow.
    highlightColor: highlights.includes(raw.highlightColor as ReadingHighlight)
      ? raw.highlightColor as ReadingHighlight
      : DEFAULT_READER_SETTINGS.highlightColor,
  };
}

export const READING_FONT_LABELS: Record<ReadingFont, string> = {
  mincho: "明朝体",
  gothic: "ゴシック体",
  rounded: "丸ゴシック体",
};

export const READING_BACKGROUND_OPTIONS: Array<{
  value: ReadingBackground;
  label: string;
  color: string;
  text: string;
}> = [
  { value: "white", label: "ホワイト", color: "#ffffff", text: "#111827" },
  { value: "ivory", label: "アイボリー", color: "#fffdfa", text: "#111827" },
  { value: "sepia", label: "セピア", color: "#F2E5CD", text: "#59432D" },
  { value: "dark", label: "ブラック", color: "#222222", text: "#FFFFFF" },
];

export const READING_HIGHLIGHT_LABELS: Record<ReadingHighlight, string> = {
  none: "なし",
  yellow: "イエロー",
  blue: "ブルー",
  pink: "ピンク",
  green: "グリーン",
};

export const READING_HIGHLIGHT_OPTIONS: ReadingHighlight[] = ["none", "yellow", "blue", "pink", "green"];

type HighlightPalette = { fillRgb: string; line: string; swatch: string };
const HIGHLIGHT_PALETTES: Record<ReadingBackground, Record<Exclude<ReadingHighlight, "none">, HighlightPalette>> = {
  white: {
    yellow: { fillRgb: "254, 240, 138", line: "#FACC15", swatch: "#FACC15" },
    blue: { fillRgb: "186, 219, 239", line: "#6BA6C9", swatch: "#9CCDE7" },
    pink: { fillRgb: "241, 194, 205", line: "#C8788D", swatch: "#E6ACBB" },
    green: { fillRgb: "194, 220, 190", line: "#749A6E", swatch: "#AFCDA8" },
  },
  ivory: {
    yellow: { fillRgb: "254, 240, 138", line: "#FACC15", swatch: "#FACC15" },
    blue: { fillRgb: "174, 207, 220", line: "#668FA1", swatch: "#9CC2D1" },
    pink: { fillRgb: "232, 189, 185", line: "#B77977", swatch: "#DFAEAA" },
    green: { fillRgb: "193, 211, 169", line: "#788B56", swatch: "#B1C58F" },
  },
  sepia: {
    yellow: { fillRgb: "215, 183, 110", line: "#A47B35", swatch: "#D7B76E" },
    blue: { fillRgb: "164, 192, 205", line: "#63869A", swatch: "#A4C0CD" },
    pink: { fillRgb: "221, 174, 164", line: "#A96761", swatch: "#DDAEA4" },
    green: { fillRgb: "184, 199, 145", line: "#718149", swatch: "#B8C791" },
  },
  dark: {
    yellow: { fillRgb: "150, 117, 53", line: "#C9A45C", swatch: "#A98543" },
    blue: { fillRgb: "66, 103, 130", line: "#7CA5C2", swatch: "#537A96" },
    pink: { fillRgb: "113, 71, 86", line: "#B87B8D", swatch: "#875768" },
    green: { fillRgb: "72, 96, 77", line: "#87A98C", swatch: "#56735D" },
  },
};

export function getReaderHighlightPalette(background: ReadingBackground, highlight: ReadingHighlight) {
  if (highlight === "none") return { fillRgb: "0, 0, 0", line: "transparent", swatch: "transparent" };
  return HIGHLIGHT_PALETTES[background][highlight];
}

export const READING_FONT_FAMILIES: Record<ReadingFont, string> = {
  mincho: '"Noto Serif JP", "Yu Mincho", YuMincho, serif',
  gothic: '"Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  rounded: '"Hiragino Maru Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
};
