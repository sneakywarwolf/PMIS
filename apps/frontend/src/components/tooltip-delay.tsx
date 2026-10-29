'use client';

import { useEffect, useRef, useState } from 'react';

/** How long the pointer must rest on an element before its hover tip appears. */
export const TOOLTIP_DELAY_MS = 1000;

/**
 * Shows every `title` hover tip in the app after TOOLTIP_DELAY_MS. Browsers fix the delay of native title tips,
 * so while the pointer is over an element its `title` is lifted off (so the browser stays quiet) and put back as
 * soon as the pointer leaves; the tip is drawn here instead. Mounted once in the root layout.
 */
export function TooltipDelay() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let host: HTMLElement | null = null;
    let text = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const release = () => {
      clearTimeout(timer);
      if (host && text && !host.hasAttribute('title')) host.setAttribute('title', text);
      host = null;
      text = '';
      setTip(null);
    };

    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null;
      if (el === host) return;
      release();
      const t = el?.getAttribute('title')?.trim();
      if (!el || !t) return;
      host = el;
      text = el.getAttribute('title')!;
      el.removeAttribute('title');
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6 });
      }, TOOLTIP_DELAY_MS);
    };
    const out = (e: MouseEvent) => {
      if (host && !host.contains(e.relatedTarget as Node | null)) release();
    };

    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('mousedown', release, true);
    document.addEventListener('keydown', release, true);
    window.addEventListener('scroll', release, true);
    window.addEventListener('blur', release);
    return () => {
      release();
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('mousedown', release, true);
      document.removeEventListener('keydown', release, true);
      window.removeEventListener('scroll', release, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  // Keep the tip on screen: centred under the element, nudged in from the edges, above it when there is no room below.
  useEffect(() => {
    const box = boxRef.current;
    if (!tip || !box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.min(Math.max(8, tip.x - w / 2), window.innerWidth - w - 8);
    const top = tip.y + h + 8 > window.innerHeight ? Math.max(8, tip.y - h - 32) : tip.y;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.visibility = 'visible';
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
      className="z-[9999] max-w-xs pointer-events-none whitespace-pre-line rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-100 shadow-lg"
    >
      {tip.text}
    </div>
  );
}
