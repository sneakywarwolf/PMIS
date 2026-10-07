'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { api } from '@/contexts/auth-context';

type Summary = {
  activeUsers: number;
  quiz: { participantsLast7Days: number; participationRate: number; revealedQuestionsLast7Days: number };
  arcade: { weeks: { weekStart: string; plays: number; players: number }[] };
};

/** Admin-only: are people actually using the Quiz and Arcade? */
export function EngagementCard() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => { api.get('/quiz/engagement').then((r) => setData(r.data)).catch(() => {}); }, []);
  if (!data) return null;

  const peak = Math.max(1, ...data.arcade.weeks.map((w) => w.plays));
  return (
    <section className="glass-card rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-medium text-gray-300 flex items-center gap-2"><Activity className="w-4 h-4 text-gray-500" /> Engagement</h2>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div><p className="text-2xl font-bold text-white tabular-nums">{data.quiz.participationRate}%</p><p className="text-xs text-gray-500">Quiz participation (7d)</p></div>
        <div><p className="text-2xl font-bold text-white tabular-nums">{data.quiz.participantsLast7Days}<span className="text-sm text-gray-500">/{data.activeUsers}</span></p><p className="text-xs text-gray-500">Users who answered</p></div>
        <div><p className="text-2xl font-bold text-white tabular-nums">{data.arcade.weeks[data.arcade.weeks.length - 1]?.players ?? 0}</p><p className="text-xs text-gray-500">Arcade players this week</p></div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-2">Arcade plays per week</p>
        <div className="flex items-end gap-2 h-16">
          {data.arcade.weeks.map((w) => (
            <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1" title={`Week of ${w.weekStart}: ${w.plays} plays, ${w.players} players`}>
              <div className="w-full rounded-t bg-fuchsia-400/60" style={{ height: `${Math.max(4, (w.plays / peak) * 100)}%` }} />
              <span className="text-[10px] text-gray-500 tabular-nums">{w.plays}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
