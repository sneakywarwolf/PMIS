'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Flame, Lock, Target, Trophy } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { BADGE_CATALOG, QuizHeader, QuizSkeleton, Ring, useQuizMotion } from '@/components/quiz-ui';

type Scorecard = {
  totalAnswered: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  totalPoints: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
};

type LeaderboardEntry = { userId: string; fullName: string; totalPoints: number; currentStreak: number; bestStreak: number; badges: string[] };

// Podium tints; the rank number is always printed, so color is never the only signal.
const RANK = ['text-amber-300 bg-amber-400/10 border-amber-400/30', 'text-gray-200 bg-gray-300/10 border-gray-300/30', 'text-orange-300 bg-orange-400/10 border-orange-400/30'];

export default function QuizScorecardPage() {
  const { user } = useAuth();
  const m = useQuizMotion();
  const [card, setCard] = useState<Scorecard | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/quiz/scorecard'), api.get('/quiz/scorecard/leaderboard')]).then(([c, l]) => {
      setCard(c.data);
      setLeaderboard(l.data);
      setLoading(false);
    });
  }, []);

  if (loading || !card) return <div className="p-6 max-w-3xl mx-auto"><QuizSkeleton rows={3} /></div>;

  const top = Math.max(1, ...leaderboard.map((e) => e.totalPoints));
  const earned = new Set(card.badges);
  const hero = [
    { label: 'Points', value: card.totalPoints, icon: Trophy, cls: 'text-amber-400 bg-amber-500/10' },
    { label: 'Current streak', value: card.currentStreak, icon: Flame, cls: 'text-orange-400 bg-orange-500/10', note: `Best ${card.bestStreak}` },
  ];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <QuizHeader title="Scorecard" subtitle="Your stats, badges and how you rank." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {hero.map((h, i) => (
          <motion.div
            key={h.label}
            initial={{ opacity: 0, y: m.reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...m.t(0.3), delay: i * m.stagger }}
            className="glass-card rounded-xl p-5 flex items-center gap-4"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${h.cls}`}><h.icon className="w-5 h-5" /></div>
            <div>
              <p className="text-2xl font-bold text-white tabular-nums">{h.value}</p>
              <p className="text-xs text-gray-400">{h.label}</p>
              {h.note && <p className="text-xs text-gray-500 tabular-nums">{h.note}</p>}
            </div>
          </motion.div>
        ))}
        <motion.div
          initial={{ opacity: 0, y: m.reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...m.t(0.3), delay: 2 * m.stagger }}
          className="glass-card rounded-xl p-5 flex items-center gap-4"
        >
          <Ring value={card.accuracy / 100} size={52}>{card.accuracy}%</Ring>
          <div>
            <p className="text-sm font-medium text-white">Accuracy</p>
            <p className="text-xs text-gray-400 tabular-nums">{card.correct} of {card.totalAnswered} correct</p>
          </div>
        </motion.div>
      </div>

      <div className="glass-card rounded-xl p-4 grid grid-cols-3 divide-x divide-gray-800 text-center">
        {[['Answered', card.totalAnswered, 'text-white'], ['Correct', card.correct, 'text-emerald-400'], ['Incorrect', card.incorrect, 'text-red-400']].map(([label, v, cls]) => (
          <div key={label as string} className="px-2">
            <p className={`text-xl font-semibold tabular-nums ${cls}`}>{v}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <section className="glass-card rounded-xl p-5">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Target className="w-4 h-4 text-gray-500" /> Badges
          <span className="text-xs text-gray-500 tabular-nums">{earned.size}/{Object.keys(BADGE_CATALOG).length}</span>
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(BADGE_CATALOG).map(([key, b], i) => {
            const has = earned.has(key);
            return (
              <motion.li
                key={key}
                initial={{ opacity: 0, y: m.reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...m.t(0.25), delay: i * m.stagger }}
                title={b.hint}
                className={`flex items-center gap-3 rounded-lg border p-3 ${has ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-gray-800 bg-white/[0.02]'}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${has ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                  {has ? <b.icon className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${has ? 'text-white' : 'text-gray-500'}`}>{b.label}</p>
                  <p className="text-xs text-gray-500 truncate">{has ? 'Earned' : b.hint}</p>
                </div>
              </motion.li>
            );
          })}
        </ul>
      </section>

      <section className="glass-card rounded-xl overflow-hidden">
        <h2 className="p-4 text-sm font-medium text-gray-300 flex items-center gap-2"><Crown className="w-4 h-4 text-gray-500" /> Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="px-4 pb-8 pt-2 text-center text-sm text-gray-500">No scores yet — answer a question to get on the board.</p>
        ) : (
          <ol className="divide-y divide-gray-800 border-t border-gray-800">
            {leaderboard.map((entry, i) => {
              const you = entry.userId === user?.id;
              return (
                <motion.li
                  key={entry.userId}
                  initial={{ opacity: 0, x: m.reduce ? 0 : -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...m.t(0.25), delay: Math.min(i, 10) * m.stagger }}
                  aria-current={you ? 'true' : undefined}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5 ${you ? 'bg-emerald-500/5' : ''}`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${RANK[i] ?? 'border-gray-700 text-gray-500'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-100">
                      {entry.fullName}
                      {you && <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">You</span>}
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-800">
                      <motion.div
                        className="h-full rounded-full bg-emerald-500/70"
                        initial={{ width: m.reduce ? `${(entry.totalPoints / top) * 100}%` : 0 }}
                        animate={{ width: `${(entry.totalPoints / top) * 100}%` }}
                        transition={{ ...m.t(0.7), delay: Math.min(i, 10) * m.stagger }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-cyan-400 tabular-nums">{entry.totalPoints} pts</span>
                </motion.li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
