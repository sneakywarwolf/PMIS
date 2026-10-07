'use client';

import { Children, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_PREFS, SECTIONS, move, normalize, type Prefs } from '@/lib/dashboard-layout';

/** Layout prefs live in localStorage per user — purely a display preference, nothing is sent to the server. */
export function useDashboardLayout(userId?: string) {
  const key = `dashboard-layout:${userId ?? 'anon'}`;
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    try { setPrefs(normalize(JSON.parse(localStorage.getItem(key) ?? 'null'))); } catch { setPrefs(DEFAULT_PREFS); }
  }, [key]);

  const update = (next: Prefs) => { setPrefs(next); localStorage.setItem(key, JSON.stringify(next)); };
  return {
    prefs,
    toggle: (id: string) => update({ ...prefs, hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id] }),
    move: (id: string, dir: -1 | 1) => update({ ...prefs, order: move(prefs.order, id, dir) }),
    reset: () => update(DEFAULT_PREFS),
  };
}

export type DashboardLayout = ReturnType<typeof useDashboardLayout>;

/** A customizable dashboard section: hidden or re-ordered per the user's prefs. Renders nothing when it has no content (e.g. role-gated). */
export function Slot({ layout, id, children }: { layout: DashboardLayout; id: string; children: React.ReactNode }) {
  if (layout.prefs.hidden.includes(id) || Children.toArray(children).length === 0) return null;
  return <div style={{ order: layout.prefs.order.indexOf(id) + 1 }}>{children}</div>;
}

export function DashboardCustomize({ layout }: { layout: DashboardLayout }) {
  const [open, setOpen] = useState(false);
  const { order, hidden } = layout.prefs;
  const label = (id: string) => SECTIONS.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Customize"
        title="Customize"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none"
      >
        <SlidersHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="dialog" aria-label="Customize dashboard" className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur-md shadow-2xl p-3">
          <ul className="space-y-1">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5">
                <button type="button" onClick={() => layout.toggle(id)} aria-pressed={!hidden.includes(id)} aria-label={`${hidden.includes(id) ? 'Show' : 'Hide'} ${label(id)}`} className="p-1 text-gray-400 hover:text-white">
                  {hidden.includes(id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <span className={`flex-1 text-sm ${hidden.includes(id) ? 'text-gray-600 line-through' : 'text-gray-200'}`}>{label(id)}</span>
                <button type="button" disabled={i === 0} onClick={() => layout.move(id, -1)} aria-label={`Move ${label(id)} up`} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                <button type="button" disabled={i === order.length - 1} onClick={() => layout.move(id, 1)} aria-label={`Move ${label(id)} down`} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={layout.reset} className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
