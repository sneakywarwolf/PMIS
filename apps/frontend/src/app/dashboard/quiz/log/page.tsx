'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, History, X } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { formatDate } from '@/lib/datetime';
import { QUIZ_HOVER, QuizHeader, QuizSkeleton, Ring, useQuizMotion } from '@/components/quiz-ui';

type MyAttempt = { selectedOption: number; isCorrect: boolean; isLate: boolean } | null;
type LogItem = { id: string; question: string; revealedAt: string; myAttempt: MyAttempt };
type LogDetail = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  revealedAt: string;
  participants: number;
  correctCount: number;
  incorrectCount: number;
  myAttempt: MyAttempt;
};

export default function QuizLogPage() {
  const m = useQuizMotion();
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    api.get('/quiz/log').then((res) => {
      setItems(res.data.items);
      setLoading(false);
    });
  }, []);

  const [answering, setAnswering] = useState(false);

  // Late answer: recorded for the user only, never scored or counted on the leaderboard.
  const answerLate = async (selectedOption: number) => {
    if (!detail) return;
    setAnswering(true);
    try {
      const res = await api.post(`/quiz/log/${detail.id}/answer`, { questionId: detail.id, selectedOption });
      setDetail({ ...detail, myAttempt: res.data });
      setItems((prev) => prev.map((it) => (it.id === detail.id ? { ...it, myAttempt: res.data } : it)));
    } finally {
      setAnswering(false);
    }
  };

  const openDetail = async (id: string) => {
    setOpening(id);
    try {
      const res = await api.get(`/quiz/log/${id}`);
      setDetail(res.data);
    } finally {
      setOpening(null);
    }
  };

  if (loading) return <div className="p-6 max-w-3xl mx-auto"><QuizSkeleton rows={5} /></div>;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <QuizHeader title="Question Log" subtitle="Every revealed question, with the answer and explanation." />

      {items.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <History className="w-8 h-8 mx-auto text-gray-500 mb-3" />
          <p className="text-white font-medium">No revealed questions yet</p>
          <p className="text-sm text-gray-400 mt-1">Past questions show up here after their reveal.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, y: m.reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...m.t(0.25), delay: Math.min(i, 8) * m.stagger }}
            >
              <button
                onClick={() => openDetail(item.id)}
                disabled={opening === item.id}
                className={`glass-card group flex w-full items-center gap-3 rounded-xl p-4 text-left text-gray-200 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none disabled:opacity-60 ${QUIZ_HOVER}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{item.question}</p>
                  <p className="mt-0.5 font-mono text-xs text-gray-500">{formatDate(item.revealedAt)}</p>
                </div>
                <span className={`shrink-0 text-xs ${item.myAttempt ? (item.myAttempt.isLate ? 'text-amber-400' : 'text-emerald-400') : 'text-gray-500'}`}>
                  {item.myAttempt ? (item.myAttempt.isLate ? 'Answered late' : 'Answered') : 'Not answered'}
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-gray-500 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-300" />
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      <Dialog.Root open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-[160] max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl focus:outline-none"
          >
            {detail && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <Dialog.Title className="text-lg font-medium text-white leading-snug">{detail.question}</Dialog.Title>
                  <Dialog.Close aria-label="Close" className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none">
                    <X className="w-4 h-4" />
                  </Dialog.Close>
                </div>

                {!detail.myAttempt && (
                  <p className="text-xs text-amber-400">You missed this one. Pick an answer to record it as a late answer — it earns no points and doesn't affect the leaderboard.</p>
                )}
                {detail.myAttempt?.isLate && (
                  <p className="text-xs text-amber-400">Answered late — no points awarded.</p>
                )}

                <div className="space-y-2">
                  {detail.options.map((opt, i) => {
                    const correct = i === detail.correctIndex;
                    if (!detail.myAttempt) {
                      return (
                        <button key={i} disabled={answering} onClick={() => answerLate(i)} className="flex w-full items-center gap-3 rounded-lg border border-gray-700 px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none disabled:opacity-60">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-700 text-xs font-semibold">{'ABCDEFGH'[i]}</span>
                          <span className="flex-1">{opt}</span>
                        </button>
                      );
                    }
                    return (
                      <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${correct ? 'border-emerald-500/40 bg-emerald-500/10 text-white' : 'border-gray-800 text-gray-500'}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold ${correct ? 'border-emerald-400 bg-emerald-500 text-black' : 'border-gray-700'}`}>
                          {correct ? <Check className="w-3.5 h-3.5" /> : 'ABCDEFGH'[i]}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {correct && <span className="text-xs font-medium text-emerald-400">Correct</span>}
                        {detail.myAttempt.selectedOption === i && <span className="text-xs font-medium text-sky-400">Your answer</span>}
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Explanation</p>
                  <p className="text-sm leading-relaxed text-gray-200">{detail.explanation}</p>
                </div>

                <div className="flex items-center gap-4">
                  <Ring value={detail.participants ? detail.correctCount / detail.participants : 0} size={52}>
                    {detail.participants ? Math.round((detail.correctCount / detail.participants) * 100) : 0}%
                  </Ring>
                  <div className="grid flex-1 grid-cols-3 gap-2 text-center">
                    <div><p className="font-semibold text-white tabular-nums">{detail.participants}</p><p className="text-xs text-gray-500">Participants</p></div>
                    <div><p className="font-semibold text-emerald-400 tabular-nums">{detail.correctCount}</p><p className="text-xs text-gray-500">Correct</p></div>
                    <div><p className="font-semibold text-red-400 tabular-nums">{detail.incorrectCount}</p><p className="text-xs text-gray-500">Incorrect</p></div>
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
