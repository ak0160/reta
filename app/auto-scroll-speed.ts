export const DEFAULT_AUTO_SCROLL_SPEED = 43;

export function clampAutoScrollSpeed(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : DEFAULT_AUTO_SCROLL_SPEED;
}

// 従来の最大45px/秒から90px/秒へ。低速域を細かくし、初期値は従来17px/秒に近づける。
export function autoScrollPixelsPerSecond(speed: number) {
  return 0.5 + 89.5 * Math.pow((clampAutoScrollSpeed(speed) - 1) / 99, 2);
}
