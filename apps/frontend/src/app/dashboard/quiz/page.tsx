'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/contexts/auth-context';

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
  const arenaRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const done = attempts >= maxAttempts;

  const dodge = () => {
    const arena = arenaRef.current;
    const button = buttonRef.current;
    if (!arena || !button) return;
    const maxX = Math.max(0, arena.clientWidth - button.offsetWidth);
    const maxY = Math.max(0, arena.clientHeight - button.offsetHeight);
    setPos({ x: Math.random() * maxX, y: Math.random() * maxY });
    setAttempts((a) => a + 1);
  };

  const handleClick = () => {
    if (done) onReveal();
    else dodge();
  };

  return (
    <div ref={arenaRef} className="relative h-28 sm:h-24">
      <motion.button
        ref={buttonRef}
        onMouseEnter={!done ? dodge : undefined}
        onClick={handleClick}
        animate={
          done
            ? { x: pos.x, y: pos.y, scale: 1, rotate: 0 }
            : { x: pos.x, y: pos.y, scale: [1, 1.1, 0.94, 1], rotate: [0, -6, 6, 0] }
        }
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="absolute glass px-4 py-2 rounded-lg text-white whitespace-nowrap"
      >
        View Explanation
      </motion.button>
    </div>
  );
}

function useCountdown(scheduledFor: string) {
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    const deadline = new Date(scheduledFor).getTime() + 24 * 60 * 60 * 1000;
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scheduledFor]);
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export default function QuizPage() {
  const { user } = useAuth();
  const showToast = useToast();
  const [data, setData] = useState<TodayResponse>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [explanationRevealed, setExplanationRevealed] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/quiz/today');
      setData(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setExplanationRevealed(false);
  }, [isRevealed(data) ? data.id : null]);

  const countdown = useCountdown(!isRevealed(data) && data ? data.scheduledFor : new Date().toISOString());

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
          <motion.div key="active" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card p-6 rounded-xl space-y-4">
            <p className="text-lg text-white">{data.question}</p>
            <div className="text-xs text-gray-400">Answer revealed in {countdown}</div>
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
                      {opt}
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

        {data && isRevealed(data) && (
          <motion.div key="revealed" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 rounded-xl space-y-3">
            <p className="text-lg text-white">{data.question}</p>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
