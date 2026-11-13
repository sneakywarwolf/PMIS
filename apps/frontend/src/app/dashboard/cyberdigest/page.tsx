'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/contexts/auth-context';
import { useAuth } from '@/contexts/auth-context';
import { formatDateTime } from '@/lib/datetime';

// ----------------------------------------------------------------------------- types

type Source = {
  slug: string; name: string; type: string; website: string; trustRole: string; enabled: boolean;
  pollIntervalMinutes: number; health: 'DISABLED' | 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'FAILING';
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number;
};
type Health = { checkedAt: string; allEnabledSourcesHealthy: boolean; coverageGaps: string[]; pendingStories: number; sources: Source[] };
type Story = {
  id: string; title: string; url: string; publisher: string; publishedAt: string | null; ingestedAt: string; summary: string | null;
  categories: string[]; cves: { cveId: string; recordStatus: string | null }[]; zeroDay: { cveId: string; state: string }[];
  verificationState: string; stateNote: string | null; lastVerifiedAt: string | null;
};
type Cvss = { provider: string; source: string; version: string; score: number; vector: string | null; severity: string | null };
type Cve = {
  cveId: string; recordStatus: string; description: string | null; cvss: Cvss[]; vendors: string[];
  nvd: { enrichment: string; status: string | null };
  kev: { listed: boolean | null; dateAdded: string | null };
  conflicts: { field: string; detail: string }[] | null; lastVerifiedAt: string | null; lastError: string | null;
};
type ZdEvidence = { id: string; kind: string; sourceType: string; primary: boolean; sourceName: string; url: string; eventDate: string | null; note: string | null; addedBy: string; retracted: boolean; retractReason: string | null };
type ZdCase = {
  cveId: string; state: string; publishedAsConfirmed: boolean; eligibleForConfirmation: boolean; reasons: string[]; missing: string[]; conflicts: string[];
  analystReason: string | null; stateSetBy: string; approvedBy: string | null; approvedAt: string | null; evidence: ZdEvidence[];
  cve: { recordStatus: string; description: string | null } | null;
};
type Verification = {
  pendingStories: number; conflictingStories: { id: string; title: string; url: string | null; stateNote: string | null }[];
  cvesAwaitingNvd: number; cvesUnavailable: number; cveConflicts: { cveId: string; conflicts: { field: string; detail: string }[] }[];
  zeroDayClaimsUnverified: number; zeroDayStatusUnknown: number;
  rejectedStories: { id: string; title: string; url: string | null; stateNote: string | null }[];
  corrections: { id: string; entityType: string; entityId: string; event: string; detail: any; createdAt: string }[];
};

const TABS = ['Daily digest', 'News', 'CVEs', 'Zero-days', 'Verification & source health', 'Administration'] as const;
type Tab = (typeof TABS)[number];

// ----------------------------------------------------------------------------- helpers

const pill = (cls: string, text: string, key?: string) => <span key={key} className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{text}</span>;
const GREEN = 'bg-emerald-500/15 text-emerald-300', AMBER = 'bg-amber-500/15 text-amber-300', RED = 'bg-red-500/15 text-red-300', GREY = 'bg-gray-500/20 text-gray-300';
const HEALTH_CLS: Record<string, string> = { HEALTHY: GREEN, STALE: AMBER, FAILING: RED, UNKNOWN: GREY, DISABLED: 'bg-gray-500/20 text-gray-400' };
const UNKNOWN = <span className="text-gray-500">unknown</span>;
const inputCls = 'px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white';
const btnCls = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 text-gray-200 hover:bg-gray-800 disabled:opacity-50';

/**
 * The server decides which links are clickable (exact-host allowlist, https only) and sends `url: null` otherwise. This
 * is a second, independent check in the browser: even a tampered response cannot make anything but a plain https
 * address clickable. A link never navigates by itself, opens in a new tab with no opener and no referrer, and is not prefetched.
 */
