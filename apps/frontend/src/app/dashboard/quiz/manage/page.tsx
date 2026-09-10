'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';

// Same turquoise-glass hover treatment used app-wide (e.g. the sidebar nav) —
// keep every Quiz control consistent with it rather than inventing a new one.
const QUIZ_HOVER = 'hover:bg-teal-400/5 hover:border-teal-400/20 hover:shadow-lg hover:shadow-teal-500/10 hover:text-white transition-all';

type Question = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'REVEALED';
};

type ResponseEntry = { id: string; selectedOption: number; isCorrect: boolean; user?: { id: string; fullName: string } };
type ResponsesDetail = { question: Question; attempts: ResponseEntry[] };

const emptyForm = { question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', scheduledFor: '' };

export default function QuizManagePage() {
  const showToast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [responses, setResponses] = useState<ResponsesDetail | null>(null);

  const openResponses = async (id: string) => {
    const res = await api.get(`/quiz/questions/${id}/responses`);
    setResponses(res.data);
  };

  const load = () => api.get('/quiz/questions').then((res) => setQuestions(res.data));

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/quiz/questions/${id}`);
      showToast('Question deleted', 'success');
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not delete question', 'error');
    }
  };

  const startEdit = (q: Question) => {
    setEditingId(q.id);
    const d = new Date(q.scheduledFor);
    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      scheduledFor: localIso,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, scheduledFor: new Date(form.scheduledFor).toISOString() };
      if (editingId) {
        await api.put(`/quiz/questions/${editingId}`, payload);
        showToast('Question updated', 'success');
      } else {
        await api.post('/quiz/questions', payload);
        showToast('Question scheduled', 'success');
      }
      resetForm();
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Could not save question', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-white">Manage Quiz</h1>

      <div className="glass-card p-6 rounded-xl space-y-3">
        <div className="text-sm text-gray-400">{editingId ? 'Edit question' : 'New question'}</div>
        <input
          className="glass w-full px-3 py-2 rounded-lg text-white bg-transparent"
          placeholder="Question"
          value={form.question}
          onChange={(e) => setForm({ ...form, question: e.target.value })}
        />
        {form.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              checked={form.correctIndex === i}
              onChange={() => setForm({ ...form, correctIndex: i })}
            />
            <input
              className="glass flex-1 px-3 py-2 rounded-lg text-white bg-transparent"
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const options = [...form.options];
                options[i] = e.target.value;
                setForm({ ...form, options });
              }}
            />
          </div>
        ))}
        <textarea
          className="glass w-full px-3 py-2 rounded-lg text-white bg-transparent"
          placeholder="Explanation"
          value={form.explanation}
          onChange={(e) => setForm({ ...form, explanation: e.target.value })}
        />
        <input
          type="datetime-local"
          className="glass px-3 py-2 rounded-lg text-white bg-transparent"
          value={form.scheduledFor}
          onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
        />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className={`glass px-4 py-2 rounded-lg text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none ${QUIZ_HOVER}`}>
            {saving ? 'Saving…' : editingId ? 'Update' : 'Schedule'}
          </button>
          {editingId && (
            <button onClick={resetForm} className={`glass px-4 py-2 rounded-lg text-gray-300 ${QUIZ_HOVER}`}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-400">All questions</div>
        {questions.map((q) => (
          <div key={q.id} className="glass-card p-4 rounded-lg flex items-center justify-between">
            <div>
              <div className="text-gray-200">{q.question}</div>
              <div className="text-xs text-gray-500">
                {q.status} · {new Date(q.scheduledFor).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openResponses(q.id)} className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-300 ${QUIZ_HOVER}`}>
                Responses
              </button>
              {q.status === 'SCHEDULED' && (
                <button onClick={() => startEdit(q)} className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-300 ${QUIZ_HOVER}`}>
                  Edit
                </button>
              )}
              <button onClick={() => handleDelete(q.id)} className="glass px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-400/5 hover:border-red-400/20 hover:shadow-lg hover:shadow-red-500/10 transition-all">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {responses && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setResponses(null)}>
          <div className="glass-card max-w-lg w-full p-6 rounded-xl space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg text-white">{responses.question.question}</p>
            <div className="flex gap-4 text-sm text-gray-400">
              <span>{responses.attempts.length} responses</span>
              <span>{responses.attempts.filter((a) => a.isCorrect).length} correct</span>
              <span>{responses.attempts.filter((a) => !a.isCorrect).length} incorrect</span>
            </div>
            <div className="space-y-1">
              {responses.attempts.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm text-gray-300 border-t border-gray-800 pt-1">
                  <span>{a.user?.fullName ?? 'Unknown user'}</span>
                  <span>{responses.question.options[a.selectedOption]}</span>
                  <span className={a.isCorrect ? 'text-cyan-400' : 'text-red-400'}>{a.isCorrect ? 'Correct' : 'Incorrect'}</span>
                </div>
              ))}
              {responses.attempts.length === 0 && <div className="text-gray-500 text-sm">No responses yet.</div>}
            </div>
            <button onClick={() => setResponses(null)} className={`glass px-3 py-1.5 rounded-lg text-sm text-gray-300 ${QUIZ_HOVER}`}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
