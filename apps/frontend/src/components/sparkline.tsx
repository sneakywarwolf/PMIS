'use client';

import { motion, useReducedMotion } from 'framer-motion';

/** Decorative trend line; the delta text next to it carries the meaning, so it's aria-hidden. */
export function Sparkline({ values, className = '', width = 72, height = 28 }: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const reduce = useReducedMotion();
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [
    1 + (i / (values.length - 1)) * (width - 2),
    height - 2 - ((v - min) / span) * (height - 4),
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];

  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`shrink-0 ${className}`}>
      <path d={`${line} L${width - 1} ${height} L1 ${height} Z`} fill="currentColor" fillOpacity={0.12} />
      <motion.path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: reduce ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
      />
      <circle cx={lx} cy={ly} r={2} fill="currentColor" />
    </svg>
  );
}
