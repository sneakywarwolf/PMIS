'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GLITCH_CHANCE, REVEAL_STEPS, REVEAL_STEP_MS, glitchLine, suspiciousLine } from '@/lib/easter-egg/quiz';

const GLITCH_MS = 1500;
const BURST_CHARS = 'アイウエオ01<>/{}$#';

/** Wraps an option label with a glow + "?" and a random quip on hover. Says nothing about correctness. */
export function SuspiciousMark() {
  const [line, setLine] = useState<string | null>(null);
  return (
    <span
      className="relative ml-2 inline-flex"
      onMouseEnter={() => setLine(suspiciousLine())}
      onMouseLeave={() => setLine(null)}
      onFocus={() => setLine(suspiciousLine())}
      onBlur={() => setLine(null)}
    >
      <motion.span
        aria-hidden
        animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.15, 1] }}
        transition={{ duration: 2.2, repeat: Infinity }}
        className="inline-flex w-5 h-5 items-center justify-center rounded-full border border-amber-400/50 text-[11px] font-bold text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.35)]"
      >
        ?
      </motion.span>
      <AnimatePresence>
        {line && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-md glass px-2 py-1 text-xs text-amber-200 pointer-events-none z-10"
          >
            {line}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Rarely returns true for ~1.5s, once per mount, at a random moment. Purely visual. */
export function useRareGlitch(enabled: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || Math.random() >= GLITCH_CHANCE) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let off: ReturnType<typeof setTimeout>;
    const start = setTimeout(() => {
      setOn(true);
      off = setTimeout(() => setOn(false), GLITCH_MS);
    }, 3000 + Math.random() * 12000);
    return () => {
      clearTimeout(start);
      clearTimeout(off);
    };
  }, [enabled]);
  return on;
}

/** Overlay drawn above the card while glitching; pointer-events off so nothing is blocked. */
export function GlitchOverlay() {
  const [line] = useState(glitchLine);
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl z-10">
      <div className="absolute inset-0 ee-scanlines opacity-80" />
      {Array.from({ length: 14 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute top-0 font-mono text-xs text-emerald-400/70"
          style={{ left: `${(i * 7 + 3) % 100}%` }}
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 260, opacity: [0, 1, 0] }}
          transition={{ duration: 1.2, delay: (i % 5) * 0.08 }}
        >
          {BURST_CHARS[i % BURST_CHARS.length]}
        </motion.span>
      ))}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6, 1, 0] }}
        transition={{ duration: 1.4 }}
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-mono text-sm tracking-[0.3em] text-red-400"
      >
        {line}
      </motion.p>
    </div>
  );
}

/** 2–4s security-style reveal sequence; calls onDone once. Skippable. */
export function RevealScanner({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= REVEAL_STEPS.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), REVEAL_STEP_MS);
    return () => clearTimeout(t);
  }, [step, onDone]);

  const granted = step >= REVEAL_STEPS.length - 1;
  return (
    <div className="relative overflow-hidden rounded-lg border border-emerald-500/20 bg-black/30 p-4 font-mono text-sm" role="status" aria-live="polite">
      <motion.div
        aria-hidden
        className="absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-emerald-400/15 to-transparent"
        animate={{ y: [-32, 160] }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      {REVEAL_STEPS.slice(0, step + 1).map((s, i) => (
        <p key={s} className={i === REVEAL_STEPS.length - 1 ? 'text-emerald-300 font-bold tracking-widest' : 'text-emerald-500/80'}>
          {i === REVEAL_STEPS.length - 1 ? s : `> ${s}${i === step ? '…' : ' ✓'}`}
        </p>
      ))}
      <div className="mt-3 h-1 rounded bg-gray-800 overflow-hidden">
        <motion.div className="h-full bg-emerald-500" animate={{ width: `${((step + 1) / REVEAL_STEPS.length) * 100}%` }} />
      </div>
      {!granted && (
        <button onClick={() => setStep(REVEAL_STEPS.length)} className="absolute top-2 right-3 text-xs text-gray-500 hover:text-gray-300">
          Skip
        </button>
      )}
    </div>
  );
}
