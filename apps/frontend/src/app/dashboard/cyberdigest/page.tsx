'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { formatDateTime } from '@/lib/datetime';

type Source = {
  slug: string; name: string; type: string; website: string; trustRole: string; enabled: boolean;
  pollIntervalMinutes: number; health: 'DISABLED' | 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'FAILING';
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number;
};
type Health = { checkedAt: string; allEnabledSourcesHealthy: boolean; coverageGaps: string[]; pendingStories: number; sources: Source[] };
type Story = {
  id: string; title: string; url: string; publisher: string; publishedAt: string | null; ingestedAt: string;
  summary: string | null; cveIds: string[]; verificationState: string;
};
type Cvss = { provider: string; source: string; version: string; score: number; vector: string | null; severity: string | null };
type Cve = {
  cveId: string; recordStatus: string; description: string | null; cvss: Cvss[];
  nvd: { enrichment: string; status: string | null };
  kev: { listed: boolean | null; dateAdded: string | null };
  conflicts: { field: string; detail: string }[] | null; lastVerifiedAt: string | null; lastError: string | null;
};

const TABS = ['News', 'CVEs', 'Zero-days', 'Source health'] as const;
type Tab = (typeof TABS)[number];

const pill = (cls: string, text: string) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{text}</span>;
const HEALTH_CLS: Record<string, string> = {
  HEALTHY: 'bg-emerald-500/15 text-emerald-300', STALE: 'bg-amber-500/15 text-amber-300', FAILING: 'bg-red-500/15 text-red-300',
  UNKNOWN: 'bg-gray-500/20 text-gray-300', DISABLED: 'bg-gray-500/20 text-gray-400',
};
const UNKNOWN = <span className="text-gray-500">unknown</span>;

