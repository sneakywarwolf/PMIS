'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Crown, Gamepad2, Zap } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';

type Row = { id: string; name: string; score: number };

// Medal tints per podium place; the rank number is always printed too, so color is never the only signal.
const MEDAL = [
  'text-amber-300 border-amber-400/40 bg-amber-400/10 shadow-amber-400/20',
  'text-slate-200 border-slate-300/40 bg-slate-300/10 shadow-slate-300/10',
  'text-orange-300 border-orange-400/40 bg-orange-400/10 shadow-orange-400/10',
];

const TOP = 5;

function Board({ title, unit, icon: Icon, accent, href, rows, meId }: {
  title: string;
  unit: string;
  icon: React.ElementType;
  accent: { text: string; bar: string; glow: string };
  href: string;
  rows: Row[] | null;
  meId?: string;
}) {
  const reduce = useReducedMotion();
  const top = rows?.slice(0, TOP) ?? [];
  const max = Math.max(1, ...top.map((r) => r.score));
  const meIdx = rows?.findIndex((r) => r.id === meId) ?? -1;
  const showMe = meIdx >= TOP;

  const line = (r: Row, rank: number, i: number) => {
    const me = r.id === meId;
    return (
      <motion.li
        key={r.id}
        initial={{ opacity: 0, x: reduce ? 0 : -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : i * 0.06, ease: 'easeOut' }}
        className={`relative overflow-hidden rounded-lg border px-3 py-2 ${me ? 'border-white/25 bg-white/[0.06]' : 'border-white/5 bg-white/[0.02]'}`}
      >
        <motion.div
          aria-hidden
          className={`absolute inset-y-0 left-0 ${accent.bar}`}
          initial={{ width: reduce ? `${(r.score / max) * 100}%` : 0 }}
          animate={{ width: `${(r.score / max) * 100}%` }}
          transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.2 + i * 0.06, ease: 'easeOut' }}
        />
        <div className="relative flex items-center gap-3">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold tabular-nums shadow-md ${rank <= 3 ? MEDAL[rank - 1] : 'text-gray-400 border-white/10 bg-white/5'}`}>
            {rank === 1 ? <Crown className="w-3.5 h-3.5" /> : rank}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-gray-100">
            {r.name}
            {me && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-white/60">you</span>}
          </span>
          <span className={`font-mono text-sm font-semibold tabular-nums ${accent.text}`}>{r.score.toLocaleString()}</span>
        </div>
      </motion.li>
    );
  };

  return (
    <div className={`glass-card relative overflow-hidden rounded-xl p-5 ${accent.glow}`}>
      <div aria-hidden className={`absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl opacity-20 ${accent.bar}`} />
      <div className="relative flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 ${accent.text}`}><Icon className="w-4 h-4" /></span>
          {title}
          <span className="text-[10px] font-medium uppercase tracking-widest text-gray-500">{unit}</span>
        </h3>
        <Link href={href} className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-white transition-colors">
          Full board <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {rows === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="relative text-sm text-gray-500 py-6 text-center">No scores yet — claim the first spot.</p>
      ) : (
        <ol className="relative space-y-2">
          {top.map((r, i) => line(r, i + 1, i))}
          {showMe && (
            <>
              <li aria-hidden className="text-center text-gray-600 leading-none">⋮</li>
              {line(rows[meIdx], meIdx + 1, TOP)}
            </>
          )}
        </ol>
      )}
    </div>
  );
}

/** Company-wide rankings (everyone vs everyone) shown above Engagements to keep teams competing. */
export function DashboardRankings() {
  const { user } = useAuth();
  const [quiz, setQuiz] = useState<Row[] | null>(null);
  const [arcade, setArcade] = useState<Row[] | null>(null);

  useEffect(() => {
    api.get('/quiz/scorecard/leaderboard')
      .then((r) => setQuiz(r.data.map((e: { userId: string; fullName: string; totalPoints: number }) => ({ id: e.userId, name: e.fullName || 'Unknown', score: e.totalPoints }))))
      .catch(() => setQuiz([]));
    api.get('/quiz/arcade/pattern-map/leaderboard')
      .then((r) => setArcade(r.data.map((e: { userId: string; name: string; bestScore: number }) => ({ id: e.userId, name: e.name, score: e.bestScore }))))
      .catch(() => setArcade([]));
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Board
        title="Quiz Champions" unit="points" icon={Zap} href="/dashboard/quiz/scorecard" rows={quiz} meId={user?.id}
        accent={{ text: 'text-emerald-300', bar: 'bg-gradient-to-r from-emerald-500/30 to-emerald-400/5', glow: 'hover:shadow-lg hover:shadow-emerald-500/10 transition-shadow' }}
      />
      <Board
        title="Pattern Map" unit="best score" icon={Gamepad2} href="/dashboard/quiz/arcade" rows={arcade} meId={user?.id}
        accent={{ text: 'text-fuchsia-300', bar: 'bg-gradient-to-r from-fuchsia-500/30 to-cyan-400/5', glow: 'hover:shadow-lg hover:shadow-fuchsia-500/10 transition-shadow' }}
      />
    </div>
  );
}
