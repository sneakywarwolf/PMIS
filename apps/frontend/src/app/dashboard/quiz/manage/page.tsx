'use client';

import { useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { useToast } from '@/components/toast-provider';

type Question = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  scheduledFor: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'REVEALED';
};

const emptyForm = { question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', scheduledFor: '' };

export default function QuizManagePage() {
  const showToast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/quiz/questions').then((res) => setQuestions(res.data));

  useEffect(() => {
    load();
  }, []);

  const startEdit = (q: Question) => {
    setEditingId(q.id);
    setForm({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      scheduledFor: q.scheduledFor.slice(0, 16),
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
          <button onClick={save} disabled={saving} className="glass px-4 py-2 rounded-lg text-white disabled:opacity-40">
            {saving ? 'Saving…' : editingId ? 'Update' : 'Schedule'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="glass px-4 py-2 rounded-lg text-gray-300">
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
            {q.status === 'SCHEDULED' && (
              <button onClick={() => startEdit(q)} className="glass px-3 py-1.5 rounded-lg text-sm text-gray-300">
                Edit
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
