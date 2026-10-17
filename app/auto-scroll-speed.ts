export const DEFAULT_AUTO_SCROLL_SPEED = 50;

export function clampAutoScrollSpeed(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : DEFAULT_AUTO_SCROLL_SPEED;
}

// 従来の最大45px/秒から90px/秒へ。低速域を細かくし、速度レベルの設定とは独立に計算する。
export function autoScrollPixelsPerSecond(speed: number) {
  return 0.5 + 89.5 * Math.pow((clampAutoScrollSpeed(speed) - 1) / 99, 2);
}

export const AUTO_SCROLL_PRESET_LABELS = [
  ["slow", "ゆっくり"], ["normal", "ふつう"], ["fast", "はやめ"], ["faster", "もっと速く"],
] as const;
export type AutoScrollPresetKey = typeof AUTO_SCROLL_PRESET_LABELS[number][0];
export type AutoScrollPresets = Record<AutoScrollPresetKey, number>;
export const DEFAULT_AUTO_SCROLL_PRESETS: AutoScrollPresets = { slow: 40, normal: 50, fast: 60, faster: 80 };

export function normalizeAutoScrollPresets(data: unknown): AutoScrollPresets {
  const values = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return Object.fromEntries(AUTO_SCROLL_PRESET_LABELS.map(([key]) => [
    key, typeof values[key] === "number" && Number.isFinite(values[key])
      ? clampAutoScrollSpeed(values[key]) : DEFAULT_AUTO_SCROLL_PRESETS[key],
  ])) as AutoScrollPresets;
}
