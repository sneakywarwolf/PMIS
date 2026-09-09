'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';

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

export default function QuizScorecardPage() {
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

  if (loading || !card) return <div className="p-6 text-gray-400">Loading scorecard…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-white">Scorecard</h1>

      <div className="glass-card p-6 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        <div><div className="text-2xl text-white">{card.totalPoints}</div><div className="text-xs text-gray-400">Points</div></div>
        <div><div className="text-2xl text-white">{card.accuracy}%</div><div className="text-xs text-gray-400">Accuracy</div></div>
        <div><div className="text-2xl text-white">{card.currentStreak}</div><div className="text-xs text-gray-400">Current Streak</div></div>
        <div><div className="text-2xl text-white">{card.bestStreak}</div><div className="text-xs text-gray-400">Best Streak</div></div>
        <div><div className="text-2xl text-white">{card.totalAnswered}</div><div className="text-xs text-gray-400">Answered</div></div>
        <div><div className="text-2xl text-white">{card.correct}</div><div className="text-xs text-gray-400">Correct</div></div>
        <div><div className="text-2xl text-white">{card.incorrect}</div><div className="text-xs text-gray-400">Incorrect</div></div>
      </div>

      <div className="glass-card p-4 rounded-xl">
        <div className="text-sm text-gray-400 mb-2">Badges</div>
        <div className="flex flex-wrap gap-2">
          {card.badges.length === 0 && <span className="text-gray-500 text-sm">No badges yet.</span>}
          {card.badges.map((b) => (
            <span key={b} className="glass px-3 py-1 rounded-full text-xs text-cyan-300">{b.replace(/_/g, ' ')}</span>
          ))}
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="p-4 text-sm text-gray-400">Leaderboard</div>
        <table className="w-full text-sm">
          <tbody>
            {leaderboard.map((entry, i) => (
              <tr key={entry.userId} className="border-t border-gray-800">
                <td className="p-3 text-gray-500 w-10">{i + 1}</td>
                <td className="p-3 text-gray-200">{entry.fullName}</td>
                <td className="p-3 text-right text-cyan-400">{entry.totalPoints} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
