'use client';

import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '@/contexts/auth-context';

type ScopeRow = { ip: string; domainHostname: string; purpose: string };
type ParseResult = { rows: ScopeRow[]; errors: { line: number; value: string; reason: string }[]; duplicates: number };

/**
 * Network Scope import (.txt: one IP per line · .csv/.xlsx: IP, Domain, Purpose). The server validates; valid rows are
 * appended to the caller's table (nothing is saved until the project form is), bad lines are listed, repeats are skipped.
 */
export function ScopeImportButton({ rows, onImport }: { rows: ScopeRow[]; onImport: (added: ScopeRow[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' | 'error'; details?: string[] } | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('existing', JSON.stringify(rows.filter((r) => r.ip.trim())));
      const { data } = await api.post<ParseResult>('/projects/network-scope/parse', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (data.rows.length) onImport(data.rows);
      const parts = [`${data.rows.length} imported`];
      if (data.duplicates) parts.push(`${data.duplicates} duplicate${data.duplicates === 1 ? '' : 's'} skipped`);
      if (data.errors.length) parts.push(`${data.errors.length} invalid`);
      setMessage({
        text: parts.join(', '),
        tone: data.errors.length ? 'warn' : 'ok',
        details: data.errors.slice(0, 10).map((x) => `Line ${x.line}: ${x.value || '(empty)'} — ${x.reason}`),
      });
    } catch (err: any) {
      const m = err.response?.data?.message;
      setMessage({ text: Array.isArray(m) ? m.join(', ') : m || 'Could not read the file', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept=".txt,.csv,.xlsx" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Import from .txt (one IP per line) or .csv / .xlsx (IP, Domain, Purpose)"
        className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import'}
      </button>
      <span className="group relative inline-flex">
        <button type="button" aria-label="Supported import formats" className="rounded text-gray-500 hover:text-gray-300 focus-visible:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
          <Info className="w-3.5 h-3.5" />
        </button>
        <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 hidden w-72 rounded-lg border border-gray-700 bg-gray-900 p-3 text-left text-xs leading-relaxed text-gray-300 shadow-xl group-hover:block group-focus-within:block">
          <span className="block font-medium text-white">Supported formats</span>
          <span className="mt-1 block"><code className="text-emerald-400">.txt</code> — one IP address or CIDR range per line (e.g. 10.0.0.5 or 10.0.0.0/24).</span>
          <span className="mt-1 block"><code className="text-emerald-400">.csv</code> / <code className="text-emerald-400">.xlsx</code> — first row must be the header <code className="text-emerald-400">IP | Domain | Purpose</code>; only IP is required.</span>
          <span className="mt-1 block text-gray-500">Other layouts are not imported. Invalid lines are listed and repeated IP + Domain pairs are skipped.</span>
        </span>
      </span>
      {message && (
        <div className="basis-full" role="status">
          <p className={`text-xs ${message.tone === 'ok' ? 'text-emerald-400' : message.tone === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>{message.text}</p>
          {message.details?.map((d, i) => <p key={i} className="text-xs text-gray-500">{d}</p>)}
        </div>
      )}
    </>
  );
}
