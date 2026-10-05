'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, User as UserIcon, Users, X } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { formatDate } from '@/lib/datetime';

type Counts = { critical: number; high: number; medium: number; low: number; info: number };
type Row = {
  id: string;
  name: string;
  clientName: string;
  scope: string | null;
  totalScopeCount: number | null;
  testingType: string | null;
  subType: string;
  complianceType: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  tester: { username: string; fullName: string | null };
  tl: { username: string; fullName: string | null };
  vulnCounts: Counts;
};

const SEVERITY_CHIPS: { key: keyof Counts; label: string; cls: string }[] = [
  { key: 'critical', label: 'C', cls: 'bg-red-500/10 border-red-500/30 text-red-400' },
  { key: 'high', label: 'H', cls: 'bg-orange-500/10 border-orange-500/30 text-orange-400' },
  { key: 'medium', label: 'M', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  { key: 'low', label: 'L', cls: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  { key: 'info', label: 'I', cls: 'bg-gray-500/10 border-gray-500/30 text-gray-400' },
];

const COMPLIANCE_LABEL: Record<string, string> = { CERT_IN: 'Cert-In', PCI: 'PCI', VAPT: 'VAPT', ASV: 'ASV' };
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const person = (u: { username: string; fullName: string | null }) => u.fullName || u.username;

const NO_FILTERS = { q: '', tester: '', tl: '', testingType: '', subType: '', compliance: '', status: '', from: '', to: '' };

type SortKey = 'client' | 'scope' | 'tester' | 'tl' | 'testing' | 'activity' | 'start' | 'end' | 'vulns' | 'compliance' | 'status';
const COLUMNS: [SortKey, string][] = [
  ['client', 'Client'], ['scope', 'Scope'], ['tester', 'Tester'], ['tl', 'Team Lead'], ['testing', 'Testing'],
  ['activity', 'Activity'], ['start', 'Start'], ['end', 'End'], ['vulns', 'Vulnerabilities'],
  ['compliance', 'Compliance'], ['status', 'Status'],
];
// Comparable value per column; '' means "no value" and always sorts last.
const SORT_VALUE: Record<SortKey, (r: Row) => string | number> = {
  client: (r) => r.clientName.toLowerCase(),
  scope: (r) => (r.scope ?? '').toLowerCase(),
  tester: (r) => person(r.tester).toLowerCase(),
  tl: (r) => person(r.tl).toLowerCase(),
  testing: (r) => (r.testingType ?? '').toLowerCase(),
  activity: (r) => r.subType,
  start: (r) => r.startDate,
  end: (r) => r.endDate ?? '',
  // severity-weighted: more criticals outrank any number of highs, etc.
  vulns: (r) => { const c = r.vulnCounts; return c.critical * 1e12 + c.high * 1e8 + c.medium * 1e4 + c.low * 1e2 + c.info; },
  compliance: (r) => r.complianceType ?? '',
  status: (r) => r.status,
};

function FilterSelect({ label, value, onChange, options, format = (v) => v }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; format?: (v: string) => string;
}) {
  return (
    <select aria-label={`Filter by ${label}`} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto text-sm">
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{format(o)}</option>)}
    </select>
  );
}

