'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Download } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { downloadBlob } from '@/lib/download';

/** Matches the server's limit for an Import Project Findings file. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;

type RowStatus = 'new' | 'duplicate' | 'invalid';

interface Row {
  row: number;
  name: string;
  severity: string;
  cvssScore: number | null;
  status: RowStatus;
  errors?: string[];
}

interface Preview {
  total: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  canImport: boolean;
  rows: Row[];
  truncated: boolean;
}

const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'text-emerald-400' },
  duplicate: { label: 'Already in project (skipped)', cls: 'text-gray-500' },
  invalid: { label: 'Invalid', cls: 'text-red-400' },
};

/** The server answers with a string, a list of strings, or { message, errors: [{ row, name, errors }] }. */
function errorText(e: any, fallback: string): string {
  if (e?.response?.status === 413) return 'This file is larger than 100 MB, the upload limit.';
  const data = e?.response?.data;
  const msg = data?.message;
  const lines: string[] = Array.isArray(msg) ? msg : msg ? [msg] : [];
  if (Array.isArray(data?.errors)) {
    for (const r of data.errors.slice(0, 20)) lines.push(`Row ${r.row}${r.name ? ` (${r.name})` : ''}: ${(r.errors || []).join(' ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : fallback;
}

export function downloadImportSample() {
  return api.get('/findings/import/sample', { responseType: 'blob' }).then((res) => downloadBlob(res.data, 'project-findings-sample.csv'));
}

export function ProjectFindingsImportDialog({
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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: { row: number; name: string }[] } | null>(null);

  const body = () => {
    const form = new FormData();
    form.append('projectId', projectId);
    form.append('file', file);
    return form;
  };

  useEffect(() => {
    api
      .post('/findings/import/preview', body(), { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => setPreview(res.data))
      .catch((e) => setError(errorText(e, 'Could not read this file.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (done) onImported();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !importing && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runImport = async () => {
    setImporting(true);
    setError('');
    try {
      const res = await api.post('/findings/import', body(), { headers: { 'Content-Type': 'multipart/form-data' } });
      setDone(res.data);
    } catch (e: any) {
      setError(errorText(e, 'Import failed. Nothing was imported.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="pf-import-title" className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="min-w-0">
            <h2 id="pf-import-title" className="text-lg font-semibold text-white">Import Project Findings</h2>
            <p className="text-xs text-gray-500 truncate">{file.name} · added to this project only, as PT findings. They are not added to the Vulnerability Database and cannot be synced to it.</p>
          </div>
          <button onClick={close} disabled={importing} aria-label="Close" className="text-gray-400 hover:text-white disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {!preview && !error && (
            <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Checking the file…</p>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300 whitespace-pre-line">
              {error}
              {!preview && (
                <button onClick={() => downloadImportSample().catch(() => undefined)} className="mt-2 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
                  <Download className="w-3 h-3" /> Download the sample template
                </button>
              )}
            </div>
          )}

          {done && (
            <div role="status" className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
              Imported {done.created} finding{done.created === 1 ? '' : 's'} into this project.
              {done.skipped.length > 0 && ` ${done.skipped.length} already in the project ${done.skipped.length === 1 ? 'was' : 'were'} skipped.`}
              {' '}Add Steps and PoC to each before generating a report.
            </div>
          )}

          {preview && !done && (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-gray-300">{preview.total} row{preview.total === 1 ? '' : 's'}</span>
                <span className="text-emerald-400">{preview.newCount} new</span>
                <span className="text-gray-500">{preview.duplicateCount} already in project</span>
                <span className={preview.invalidCount > 0 ? 'text-red-400' : 'text-gray-500'}>{preview.invalidCount} invalid</span>
              </div>
              {preview.invalidCount > 0 && (
                <p className="text-xs text-red-300">Fix the rows below in your file and choose it again. Nothing is imported while any row is invalid.</p>
              )}
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-800/50 text-xs text-gray-400">
                    <tr>
                      <th className="p-3">Row</th>
                      <th className="p-3">Vulnerability</th>
                      <th className="p-3">Severity</th>
                      <th className="p-3">CVSS</th>
                      <th className="p-3">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row} className={`border-b border-gray-800 ${r.status === 'duplicate' ? 'opacity-60' : ''}`}>
                        <td className="p-3 text-gray-500 tabular-nums">{r.row}</td>
                        <td className="p-3 text-white break-words">{r.name || '—'}</td>
                        <td className="p-3 text-gray-300">{r.severity || '—'}</td>
                        <td className="p-3 font-mono tabular-nums text-gray-300">{r.cvssScore ?? '—'}</td>
                        <td className={`p-3 ${STATUS[r.status].cls}`}>
                          {STATUS[r.status].label}
                          {r.errors?.map((m, i) => <p key={i} className="text-xs text-red-300 mt-1">{m}</p>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncated && <p className="text-xs text-gray-500">Only the first rows are listed here; the whole file is checked.</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-700">
          <button onClick={() => downloadImportSample().catch(() => undefined)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
            <Download className="w-3.5 h-3.5" /> Sample template (.csv)
          </button>
          <div className="flex gap-3">
            <button onClick={close} disabled={importing} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm disabled:opacity-50">
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button
                onClick={runImport}
                disabled={!preview?.canImport || importing}
                className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50 flex items-center gap-2"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                {importing ? 'Importing…' : preview?.canImport ? `Import ${preview.newCount} finding${preview.newCount === 1 ? '' : 's'}` : 'Import'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
