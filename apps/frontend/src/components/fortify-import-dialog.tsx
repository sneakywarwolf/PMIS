'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import { UploadStatus, useUploadStatus } from '@/components/upload-status';
import { describeUploadError } from '@/lib/upload-error';
import { api } from '@/contexts/auth-context';
import { useSeverity } from '@/lib/severity';

type Status = 'new' | 'duplicate' | 'merge' | 'invalid';

interface Item {
  key: string;
  name: string;
  severity: string;
  cweId: string | null;
  cveId: string | null;
  affected: string[];
  instanceCount: number;
  status: Status;
  problem?: string;
}

interface Preview {
  items: Item[];
  activeInstances: number;
  suppressedInstances: number;
  suppressionApplied: boolean;
}

interface ImportResult {
  created: { key: string; name: string }[];
  skipped: { key: string; name: string; reason: string }[];
  merged?: { key: string; name: string }[];
  failed: { key: string; name: string; error: string }[];
}

const STATUS: Record<Status, { label: string; cls: string; hint: string; selectable: boolean }> = {
  new: { label: 'New', cls: 'text-emerald-400', hint: 'Will be added to this project as an SCR finding. It is not added to the global Vulnerability DB.', selectable: true },
  duplicate: { label: 'Already in project', cls: 'text-gray-500', hint: 'This project already has this finding.', selectable: false },
  merge: { label: 'Already in project: add locations', cls: 'text-cyan-400', hint: 'Already imported from another file. Importing adds the code locations this file has that the finding does not; nothing is removed.', selectable: true },
  invalid: { label: 'Cannot import', cls: 'text-red-400', hint: 'This record has a problem and cannot be imported.', selectable: false },
};

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];

