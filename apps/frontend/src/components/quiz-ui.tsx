'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Award, Flame, Lock, Medal, Star, Target, Trophy, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';

/** Shared hover treatment for Quiz controls (same turquoise glass used app-wide). */
export const QUIZ_HOVER =
  'hover:bg-teal-400/5 hover:border-teal-400/20 hover:shadow-lg hover:shadow-teal-500/10 hover:text-white transition-all';

/** Small, quick, ease-out. All Quiz motion goes through this so reduced-motion is honoured in one place. */
export function useQuizMotion() {
  const reduce = useReducedMotion();
  return {
    reduce: !!reduce,
    t: (duration = 0.25) => ({ duration: reduce ? 0 : duration, ease: 'easeOut' as const }),
    stagger: reduce ? 0 : 0.06,
  };
}

const TABS = [
  { href: '/dashboard/quiz', label: 'Today' },
  { href: '/dashboard/quiz/log', label: 'Question Log' },
  { href: '/dashboard/quiz/scorecard', label: 'Scorecard' },
];

export function QuizHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const m = useQuizMotion();
  const tabs = user?.role === 'ADMIN' ? [...TABS, { href: '/dashboard/quiz/manage', label: 'Manage' }] : TABS;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <nav aria-label="Quiz sections" className="flex gap-0 sm:gap-1 overflow-x-auto border-b border-gray-800">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`relative whitespace-nowrap px-2 sm:px-3 py-2 text-[13px] sm:text-sm transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none rounded-t-lg ${
                active ? 'text-emerald-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
              {active && (
                <motion.span
                  layoutId="quiz-tab-underline"
                  transition={m.t(0.2)}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-400"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const PILL = {
  live: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  closed: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  revealed: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
} as const;

export function StatusPill({ status }: { status: keyof typeof PILL }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL[status]}`}>
      {status === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      {status === 'live' ? 'Live' : status === 'closed' ? 'Closed' : 'Revealed'}
    </span>
  );
}

/** Circular progress; `value` is 0–1. The number inside is the real signal, the arc is decoration. */
export function Ring({ value, size = 56, stroke = 4, children, className = 'text-emerald-400' }: {
  value: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  const m = useQuizMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: m.reduce ? c * (1 - v) : c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={m.t(0.9)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function QuizSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-white/5 animate-pulse" />
      <div className="h-9 rounded-lg bg-white/5 animate-pulse" />
      <div className="glass-card rounded-xl p-6 space-y-3">
        <div className="h-6 w-4/5 rounded bg-white/5 animate-pulse" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

/** Every badge the backend can award (QuizBadge enum), so locked ones can be shown too. */
export const BADGE_CATALOG: Record<string, { label: string; hint: string; icon: React.ElementType }> = {
  FIRST_CORRECT: { label: 'First Blood', hint: 'Answer your first question correctly', icon: Target },
  STREAK_5: { label: '5 in a Row', hint: 'Reach a 5-day streak', icon: Flame },
  STREAK_10: { label: '10 in a Row', hint: 'Reach a 10-day streak', icon: Zap },
  STREAK_30: { label: '30 in a Row', hint: 'Reach a 30-day streak', icon: Trophy },
  ANSWERED_50: { label: 'Regular', hint: 'Answer 50 questions', icon: Medal },
  ANSWERED_100: { label: 'Veteran', hint: 'Answer 100 questions', icon: Award },
  PERFECT_WEEK: { label: 'Perfect Week', hint: 'Answer every question correctly for a week', icon: Star },
};

export { Lock };
