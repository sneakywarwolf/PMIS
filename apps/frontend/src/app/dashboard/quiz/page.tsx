'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, CheckCircle2, Clock, Flame, X, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/contexts/auth-context';
import { GlitchOverlay, SuspiciousMark, useRareGlitch } from '@/components/easter-egg/quiz-eggs';
import { suspiciousOption } from '@/lib/easter-egg/quiz';
import { RevealedCardView, type RevealCard } from '@/components/quiz-revealed-card';
import { formatDateTime } from '@/lib/datetime';
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
  // Other questions still inside their answer window (sent with the newest one).
  others?: ActiveQuestion[];
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
  return (
    <Suspense fallback={<div className="p-6 max-w-2xl mx-auto"><QuizSkeleton /></div>}>
      <QuizPageInner />
    </Suspense>
  );
}

function QuizPageInner() {
  const { user } = useAuth();
  const showToast = useToast();
  const [data, setData] = useState<ActiveQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [pool, setPool] = useState<ActiveQuestion[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedCards, setRevealedCards] = useState<RevealCard[] | null>(null);
  const revealParam = useSearchParams().get('reveal');
  const [skewMs, setSkewMs] = useState(0);
  const [eggOn, setEggOn] = useState<boolean | null>(null); // null = settings still loading

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // The two sections load independently, so a slow or failed reveal list never hides the active questions.
      api.get('/quiz/revealed').then((r) => setRevealedCards(r.data)).catch(() => setRevealedCards((prev) => prev ?? []));
      const res = await api.get('/quiz/today');
      const serverNow = Date.parse(res.headers?.date);
      if (!Number.isNaN(serverNow)) setSkewMs(serverNow - Date.now());
      const d = res.data as TodayResponse;
      if (d && !isRevealed(d)) {
        const { others, ...first } = d;
        const list = [first as ActiveQuestion, ...(others ?? [])];
        setPool(list);
        // Stay on the question being viewed (e.g. right after answering it) while it is still open.
        setData((prev) => (prev && !isRevealed(prev) ? list.find((q) => q.id === prev.id) : undefined) ?? list[0]);
      } else {
        setPool([]);
        setData(null); // a revealed question belongs to the Recently Revealed section, never to Active
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Easter Egg extras follow the admin toggle. Reads the app-wide settings the branding provider already
  // fetched, instead of issuing its own duplicate GET /settings; until they load, the extras stay off.
  const { settings: appSettings } = useBranding();
  useEffect(() => {
    setEggOn(!!appSettings?.easterEgg?.enabled);
  }, [appSettings?.easterEgg?.enabled]);

  const countdown = useCountdown(data ? data.scheduledFor : new Date().toISOString(), skewMs);

  // The reveal is server-driven: once the window closes (by server time), poll until the server says REVEALED.
  const windowClosed = !!data && countdown.remainingMs === 0;
  useEffect(() => {
    if (!windowClosed) return;
    const t = setInterval(() => load(true), 15_000);
    load(true);
    return () => clearInterval(t);
  }, [windowClosed]);

  const suspicious = eggOn && data ? suspiciousOption(data.id, data.options.length) : null;
  const glitching = useRareGlitch(!!eggOn && !!data);

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

  // A reveal notification opens /dashboard/quiz?reveal=<id>: bring that exact card into view.
  useEffect(() => {
    if (!revealParam || !revealedCards) return;
    document.getElementById(`reveal-${revealParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [revealParam, revealedCards]);

  const submit = async () => {
    if (selected === null || !data) return;
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

  const active = data;
  const answered = !!active?.alreadyAnswered;
  const canPick = !!active && !answered && !windowClosed;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <QuizHeader title="Question of the Day" subtitle="One question a day. Answer before the reveal to earn points and build your streak." />

      <h2 className="text-base font-semibold text-white">Active Questions</h2>
      {pool.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Open questions">
          {pool.map((q, i) => (
            <button
              key={q.id}
              role="tab"
              aria-selected={active?.id === q.id}
              onClick={() => { setData(q); setSelected(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                active?.id === q.id
                  ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-white'
              }`}
            >
              Question {i + 1} · {formatDateTime(q.scheduledFor)}{q.alreadyAnswered ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}

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

      </AnimatePresence>

      <section aria-labelledby="revealed-heading" className="space-y-4 pt-2">
        <div>
          <h2 id="revealed-heading" className="text-base font-semibold text-white">Recently Revealed — Answers &amp; Explanations</h2>
          <p className="text-sm text-gray-400">
            Each answer stays here for 24 hours after it was revealed. Older ones are in the{' '}
            <Link href="/dashboard/quiz/log" className="text-emerald-400 hover:underline">Question Log</Link>.
          </p>
        </div>
        {revealParam && revealedCards && !revealedCards.some((c) => c.id === revealParam) && (
          <div role="status" className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 text-sm text-gray-300">
            That reveal is older than 24 hours and is no longer shown here. You can still find it in the{' '}
            <Link href="/dashboard/quiz/log" className="text-emerald-400 hover:underline">Question Log</Link>.
          </div>
        )}
        {revealedCards === null ? (
          <QuizSkeleton />
        ) : revealedCards.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <p className="text-white font-medium">No answers revealed in the last 24 hours</p>
            <p className="text-sm text-gray-400 mt-1">Revealed answers and explanations will appear here.</p>
          </div>
        ) : (
          revealedCards.map((c, i) => (
            <RevealedCardView key={c.id} card={c} latest={i === 0} highlighted={revealParam === c.id} eggOn={!!eggOn} onAnswered={() => load(true)} />
          ))
        )}
      </section>
    </div>
  );
}
