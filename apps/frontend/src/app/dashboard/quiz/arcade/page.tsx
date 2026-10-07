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

type Cfg = { grid: number; length: number; step: number; label: string };

// Rounds 1-6: a gentle fixed ramp. From round 7 every round rolls a random tier,
// so a super-easy round can follow a super-tough one.
const RAMP: Cfg[] = [
  { grid: 3, length: 3, step: 650, label: 'Warm-up' },
  { grid: 3, length: 4, step: 620, label: 'Warm-up' },
  { grid: 3, length: 4, step: 580, label: 'Easy' },
  { grid: 4, length: 4, step: 560, label: 'Easy' },
  { grid: 4, length: 5, step: 520, label: 'Getting warmer' },
  { grid: 4, length: 5, step: 500, label: 'Getting warmer' },
];
const between = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const TIERS: (() => Cfg)[] = [
  () => ({ grid: 3, length: 3, step: 700, label: 'Super easy' }),
  () => ({ grid: 3, length: between(4, 5), step: 600, label: 'Easy' }),
  () => ({ grid: 4, length: between(5, 7), step: 450, label: 'Medium' }),
  () => ({ grid: 5, length: between(8, 10), step: 330, label: 'Tough' }),
  () => ({ grid: 5, length: between(11, 14), step: 240, label: 'Super tough' }),
];
const cfgFor = (n: number): Cfg => RAMP[n - 1] ?? TIERS[between(0, TIERS.length - 1)]();

// A fresh vivid colour per round (lit tile, correct tap, accent) on high-contrast tiles.
const PALETTES = [
  { lit: 'bg-cyan-300 border-cyan-100 shadow-cyan-400/50', ok: 'bg-cyan-500/50 border-cyan-300', text: 'text-cyan-300' },
  { lit: 'bg-fuchsia-400 border-fuchsia-200 shadow-fuchsia-400/50', ok: 'bg-fuchsia-500/50 border-fuchsia-300', text: 'text-fuchsia-300' },
  { lit: 'bg-amber-300 border-amber-100 shadow-amber-400/50', ok: 'bg-amber-500/50 border-amber-300', text: 'text-amber-300' },
  { lit: 'bg-lime-300 border-lime-100 shadow-lime-400/50', ok: 'bg-lime-500/50 border-lime-300', text: 'text-lime-300' },
  { lit: 'bg-rose-400 border-rose-200 shadow-rose-400/50', ok: 'bg-rose-500/50 border-rose-300', text: 'text-rose-300' },
  { lit: 'bg-violet-400 border-violet-200 shadow-violet-400/50', ok: 'bg-violet-500/50 border-violet-300', text: 'text-violet-300' },
];

function makePattern(cfg: Cfg): number[] {
  const tiles = Array.from({ length: cfg.grid ** 2 }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, cfg.length);
}

export default function ArcadePage() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [roundNo, setRoundNo] = useState(1);
  const [lives, setLives] = useState(LIVES);
  const [cfg, setCfg] = useState<Cfg>(RAMP[0]);
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

  // A retry after a mistake keeps the same difficulty (`keep`) so a tough roll can't be dodged by losing a life.
  const startRound = useCallback((n: number, keep?: Cfg) => {
    const c = keep ?? cfgFor(n);
    const p = makePattern(c);
    const step = c.step;
    setRoundNo(n);
    setCfg(c);
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
      later(() => (left <= 0 ? finish() : startRound(roundNo, cfg)), 700);
      return;
    }
    r.correct += 1;
    const next = [...picked, tile];
    setPicked(next);
    if (next.length === pattern.length) {
      r.rounds.push({ grid: cfg.grid, length: pattern.length, ms: Math.min(60000, Date.now() - r.recallStart) });
      setPhase('reveal');
      later(() => startRound(roundNo + 1), 600);
    }
  };

  const size = cfg.grid;
  const pal = PALETTES[(roundNo - 1) % PALETTES.length];
  const cleared = run.current.rounds.length;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <QuizHeader title="Arcade" subtitle="Pattern Map — a quick break-time memory game. Separate from the daily Quiz." />

      <section className="glass-card rounded-xl p-5 max-w-sm mx-auto w-full space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400 tabular-nums">Round <span className="text-white font-semibold">{phase === 'idle' ? '–' : roundNo}</span>{phase !== 'idle' && <span className={`ml-2 text-xs font-medium ${pal.text}`}>{cfg.label}</span>}</span>
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
                className={`aspect-square rounded-lg border transition-all duration-150 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${
                  isLit ? `${pal.lit} shadow-lg scale-105`
                  : f === 'ok' ? pal.ok
                  : f === 'bad' ? 'bg-red-600/70 border-red-300'
                  : 'bg-slate-700/70 border-slate-500 enabled:hover:bg-slate-600 enabled:hover:border-slate-300'
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
