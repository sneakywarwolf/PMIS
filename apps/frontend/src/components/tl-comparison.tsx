'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/contexts/auth-context';
import { STATUS_COLORS, STATUS_ORDER, TOOLTIP_STYLE } from '@/lib/chart-theme';
import { RiskRing } from '@/components/risk-ring';
import { titleCase } from '@/lib/use-engagements';
import type { Counts } from '@/lib/risk';

type Team = {
  tlId: string;
  tlName: string;
  teamSize: number;
  total: number;
  byStatus: Record<string, number>;
  vulnCounts: Counts;
};

/**
 * Status comparison across Team Leads. Only rendered for ADMIN/AVP, and the
 * endpoint is role-guarded server-side too. Clicking a bar segment filters
 * the Engagements table to that TL + status.
 */
export function TlComparison({ onSelect }: { onSelect: (tl: { id: string; name: string }, status: string) => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    api.get('/dashboard/tl-comparison').then((r) => setTeams(r.data)).catch(() => setError(true));
  };
  useEffect(load, []);

  const chart = (teams ?? []).map((t) => ({ ...t.byStatus, name: t.tlName, tlId: t.tlId }));

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Team Lead Comparison</h2>
        <p className="text-sm text-gray-400">Project status per team · click a segment to filter Engagements</p>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Couldn&apos;t load the comparison.</span>
          <button type="button" onClick={load} className="flex items-center gap-1.5 hover:text-red-300"><RefreshCw className="w-4 h-4" /> Retry</button>
        </div>
      ) : teams === null ? (
        <div className="h-64 rounded-lg bg-white/5 animate-pulse" aria-busy="true" />
      ) : teams.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">No teams yet</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-3" style={{ height: Math.max(220, teams.length * 44 + 60) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                <XAxis type="number" stroke="#9ca3af" allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="#9ca3af" width={96} />
                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff' }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: number, k: string) => [v, titleCase(k)]} />
                <Legend formatter={(k: string) => titleCase(k)} />
                {STATUS_ORDER.map((s) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="status"
                    fill={STATUS_COLORS[s]}
                    cursor="pointer"
                    onClick={(d: any) => onSelect({ id: d.tlId, name: d.name }, s)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="xl:col-span-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-medium">Team Lead</th>
                  <th className="px-3 py-2 font-medium text-right">Testers</th>
                  <th className="px-3 py-2 font-medium text-right">Projects</th>
                  <th className="px-3 py-2 font-medium text-right">Done</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.tlId} className="border-b border-gray-800 hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2 text-white whitespace-nowrap">{t.tlName}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">{t.teamSize}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-300">{t.total}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-400">
                      {t.total ? Math.round((t.byStatus.COMPLETED / t.total) * 100) : 0}%
                    </td>
                    <td className="px-3 py-2"><RiskRing counts={t.vulnCounts} size={28} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
