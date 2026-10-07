'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Clock, Flame, X, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/contexts/auth-context';
import { GlitchOverlay, RevealScanner, SuspiciousMark, useRareGlitch } from '@/components/easter-egg/quiz-eggs';
import { correctTip, roast, suspiciousOption, type QuizStats } from '@/lib/easter-egg/quiz';
import { QUIZ_HOVER, QuizHeader, QuizSkeleton, Ring, StatusPill, useQuizMotion } from '@/components/quiz-ui';

const LETTERS = 'ABCDEFGH';
const WINDOW_MS = 24 * 60 * 60 * 1000;

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

  const m = useQuizMotion();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Radio-group keyboard behaviour: arrows move the choice (wrapping), focus follows.
  const onOptionKey = (e: React.KeyboardEvent, i: number, n: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + n) % n;
    setSelected(next);
    optionRefs.current[next]?.focus();
  };

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

  if (loading) return <div className="p-6 max-w-2xl mx-auto"><QuizSkeleton /></div>;

  const active = data && !isRevealed(data) ? data : null;
  const revealed = data && isRevealed(data) ? data : null;
  const answered = !!active?.alreadyAnswered;
  const canPick = !!active && !answered && !windowClosed;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <QuizHeader title="Question of the Day" subtitle="One question a day. Answer before the reveal to earn points and build your streak." />

      {!data && (
        <div className="glass-card rounded-xl p-10 text-center">
          <Clock className="w-8 h-8 mx-auto text-gray-500 mb-3" />
          <p className="text-white font-medium">No active question right now</p>
          <p className="text-sm text-gray-400 mt-1">Check back soon — a new one is on its way.</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {active && (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: m.reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={m.t(0.3)}
            className="relative glass-card rounded-xl p-5 md:p-6 space-y-5"
          >
            {glitching && <GlitchOverlay />}

            <div className="flex items-center justify-between gap-4">
              <StatusPill status={windowClosed ? 'closed' : 'live'} />
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">{windowClosed ? 'Waiting for reveal' : 'Reveal in'}</p>
                  <p className="font-mono text-sm text-white tabular-nums" aria-live="off">{windowClosed ? '—' : countdown.label}</p>
                </div>
                <Ring value={windowClosed ? 0 : countdown.remainingMs / WINDOW_MS} size={44} stroke={3} className={countdown.remainingMs < 3_600_000 ? 'text-amber-400' : 'text-emerald-400'}>
                  <Clock className="w-4 h-4 text-gray-300" />
                </Ring>
              </div>
            </div>

            <p className={`text-lg md:text-xl font-medium text-white leading-snug ${glitching ? 'ee-glitch' : ''}`}>{active.question}</p>

            {answered ? (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">Answer locked in</p>
                  <p className="text-sm text-gray-400">Come back after the reveal to see how you did.</p>
                </div>
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label="Answer options" className="grid gap-2.5">
                  {active.options.map((opt, i) => {
                    const on = selected === i;
                    return (
                      <motion.button
                        key={i}
                        ref={(el) => { optionRefs.current[i] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on || (selected === null && i === 0) ? 0 : -1}
                        disabled={!canPick}
                        onClick={() => setSelected(i)}
                        onKeyDown={(e: React.KeyboardEvent) => onOptionKey(e, i, active.options.length)}
                        initial={{ opacity: 0, y: m.reduce ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...m.t(0.25), delay: i * m.stagger }}
                        whileTap={m.reduce ? undefined : { scale: 0.99 }}
                        className={`group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                          on
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-white shadow-lg shadow-emerald-500/5'
                            : `glass border-transparent text-gray-200 ${QUIZ_HOVER}`
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
                            on ? 'border-emerald-400 bg-emerald-500 text-black' : 'border-gray-700 text-gray-400 group-hover:border-teal-400/40 group-hover:text-white'
                          }`}
                        >
                          {on ? <Check className="w-4 h-4" /> : LETTERS[i]}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {suspicious === i && <SuspiciousMark />}
                      </motion.button>
                    );
                  })}
                </div>

                <button
                  onClick={submit}
                  disabled={selected === null || submitting || !canPick}
                  className="w-full sm:w-auto min-w-[10rem] rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600"
                >
                  {submitting ? 'Submitting…' : 'Submit Answer'}
                </button>
                {windowClosed && <p className="text-xs text-gray-400">The answer window has closed. Waiting for the reveal…</p>}
              </>
            )}
          </motion.div>
        )}

        {revealed && eggOn !== null && (
          <motion.div
            key="revealed"
            initial={{ opacity: 0, y: m.reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={m.t(0.3)}
            className="glass-card rounded-xl p-5 md:p-6 space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <StatusPill status="revealed" />
              {revealed.userIsCorrect !== null && (
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${revealed.userIsCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                  {revealed.userIsCorrect ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {revealed.userIsCorrect ? 'You got it right' : 'Not this time'}
                </span>
              )}
            </div>

            <p className="text-lg md:text-xl font-medium text-white leading-snug">{revealed.question}</p>

            {eggOn && !scanned ? (
              <RevealScanner onDone={finishScan} />
            ) : (
              <>
                {eggOn && revealed.userIsCorrect === true && (
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

                <div className="grid gap-2.5" aria-label="Answer options">
                  {revealed.options.map((opt, i) => {
                    const correct = i === revealed.correctIndex;
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: m.reduce ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...m.t(0.25), delay: i * m.stagger }}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                          correct ? 'border-emerald-500/40 bg-emerald-500/10 text-white' : 'border-gray-800 bg-white/[0.02] text-gray-500'
                        }`}
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${correct ? 'border-emerald-400 bg-emerald-500 text-black' : 'border-gray-700'}`}>
                          {correct ? <Check className="w-4 h-4" /> : LETTERS[i]}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {correct && <span className="text-xs font-medium text-emerald-400">Correct answer</span>}
                      </motion.div>
                    );
                  })}
                </div>

                {explanationRevealed ? (
                  <motion.div initial={{ opacity: 0, y: m.reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={m.t(0.25)} className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Explanation</p>
                    <p className="text-sm text-gray-200 leading-relaxed">{revealed.explanation}</p>
                  </motion.div>
                ) : revealed.userIsCorrect === false ? (
                  <EvasiveExplanationButton onReveal={() => setExplanationRevealed(true)} />
                ) : (
                  <button
                    onClick={() => setExplanationRevealed(true)}
                    className={`glass w-fit rounded-lg px-4 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${QUIZ_HOVER}`}
                  >
                    View Explanation
                  </button>
                )}

                <div className="flex items-center gap-4 rounded-xl border border-gray-800 bg-white/[0.02] p-4">
                  <Ring value={revealed.participants ? revealed.correctCount / revealed.participants : 0} size={56}>
                    {revealed.participants ? Math.round((revealed.correctCount / revealed.participants) * 100) : 0}%
                  </Ring>
                  <div className="grid flex-1 grid-cols-3 gap-2 text-center">
                    <div><p className="text-lg font-semibold text-white tabular-nums">{revealed.participants}</p><p className="text-xs text-gray-500">Participants</p></div>
                    <div><p className="text-lg font-semibold text-emerald-400 tabular-nums">{revealed.correctCount}</p><p className="text-xs text-gray-500">Correct</p></div>
                    <div><p className="text-lg font-semibold text-red-400 tabular-nums">{revealed.incorrectCount}</p><p className="text-xs text-gray-500">Incorrect</p></div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