export function DashboardEngagements() {
  const { user } = useAuth();
  const orgWide = user?.role === 'ADMIN' || user?.role === 'AVP';
  const [view, setView] = useState<'team' | 'self'>('team');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'start', dir: -1 });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    setRows(null);
    api
      .get('/dashboard/engagements', { params: { view } })
      .then((res) => setRows(res.data))
      .catch(() => setError(true));
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view]);

  const setFilter = (k: keyof typeof NO_FILTERS, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const options = (pick: (r: Row) => string | null) =>
    [...new Set((rows ?? []).map(pick).filter((v): v is string => !!v))].sort();

  const q = filters.q.trim().toLowerCase();
  const shown = (rows ?? [])
    .filter((r) => {
      const start = r.startDate.slice(0, 10);
      return (
        (!q || `${r.clientName} ${r.scope ?? ''}`.toLowerCase().includes(q)) &&
        (!filters.tester || person(r.tester) === filters.tester) &&
        (!filters.tl || person(r.tl) === filters.tl) &&
        (!filters.testingType || r.testingType === filters.testingType) &&
        (!filters.subType || r.subType === filters.subType) &&
        (!filters.compliance || r.complianceType === filters.compliance) &&
        (!filters.status || r.status === filters.status) &&
        (!filters.from || start >= filters.from) &&
        (!filters.to || start <= filters.to)
      );
    })
    .sort((a, b) => {
      const [x, y] = [SORT_VALUE[sort.key](a), SORT_VALUE[sort.key](b)];
      // Empty values (no end date etc.) always sink to the bottom regardless of direction.
      if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Engagements</h2>
          <p className="text-sm text-gray-400">
            {orgWide ? 'All teams' : view === 'team' ? 'Your team' : 'Your engagements'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!orgWide && (
            <div role="group" aria-label="Engagement view" className="flex rounded-lg border border-gray-700 p-0.5">
              {([['team', 'Team', Users], ['self', 'Self', UserIcon]] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none ${
                    view === v
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      : 'border border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          aria-label="Search client or scope"
          placeholder="Search client / scope"
          value={filters.q}
          onChange={(e) => setFilter('q', e.target.value)}
          className="w-auto text-sm"
        />
        <FilterSelect label="Tester" value={filters.tester} onChange={(v) => setFilter('tester', v)} options={options((r) => person(r.tester))} />
        <FilterSelect label="Team Lead" value={filters.tl} onChange={(v) => setFilter('tl', v)} options={options((r) => person(r.tl))} />
        <FilterSelect label="Testing" value={filters.testingType} onChange={(v) => setFilter('testingType', v)} options={options((r) => r.testingType)} />
        <FilterSelect label="Activity" value={filters.subType} onChange={(v) => setFilter('subType', v)} options={options((r) => r.subType)} format={titleCase} />
        <FilterSelect label="Compliance" value={filters.compliance} onChange={(v) => setFilter('compliance', v)} options={Object.keys(COMPLIANCE_LABEL)} format={(v) => COMPLIANCE_LABEL[v]} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={options((r) => r.status)} format={titleCase} />
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Start
          <input type="date" aria-label="Start date from" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className="w-auto text-sm" />
          –
          <input type="date" aria-label="Start date to" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className="w-auto text-sm" />
        </label>
        {filtersActive && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none">
            <X className="w-4 h-4" /> Clear
          </button>
        )}
        {rows && <span className="ml-auto text-xs text-gray-500 tabular-nums">{shown.length} of {rows.length}</span>}
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Couldn&apos;t load engagements.</span>
          <button type="button" onClick={load} className="flex items-center gap-1.5 hover:text-red-300">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : rows === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-12">No engagements to show</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-xs uppercase tracking-wide text-gray-500">
                {COLUMNS.map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    className="px-3 py-2 font-medium whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className={`flex items-center gap-1 uppercase tracking-wide hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none rounded ${sort.key === key ? 'text-emerald-400' : ''}`}
                    >
                      {label}
                      {sort.key === key ? (
                        sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-gray-800 hover:bg-white/5 transition-colors">
                  <td className="px-3 py-2 text-white whitespace-nowrap">
                    <Link href={`/dashboard/projects/${r.id}`} className="hover:text-emerald-400">{r.clientName}</Link>
                  </td>
                  <td className="px-3 py-2 text-gray-300 max-w-[14rem] truncate" title={r.scope ?? undefined}>
                    {r.scope || '—'}
                    {r.totalScopeCount != null && <span className="font-mono text-xs text-gray-500"> ({r.totalScopeCount})</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{person(r.tester)}</td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{person(r.tl)}</td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{r.testingType || '—'}</td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{titleCase(r.subType)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400 whitespace-nowrap">{formatDate(r.startDate)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400 whitespace-nowrap">{r.endDate ? formatDate(r.endDate) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1" role="group" aria-label="Vulnerability counts by severity">
                      {SEVERITY_CHIPS.map(({ key, label, cls }) => (
                        <span
                          key={key}
                          title={`${titleCase(key)}: ${r.vulnCounts[key]}`}
                          className={`rounded-md border px-1.5 py-0.5 text-xs font-mono tabular-nums ${cls} ${r.vulnCounts[key] === 0 ? 'opacity-40' : ''}`}
                        >
                          {label} {r.vulnCounts[key]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.complianceType ? (
                      <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs text-emerald-400">
                        {COMPLIANCE_LABEL[r.complianceType] ?? r.complianceType}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`status-badge status-${r.status.toLowerCase()}`}>{titleCase(r.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
