'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const HITS_TO_BREAK = 3;
const REASSEMBLE_MS = 2500;
// Each shard is the same glyph clipped to one wedge, so the pieces fit back together exactly.
const SHARDS = [
  { clip: 'polygon(0 0, 55% 0, 40% 45%, 0 35%)', x: -60, y: -50, r: -40 },
  { clip: 'polygon(55% 0, 100% 0, 100% 40%, 40% 45%)', x: 60, y: -60, r: 35 },
  { clip: 'polygon(0 35%, 40% 45%, 30% 100%, 0 100%)', x: -70, y: 60, r: -25 },
  { clip: 'polygon(40% 45%, 100% 40%, 100% 70%, 60% 100%, 30% 100%)', x: 30, y: 80, r: 50 },
  { clip: 'polygon(100% 70%, 100% 100%, 60% 100%)', x: 80, y: 50, r: 70 },
];

export function BreakableDigit({ char }: { char: string }) {
  const [hits, setHits] = useState(0);
  const broken = hits >= HITS_TO_BREAK;

  useEffect(() => {
    if (!broken) return;
    const t = setTimeout(() => setHits(0), REASSEMBLE_MS);
    return () => clearTimeout(t);
  }, [broken]);

  const glyph = 'text-[7rem] md:text-[10rem] font-black leading-none text-emerald-400 select-none';

  return (
    <button
      type="button"
      aria-label={`Digit ${char}`}
      onClick={() => !broken && setHits((h) => h + 1)}
      className="relative inline-block cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded"
      style={{ textShadow: '0 0 30px rgba(16,185,129,0.35)' }}
    >
      {/* invisible glyph keeps the layout box while shards fly */}
      <span className={`${glyph} ${broken ? 'opacity-0' : ''}`}>
        <motion.span
          key={hits}
          className="inline-block"
          animate={hits ? { x: [0, -6, 5, -3, 0], rotate: [0, -3, 2, 0] } : {}}
          transition={{ duration: 0.3 }}
        >
          {char}
        </motion.span>
      </span>
      {hits > 0 && !broken && (
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          <polyline points="55,0 40,45 30,100" className="fill-none stroke-black/70" strokeWidth={1.5} />
          {hits > 1 && <polyline points="0,35 40,45 100,40" className="fill-none stroke-black/70" strokeWidth={1.5} />}
        </svg>
      )}
      {broken &&
        SHARDS.map((s, i) => (
          <motion.span
            key={i}
            aria-hidden
            className={`${glyph} absolute inset-0 pointer-events-none`}
            style={{ clipPath: s.clip }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{ x: s.x, y: s.y, rotate: s.r, opacity: 0.25 }}
            transition={{ type: 'spring', stiffness: 120, damping: 12 }}
          >
            {char}
          </motion.span>
        ))}
    </button>
  );
}