const safeUrl = (u: string | null | undefined): string | undefined => {
  if (!u) return undefined;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && !p.username && !p.password && !p.port ? p.href : undefined;
  } catch {
    return undefined;
  }
};
function Ext({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const href = safeUrl(url);
  if (!href) return <span className={className?.replace(/hover:\S+|underline/g, '')} title="Link not available: this site is not on the approved list">{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className={className}>{children}</a>;
}
const errMsg = (e: any) => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : m?.message ? `${m.message}${m.missing?.length ? `: ${m.missing.join('; ')}` : ''}` : 'The action failed.';
};

const STORY_STATE: Record<string, [string, string]> = {
  VERIFIED: [GREEN, 'Reported by publisher'],
  ATTRIBUTED: [GREEN, 'Reported by publisher'],
  PENDING: [GREY, 'Pending verification'],
  CONFLICTING: [RED, 'Conflicting evidence'],
  REJECTED: [RED, 'Rejected'],
  SOURCE_UNAVAILABLE: [GREY, 'Source unavailable'],
};
const ZD_STATE: Record<string, [string, string]> = {
  CONFIRMED: [RED, 'Confirmed zero-day'],
  REPORTED_UNVERIFIED: [AMBER, 'Zero-day reported — unverified'],
  KNOWN_EXPLOITED_UNCONFIRMED: [AMBER, 'Known exploited — zero-day not confirmed'],
  NOT_SUBSTANTIATED: [GREY, 'Zero-day claim not substantiated'],
  UNKNOWN: [GREY, 'Zero-day status unknown'],
};
const CATEGORIES = ['ransomware', 'malware', 'breach', 'vulnerability', 'appsec', 'cloud', 'threat-intel', 'other'];

/** Small inline "why?" box: review actions always carry a reason, which is stored with the decision. */
function ReasonAction({ label, onSubmit, danger }: { label: string; onSubmit: (reason: string) => Promise<void>; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return <button className={`${btnCls} ${danger ? 'text-red-300' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await onSubmit(reason);
      setOpen(false);
      setReason('');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={`${inputCls} w-64 !py-1`} />
      <button className={btnCls} disabled={busy || reason.trim().length < 5} onClick={go}>{label}</button>
      <button className={btnCls} onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </span>
  );
}

// ----------------------------------------------------------------------------- News

function NewsTab({ canReview }: { canReview: boolean }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<{ total: number; items: Story[] } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.get('/cyberdigest/stories', { params: { q: q || undefined, category: category || undefined, state: state || undefined, from: from || undefined, to: to ? `${to}T23:59:59` : undefined, take: 50 } })
      .then((r) => { setData(r.data); setErr(''); }).catch(() => setErr('Could not load stories.'));
  }, [q, category, state, from, to]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const act = (id: string, what: 'reject' | 'correct') => async (reason: string) => { await api.post(`/cyberdigest/stories/${id}/${what}`, { reason }); load(); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or CVE id" className={`${inputCls} w-64`} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} className={inputCls}>
          <option value="">All states (except rejected)</option>{Object.entries(STORY_STATE).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="text-xs text-gray-400">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} ml-1`} /></label>
        <label className="text-xs text-gray-400">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} ml-1`} /></label>
        {data && <span className="text-xs text-gray-400">{data.total} stories</span>}
      </div>
      <p className="text-xs text-amber-300/90">Stories are synced automatically from publisher RSS feeds. CVE badges show what CVE.org says, not what the article says.</p>
      {err && <div className="text-red-300 text-sm">{err}</div>}
      {data?.items.length === 0 && <div className="glass-card p-6 rounded-xl text-gray-400">No stories match. Sources are polled every 20–30 minutes.</div>}
      {data?.items.map((s) => {
        const [cls, label] = STORY_STATE[s.verificationState] ?? [GREY, s.verificationState];
        return (
          <div key={s.id} className="glass-card p-4 rounded-xl space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <Ext url={s.url} className="text-white font-medium hover:text-cyan-300">{s.title}</Ext>
              {pill(cls, label)}
            </div>
            <div className="text-xs text-gray-400">{s.publisher} · {s.publishedAt ? formatDateTime(s.publishedAt) : 'publication date not given by source'} · ingested {formatDateTime(s.ingestedAt)}{s.lastVerifiedAt ? ` · last checked ${formatDateTime(s.lastVerifiedAt)}` : ''}</div>
            {s.summary && <p className="text-sm text-gray-300">{s.summary}</p>}
            <div className="flex flex-wrap gap-1 items-center">
              {s.categories.map((c) => <span key={c} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-300">{c}</span>)}
              {s.cves.map((c) => pill(c.recordStatus === 'PUBLISHED' ? GREEN : c.recordStatus === 'REJECTED' || c.recordStatus === 'NOT_FOUND' ? RED : GREY, `${c.cveId} · ${c.recordStatus ? `CVE.org ${c.recordStatus.toLowerCase().replace('_', ' ')}` : 'not checked yet'}`, c.cveId))}
              {s.zeroDay.map((z) => pill(ZD_STATE[z.state]?.[0] ?? GREY, `${z.cveId}: ${ZD_STATE[z.state]?.[1] ?? z.state}`, `zd-${z.cveId}`))}
            </div>
            {s.stateNote && <div className="text-xs text-gray-400">{s.stateNote}</div>}
            {canReview && (
              <div className="flex flex-wrap gap-2 pt-1">
                {s.verificationState !== 'REJECTED' && <ReasonAction label="Reject" danger onSubmit={act(s.id, 'reject')} />}
                {s.verificationState === 'REJECTED' && <ReasonAction label="Restore" onSubmit={act(s.id, 'correct')} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------- CVEs

function CvesTab() {
  const [q, setQ] = useState('');
  const [kev, setKev] = useState('');
  const [severity, setSeverity] = useState('');
  const [vendor, setVendor] = useState('');
  const [nvd, setNvd] = useState('');
  const [data, setData] = useState<{ total: number; items: Cve[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/cyberdigest/cves', { params: { q: q || undefined, kev: kev || undefined, severity: severity || undefined, vendor: vendor || undefined, nvd: nvd || undefined, take: 50 } })
        .then((r) => { setData(r.data); setErr(''); }).catch(() => setErr('Could not load CVEs.'));
    }, 250);
    return () => clearTimeout(t);
  }, [q, kev, severity, vendor, nvd]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE id or text" className={`${inputCls} w-56`} />
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor (e.g. apache)" className={`${inputCls} w-44`} />
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputCls}>
          <option value="">Any provider severity</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
        </select>
        <select value={kev} onChange={(e) => setKev(e.target.value)} className={inputCls}>
          <option value="">KEV: any</option><option value="true">In CISA KEV</option><option value="false">Not in KEV</option><option value="unknown">KEV unknown</option>
        </select>
        <select value={nvd} onChange={(e) => setNvd(e.target.value)} className={inputCls}>
          <option value="">NVD: any</option><option value="ENRICHED">Enriched</option><option value="PENDING">Pending</option><option value="UNAVAILABLE">Unavailable</option>
        </select>
        {data && <span className="text-xs text-gray-400">{data.total} CVEs</span>}
      </div>
      <p className="text-xs text-gray-500">Severity filter uses the label a provider attached to its own score; PMIS does not calculate one. Patch status is not tracked yet.</p>
      {err && <div className="text-red-300 text-sm">{err}</div>}
      {data?.items.length === 0 && <div className="glass-card p-6 rounded-xl text-gray-400">No CVEs match. CVEs mentioned in ingested stories are checked against CVE.org and NVD in the background.</div>}
      {data?.items.map((c) => (
        <div key={c.cveId} className="glass-card p-4 rounded-xl space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://www.cve.org/CVERecord?id=${c.cveId}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-white font-semibold hover:text-cyan-300">{c.cveId}</a>
            {pill(c.recordStatus === 'PUBLISHED' ? GREEN : c.recordStatus === 'REJECTED' ? RED : GREY, `CVE.org: ${c.recordStatus.toLowerCase().replace('_', ' ')}`)}
            {pill(c.nvd.enrichment === 'ENRICHED' ? GREEN : AMBER, `NVD: ${c.nvd.enrichment.toLowerCase()}`)}
            {c.kev.listed === true && pill(RED, 'In CISA KEV')}
            {c.kev.listed === false && pill(GREY, 'Not in KEV catalog')}
            {c.kev.listed === null && pill('bg-gray-500/20 text-gray-400', 'KEV status unknown')}
          </div>
          {c.conflicts?.map((x, i) => <div key={i} className="text-xs text-red-300">Conflict: {x.detail}</div>)}
          <p className="text-sm text-gray-300">{c.description ?? <span className="text-gray-500">No official description available.</span>}</p>
          {c.vendors.length > 0 && <div className="text-xs text-gray-400">Vendors named by CVE.org / NVD: {c.vendors.slice(0, 6).join(', ')}</div>}
          <div className="text-xs text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            {c.cvss.length === 0 ? <span>CVSS: not provided by any source</span> : c.cvss.map((s, i) => <span key={i}>CVSS {s.version}: <b className="text-gray-200">{s.score}</b>{s.severity ? ` ${s.severity}` : ''} <span className="text-gray-500">({s.provider}, {s.source})</span></span>)}
          </div>
          <div className="text-xs text-gray-500">Exploitation, patch and zero-day status: see the Zero-days tab; patch status {UNKNOWN} · last verified {c.lastVerifiedAt ? formatDateTime(c.lastVerifiedAt) : 'never'}{c.lastError ? ` · last error: ${c.lastError}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- Zero-days

const KIND_LABEL: Record<string, string> = {
  EXPLOITATION_OBSERVED: 'Exploitation observed', PATCH_RELEASED: 'Patch released', NO_PATCH_AVAILABLE: 'No patch available', VENDOR_AWARENESS: 'Vendor aware',
  DISCLOSURE: 'Disclosure', POC_PUBLIC: 'Public PoC', ZERO_DAY_CLAIM: 'Zero-day claim', CONTRADICTS_EXPLOITATION: 'Contradicts exploitation', CONTRADICTS_ZERO_DAY: 'Contradicts zero-day',
};
const SOURCE_TYPES: [string, string][] = [['VENDOR', 'Vendor (primary)'], ['RESEARCHER', 'Researcher (primary)'], ['GOVERNMENT', 'Government / CERT (primary)'], ['INCIDENT_REPORT', 'Incident report (primary)'], ['TECHNICAL_INVESTIGATION', 'Technical investigation (primary)'], ['NEWS', 'News (secondary)'], ['SOCIAL', 'Social (secondary)'], ['OTHER', 'Other (secondary)']];

function EvidenceForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ cve: '', kind: 'EXPLOITATION_OBSERVED', sourceType: 'VENDOR', sourceName: '', url: '', eventDate: '', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/cyberdigest/zero-days/${encodeURIComponent(f.cve.trim())}/evidence`, { kind: f.kind, sourceType: f.sourceType, sourceName: f.sourceName, url: f.url, eventDate: f.eventDate || undefined, note: f.note || undefined });
      setF({ ...f, sourceName: '', url: '', eventDate: '', note: '' });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="glass-card p-4 rounded-xl">
      <summary className="cursor-pointer text-sm text-white">Record evidence for a CVE</summary>
      <div className="grid grid-cols-2 gap-2 pt-3">
        <input className={inputCls} placeholder="CVE-2026-12345" value={f.cve} onChange={set('cve')} />
        <select className={inputCls} value={f.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className={inputCls} value={f.sourceType} onChange={set('sourceType')}>{SOURCE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className={inputCls} placeholder="Source name (e.g. Vendor PSIRT)" value={f.sourceName} onChange={set('sourceName')} />
        <input className={`${inputCls} col-span-2`} placeholder="Evidence URL (https://…)" value={f.url} onChange={set('url')} />
        <label className="text-xs text-gray-400">Date the source states <input type="date" className={`${inputCls} ml-2`} value={f.eventDate} onChange={set('eventDate')} /></label>
        <input className={inputCls} placeholder="Note (optional)" value={f.note} onChange={set('note')} />
      </div>
      <p className="text-xs text-gray-500 pt-2">Enter the date exactly as the source states it. Leave it empty if the source gives none; a date is never inferred.</p>
      <div className="pt-2 flex items-center gap-3"><button className={btnCls} disabled={busy || !f.cve || !f.sourceName || !f.url} onClick={submit}>Add evidence</button>{err && <span className="text-xs text-red-300">{err}</span>}</div>
    </details>
  );
}

function CaseCard({ c, canReview, reload }: { c: ZdCase; canReview: boolean; reload: () => void }) {
  const post = (path: string, body: object = {}) => async () => { await api.post(`/cyberdigest/zero-days/${c.cveId}/${path}`, body); reload(); };
  const [target, setTarget] = useState('UNKNOWN');
  const [stateCls, stateLabel] = ZD_STATE[c.state] ?? [GREY, c.state];
  return (
    <div className="glass-card p-4 rounded-xl space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`https://www.cve.org/CVERecord?id=${c.cveId}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-white font-semibold hover:text-cyan-300">{c.cveId}</a>
        {pill(c.publishedAsConfirmed ? RED : stateCls, c.publishedAsConfirmed ? 'Confirmed zero-day' : stateLabel)}
        {c.approvedBy && <span className="text-xs text-gray-400">approved by {c.approvedBy} {c.approvedAt ? formatDateTime(c.approvedAt) : ''}</span>}
        {c.eligibleForConfirmation && pill(AMBER, 'Evidence qualifies — awaiting analyst approval')}
      </div>
      {c.cve?.description && <p className="text-sm text-gray-300">{c.cve.description}</p>}
      {c.reasons.map((r, i) => <div key={i} className="text-xs text-gray-300">{r}</div>)}
      {c.analystReason && <div className="text-xs text-gray-400">Analyst note ({c.stateSetBy}): {c.analystReason}</div>}
      {c.conflicts.map((r, i) => <div key={i} className="text-xs text-red-300">Conflict: {r}</div>)}
      {c.missing.length > 0 && <div className="text-xs text-amber-300/90">Still needed for a confirmed zero-day: {c.missing.join('; ')}</div>}
      <div className="space-y-1 pt-1">
        {c.evidence.map((e) => (
          <div key={e.id} className={`text-xs flex flex-wrap items-center gap-x-2 ${e.retracted ? 'line-through text-gray-600' : 'text-gray-400'}`}>
            <span><span className="text-gray-200">{KIND_LABEL[e.kind] ?? e.kind}</span> · {e.eventDate ? e.eventDate.slice(0, 10) : 'date not stated'} · {e.primary ? 'primary' : 'secondary'} source:{' '}
              <Ext url={e.url} className="text-cyan-300 hover:underline">{e.sourceName}</Ext> {e.addedBy ? ` (${e.addedBy})` : null}</span>
            {e.retracted && <span className="no-underline text-gray-500">retracted: {e.retractReason}</span>}
            {canReview && !e.retracted && <ReasonAction label="Retract" danger onSubmit={async (reason) => { await api.post(`/cyberdigest/zero-days/evidence/${e.id}/retract`, { reason }); reload(); }} />}
          </div>
        ))}
      </div>
      {canReview && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {c.eligibleForConfirmation && <button className={btnCls} onClick={() => post('approve')().catch(() => undefined)}>Approve as confirmed</button>}
          {c.state === 'CONFIRMED' && <ReasonAction label="Withdraw confirmation" danger onSubmit={async (reason) => post('withdraw', { state: 'REPORTED_UNVERIFIED', reason })()} />}
          {c.state !== 'CONFIRMED' && (
            <>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputCls} !py-1 text-xs`}>
                {['REPORTED_UNVERIFIED', 'KNOWN_EXPLOITED_UNCONFIRMED', 'NOT_SUBSTANTIATED', 'UNKNOWN'].map((s) => <option key={s} value={s}>{ZD_STATE[s][1]}</option>)}
              </select>
              <ReasonAction label="Set status" onSubmit={async (reason) => post('transition', { state: target, reason })()} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ZeroDayTab({ canReview }: { canReview: boolean }) {
  const [data, setData] = useState<Record<string, ZdCase[]>>({});
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    const sections = canReview ? ['confirmed', 'known_exploited', 'review'] : ['confirmed', 'known_exploited'];
    Promise.all(sections.map((s) => api.get('/cyberdigest/zero-days', { params: { section: s } }).then((r) => [s, r.data.items as ZdCase[]] as const)))
      .then((e) => { setData(Object.fromEntries(e)); setErr(''); })
      .catch(() => setErr('Could not load zero-day cases.'));
  }, [canReview]);
  useEffect(() => { load(); }, [load]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState('');
  const eligible = (data.known_exploited ?? []).concat(data.review ?? []).filter((c) => c.eligibleForConfirmation);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approveSelected = async () => {
    try {
      const r = await api.post('/cyberdigest/zero-days/bulk-approve', { cveIds: [...picked] });
      const ok = r.data.results.filter((x: any) => x.ok).length;
      setBulkMsg(`${ok} of ${r.data.results.length} approved.${r.data.results.some((x: any) => !x.ok) ? ' Those refused did not meet the evidence rules.' : ''}`);
      setPicked(new Set());
    } catch (e) { setBulkMsg(errMsg(e)); }
    load();
  };
  if (err) return <div className="text-red-300 text-sm">{err}</div>;
  const sec = (key: string, title: string, note: string, empty: string) => (
    <section className="space-y-2">
      <h2 className="text-white font-medium">{title} <span className="text-gray-500 text-sm">({data[key]?.length ?? 0})</span></h2>
      <p className="text-xs text-gray-400">{note}</p>
      {(data[key] ?? []).length === 0 ? <div className="glass-card p-4 rounded-xl text-sm text-gray-500">{empty}</div> : data[key].map((c) => (
        <div key={c.cveId} className="flex items-start gap-2">
          {canReview && c.eligibleForConfirmation && <input type="checkbox" className="mt-5" aria-label={`Select ${c.cveId}`} checked={picked.has(c.cveId)} onChange={() => toggle(c.cveId)} />}
          <div className="flex-1"><CaseCard c={c} canReview={canReview} reload={load} /></div>
        </div>
      ))}
    </section>
  );
  return (
    <div className="space-y-6">
      {canReview && <EvidenceForm onDone={load} />}
      {canReview && eligible.length > 0 && (
        <div className="glass-card p-3 rounded-xl flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-300">{eligible.length} case(s) have evidence that qualifies for confirmation.</span>
          <button className={btnCls} onClick={() => setPicked(new Set(eligible.map((c) => c.cveId)))}>Select all</button>
          <button className={btnCls} disabled={!picked.size} onClick={approveSelected}>Approve selected ({picked.size})</button>
          {bulkMsg && <span className="text-xs text-cyan-300">{bulkMsg}</span>}
        </div>
      )}
      {sec('confirmed', 'Confirmed zero-day exploitation', 'Only cases with qualifying primary evidence and a recorded analyst approval appear here.', 'No confirmed zero-days.')}
      {sec('known_exploited', 'Known exploited — zero-day status unconfirmed', 'Exploitation is established (for example CISA KEV). The evidence does not show it began before a fix existed, so these are not called zero-days.', 'None.')}
      {canReview && sec('review', 'Review queue — reported, unsubstantiated or unknown', 'Not published as fact. A publisher reporting a zero-day lands here until primary evidence is recorded.', 'Nothing to review.')}
    </div>
  );
}

// ----------------------------------------------------------------------------- Verification & health

function HealthTab({ canManage }: { canManage: boolean }) {
  const [h, setH] = useState<Health | null>(null);
  const [v, setV] = useState<Verification | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    Promise.all([api.get('/cyberdigest/health'), api.get('/cyberdigest/verification')])
      .then(([a, b]) => { setH(a.data); setV(b.data); setErr(''); }).catch(() => setErr('Could not load verification status.'));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (err) return <div className="text-red-300 text-sm">{err}</div>;
  if (!h || !v) return <div className="text-gray-400">Loading…</div>;
  const bad = h.sources.filter((s) => s.enabled && s.health !== 'HEALTHY');
  const run = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); setMsg(typeof r?.data?.error === 'string' ? `${ok}: ${r.data.error}` : ok); } catch (e) { setMsg(errMsg(e)); } load(); };
  const count = (label: string, n: number) => <div className="glass-card p-3 rounded-xl"><div className="text-xl text-white">{n}</div><div className="text-xs text-gray-400">{label}</div></div>;
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-lg text-sm ${h.allEnabledSourcesHealthy ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
        {h.allEnabledSourcesHealthy ? 'Every enabled source succeeded recently.' : `${bad.length} enabled source(s) are not confirmed healthy. Content may be incomplete or out of date.`}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {count('stories pending verification', v.pendingStories)}
        {count('stories with conflicting evidence', v.conflictingStories.length)}
        {count('CVEs awaiting NVD enrichment', v.cvesAwaitingNvd)}
        {count('CVEs CVE.org could not be reached for', v.cvesUnavailable)}
        {count('zero-day claims unverified / unknown', v.zeroDayClaimsUnverified + v.zeroDayStatusUnknown)}
      </div>

      {(v.conflictingStories.length > 0 || v.cveConflicts.length > 0) && (
        <div className="glass-card p-4 rounded-xl space-y-1">
          <div className="text-white text-sm font-medium">Conflicting evidence</div>
          {v.conflictingStories.map((s) => <div key={s.id} className="text-xs text-red-300"><Ext url={s.url} className="underline">{s.title}</Ext> — {s.stateNote}</div>)}
          {v.cveConflicts.map((c) => c.conflicts.map((x, i) => <div key={`${c.cveId}${i}`} className="text-xs text-red-300">{c.cveId}: {x.detail}</div>))}
        </div>
      )}
      {(v.rejectedStories.length > 0 || v.corrections.length > 0) && (
        <div className="glass-card p-4 rounded-xl space-y-1">
          <div className="text-white text-sm font-medium">Rejected claims and corrections</div>
          {v.rejectedStories.map((s) => <div key={s.id} className="text-xs text-gray-300">Rejected: {s.title} — {s.stateNote}</div>)}
          {v.corrections.map((c) => <div key={c.id} className="text-xs text-gray-400">{formatDateTime(c.createdAt)} · {c.entityType === 'STORY' ? 'story' : c.entityId} · {c.event.toLowerCase().replace('_', ' ')}{c.detail?.reason ? ` — ${c.detail.reason}` : ''}</div>)}
        </div>
      )}

      {msg && <div className="text-xs text-cyan-300">{msg}</div>}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-800 text-left text-gray-400">
            <th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Role</th><th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Last success</th><th className="p-3 font-medium">Last error</th>{canManage && <th className="p-3 font-medium">Manage</th>}
          </tr></thead>
          <tbody>
            {h.sources.map((s) => (
              <tr key={s.slug} className="border-t border-gray-800">
                <td className="p-3"><Ext url={s.website} className="text-white hover:text-cyan-300">{s.name}</Ext></td>
                <td className="p-3 text-gray-300">{s.trustRole === 'AUTHORITATIVE' ? 'Authoritative' : 'Discovery'}</td>
                <td className="p-3">{pill(HEALTH_CLS[s.health], s.health.toLowerCase())}{s.consecutiveFailures > 0 && <span className="ml-2 text-xs text-gray-500">{s.consecutiveFailures} failures</span>}</td>
                <td className="p-3 text-gray-300">{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : <span className="text-gray-500">never</span>}</td>
                <td className="p-3 text-xs text-red-300/90">{s.lastError ?? ''}</td>
                {canManage && (
                  <td className="p-3 space-x-2 whitespace-nowrap">
                    <button className={btnCls} onClick={() => run(() => api.patch(`/cyberdigest/sources/${s.slug}`, { enabled: !s.enabled }), `${s.name} ${s.enabled ? 'disabled' : 'enabled'}`)}>{s.enabled ? 'Disable' : 'Enable'}</button>
                    {(s.type === 'NEWS_RSS' || s.type === 'RESEARCH_RSS' || s.type === 'KEV_JSON') && <button className={btnCls} onClick={() => run(() => api.post(`/cyberdigest/sources/${s.slug}/poll`), `Polled ${s.name}`)}>Poll now</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">CVE.org and NVD are queried per CVE, so their status reflects the most recent lookups. Checked {formatDateTime(h.checkedAt)}.</p>
    </div>
  );
}

// ----------------------------------------------------------------------------- Daily digest

type DGroup = {
  groupKey: string; headline: string; primaryStoryId: string; state: 'ATTRIBUTED' | 'VERIFIED'; summary: string | null; categories: string[]; cves: string[];
  zeroDay: { cveId: string; state: string }[]; rankReasons: string[]; sources: { storyId: string; publisher: string; url: string; publishedAt: string | null; state: string }[];
};
type DContent = {
  date: string; windowStart: string; windowEnd: string; executiveSummary: { lines: string[]; nothingQualified: boolean };
  news: DGroup[]; research: { portswigger: DGroup[]; cloudflare: DGroup[] };
  cves: { cveId: string; description: string | null; cvss: Cvss[]; kevListed: boolean | null; nvdEnrichment: string; change: string; changes: string[] }[];
  kev: { cveId: string; vendorProject: string; product: string; name: string; dateAdded: string; dueDate: string | null; ransomwareUse: string; shortDescription: string }[];
  zeroDays: { cveId: string; description: string | null; approvedBy: string | null; approvedAt: string | null; evidence: { kind: string; sourceName: string; url: string; eventDate: string | null; primary: boolean }[] }[];
  corrections: { kind: string; ref: string; text: string; at: string }[];
  limitations: string[]; omitted: { news: number; research: number; cves: number; kev: number }; rankPolicy: { reason: string }[];
};
type DMeta = { date: string; status: 'SHADOW' | 'PUBLISHED' | 'WITHDRAWN'; generatedAt: string; windowStart: string; windowEnd: string; publishedAt: string | null; withdrawReason: string | null; generatedBy: string; counts?: Record<string, number> };
type DView = { meta: DMeta; content: DContent | null; overlay: { storyFlags: Record<string, { state: string; note: string | null }>; zeroDayFlags: Record<string, { state: string }> } | null };

function GroupCard({ g, flags }: { g: DGroup; flags: DView['overlay'] }) {
  const flagged = g.sources.map((s) => flags?.storyFlags[s.storyId]).filter(Boolean) as { state: string; note: string | null }[];
  return (
    <div className="glass-card p-4 rounded-xl space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-white font-medium">{g.headline}</div>
        {pill(GREEN, 'Reported by publisher')}
      </div>
      {flagged.map((f, i) => <div key={i} className="text-xs text-red-300">Corrected after publication: {f.state === 'REJECTED' ? 'a source story was rejected' : 'evidence now conflicts'}{f.note ? ` — ${f.note}` : ''}</div>)}
      {g.summary && <p className="text-sm text-gray-300">{g.summary}</p>}
      <div className="flex flex-wrap gap-1 items-center">
        {g.categories.map((c) => <span key={c} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-300">{c}</span>)}
        {g.cves.map((c) => <span key={c} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-cyan-300">{c}</span>)}
        {g.zeroDay.map((z) => pill(RED, `${z.cveId}: confirmed zero-day`, `zd-${z.cveId}`))}
      </div>
      {g.rankReasons.length > 0 && <div className="text-xs text-gray-500">Listed high because it {g.rankReasons.join('; ')}.</div>}
      <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
        {g.sources.map((s) => <Ext key={s.storyId} url={s.url} className="text-cyan-300 hover:underline">{s.publisher}{s.publishedAt ? ` · ${formatDateTime(s.publishedAt)}` : ''}</Ext>)}
      </div>
    </div>
  );
}

function DigestTab({ canReview }: { canReview: boolean }) {
  const [list, setList] = useState<DMeta[] | null>(null);
  const [date, setDate] = useState('');
  const [view, setView] = useState<DView | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ stale: boolean; ageHours: number | null; publishedFor?: string; today: string; pipelineEnabled: boolean } | null>(null);
  const loadList = useCallback(() => Promise.all([api.get('/cyberdigest/digests'), api.get('/cyberdigest/digests/latest')]).then(([r, l]) => { setList(r.data.items); setFresh(l.data); setDate((d) => d || l.data.publishedFor || r.data.items[0]?.date || ''); }).catch(() => setErr('Could not load digests.')), []);
  useEffect(() => { loadList(); }, [loadList]);
  const loadOne = useCallback(() => {
    if (!date) { setView(null); return; }
    api.get(`/cyberdigest/digests/${date}`).then((r) => { setView(r.data); setErr(''); }).catch(() => setErr('Could not load that digest.'));
  }, [date]);
  useEffect(() => { loadOne(); }, [loadOne]);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setErr(''); try { await fn(); await loadList(); loadOne(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };

  if (err && !list) return <div className="text-red-300 text-sm">{err}</div>;
  if (!list) return <div className="text-gray-400">Loading…</div>;
  const m = view?.meta;
  const c = view?.content;
  const section = (title: string, n: number, body: React.ReactNode, empty: string) => (
    <section className="space-y-2">
      <h2 className="text-white font-medium">{title} <span className="text-gray-500 text-sm">({n})</span></h2>
      {n === 0 ? <div className="glass-card p-3 rounded-xl text-sm text-gray-500">{empty}</div> : body}
    </section>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} disabled={!list.length}>
          {list.length === 0 && <option value="">No digests yet</option>}
          {list.map((d) => <option key={d.date} value={d.date}>{d.date}{d.status !== 'PUBLISHED' ? ` (${d.status.toLowerCase()})` : ''}</option>)}
        </select>
        {canReview && <button className={btnCls} disabled={busy} onClick={() => run(() => api.post('/cyberdigest/digests/generate'))}>Build a held copy now (optional)</button>}
        {err && <span className="text-xs text-red-300">{err}</span>}
      </div>
      {list.length === 0 && <div className="glass-card p-6 rounded-xl text-gray-400">No digest has been published yet. The first one is created automatically after the configured daily time.</div>}
      {fresh?.stale && fresh.publishedFor && (
        <div className="p-3 rounded-lg text-sm bg-amber-500/10 text-amber-300">
          Today&rsquo;s digest has not been published yet. The newest one is for {fresh.publishedFor}, published about {fresh.ageHours != null ? (fresh.ageHours >= 48 ? `${Math.round(fresh.ageHours / 24)} days` : `${Math.round(fresh.ageHours)} hours`) : 'some time'} ago.
          {!fresh.pipelineEnabled && ' Automatic processing is currently paused by an administrator.'}
        </div>
      )}

      {m && (
        <div className="space-y-2">
          {m.status === 'SHADOW' && <div className="p-3 rounded-lg text-sm bg-amber-500/10 text-amber-300">Held digest: visible to administrators only and nobody has been notified. Publishing is normally automatic; this one was held (hold mode, or a publication check did not pass).</div>}
          {m.status === 'WITHDRAWN' && <div className="p-3 rounded-lg text-sm bg-red-500/10 text-red-300">This digest was withdrawn{m.withdrawReason ? `: ${m.withdrawReason}` : '.'}</div>}
          <div className="text-xs text-gray-400">Covers {formatDateTime(m.windowStart)} to {formatDateTime(m.windowEnd)} · generated {formatDateTime(m.generatedAt)} by {m.generatedBy}{m.publishedAt ? ` · published ${formatDateTime(m.publishedAt)}` : ''}</div>
          {canReview && m.status !== 'WITHDRAWN' && (
            <div className="flex flex-wrap gap-2">
              {m.status === 'SHADOW' && <button className={btnCls} disabled={busy} onClick={() => run(() => api.post(`/cyberdigest/digests/${m.date}/publish`))}>Publish this held digest</button>}
              <ReasonAction label="Withdraw digest" danger onSubmit={async (reason) => { await api.post(`/cyberdigest/digests/${m.date}/withdraw`, { reason }); await loadList(); loadOne(); }} />
            </div>
          )}
        </div>
      )}

      {c && (
        <div className="space-y-6">
          <section className="glass-card p-4 rounded-xl space-y-1">
            <h2 className="text-white font-medium">Executive summary</h2>
            {c.executiveSummary.lines.map((l, i) => <p key={i} className="text-sm text-gray-300">{l}</p>)}
          </section>

          {c.corrections.length > 0 && (
            <section className="glass-card p-4 rounded-xl space-y-1 border border-red-500/30">
              <h2 className="text-white font-medium">Corrections to earlier items</h2>
              {c.corrections.map((x, i) => <p key={i} className="text-sm text-red-300">{x.text}</p>)}
            </section>
          )}

          {section('Confirmed zero-day exploitation', c.zeroDays.length, c.zeroDays.map((z) => (
            <div key={z.cveId} className="glass-card p-4 rounded-xl space-y-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-white font-semibold">{z.cveId}</span>{pill(RED, 'Confirmed zero-day')}<span className="text-xs text-gray-400">approved by {z.approvedBy ?? 'unknown'} {z.approvedAt ? formatDateTime(z.approvedAt) : ''}</span></div>
              {view?.overlay?.zeroDayFlags[z.cveId] && <div className="text-xs text-red-300">Corrected after publication: this is no longer a confirmed zero-day (now {ZD_STATE[view.overlay.zeroDayFlags[z.cveId].state]?.[1] ?? view.overlay.zeroDayFlags[z.cveId].state}).</div>}
              {z.description && <p className="text-sm text-gray-300">{z.description}</p>}
              {z.evidence.map((e, i) => <div key={i} className="text-xs text-gray-400">{KIND_LABEL[e.kind] ?? e.kind} · {e.eventDate ? e.eventDate.slice(0, 10) : 'date not stated'} · {e.primary ? 'primary' : 'secondary'}: <Ext url={e.url} className="text-cyan-300 hover:underline">{e.sourceName}</Ext></div>)}
            </div>
          )), 'No confirmed zero-day exploitation alerts.')}

          {section('New CISA KEV additions', c.kev.length, c.kev.map((k) => (
            <div key={k.cveId} className="glass-card p-3 rounded-xl text-sm space-y-0.5">
              <div className="flex flex-wrap items-center gap-2"><span className="text-white font-semibold">{k.cveId}</span><span className="text-gray-300">{k.vendorProject} {k.product}</span>{k.ransomwareUse === 'Known' && pill(RED, 'Known ransomware use')}</div>
              <div className="text-xs text-gray-400">{k.name} · added to KEV {k.dateAdded}{k.dueDate ? ` · CISA due date ${k.dueDate}` : ''}. KEV listing means CISA has evidence of exploitation; it does not establish a zero-day.</div>
            </div>
          )), 'No new KEV additions.')}

          {section('CVEs newly verified or updated', c.cves.length, c.cves.map((v) => (
            <div key={v.cveId} className="glass-card p-3 rounded-xl text-sm space-y-0.5">
              <div className="flex flex-wrap items-center gap-2"><a href={`https://www.cve.org/CVERecord?id=${v.cveId}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-white font-semibold hover:text-cyan-300">{v.cveId}</a>{pill(GREEN, v.change === 'new' ? 'New' : 'Updated')}{v.kevListed && pill(RED, 'In CISA KEV')}{v.nvdEnrichment !== 'ENRICHED' && pill(AMBER, 'NVD enrichment pending')}</div>
              {v.description && <p className="text-gray-300">{v.description}</p>}
              <div className="text-xs text-gray-400 flex flex-wrap gap-x-3">{v.cvss.length === 0 ? <span>CVSS: not provided by any source</span> : v.cvss.map((s, i) => <span key={i}>CVSS {s.version}: <b className="text-gray-200">{s.score}</b>{s.severity ? ` ${s.severity}` : ''} ({s.provider})</span>)}</div>
            </div>
          )), 'No new or updated CVE records.')}

          {section('Cybersecurity news', c.news.length, <>{c.news.map((g) => <GroupCard key={g.groupKey} g={g} flags={view!.overlay} />)}{c.omitted.news > 0 && <p className="text-xs text-gray-500">{c.omitted.news} more topic group(s) are not shown. Find them under the News tab.</p>}</>, 'No qualifying news.')}
          {section('PortSwigger research', c.research.portswigger.length, c.research.portswigger.map((g) => <GroupCard key={g.groupKey} g={g} flags={view!.overlay} />), 'No new PortSwigger posts.')}
          {section('Cloudflare security and infrastructure', c.research.cloudflare.length, c.research.cloudflare.map((g) => <GroupCard key={g.groupKey} g={g} flags={view!.overlay} />), 'No new Cloudflare posts.')}

          <section className="glass-card p-4 rounded-xl space-y-1 border border-amber-500/30">
            <h2 className="text-white font-medium">What this digest does not cover</h2>
            {c.limitations.map((l, i) => <p key={i} className="text-sm text-amber-200/90">{l}</p>)}
          </section>
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer">How items are ordered</summary>
            <p className="pt-1">Items rank by these reasons, strongest first: {c.rankPolicy.map((p) => p.reason).join('; ')}. Ties go to the more recent item. No numeric score is calculated.</p>
          </details>
        </div>
      )}
      {m?.status === 'WITHDRAWN' && !c && <div className="glass-card p-4 rounded-xl text-sm text-gray-400">The content of a withdrawn digest is hidden.</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------- page

// ----------------------------------------------------------------------------- Administration (administrators only)

type Cfg = { moduleEnabledForNonAdmins: boolean; pipelineEnabled: boolean; publishTime: string; timezone: string; publishMode: 'AUTO' | 'HOLD'; minDiscoveryCoveragePct: number; retentionDays: number; jobRetryBackoffMinutes: number; linkHosts: string[] };
type JobRow = { job: string; lastSuccessAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null; failureStreak: number; failedLast24h: number };

function AdminTab() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [draft, setDraft] = useState<Partial<Cfg>>({});
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [msg, setMsg] = useState('');
  const [host, setHost] = useState('');
  const [src, setSrc] = useState({ name: '', endpoint: '', website: '' });
  const load = useCallback(() => {
    Promise.all([api.get('/cyberdigest/admin/config'), api.get('/cyberdigest/admin/jobs')]).then(([c, j]) => { setCfg(c.data); setJobs(j.data.jobs); }).catch(() => setMsg('Could not load settings.'));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const save = async (patch: Partial<Cfg>, ok: string) => { try { await api.patch('/cyberdigest/admin/config', patch); setDraft({}); setMsg(ok); } catch (e) { setMsg(errMsg(e)); } load(); };
  const call = async (fn: () => Promise<any>, ok: string) => { try { await fn(); setMsg(ok); } catch (e) { setMsg(errMsg(e)); } load(); };
  if (!cfg) return <div className="text-gray-400">{msg || 'Loading…'}</div>;
  const v = { ...cfg, ...draft };
  const field = (label: string, node: React.ReactNode, hint?: string) => <label className="block text-xs text-gray-400 space-y-1"><span>{label}</span>{node}{hint && <span className="block text-gray-500">{hint}</span>}</label>;
  return (
    <div className="space-y-5">
      {msg && <div className="text-xs text-cyan-300">{msg}</div>}
      <section className="glass-card p-4 rounded-xl space-y-3">
        <h2 className="text-white font-medium">Availability and processing</h2>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-start gap-2 text-sm text-gray-200 max-w-sm"><input type="checkbox" className="mt-1" checked={cfg.moduleEnabledForNonAdmins} onChange={(e) => save({ moduleEnabledForNonAdmins: e.target.checked }, e.target.checked ? 'Cyberdigest is now available to all roles.' : 'Cyberdigest is now hidden from every non-administrator.')} /><span>Available to non-administrators<span className="block text-xs text-gray-500">Off: only administrators can open Cyberdigest or call its API. Takes effect on the next request.</span></span></label>
          <label className="flex items-start gap-2 text-sm text-gray-200 max-w-sm"><input type="checkbox" className="mt-1" checked={cfg.pipelineEnabled} onChange={(e) => save({ pipelineEnabled: e.target.checked }, e.target.checked ? 'Processing resumed.' : 'Processing paused: nothing is ingested, verified or published.')} /><span>Processing pipeline running<span className="block text-xs text-gray-500">Off: no collecting, verifying or publishing. Existing data and digests stay; readers keep seeing the last published digest, dated.</span></span></label>
        </div>
      </section>

      <section className="glass-card p-4 rounded-xl space-y-3">
        <h2 className="text-white font-medium">Daily publishing</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {field('Publish time (24h)', <input className={inputCls} value={v.publishTime} onChange={(e) => setDraft({ ...draft, publishTime: e.target.value })} placeholder="08:00" />)}
          {field('Time zone', <input className={inputCls} value={v.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} placeholder="Asia/Kolkata" />, 'IANA name, e.g. Asia/Kolkata')}
          {field('Minimum healthy news sources (%)', <input type="number" className={inputCls} value={v.minDiscoveryCoveragePct} onChange={(e) => setDraft({ ...draft, minDiscoveryCoveragePct: Number(e.target.value) })} />, 'Below this, the previous digest stays up')}
          {field('Keep digests (days)', <input type="number" className={inputCls} value={v.retentionDays} onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })} />)}
          {field('Retry delay after a failure (min)', <input type="number" className={inputCls} value={v.jobRetryBackoffMinutes} onChange={(e) => setDraft({ ...draft, jobRetryBackoffMinutes: Number(e.target.value) })} />, 'Doubles per failure, up to 60')}
        </div>
        <button className={btnCls} disabled={!Object.keys(draft).length} onClick={() => save(draft, 'Settings saved.')}>Save schedule settings</button>
      </section>

      <section className="glass-card p-4 rounded-xl space-y-2">
        <h2 className="text-white font-medium">Approved link destinations</h2>
        <p className="text-xs text-gray-400">Only these exact hostnames are clickable in Cyberdigest. Anything else shows as plain text. <code>blog.example.com</code> does not allow <code>example.com</code>. Link shorteners and IP addresses are refused.</p>
        <div className="flex flex-wrap gap-2">
          {cfg.linkHosts.map((h) => <span key={h} className="px-2 py-1 rounded bg-gray-800 text-xs text-gray-200 inline-flex items-center gap-1">{h}<button aria-label={`Remove ${h}`} className="text-red-300" onClick={() => call(() => api.delete(`/cyberdigest/admin/link-hosts/${encodeURIComponent(h)}`), `${h} removed.`)}>×</button></span>)}
        </div>
        <div className="flex gap-2"><input className={`${inputCls} w-64`} placeholder="www.example.com" value={host} onChange={(e) => setHost(e.target.value)} /><button className={btnCls} disabled={!host} onClick={() => call(async () => { await api.post('/cyberdigest/admin/link-hosts', { host }); setHost(''); }, 'Hostname added.')}>Allow hostname</button></div>
      </section>

      <section className="glass-card p-4 rounded-xl space-y-2">
        <h2 className="text-white font-medium">Add a news feed</h2>
        <p className="text-xs text-gray-400">One step: the server starts collecting this feed and users may click through to its website. The feed host is checked against the public internet at every connection (private and internal addresses are refused).</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className={inputCls} placeholder="Name" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} />
          <input className={inputCls} placeholder="Feed URL (https://…/feed)" value={src.endpoint} onChange={(e) => setSrc({ ...src, endpoint: e.target.value })} />
          <input className={inputCls} placeholder="Website (optional)" value={src.website} onChange={(e) => setSrc({ ...src, website: e.target.value })} />
        </div>
        <button className={btnCls} disabled={!src.name || !src.endpoint} onClick={() => call(async () => { await api.post('/cyberdigest/admin/sources', { name: src.name, endpoint: src.endpoint, website: src.website || undefined }); setSrc({ name: '', endpoint: '', website: '' }); }, 'Feed added.')}>Add feed</button>
      </section>

      <section className="glass-card rounded-xl overflow-hidden">
        <div className="p-4 pb-2"><h2 className="text-white font-medium">Background jobs</h2><p className="text-xs text-gray-400">Failed jobs retry by themselves with growing delays.</p></div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-800 text-left text-gray-400"><th className="p-3 font-medium">Job</th><th className="p-3 font-medium">Last success</th><th className="p-3 font-medium">Last run</th><th className="p-3 font-medium">Failing in a row</th><th className="p-3 font-medium">Last error</th></tr></thead>
          <tbody>{jobs.map((j) => (
            <tr key={j.job} className="border-t border-gray-800">
              <td className="p-3 text-white">{j.job}</td>
              <td className="p-3 text-gray-300">{j.lastSuccessAt ? formatDateTime(j.lastSuccessAt) : <span className="text-gray-500">never</span>}</td>
              <td className="p-3 text-gray-300">{j.lastRunAt ? `${formatDateTime(j.lastRunAt)} · ${j.lastStatus?.toLowerCase()}` : <span className="text-gray-500">never</span>}</td>
              <td className="p-3">{j.failureStreak > 0 ? pill(RED, String(j.failureStreak)) : <span className="text-gray-500">0</span>}</td>
              <td className="p-3 text-xs text-red-300/90">{j.lastError ?? ''}</td>
            </tr>))}</tbody>
        </table>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------- page

