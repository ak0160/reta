"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

type MapReaction = {
  paragraphIndex: number;
  participantName: string;
  emoji: string;
  comment: string;
  createdAt: number;
};

export function groupMapReactions(reactions: MapReaction[], currentIndex: number) {
  const groups = new Map<number, MapReaction[]>();
  for (const reaction of reactions) {
    // 従来のマップと同じ条件。未到達の区切りの内容・件数を表示しない。
    if (reaction.paragraphIndex > currentIndex) continue;
    const group = groups.get(reaction.paragraphIndex) ?? [];
    group.push(reaction);
    groups.set(reaction.paragraphIndex, group);
  }
  return groups;
}

export default function ReadingMapReactions({ reactions, currentIndex, getPercent, children, vertical = false }: {
  reactions: MapReaction[];
  vertical?: boolean;
  currentIndex: number;
  getPercent: (index: number) => number;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const groups = useMemo(() => groupMapReactions(reactions, currentIndex), [reactions, currentIndex]);
  const active = selected === null ? undefined : groups.get(selected);
  const open = !!active?.length;
  const close = (returnFocus = false) => {
    setSelected(null);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (selected !== null && !groups.has(selected)) setSelected(null);
  }, [selected, groups]);

  useEffect(() => {
    if (!open) return;
    // Keep focus on the heart so opening a note never scrolls the reading screen.
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inCard = card.current?.contains(target);
      const inHeart = target instanceof Element && wrapper.current?.contains(target) && target.closest(".reta-map-heart");
      if (!inCard && !inHeart) setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, selected]);

  return <div ref={wrapper} className={`reta-map-interactive${open ? " is-open" : ""}${vertical ? " is-vertical" : ""}`} onKeyDown={event => {
    // カード内のキー操作で本文の読書ショートカットを発火させない。
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(true); }
  }}>
    <div className="reta-map-track relative rounded-full">
      {children}
      {Array.from(groups, ([index, items]) => <button
        key={index}
        type="button"
        className={`reta-map-heart${selected === index ? " is-selected" : ""}`}
        style={vertical ? { top: `${getPercent(index)}%` } : { left: `${100 - getPercent(index)}%` }}
        aria-label={`${index + 1}区切り目のリアクション ${items.length}件を表示`}
        aria-haspopup="dialog"
        aria-expanded={selected === index}
        aria-controls={selected === index ? id : undefined}
        onClick={event => {
          trigger.current = event.currentTarget;
          setSelected(current => current === index ? null : index);
        }}
      ><span aria-hidden="true">♥</span>{items.length > 1 && <span className="reta-map-heart-count" aria-hidden="true">{items.length}</span>}</button>)}
    </div>
    {open && selected !== null && <section
      ref={card}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(true); }
      }}
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="reta-map-reaction-card reta-map-inline-note"
      style={vertical ? { top: `calc(${getPercent(selected)}% + 40px)` } : undefined}
    >
      <div className="reta-map-reaction-card-header">
        <h3 id={`${id}-title`}>{selected + 1}区切り目 <span>· {active.length}件</span></h3>
        <button ref={closeButton} type="button" onClick={() => close(true)} aria-label="リアクションを閉じる">×</button>
      </div>
      <ul>{active.map((reaction, index) => <li key={`${reaction.createdAt}-${index}`}>
        <div className="reta-map-reaction-author"><span className="reta-map-reaction-emoji">{reaction.emoji}</span><span>{reaction.participantName || "利用者"}</span></div>
        {reaction.comment.trim() && <p>{reaction.comment}</p>}
      </li>)}</ul>
    </section>}
  </div>;
}
