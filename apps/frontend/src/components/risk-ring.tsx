'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Counts, riskLevel, riskScore } from '@/lib/risk';

/** 0–100 risk gauge. The number and label are always present, so color is never the only signal. */
export function RiskRing({ counts, size = 32 }: { counts: Counts; size?: number }) {
  const reduce = useReducedMotion();
  const score = riskScore(counts);
  const { label, cls } = riskLevel(score);
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Risk ${score} of 100, ${label}`}
      className={`shrink-0 ${cls}`}
    >
      <title>{`Risk ${score}/100 · ${label}`}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: reduce ? c * (1 - score / 100) : c }}
        animate={{ strokeDashoffset: c * (1 - score / 100) }}
        transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-white font-mono tabular-nums"
        style={{ fontSize: size * 0.34 }}
      >
        {score}
      </text>
    </svg>
  );
}
