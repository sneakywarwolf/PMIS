'use client';

import { useEffect, useRef } from 'react';

const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}[]$#%&*';
const FONT = 16;
const DRAW_INTERVAL_MS = 33;
const MIN_FPS = 30;

// Circuit breaker: below MIN_FPS the column density halves; if it stays low
// the canvas stops and onDisable fires so the page falls back to a static bg.
export function MatrixRain({ boostAt, onDisable }: { boostAt: number; onDisable: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boostRef = useRef(boostAt);
  boostRef.current = boostAt;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDisable();
      return;
    }
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onDisable();
      return;
    }

    let w = 0;
    let h = 0;
    let drops: number[] = [];
    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      drops = Array.from({ length: Math.ceil(w / FONT) }, () => (Math.random() * -h) / FONT);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let stride = 1;
    let frames = 0;
    let windowStart = performance.now();
    let warmedUp = false;
    let lastDraw = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      frames++;
      const elapsed = t - windowStart;
      if (elapsed > 2000) {
        // tab was hidden / rAF paused — don't judge performance on a stall
        frames = 0;
        windowStart = t;
      } else if (elapsed >= 1000) {
        const fps = (frames * 1000) / elapsed;
        frames = 0;
        windowStart = t;
        if (!warmedUp) warmedUp = true;
        else if (fps < MIN_FPS) {
          if (stride === 1) stride = 2;
          else {
            cancelAnimationFrame(raf);
            ctx.clearRect(0, 0, w, h);
            onDisable();
            return;
          }
        }
      }

      if (t - lastDraw < DRAW_INTERVAL_MS) return;
      lastDraw = t;
      const speed = t - boostRef.current < 900 ? 3 : 1;

      ctx.fillStyle = 'rgba(5, 10, 18, 0.12)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FONT}px monospace`;
      for (let i = 0; i < drops.length; i += stride) {
        const y = drops[i] * FONT;
        ctx.fillStyle = Math.random() > 0.975 ? '#d1fae5' : 'rgba(16, 185, 129, 0.75)';
        ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0], i * FONT, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i] += speed;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [onDisable]);

  return <canvas ref={canvasRef} aria-hidden className="fixed inset-0 pointer-events-none" />;
}
