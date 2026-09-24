'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/contexts/auth-context';
import { GlitchOverlay, RevealScanner, SuspiciousMark, useRareGlitch } from '@/components/easter-egg/quiz-eggs';
import { correctTip, roast, suspiciousOption, type QuizStats } from '@/lib/easter-egg/quiz';

// Same turquoise-glass hover treatment used app-wide (e.g. the sidebar nav) —
// keep every Quiz control consistent with it rather than inventing a new one.
const QUIZ_HOVER = 'hover:bg-teal-400/5 hover:border-teal-400/20 hover:shadow-lg hover:shadow-teal-500/10 hover:text-white transition-all';

type ActiveQuestion = {
  id: string;
  question: string;
  options: string[];
  scheduledFor: string;
  status: 'ACTIVE';
  alreadyAnswered: boolean;
};

type RevealedQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  revealedAt: string;
  participants: number;
  correctCount: number;
  incorrectCount: number;
  userIsCorrect: boolean | null;
};

type TodayResponse = ActiveQuestion | RevealedQuestion | null;

function isRevealed(q: TodayResponse): q is RevealedQuestion {
  return !!q && 'correctIndex' in q;
}

/** "View Explanation" button that dodges 3-6 tap/click attempts before becoming clickable — only used when the viewer answered incorrectly. */
function EvasiveExplanationButton({ onReveal }: { onReveal: () => void }) {
  const [maxAttempts] = useState(() => 3 + Math.floor(Math.random() * 4)); // 3-6 inclusive
  const [attempts, setAttempts] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [lean, setLean] = useState({ x: 0, y: 0 });
  const arenaRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const done = attempts >= maxAttempts;

  const bounds = () => {
    const arena = arenaRef.current;
    const button = buttonRef.current;
    if (!arena || !button) return null;
    return { maxX: Math.max(0, arena.clientWidth - button.offsetWidth), maxY: Math.max(0, arena.clientHeight - button.offsetHeight) };
  };

  // Keep the button inside its arena if the card is resized.
  useEffect(() => {
    const clamp = () => {
      const b = bounds();
      if (b) setPos((p) => ({ x: Math.min(p.x, b.maxX), y: Math.min(p.y, b.maxY) }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const dodge = () => {
    const b = bounds();
    if (!b) return;
    // Land clearly away from the current spot so every escape reads as a jump.
    const minJump = Math.max(b.maxX, b.maxY) / 3;
    let next = pos;
    for (let i = 0; i < 8; i++) {
      next = { x: Math.random() * b.maxX, y: Math.random() * b.maxY };
      if (Math.hypot(next.x - pos.x, next.y - pos.y) >= minJump) break;
    }
    setPos(next);
    setLean({ x: 0, y: 0 });
    setAttempts((a) => a + 1);
  };

  // Magnetic: lean a few px toward the cursor while hovering.
  const magnet = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setLean({ x: ((e.clientX - r.left) / r.width - 0.5) * 8, y: ((e.clientY - r.top) / r.height - 0.5) * 8 });
  };

  return (
    <div ref={arenaRef} className="relative h-28 sm:h-24">
      <motion.button
        ref={buttonRef}
        onClick={done ? onReveal : dodge}
        onMouseMove={done ? undefined : magnet}
        onMouseLeave={() => setLean({ x: 0, y: 0 })}
        animate={
          done
            ? { x: pos.x, y: pos.y, scale: 1, rotate: 0 }
            : { x: pos.x + lean.x, y: pos.y + lean.y, scale: [1, 1.1, 0.94, 1], rotate: [0, -6, 6, 0] }
        }
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className={`absolute glass px-4 py-2 rounded-lg text-white whitespace-nowrap ${done ? QUIZ_HOVER : ''}`}
      >
        View Explanation
      </motion.button>
    </div>
  );
}

// skewMs = server clock − local clock, so the countdown follows server time.
function useCountdown(scheduledFor: string, skewMs: number) {
  const [remainingMs, setRemainingMs] = useState(1);
  useEffect(() => {
    const deadline = new Date(scheduledFor).getTime() + 24 * 60 * 60 * 1000;
    const tick = () => setRemainingMs(Math.max(0, deadline - (Date.now() + skewMs)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scheduledFor, skewMs]);
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return { label: `${hours}h ${minutes}m ${seconds}s`, remainingMs };
}

export default function QuizPage() {
  const { user } = useAuth();
  const showToast = useToast();
  const [data, setData] = useState<TodayResponse>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [explanationRevealed, setExplanationRevealed] = useState(false);
  const [skewMs, setSkewMs] = useState(0);
  const [eggOn, setEggOn] = useState<boolean | null>(null); // null = settings still loading
  const [scanned, setScanned] = useState(false);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/quiz/today');
      const serverNow = Date.parse(res.headers?.date);
      if (!Number.isNaN(serverNow)) setSkewMs(serverNow - Date.now());
      setData(res.data);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Easter Egg extras follow the admin toggle; any failure just leaves them off.
    api.get('/settings').then((r) => setEggOn(!!r.data.settings?.easterEgg?.enabled)).catch(() => setEggOn(false));
  }, []);

  const revealedId = isRevealed(data) ? data.id : null;
  const userIsCorrect = isRevealed(data) ? data.userIsCorrect : null;
  useEffect(() => {
    setExplanationRevealed(false);
    setScanned(false);
    setTip(null);
  }, [revealedId]);

  const roastLine = useMemo(() => (revealedId && userIsCorrect === false ? roast() : null), [revealedId, userIsCorrect]);

  // Correct answerers get their scorecard, and it decides whether a rare tip is possible.
  useEffect(() => {
    if (!revealedId || userIsCorrect !== true) return;
    api
      .get('/quiz/scorecard')
      .then((r) => r.data as QuizStats)
      .catch(() => null)
      .then((s) => {
        setStats(s);
        setTip(correctTip(s));
      });
  }, [revealedId, userIsCorrect]);

  const countdown = useCountdown(!isRevealed(data) && data ? data.scheduledFor : new Date().toISOString(), skewMs);

  // The reveal is server-driven: once the window closes (by server time), poll until the server says REVEALED.
  const windowClosed = !!data && !isRevealed(data) && countdown.remainingMs === 0;
  useEffect(() => {
    if (!windowClosed) return;
    const t = setInterval(() => load(true), 15_000);
    load(true);
    return () => clearInterval(t);
  }, [windowClosed]);

  const suspicious = eggOn && data && !isRevealed(data) ? suspiciousOption(data.id, data.options.length) : null;
  const glitching = useRareGlitch(!!eggOn && !!data && !isRevealed(data));
  const finishScan = useCallback(() => setScanned(true), []);

  const submit = async () => {
    if (selected === null || isRevealed(data) || !data) return;
    setSubmitting(true);
    try {
      await api.post('/quiz/today/answer', { questionId: data.id, selectedOption: selected });
      showToast('Answer submitted!', 'success');
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not submit answer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-400">Loading today&apos;s question…</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Question of the Day</h1>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/quiz/log" className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-200 ${QUIZ_HOVER}`}>
            Question Log
          </Link>
          <Link href="/dashboard/quiz/scorecard" className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-200 ${QUIZ_HOVER}`}>
            Scorecard
          </Link>
          {user?.role === 'ADMIN' && (
            <Link href="/dashboard/quiz/manage" className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-200 ${QUIZ_HOVER}`}>
              Manage Quiz
            </Link>
          )}
        </div>
      </div>

      {!data && (
        <div className="glass-card p-6 rounded-xl text-gray-400">No active question right now. Check back soon.</div>
      )}

      <AnimatePresence mode="wait">
        {data && !isRevealed(data) && (
          <motion.div key="active" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative glass-card p-6 rounded-xl space-y-4">
            {glitching && <GlitchOverlay />}
            <p className={`text-lg text-white ${glitching ? 'ee-glitch' : ''}`}>{data.question}</p>
            <div className="text-xs text-gray-400">
              {windowClosed ? 'Answer window closed. Waiting for the reveal…' : `Answer revealed in ${countdown.label}`}
            </div>
            {data.alreadyAnswered ? (
              <p className="text-sm text-cyan-400">You&apos;ve already answered — check back after the reveal.</p>
            ) : (
              <>
                <div className="grid gap-2">
                  {data.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`glass text-left px-4 py-2.5 rounded-lg text-gray-200 ${selected === i ? 'border-cyan-400 text-white transition-all' : QUIZ_HOVER}`}
                    >
                      <span className="flex items-center justify-between">
                        {opt}
                        {suspicious === i && <SuspiciousMark />}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={submit}
                  disabled={selected === null || submitting}
                  className={`glass px-4 py-2 rounded-lg text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none ${QUIZ_HOVER}`}
                >
                  {submitting ? 'Submitting…' : 'Submit Answer'}
                </button>
              </>
            )}
          </motion.div>
        )}

        {data && isRevealed(data) && eggOn !== null && (
          <motion.div key="revealed" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 rounded-xl space-y-3">
            <p className="text-lg text-white">{data.question}</p>

            {eggOn && !scanned ? (
              <RevealScanner onDone={finishScan} />
            ) : (
              <>
                {eggOn && data.userIsCorrect === true && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
                  >
                    <p className="font-mono text-sm font-bold tracking-[0.3em] text-emerald-300" style={{ textShadow: '0 0 12px rgba(16,185,129,0.6)' }}>
                      ACCESS GRANTED
                    </p>
                    {tip && <p className="mt-1 text-sm text-emerald-100/90">{tip}</p>}
                    {stats && (
                      <p className="mt-2 font-mono text-xs text-emerald-400/70">
                        {stats.currentStreak} streak · {stats.accuracy}% accuracy · {stats.totalAnswered} answered
                      </p>
                    )}
                  </motion.div>
                )}
                {eggOn && roastLine && (
                  <motion.div
                    initial={{ x: 0 }}
                    animate={{ x: [0, -6, 6, -4, 4, 0], boxShadow: ['0 0 0 rgba(239,68,68,0)', '0 0 18px rgba(239,68,68,0.45)', '0 0 0 rgba(239,68,68,0)'] }}
                    transition={{ duration: 0.6 }}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    {roastLine}
                  </motion.div>
                )}

                <p className="text-cyan-400 font-medium">Correct answer: {data.options[data.correctIndex]}</p>

                {explanationRevealed ? (
                  <p className="text-gray-300 text-sm">{data.explanation}</p>
                ) : data.userIsCorrect === false ? (
                  <EvasiveExplanationButton onReveal={() => setExplanationRevealed(true)} />
                ) : (
                  <button
                    onClick={() => setExplanationRevealed(true)}
                    className={`glass px-4 py-2 rounded-lg text-white w-fit ${QUIZ_HOVER}`}
                  >
                    View Explanation
                  </button>
                )}

                <div className="flex gap-4 text-sm text-gray-400">
                  <span>{data.participants} participants</span>
                  <span>{data.correctCount} correct</span>
                  <span>{data.incorrectCount} incorrect</span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
