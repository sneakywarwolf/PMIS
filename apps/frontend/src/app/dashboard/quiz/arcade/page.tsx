'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Play, RotateCcw, Trophy } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { QuizHeader } from '@/components/quiz-ui';

// Pattern Map: standalone break-time game. Its scores live in their own table and never touch Quiz data.

type Round = { grid: number; length: number; ms: number };
type Phase = 'idle' | 'reveal' | 'recall' | 'over';
type Result = { score: number; accuracy: number; roundsCleared: number; best: number };
type Entry = { rank: number; userId: string; name: string; bestScore: number };

const LIVES = 3;

const gridFor = (n: number) => (n <= 4 ? 3 : n <= 9 ? 4 : 5);
const lengthFor = (n: number) => Math.min(gridFor(n) ** 2 - 2, 2 + Math.ceil(n / 1.5));
const revealMsFor = (n: number) => Math.max(300, 650 - n * 15);

function makePattern(n: number): number[] {
  const tiles = Array.from({ length: gridFor(n) ** 2 }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, lengthFor(n));
}

export default function ArcadePage() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [roundNo, setRoundNo] = useState(1);
  const [lives, setLives] = useState(LIVES);
  const [pattern, setPattern] = useState<number[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [flash, setFlash] = useState<{ tile: number; ok: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [board, setBoard] = useState<Entry[]>([]);

  // Run stats live in a ref: they feed the final submit and must not lag behind rapid clicks.
  const run = useRef({ rounds: [] as Round[], clicks: 0, correct: 0, recallStart: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const loadBoard = useCallback(() => {
    api.get('/quiz/arcade/pattern-map/leaderboard').then((r) => setBoard(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadBoard(); return clearTimers; }, [loadBoard]);

  const startRound = useCallback((n: number) => {
    const p = makePattern(n);
    const step = revealMsFor(n);
    setRoundNo(n);
    setPattern(p);
    setPicked([]);
    setFlash(null);
    setPhase('reveal');
    clearTimers();
    p.forEach((tile, i) => {
      later(() => setLit(tile), 500 + i * step * 1.4);
      later(() => setLit(null), 500 + i * step * 1.4 + step);
    });
    later(() => { run.current.recallStart = Date.now(); setPhase('recall'); }, 500 + p.length * step * 1.4);
  }, []);

  const finish = async () => {
    setPhase('over');
    const { rounds, clicks, correct } = run.current;
    if (!rounds.length) return;
    try {
      const r = await api.post('/quiz/arcade/pattern-map/scores', { rounds, clicks, correctClicks: correct });
      setResult(r.data);
      loadBoard();
    } catch { /* score not saved; the run result below still shows */ }
  };

  const start = () => {
    run.current = { rounds: [], clicks: 0, correct: 0, recallStart: 0 };
    setLives(LIVES);
    setResult(null);
    startRound(1);
  };

  const tap = (tile: number) => {
    if (phase !== 'recall') return;
    const r = run.current;
    const ok = tile === pattern[picked.length];
    r.clicks += 1;
    setFlash({ tile, ok });
    if (!ok) {
      const left = lives - 1;
      setLives(left);
      setPhase('reveal'); // lock input during the pause
      later(() => (left <= 0 ? finish() : startRound(roundNo)), 700);
      return;
    }
    r.correct += 1;
    const next = [...picked, tile];
    setPicked(next);
    if (next.length === pattern.length) {
      r.rounds.push({ grid: gridFor(roundNo), length: pattern.length, ms: Math.min(60000, Date.now() - r.recallStart) });
      setPhase('reveal');
      later(() => startRound(roundNo + 1), 600);
    }
  };

  const size = gridFor(roundNo);
  const cleared = run.current.rounds.length;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <QuizHeader title="Arcade" subtitle="Pattern Map — a quick break-time memory game. Separate from the daily Quiz." />

      <section className="glass-card rounded-xl p-5 max-w-sm mx-auto w-full space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400 tabular-nums">Round <span className="text-white font-semibold">{phase === 'idle' ? '–' : roundNo}</span></span>
          <span className="flex gap-1" aria-label={`${lives} lives left`}>
            {Array.from({ length: LIVES }).map((_, i) => (
              <Heart key={i} className={`w-4 h-4 ${i < lives ? 'text-rose-400 fill-rose-400' : 'text-gray-700'}`} />
            ))}
          </span>
        </div>

        <div className="grid gap-2 mx-auto" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} role="group" aria-label="Pattern grid">
          {Array.from({ length: size * size }).map((_, i) => {
            const isLit = lit === i;
            const f = flash?.tile === i ? (flash.ok ? 'ok' : 'bad') : null;
            return (
              <button
                key={`${size}-${i}`}
                type="button"
                disabled={phase !== 'recall'}
                onClick={() => tap(i)}
                aria-label={`Tile ${i + 1}`}
                className={`aspect-square rounded-lg border transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${
                  isLit ? 'bg-emerald-400 border-emerald-300 shadow-lg shadow-emerald-500/30'
                  : f === 'ok' ? 'bg-emerald-500/30 border-emerald-500/50'
                  : f === 'bad' ? 'bg-rose-500/40 border-rose-500/60'
                  : 'bg-white/[0.03] border-gray-800 enabled:hover:bg-teal-400/10 enabled:hover:border-teal-400/30'
                }`}
              />
            );
          })}
        </div>

        <p className="text-center text-xs text-gray-500 h-4" aria-live="polite">
          {phase === 'reveal' && picked.length === 0 && !flash ? 'Watch the pattern…' : phase === 'recall' ? 'Repeat it in order' : ''}
        </p>

        {(phase === 'idle' || phase === 'over') && (
          <div className="text-center space-y-3">
            {phase === 'over' && (
              <div>
                <p className="text-3xl font-bold text-white tabular-nums">{result?.score ?? 0}</p>
                <p className="text-xs text-gray-400 tabular-nums">
                  {cleared} round{cleared === 1 ? '' : 's'} cleared{result ? ` · ${result.accuracy}% accuracy · best ${result.best}` : ''}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none"
            >
              {phase === 'idle' ? <Play className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
              {phase === 'idle' ? 'Start' : 'Play again'}
            </button>
          </div>
        )}
      </section>

      <section className="glass-card rounded-xl p-5 max-w-sm mx-auto w-full">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" /> Pattern Map Leaderboard
        </h2>
        {board.length === 0 ? (
          <p className="text-sm text-gray-500">No scores yet — be the first.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 text-left">
                <th className="font-normal pb-2 w-12">Rank</th>
                <th className="font-normal pb-2">Player</th>
                <th className="font-normal pb-2 text-right">Best</th>
              </tr>
            </thead>
            <tbody>
              {board.map((e) => (
                <tr key={e.userId} className={`border-t border-gray-800 ${e.userId === user?.id ? 'text-emerald-300' : 'text-gray-200'}`}>
                  <td className="py-2 tabular-nums">{e.rank}</td>
                  <td className="py-2 truncate max-w-[10rem]">{e.name}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{e.bestScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
