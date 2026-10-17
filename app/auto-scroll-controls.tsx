"use client";

import { useId, useState } from "react";

import { AUTO_SCROLL_PRESET_LABELS, DEFAULT_AUTO_SCROLL_PRESETS, type AutoScrollPresets, type AutoScrollPresetKey } from "./auto-scroll-speed";

export default function AutoScrollControls({ speed, playing, presets, onPresetsChange, syncMessage, onSpeedChange, onToggle }: {
  speed: number;
  syncMessage: string;
  presets: AutoScrollPresets;
  onPresetsChange: (presets: AutoScrollPresets) => void;
  playing: boolean;
  onSpeedChange: (speed: number) => void;
  onToggle: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<AutoScrollPresetKey, string>>({ slow: "", normal: "", fast: "", faster: "" });
  const [error, setError] = useState("");
  const startEditing = () => {
    setDraft(Object.fromEntries(AUTO_SCROLL_PRESET_LABELS.map(([key]) => [key, String(presets[key])])) as Record<AutoScrollPresetKey, string>);
    setError(""); setEditing(true);
  };
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
      {AUTO_SCROLL_PRESET_LABELS.map(([key, label]) => <button key={key} type="button" onClick={() => onSpeedChange(presets[key])} aria-pressed={speed === presets[key]} className={`${button} ${speed === presets[key] ? "!bg-[#fcf0f1]" : ""}`}>{label}（{presets[key]}）</button>)}
    </div>
    {!editing ? <button type="button" onClick={startEditing} className="text-xs text-[#a6445a] underline underline-offset-4">自分の速度を設定</button> : <div className="space-y-3 rounded-xl border border-[#eed5d8] bg-[#fff8fa] p-3">
      <p className="text-xs font-bold text-gray-600">プリセットを自分好みに（1〜100）</p>
      <div className="grid grid-cols-2 gap-3">{AUTO_SCROLL_PRESET_LABELS.map(([key, label]) => <label key={key} htmlFor={`${id}-${key}`} className="grid gap-1 text-xs text-gray-600">
        {label}<input id={`${id}-${key}`} type="number" min={1} max={100} step={1} value={draft[key]} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setError(""); }} className="min-w-0 w-full rounded-lg border border-[#eed5d8] bg-white px-2 py-2 text-sm outline-none focus:border-[#bf596f]" />
      </label>)}</div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => {
          const values = Object.fromEntries(AUTO_SCROLL_PRESET_LABELS.map(([key]) => [key, Number(draft[key])])) as AutoScrollPresets;
          if (AUTO_SCROLL_PRESET_LABELS.some(([key]) => !draft[key].trim() || !Number.isInteger(values[key]) || values[key] < 1 || values[key] > 100)) { setError("すべての速度を1〜100の整数で入力してください。"); return; }
          onPresetsChange(values); setEditing(false);
        }}>保存</button>
        <button type="button" className={button} onClick={() => setEditing(false)}>キャンセル</button>
        <button type="button" className="text-xs text-gray-500" onClick={() => { setDraft(Object.fromEntries(AUTO_SCROLL_PRESET_LABELS.map(([key]) => [key, String(DEFAULT_AUTO_SCROLL_PRESETS[key])])) as Record<AutoScrollPresetKey, string>); setError(""); }}>初期値に戻す</button>
      </div>
    </div>}
    <p role="status" className="text-[0.65rem] leading-relaxed text-gray-500">{syncMessage}</p>
  </div>;
}
