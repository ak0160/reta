"use client";

import { useId } from "react";

export default function AutoScrollControls({ speed, playing, onSpeedChange, onToggle }: {
  speed: number;
  playing: boolean;
  onSpeedChange: (speed: number) => void;
  onToggle: () => void;
}) {
  const id = useId();
  const button = "rounded-lg border border-[#eed5d8] bg-white px-3 py-2 text-xs font-bold text-[#a6445a] disabled:opacity-40";
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs font-bold text-gray-600">速度 <span className="tabular-nums text-[#a6445a]">{speed} / 100</span></label>
      <button type="button" onClick={onToggle} aria-label={playing ? "自動スクロールを一時停止" : "自動スクロールを再生"} className={button}>{playing ? "Ⅱ 一時停止" : "▶ 再生"}</button>
    </div>
    <div className="flex items-center gap-2">
      <button type="button" disabled={speed <= 1} onClick={() => onSpeedChange(speed - 1)} aria-label="速度を1下げる" className={button}>−1</button>
      <input id={id} type="range" min={1} max={100} step={1} value={speed} onChange={event => onSpeedChange(Number(event.target.value))} className="min-w-0 flex-1 accent-[#bf596f]" />
      <button type="button" disabled={speed >= 100} onClick={() => onSpeedChange(speed + 1)} aria-label="速度を1上げる" className={button}>＋1</button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {([[10, "ゆっくり"], [30, "ふつう"], [60, "はやめ"], [90, "もっと速く"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => onSpeedChange(value)} aria-pressed={speed === value} className={`${button} ${speed === value ? "!bg-[#fcf0f1]" : ""}`}>{label}（{value}）</button>)}
    </div>
  </div>;
}