function NewsTab() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ total: number; items: Story[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/cyberdigest/stories', { params: { q: q || undefined, take: 50 } }).then((r) => { setData(r.data); setErr(''); }).catch(() => setErr('Could not load stories.'));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or CVE id" className="w-72 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white" />
        {data && <span className="text-xs text-gray-400">{data.total} stories</span>}
      </div>
      <p className="text-xs text-amber-300/90">Publisher reporting only. These items have not been independently verified; CVE ids shown are as the publisher wrote them.</p>
      {err && <div className="text-red-300 text-sm">{err}</div>}
      {data?.items.length === 0 && <div className="glass-card p-6 rounded-xl text-gray-400">No stories ingested yet. Sources are polled every 20–30 minutes.</div>}
      {data?.items.map((s) => (
        <div key={s.id} className="glass-card p-4 rounded-xl space-y-1">
          <div className="flex items-start justify-between gap-3">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-white font-medium hover:text-cyan-300">{s.title}</a>
            {pill('bg-amber-500/15 text-amber-300', 'Attributed reporting')}
          </div>
          <div className="text-xs text-gray-400">{s.publisher} · {s.publishedAt ? formatDateTime(s.publishedAt) : 'publication date not given by source'} · ingested {formatDateTime(s.ingestedAt)}</div>
          {s.summary && <p className="text-sm text-gray-300">{s.summary}</p>}
          {s.cveIds.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{s.cveIds.map((c) => <span key={c} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-cyan-300">{c} · mentioned, see CVEs tab</span>)}</div>}
        </div>
      ))}
    </div>
  );
}

function CvesTab() {
  const [q, setQ] = useState('');
  const [kev, setKev] = useState('');
  const [data, setData] = useState<{ total: number; items: Cve[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/cyberdigest/cves', { params: { q: q || undefined, kev: kev || undefined, take: 50 } }).then((r) => { setData(r.data); setErr(''); }).catch(() => setErr('Could not load CVEs.'));
    }, 250);
    return () => clearTimeout(t);
  }, [q, kev]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE id or text" className="w-72 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white" />
        <select value={kev} onChange={(e) => setKev(e.target.value)} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white">
          <option value="">KEV: any</option><option value="true">In CISA KEV</option><option value="false">Not in KEV</option><option value="unknown">KEV unknown</option>
        </select>
        {data && <span className="text-xs text-gray-400">{data.total} CVEs</span>}
      </div>
      {err && <div className="text-red-300 text-sm">{err}</div>}
      {data?.items.length === 0 && <div className="glass-card p-6 rounded-xl text-gray-400">No CVEs verified yet. CVEs mentioned in ingested stories are checked against CVE.org and NVD in the background.</div>}
      {data?.items.map((c) => (
        <div key={c.cveId} className="glass-card p-4 rounded-xl space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://www.cve.org/CVERecord?id=${c.cveId}`} target="_blank" rel="noopener noreferrer" className="text-white font-semibold hover:text-cyan-300">{c.cveId}</a>
            {pill(c.recordStatus === 'PUBLISHED' ? 'bg-emerald-500/15 text-emerald-300' : c.recordStatus === 'REJECTED' ? 'bg-red-500/15 text-red-300' : 'bg-gray-500/20 text-gray-300', `CVE.org: ${c.recordStatus.toLowerCase().replace('_', ' ')}`)}
            {pill(c.nvd.enrichment === 'ENRICHED' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300', `NVD: ${c.nvd.enrichment === 'ENRICHED' ? 'enriched' : c.nvd.enrichment.toLowerCase()}`)}
            {c.kev.listed === true && pill('bg-red-500/15 text-red-300', 'In CISA KEV')}
            {c.kev.listed === false && pill('bg-gray-500/20 text-gray-300', 'Not in KEV catalog')}
            {c.kev.listed === null && pill('bg-gray-500/20 text-gray-400', 'KEV status unknown')}
          </div>
          {c.conflicts?.map((x, i) => <div key={i} className="text-xs text-red-300">Conflict: {x.detail}</div>)}
          <p className="text-sm text-gray-300">{c.description ?? <span className="text-gray-500">No official description available.</span>}</p>
          <div className="text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            {c.cvss.length === 0 ? <span>CVSS: not provided by any source</span> : c.cvss.map((s, i) => <span key={i}>CVSS {s.version}: <b className="text-gray-200">{s.score}</b>{s.severity ? ` ${s.severity}` : ''} <span className="text-gray-500">({s.provider}, {s.source})</span></span>)}
          </div>
          <div className="text-xs text-gray-500">Exploitation, patch and zero-day status: {UNKNOWN} (not assessed yet) · last verified {c.lastVerifiedAt ? formatDateTime(c.lastVerifiedAt) : 'never'}{c.lastError ? ` · last error: ${c.lastError}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

function ZeroDayTab() {
  return (
    <div className="glass-card p-6 rounded-xl space-y-2">
      <div className="text-white font-medium">Zero-day exploitation alerts: not available yet</div>
      <p className="text-sm text-gray-400">
        The analyst-approved zero-day workflow is not built yet (Phase 3). Nothing is classified as a zero-day, and no CVE should be read as a confirmed zero-day. CISA KEV listing shown on the CVEs tab means CISA has evidence of exploitation; it does not establish a zero-day timeline.
      </p>
    </div>
  );
}

function HealthTab() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get('/cyberdigest/health').then((r) => { setH(r.data); setErr(''); }).catch(() => setErr('Could not load source health.')), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (err) return <div className="text-red-300 text-sm">{err}</div>;
  if (!h) return <div className="text-gray-400">Loading…</div>;
  const bad = h.sources.filter((s) => s.enabled && s.health !== 'HEALTHY');
  return (
    <div className="space-y-3">
      <div className={`p-3 rounded-lg text-sm ${h.allEnabledSourcesHealthy ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
        {h.allEnabledSourcesHealthy ? 'Every enabled source succeeded recently.' : `${bad.length} enabled source(s) are not confirmed healthy. Content below may be incomplete or out of date.`}
        {' '}{h.pendingStories} stories await verification.
      </div>
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-800 text-left text-gray-400">
            <th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Role</th><th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Last success</th><th className="p-3 font-medium">Last error</th>
          </tr></thead>
          <tbody>
            {h.sources.map((s) => (
              <tr key={s.slug} className="border-t border-gray-800">
                <td className="p-3"><a href={s.website} target="_blank" rel="noopener noreferrer" className="text-white hover:text-cyan-300">{s.name}</a></td>
                <td className="p-3 text-gray-300">{s.trustRole === 'AUTHORITATIVE' ? 'Authoritative' : 'Discovery'}</td>
                <td className="p-3">{pill(HEALTH_CLS[s.health], s.health.toLowerCase())}{s.consecutiveFailures > 0 && <span className="ml-2 text-xs text-gray-500">{s.consecutiveFailures} failures</span>}</td>
                <td className="p-3 text-gray-300">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : <span className="text-gray-500">never</span>}</td>
                <td className="p-3 text-xs text-red-300/90">{s.lastError ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">CVE.org and NVD are queried per CVE, so their status reflects the most recent lookups. Checked {formatDateTime(h.checkedAt)}.</p>
    </div>
  );
}

export default function CyberdigestPage() {
  const [tab, setTab] = useState<Tab>('News');
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Cyberdigest</h1>
        <p className="text-sm text-gray-400 mt-1">Cybersecurity intelligence with sources and verification status. Work in progress: ingestion and CVE/KEV verification are live; summaries, zero-day review and the daily digest are not built yet.</p>
      </div>
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t ? 'border-cyan-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>{t}</button>
        ))}
      </div>
      {tab === 'News' && <NewsTab />}
      {tab === 'CVEs' && <CvesTab />}
      {tab === 'Zero-days' && <ZeroDayTab />}
      {tab === 'Source health' && <HealthTab />}
    </div>
  );
}
