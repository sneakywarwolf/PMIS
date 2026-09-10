'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';

// Same turquoise-glass hover treatment used app-wide (e.g. the sidebar nav) —
// keep every Quiz control consistent with it rather than inventing a new one.
const QUIZ_HOVER = 'hover:bg-teal-400/5 hover:border-teal-400/20 hover:shadow-lg hover:shadow-teal-500/10 hover:text-white transition-all';

type LogItem = { id: string; question: string; revealedAt: string };
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
};

export default function QuizLogPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LogDetail | null>(null);

  useEffect(() => {
    api.get('/quiz/log').then((res) => {
      setItems(res.data.items);
      setLoading(false);
    });
  }, []);

  const openDetail = async (id: string) => {
    const res = await api.get(`/quiz/log/${id}`);
    setDetail(res.data);
  };

  if (loading) return <div className="p-6 text-gray-400">Loading question log…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold text-white">Question Log</h1>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => openDetail(item.id)}
            className={`glass-card w-full text-left p-4 rounded-lg text-gray-200 ${QUIZ_HOVER}`}
          >
            <div>{item.question}</div>
            <div className="text-xs text-gray-500">{new Date(item.revealedAt).toLocaleDateString()}</div>
          </button>
        ))}
        {items.length === 0 && <div className="text-gray-500">No revealed questions yet.</div>}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="glass-card max-w-lg w-full p-6 rounded-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg text-white">{detail.question}</p>
            <p className="text-cyan-400">Correct answer: {detail.options[detail.correctIndex]}</p>
            <p className="text-gray-300 text-sm">{detail.explanation}</p>
            <div className="flex gap-4 text-sm text-gray-400">
              <span>{detail.participants} participants</span>
              <span>{detail.correctCount} correct</span>
              <span>{detail.incorrectCount} incorrect</span>
            </div>
            <button onClick={() => setDetail(null)} className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-300 ${QUIZ_HOVER}`}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