export default function CyberdigestPage() {
  const { user } = useAuth();
  const admin = user?.role === 'ADMIN';
  const tabs = admin ? TABS : TABS.filter((t) => t !== 'Verification & source health' && t !== 'Administration');
  const [tab, setTab] = useState<Tab>('Daily digest');
  const [blocked, setBlocked] = useState(false);
  // If an administrator switches Cyberdigest off while this page is open, the next poll shows the notice and clears what was loaded.
  useEffect(() => {
    if (admin) return;
    const ask = () => api.get('/cyberdigest/access').then(() => setBlocked(false)).catch((e) => e?.response?.status === 403 && setBlocked(true));
    ask();
    const t = setInterval(ask, 30_000);
    return () => clearInterval(t);
  }, [admin]);
  if (blocked) return <div className="p-6 max-w-3xl mx-auto"><div className="glass-card p-6 rounded-xl text-gray-300">Cyberdigest is not available to your role right now.</div></div>;
  const canReview = !!admin;
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Cyberdigest</h1>
        <p className="text-sm text-gray-400 mt-1">Cybersecurity intelligence with sources and verification status. Every item shows its source and verification status.</p>
      </div>
      <div className="flex gap-1 border-b border-gray-800">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t ? 'border-cyan-400 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Daily digest' && <DigestTab canReview={canReview} />}
      {tab === 'News' && <NewsTab canReview={canReview} />}
      {tab === 'CVEs' && <CvesTab />}
      {tab === 'Zero-days' && <ZeroDayTab canReview={canReview} />}
      {tab === 'Verification & source health' && admin && <HealthTab canManage={canReview} />}
      {tab === 'Administration' && admin && <AdminTab />}
    </div>
  );
}
