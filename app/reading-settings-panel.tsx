"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  READING_BACKGROUND_OPTIONS,
  READING_FONT_LABELS,
  READING_HIGHLIGHT_LABELS,
  READING_HIGHLIGHT_OPTIONS,
  getReaderHighlightPalette,
  type ReaderSettings,
} from "./reading-settings";

export default function ReadingSettingsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(38);
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const update = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const startSheetResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStart.current = { y: event.clientY, height: sheetHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeSheet = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const delta = ((dragStart.current.y - event.clientY) / viewportHeight) * 100;
    setSheetHeight(Math.max(30, Math.min(82, dragStart.current.height + delta)));
  };

  return <>
    <button
      type="button"
      onClick={() => setOpen(value => !value)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label="読書設定を開く"
      className="inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-[#eed5d8] bg-white px-3 text-base font-semibold tracking-[-0.06em] text-[#a6445a] shadow-sm transition hover:bg-[#fff4f6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bf7182]"
    >Aa</button>
    {open && <>
      <section
        role="dialog"
        aria-label="読書設定"
        style={{ "--settings-sheet-height": `${sheetHeight}dvh` } as CSSProperties}
        className="reading-settings-dialog fixed right-3 top-20 z-[1100] max-h-[calc(100dvh-6rem)] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[1.4rem] border border-[#eadadd] bg-[#fffdfa] p-4 text-[#3f3435] shadow-[0_18px_55px_rgba(54,34,38,0.2)] sm:right-6 sm:top-24 sm:p-5"
      >
        <button
          type="button"
          aria-label="設定パネルの高さを調整"
          className="reading-settings-sheet-handle"
          onPointerDown={startSheetResize}
          onPointerMove={resizeSheet}
          onPointerUp={() => { dragStart.current = null; }}
          onPointerCancel={() => { dragStart.current = null; }}
          onClick={event => event.preventDefault()}
        ><span aria-hidden="true" /></button>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.62rem] font-bold tracking-[0.2em] text-[#b56d7d]">READING SETTINGS</p>
            <h2 className="mt-1 font-serif text-lg font-semibold">読書設定</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="読書設定を閉じる" className="rounded-full px-2 py-1 text-xl leading-none text-gray-400 hover:bg-[#faedef] hover:text-[#a6445a]">×</button>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-bold text-gray-600">フォント</legend>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#f7f0ef] p-1">
            {Object.entries(READING_FONT_LABELS).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={settings.font === value}
                onClick={() => update("font", value as ReaderSettings["font"])}
                className={`min-h-10 rounded-lg px-1 text-xs font-semibold transition ${settings.font === value ? "bg-white text-[#9f5265] shadow-sm" : "text-gray-600 hover:bg-white/70"}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>


        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs font-bold text-gray-600"><span>文字サイズ</span><span>{Math.round(settings.fontSizePx)} px</span></span>
          <input aria-label="文字サイズ" className="mt-2 w-full accent-[#b96779]" type="range" min="20" max="26" step="2" value={settings.fontSizePx} onChange={event => update("fontSizePx", Number(event.target.value))} />
          <span className="flex justify-between text-[0.65rem] text-gray-400"><span>小</span><span>大</span></span>
        </label>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-bold text-gray-600">背景色</legend>
          <div className="grid grid-cols-4 gap-2">
            {READING_BACKGROUND_OPTIONS.map(option => (
              <button key={option.value} type="button" aria-label={option.label} aria-pressed={settings.background === option.value}
                onClick={() => update("background", option.value)}
                className={`flex min-h-[4.2rem] flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[0.62rem] font-semibold transition ${settings.background === option.value ? "border-[#b96779] ring-2 ring-[#e9c5cc]" : "border-[#eee5e3] hover:border-[#d9aab3]"}`}>
                <span aria-hidden="true" className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: option.color }} />
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-bold text-gray-600">ハイライトカラー</legend>
          <div className="grid grid-cols-5 gap-1">
            {READING_HIGHLIGHT_OPTIONS.map(value => {
              const selected = settings.highlightColor === value;
              const palette = getReaderHighlightPalette(settings.background, value);
              return <button key={value} type="button" aria-label={READING_HIGHLIGHT_LABELS[value]} aria-pressed={selected}
                onClick={() => update("highlightColor", value)}
                className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.6rem] font-semibold text-gray-600 transition hover:bg-[#faf3f3] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b96779]">
                <span className={`relative flex h-8 w-8 items-center justify-center rounded-full border ${selected ? "border-[#a6445a] ring-2 ring-[#e9c5cc] ring-offset-1" : "border-black/10"}`}
                  style={{ backgroundColor: palette.swatch }}>
                  {value === "none" && <span aria-hidden="true" className="absolute h-[1.5px] w-7 rotate-[-45deg] bg-gray-500" />}
                  {selected && value !== "none" && <span aria-hidden="true" className="text-xs font-black text-white drop-shadow">✓</span>}
                  {selected && value === "none" && <span aria-hidden="true" className="text-[0.6rem] font-black text-gray-600">✓</span>}
                </span>
                {READING_HIGHLIGHT_LABELS[value]}
              </button>;
            })}
          </div>
        </fieldset>

        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs font-bold text-gray-600"><span>行間</span><span>{settings.lineSpacing.toFixed(2)}×</span></span>
          <input aria-label="行間" className="mt-2 w-full accent-[#b96779]" type="range" min="0.75" max="1.5" step="0.05" value={settings.lineSpacing} onChange={event => update("lineSpacing", Number(event.target.value))} />
          <span className="flex justify-between text-[0.65rem] text-gray-400"><span>狭い</span><span>広い</span></span>
        </label>

        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs font-bold text-gray-600"><span>段落間隔</span><span>{settings.paragraphSpacing.toFixed(2)}×</span></span>
          <input aria-label="段落間隔" className="mt-2 w-full accent-[#b96779]" type="range" min="0" max="1.5" step="0.1" value={settings.paragraphSpacing} onChange={event => update("paragraphSpacing", Number(event.target.value))} />
          <span className="flex justify-between text-[0.65rem] text-gray-400"><span>狭い</span><span>広い</span></span>
        </label>

        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs font-bold text-gray-600"><span>文字間隔</span><span>{settings.letterSpacing.toFixed(2)}×</span></span>
          <input aria-label="文字間隔" className="mt-2 w-full accent-[#b96779]" type="range" min="0.5" max="1.6" step="0.05" value={settings.letterSpacing} onChange={event => update("letterSpacing", Number(event.target.value))} />
          <span className="flex justify-between text-[0.65rem] text-gray-400"><span>狭い</span><span>広い</span></span>
        </label>

        <label className="mt-4 block">
          <span className={`flex items-center justify-between text-xs font-bold ${settings.highlightColor === "none" ? "text-gray-400" : "text-gray-600"}`}><span>ハイライトの濃さ</span><span>{settings.highlightColor === "none" ? "—" : `${Math.round(settings.highlightOpacity * 100)}%`}</span></span>
          <input aria-label="ハイライトの濃さ" disabled={settings.highlightColor === "none"} className="mt-2 w-full accent-[#d4a82c] disabled:cursor-not-allowed disabled:opacity-35" type="range" min="0.08" max="0.55" step="0.01" value={settings.highlightOpacity} onChange={event => update("highlightOpacity", Number(event.target.value))} />
          <span className="flex justify-between text-[0.65rem] text-gray-400"><span>淡い</span><span>濃い</span></span>
        </label>

        <button type="button" onClick={onReset} className="mt-5 min-h-10 w-full rounded-xl border border-[#eadadd] bg-white px-3 text-xs font-bold text-[#9f5265] transition hover:bg-[#fff4f6]">
          初期設定に戻す
        </button>
      </section>
    </>}
  </>;
}
