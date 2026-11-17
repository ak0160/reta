"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A display-only overlay: names must never reduce the space available to text.
export default function ReaderNameBadges({ className, children }: { className: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const badges = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const target = anchor.current?.parentElement;
    const overlay = badges.current;
    const area = target?.closest(".reta-reader-body");
    if (!mounted || !target || !overlay || !area) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      const viewport = area.getBoundingClientRect();
      const width = overlay.getBoundingClientRect().width;
      const height = overlay.getBoundingClientRect().height;
      // Do not leave an offscreen paragraph's names floating over another one.
      if (rect.right <= viewport.left || rect.left >= viewport.right || viewport.bottom <= 0 || viewport.top >= window.innerHeight) {
        overlay.style.visibility = "hidden";
        return;
      }
      const left = Math.max(viewport.left + 4, Math.min(rect.right - width, viewport.right - width - 4));
      const top = Math.max(8, rect.top - height - 8);
      overlay.style.setProperty("--reader-name-left", `${left}px`);
      overlay.style.setProperty("--reader-name-top", `${top}px`);
      overlay.style.visibility = "visible";
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    observer.observe(area);
    observer.observe(overlay);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    place();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [mounted, children]);

  return <>
    <span hidden ref={anchor} aria-hidden="true" />
    {mounted && createPortal(
      <div ref={badges} className={`${className} reader-name-overlay`} style={{ visibility: "hidden" }}>{children}</div>,
      document.body,
    )}
  </>;
}