export function FortifyImportDialog({ projectId, file, onClose, onImported }: { projectId: string; file: File; onClose: () => void; onImported: () => void }) {
  const sev = useSeverity();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const upload = useUploadStatus();
  const [attempt, setAttempt] = useState(0);

  const body = () => {
    const form = new FormData();
    form.append('projectId', projectId);
    form.append('file', file);
    return form;
  };

  useEffect(() => {
    upload.begin(file.size);
    api
      .post('/findings/fortify/preview', body(), { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: upload.onProgress })
      .then((res) => {
        const data: Preview = res.data;
        setPreview(data);
        setSelected(new Set(data.items.filter((i) => STATUS[i.status].selectable).map((i) => i.key)));
      })
      .catch((e) => setError(describeUploadError(e, { fileSize: file.size, uploaded: upload.latest().loaded, elapsed: upload.latest().elapsed }, 'Could not read this file.')))
      .finally(() => upload.finish());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const close = () => {
    if (result) onImported();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !importing && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const items = preview?.items ?? [];
  const visible = useMemo(
    () => items.filter((i) => (!severity || i.severity === severity) && (!query || `${i.name} ${i.cweId ?? ''} ${i.cveId ?? ''}`.toLowerCase().includes(query.toLowerCase()))),
    [items, query, severity],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const runImport = async () => {
    setImporting(true);
    setError('');
    upload.begin(file.size);
    try {
      const form = body();
      form.append('selected', JSON.stringify([...selected]));
      const res = await api.post('/findings/fortify/import', form, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: upload.onProgress });
      setResult(res.data);
    } catch (e: any) {
      setError(describeUploadError(e, { fileSize: file.size, uploaded: upload.latest().loaded, elapsed: upload.latest().elapsed }, 'Import failed. Nothing was imported.'));
    } finally {
      upload.finish();
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="fortify-title" className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="min-w-0">
            <h2 id="fortify-title" className="text-lg font-semibold text-white">Import Fortify findings</h2>
            <p className="text-xs text-gray-500 truncate">{file.name} · imported as SCR findings, added to this project only (not the global Vulnerability DB)</p>
          </div>
          <button onClick={close} aria-label="Close" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="p-6 space-y-3 overflow-y-auto text-sm">
            <p className="text-white">
              {result.created.length} finding{result.created.length === 1 ? '' : 's'} imported
              {(result.merged?.length ?? 0) > 0 && `, ${result.merged!.length} updated with new locations`}
              {result.skipped.length > 0 && `, ${result.skipped.length} skipped`}
              {result.failed.length > 0 && `, ${result.failed.length} failed`}.
            </p>
            {[...result.skipped.map((s) => ({ key: s.key, name: s.name, msg: s.reason })), ...result.failed.map((f) => ({ key: f.key, name: f.name, msg: f.error }))].map((r) => (
              <div key={r.key} className="text-gray-400"><span className="text-gray-300">{r.name}</span>: {r.msg}</div>
            ))}
            <div className="flex justify-end pt-2">
              <button onClick={close} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium">Done</button>
            </div>
          </div>
        ) : !preview ? (
          error ? (
            <div className="m-6 space-y-3">
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
              <button onClick={() => { setError(''); setAttempt((a) => a + 1); }} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm">Try again</button>
            </div>
          ) : (
            <div className="p-6"><UploadStatus snap={upload.snap} fileName={file.name} working="Reading the Fortify results" /></div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-800">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, CWE" aria-label="Search findings" className="pl-9 pr-3 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white w-64" />
              </div>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity" className="px-3 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-sm text-white">
                <option value="">All severities</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={() => setSelected(new Set(visible.filter((i) => STATUS[i.status].selectable).map((i) => i.key)))} className="text-sm text-emerald-400 hover:text-emerald-300">Select all shown</button>
              <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white">Clear selection</button>
              <span className="ml-auto text-xs text-gray-500">
                {preview.activeInstances} instance{preview.activeInstances === 1 ? '' : 's'} in {items.length} finding{items.length === 1 ? '' : 's'}
                {preview.suppressionApplied ? ` · ${preview.suppressedInstances} suppressed left out` : ' · suppression is only applied for .fpr files'}
              </span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                  <tr className="text-left">
                    <th className="p-3 w-10" />
                    <th className="p-3 font-medium">Finding</th>
                    <th className="p-3 font-medium">Severity</th>
                    <th className="p-3 font-medium">CWE</th>
                    <th className="p-3 font-medium">Locations</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => {
                    const st = STATUS[i.status];
                    return (
                      <tr key={i.key} className={`border-b border-gray-800 ${st.selectable ? 'hover:bg-white/5' : 'opacity-60'}`}>
                        <td className="p-3"><input type="checkbox" checked={selected.has(i.key)} disabled={!st.selectable} onChange={() => toggle(i.key)} aria-label={`Select ${i.name}`} /></td>
                        <td className="p-3">
                          <p className="text-white">{i.name}</p>
                          {i.problem && <p className="text-xs text-red-400">{i.problem}</p>}
                        </td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={sev.badgeStyle(i.severity)}>{sev.label(i.severity)}</span></td>
                        <td className="p-3 text-gray-300 font-mono text-xs">{i.cweId ?? '—'}</td>
                        <td className="p-3 text-gray-300" title={i.affected.join('\n')}>{i.instanceCount} instance{i.instanceCount === 1 ? '' : 's'}</td>
                        <td className={`p-3 ${st.cls}`} title={st.hint}>{st.label}</td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">No findings match the filters.</td></tr>}
                </tbody>
              </table>
            </div>
            {importing && <div className="px-4 pt-4"><UploadStatus snap={upload.snap} fileName={file.name} working="Creating the findings" /></div>}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-gray-700">
              <span className="text-xs text-red-400">{error}</span>
              <div className="flex gap-2">
                <button onClick={close} disabled={importing} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm disabled:opacity-50">Cancel</button>
                <button onClick={runImport} disabled={importing || selected.size === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {selected.size === 0 ? 'Select findings to import' : `Import ${selected.size} finding${selected.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
