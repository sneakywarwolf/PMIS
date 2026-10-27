'use client';

import { useState } from 'react';
import { Row, person } from '@/lib/use-engagements';
import { SEVERITY_KEYS, Counts } from '@/lib/risk';
import { SEVERITY_COLORS } from '@/lib/chart-theme';
import { useSeverity } from '@/lib/severity';

const LABEL: Record<keyof Counts, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const BY = { tester: (r: Row) => person(r.tester), client: (r: Row) => r.clientName } as const;

/**
 * Severity × (tester | client) matrix. Cell opacity encodes count within its
 * column (so a "Critical" column of 1–2 still reads); the number is always printed.
 */
export function FindingsHeatmap({ rows, onSelect }: { rows: Row[] | null; onSelect: (severity: keyof Counts) => void }) {
  const sev = useSeverity();
  const [by, setBy] = useState<keyof typeof BY>('tester');

  const grid = new Map<string, Counts>();
  for (const r of rows ?? []) {
    const key = BY[by](r);
    const cell = grid.get(key) ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    SEVERITY_KEYS.forEach((k) => (cell[k] += r.vulnCounts[k]));
    grid.set(key, cell);
  }
  const lines = [...grid.entries()].sort((a, b) => total(b[1]) - total(a[1])).slice(0, 12);
  const colMax = Object.fromEntries(SEVERITY_KEYS.map((k) => [k, Math.max(1, ...lines.map(([, c]) => c[k]))]));

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Findings Heatmap</h2>
          <p className="text-sm text-gray-400">Severity by {by} · top 12 · click a column to filter Engagements</p>
        </div>
        <div role="group" aria-label="Group heatmap by" className="inline-flex rounded-lg border border-gray-700 bg-gray-800/50 p-0.5 text-sm">
          {(['tester', 'client'] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={by === b}
              onClick={() => setBy(b)}
              className={`rounded-md px-3 py-1.5 capitalize transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${
                by === b ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="h-48 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
      ) : lines.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">No findings data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2 py-1 text-left font-medium capitalize">{by}</th>
                {SEVERITY_KEYS.map((k) => (
                  <th key={k} className="px-1 py-1 font-medium">
                    <button
                      type="button"
                      onClick={() => onSelect(k)}
                      className="w-full rounded uppercase tracking-wide hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none"
                    >
                      {sev.label(LABEL[k])}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(([name, c]) => (
                <tr key={name}>
                  <td className="max-w-[10rem] truncate px-2 py-1 text-gray-300" title={name}>{name}</td>
                  {SEVERITY_KEYS.map((k) => (
                    <td
                      key={k}
                      title={`${name} · ${sev.label(LABEL[k])}: ${c[k]}`}
                      className="rounded-md px-1 py-1.5 text-center font-mono tabular-nums text-white"
                      style={{ backgroundColor: c[k] ? withAlpha(sev.color(LABEL[k]) || SEVERITY_COLORS[LABEL[k]], 0.15 + 0.6 * (c[k] / colMax[k])) : 'rgba(255,255,255,0.03)' }}
                    >
                      {c[k] || <span className="text-gray-600">0</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const total = (c: Counts) => SEVERITY_KEYS.reduce((n, k) => n + c[k], 0);
const withAlpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(2)})`;
};
