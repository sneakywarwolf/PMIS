'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';
import { RevealScanner } from '@/components/easter-egg/quiz-eggs';
import { correctTip, roast, type QuizStats } from '@/lib/easter-egg/quiz';
import { formatDateTime } from '@/lib/datetime';
import { QUIZ_HOVER, Ring, StatusPill, useQuizMotion } from '@/components/quiz-ui';

const LETTERS = 'ABCDEFGH';

export type RevealCard = {
  id: string;
  question: string;
  options: string[];
  revealedAt: string;
  // Absent until the caller has attempted the question: the backend withholds them.
  correctIndex?: number;
  explanation?: string;
  participants?: number;
  correctCount?: number;
  incorrectCount?: number;
  myAttempt: { selectedOption: number; isCorrect: boolean; isLate: boolean } | null;
};

/** One revealed question: its own question, options, correct answer and explanation together. */
export function RevealedCardView({
  card,
  latest,
  highlighted,
  eggOn,
  onAnswered,
}: {
  card: RevealCard;
  latest: boolean;
  highlighted: boolean;
  eggOn: boolean;
  onAnswered: () => void;
}) {
  const m = useQuizMotion();
  const showToast = useToast();
  const [scanned, setScanned] = useState(false);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const finishScan = useCallback(() => setScanned(true), []);

  const attempt = card.myAttempt;
  const open = attempt !== null && card.correctIndex !== undefined; // the answer is only shown after an attempt
  const onTime = !!attempt && !attempt.isLate;
  const roastLine = useMemo(() => (onTime && attempt?.isCorrect === false ? roast() : null), [onTime, attempt?.isCorrect]);

  useEffect(() => {
    if (!eggOn || !onTime || attempt?.isCorrect !== true) return;
    api
      .get('/quiz/scorecard')
      .then((r) => r.data as QuizStats)
      .catch(() => null)
      .then((st) => {
        setStats(st);
        setTip(correctTip(st));
      });
  }, [eggOn, onTime, attempt?.isCorrect]);

  const answerLate = async () => {
    if (picked === null) return;
    setSending(true);
    try {
      await api.post(`/quiz/log/${card.id}/answer`, { questionId: card.id, selectedOption: picked });
      onAnswered();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not submit answer', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      id={`reveal-${card.id}`}
      initial={{ opacity: 0, y: m.reduce ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={m.t(0.3)}
      className={`glass-card rounded-xl p-5 md:p-6 space-y-4 ${highlighted ? 'ring-2 ring-emerald-400/60' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill status="revealed" />
          {latest && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Latest</span>}
        </div>
        <span className="text-xs text-gray-500">Revealed {formatDateTime(card.revealedAt)}</span>
      </div>

      <p className="text-lg md:text-xl font-medium text-white leading-snug">{card.question}</p>

      {!open ? (
        <>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            You didn&apos;t answer this one in time. Pick an option to see the correct answer and explanation — a late answer earns no marks.
          </div>
          <div role="radiogroup" aria-label="Answer options" className="grid gap-2.5">
            {card.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={picked === i}
                onClick={() => setPicked(i)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${
                  picked === i ? 'border-emerald-500/50 bg-emerald-500/10 text-white' : `glass border-transparent text-gray-200 ${QUIZ_HOVER}`
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-700 text-xs font-semibold text-gray-400">{LETTERS[i]}</span>
                <span className="flex-1">{opt}</span>
              </button>
            ))}
          </div>
          <button
            onClick={answerLate}
            disabled={picked === null || sending}
            className="w-full sm:w-auto rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Submitting…' : 'Submit late answer'}
          </button>
        </>
      ) : eggOn && onTime && !scanned ? (
        <RevealScanner onDone={finishScan} />
      ) : (
        <>
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${attempt!.isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
            {attempt!.isCorrect ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {attempt!.isCorrect ? 'You got it right' : 'Not this time'}
            {attempt!.isLate && <span className="text-xs font-normal text-gray-400">· late answer, no marks awarded</span>}
          </span>

          {eggOn && onTime && attempt!.isCorrect && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <p className="font-mono text-sm font-bold tracking-[0.3em] text-emerald-300" style={{ textShadow: '0 0 12px rgba(16,185,129,0.6)' }}>
                ACCESS GRANTED
              </p>
              {tip && <p className="mt-1 text-sm text-emerald-100/90">{tip}</p>}
              {stats && (
                <p className="mt-2 font-mono text-xs text-emerald-400/70">
                  {stats.currentStreak} streak · {stats.accuracy}% accuracy · {stats.totalAnswered} answered
                </p>
              )}
            </div>
          )}
          {eggOn && roastLine && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{roastLine}</div>}

          <div className="grid gap-2.5" aria-label="Answer options">
            {card.options.map((opt, i) => {
              const correct = i === card.correctIndex;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                    correct ? 'border-emerald-500/40 bg-emerald-500/10 text-white' : 'border-gray-800 bg-white/[0.02] text-gray-500'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${correct ? 'border-emerald-400 bg-emerald-500 text-black' : 'border-gray-700'}`}>
                    {correct ? <Check className="w-4 h-4" /> : LETTERS[i]}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {correct && <span className="text-xs font-medium text-emerald-400">Correct answer</span>}
                </div>
              );
            })}
          </div>

          {card.explanation?.trim() && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Explanation</p>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{card.explanation}</p>
            </div>
          )}

          <div className="flex items-center gap-4 rounded-xl border border-gray-800 bg-white/[0.02] p-4">
            <Ring value={card.participants ? (card.correctCount ?? 0) / card.participants : 0} size={56}>
              {card.participants ? Math.round(((card.correctCount ?? 0) / card.participants) * 100) : 0}%
            </Ring>
            <div className="grid flex-1 grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-semibold text-white tabular-nums">{card.participants ?? 0}</p><p className="text-xs text-gray-500">Participants</p></div>
              <div><p className="text-lg font-semibold text-emerald-400 tabular-nums">{card.correctCount ?? 0}</p><p className="text-xs text-gray-500">Correct</p></div>
              <div><p className="text-lg font-semibold text-red-400 tabular-nums">{card.incorrectCount ?? 0}</p><p className="text-xs text-gray-500">Incorrect</p></div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
