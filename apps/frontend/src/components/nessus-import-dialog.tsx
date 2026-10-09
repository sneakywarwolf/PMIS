'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import { api } from '@/contexts/auth-context';

type Status = 'ready' | 'new-library-entry' | 'needs-approval' | 'awaiting-approval' | 'duplicate';

interface Item {
  key: string;
  name: string;
  severity: string;
  cvssScore: number | null;
  cvssVector: string | null;
  cveId: string | null;
  affected: string[];
  status: Status;
}

interface ImportResult {
  created: { key: string; name: string }[];
  requested: { key: string; name: string }[];
  skipped: { key: string; name: string; reason: string }[];
  failed: { key: string; name: string; error: string }[];
}

const severityColors: Record<string, string> = {
  Critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  High: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Info: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const STATUS: Record<Status, { label: string; cls: string; hint: string; selectable: boolean }> = {
  ready: { label: 'In library', cls: 'text-emerald-400', hint: 'Matches an approved Vulnerability DB entry. The finding is added as a draft.', selectable: true },
  'new-library-entry': { label: 'Adds to library', cls: 'text-blue-400', hint: 'No library match. As Admin, a library entry is created, then the finding is added.', selectable: true },
  'needs-approval': { label: 'Needs approval', cls: 'text-amber-400', hint: 'No library match. A request is sent for approval; add the finding once it is approved.', selectable: true },
  'awaiting-approval': { label: 'Awaiting approval', cls: 'text-gray-500', hint: 'A library request for this finding is already pending.', selectable: false },
  duplicate: { label: 'Already added', cls: 'text-gray-500', hint: 'This project already has this finding.', selectable: false },
};

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];

export function NessusImportDialog({
  projectId,
  file,
  onClose,
  onImported,
}: {
  projectId: string;
  file: File;
  onClose: () => void;
  onImported: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const body = () => {
    const form = new FormData();
    form.append('projectId', projectId);
    form.append('file', file);
    return form;
  };

  useEffect(() => {
    api
      .post('/findings/nessus/preview', body(), { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => setItems(res.data.items))
      .catch((e) => setError(e.response?.data?.message || 'Could not read this file.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !importing && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => {
    if (result) onImported();
    onClose();
  };

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          (!severity || i.severity === severity) &&
          (!query || `${i.name} ${i.cveId ?? ''} ${i.key}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [items, query, severity],
  );
  const selectableVisible = visible.filter((i) => STATUS[i.status].selectable);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const needsApproval = (items ?? []).filter((i) => selected.has(i.key) && i.status === 'needs-approval').length;

  const runImport = async () => {
    setImporting(true);
    setError('');
    try {
      const form = body();
      form.append('selected', JSON.stringify([...selected]));
      const res = await api.post('/findings/nessus/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(res.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nessus-title"
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="min-w-0">
            <h2 id="nessus-title" className="text-lg font-semibold text-white">Import Nessus findings</h2>
            <p className="text-xs text-gray-500 truncate">{file.name}</p>
          </div>
          <button onClick={close} disabled={importing} aria-label="Close" className="text-gray-400 hover:text-white disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-4 overflow-y-auto text-sm">
            <p className="text-white">
              {result.created.length} finding{result.created.length === 1 ? '' : 's'} added
              {result.requested.length > 0 && `, ${result.requested.length} library request${result.requested.length === 1 ? '' : 's'} sent for approval`}
              {result.skipped.length > 0 && `, ${result.skipped.length} skipped`}
              {result.failed.length > 0 && `, ${result.failed.length} failed`}.
            </p>
            {result.requested.length > 0 && (
              <p className="text-amber-400">Requested findings are added once approvers approve their library entries. Import the file again afterwards to add them.</p>
            )}
            {[...result.skipped.map((s) => ({ ...s, msg: s.reason })), ...result.failed.map((f) => ({ ...f, msg: f.error }))].map((r) => (
              <p key={r.key} className="text-gray-400">
                <span className="text-gray-300">{r.name}</span>: {r.msg}
              </p>
            ))}
          </div>
        ) : error && !items ? (
          <p role="alert" className="m-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
        ) : !items ? (
          <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-800">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, CVE, plugin ID"
                  aria-label="Search findings"
                  className="pl-9 pr-3 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white w-64"
                />
              </div>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity" className="px-3 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white">
                <option value="">All severities</option>
                {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <button
                onClick={() => setSelected((p) => new Set([...p, ...selectableVisible.map((i) => i.key)]))}
                className="text-sm text-emerald-400 hover:text-emerald-300"
              >
                Select shown ({selectableVisible.length})
              </button>
              <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white">Clear</button>
              <span className="ml-auto text-xs text-gray-500">{items.length} found · {selected.size} selected</span>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                  <tr className="text-left">
                    <th className="p-3 w-10" />
                    <th className="p-3 font-medium">Finding</th>
                    <th className="p-3 font-medium">Severity</th>
                    <th className="p-3 font-medium">CVSS</th>
                    <th className="p-3 font-medium">Affected</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => {
                    const st = STATUS[i.status];
                    return (
                      <tr key={i.key} className={`border-b border-gray-800 ${st.selectable ? 'hover:bg-white/5' : 'opacity-60'}`}>
                        <td className="p-3">
                          <input type="checkbox" checked={selected.has(i.key)} disabled={!st.selectable} onChange={() => toggle(i.key)} aria-label={`Select ${i.name}`} />
                        </td>
                        <td className="p-3">
                          <p className="text-white">{i.name}</p>
                          <p className="text-xs text-gray-500 font-mono">Plugin {i.key}{i.cveId && ` · ${i.cveId}`}</p>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${severityColors[i.severity] || severityColors.Info}`}>{i.severity}</span>
                        </td>
                        <td className="p-3 font-mono tabular-nums text-gray-300" title={i.cvssVector ?? undefined}>{i.cvssScore ?? '—'}</td>
                        <td className="p-3 text-gray-300" title={i.affected.join('\n')}>{i.affected.length} host{i.affected.length === 1 ? '' : 's'}</td>
                        <td className={`p-3 ${st.cls}`} title={st.hint}>{st.label}</td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-gray-500">No findings match the filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-gray-700">
              <p className="text-xs text-amber-400">
                {needsApproval > 0 && `${needsApproval} selected finding${needsApproval === 1 ? ' has' : 's have'} no library entry yet and will be sent for approval instead of being added.`}
                {error && <span role="alert" className="text-red-400">{error}</span>}
              </p>
              <div className="flex gap-2">
                <button onClick={close} disabled={importing} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm disabled:opacity-50">Cancel</button>
                <button
                  onClick={runImport}
                  disabled={importing || selected.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import {selected.size > 0 ? `${selected.size} selected` : 'selected'}
                </button>
              </div>
            </div>
          </>
        )}

        {result && (
          <div className="flex justify-end p-4 border-t border-gray-700">
            <button onClick={close} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
