'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download, Info } from 'lucide-react';
import { useBranding } from '@/contexts/branding-context';
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
  const data = e?.response?.data;
  if (e?.response?.status === 413) return data?.message || 'This file is larger than the upload limit set by your Admin.';
  const msg = data?.message;
  const lines: string[] = Array.isArray(msg) ? msg : msg ? [msg] : [];
  if (Array.isArray(data?.errors)) {
    for (const r of data.errors.slice(0, 20)) lines.push(`Row ${r.row}${r.name ? ` (${r.name})` : ''}: ${(r.errors || []).join(' ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : fallback;
}

/** The header row the file must start with, exactly and in this order (same as the sample template). */
export const IMPORT_HEADERS = ['S.No', 'Name', 'Severity', 'CVSS', 'CVSS-VEC', 'Description', 'Impact', 'Remediation', 'Reference', 'CVE ID', 'CWE ID'];

/**
 * The "i" beside Import Project Findings: which files are accepted, the header row they need, and what each column
 * must hold. Opens on click, hover or keyboard focus; Escape closes it.
 */
export function ImportFormatInfo() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { settings } = useBranding();
  // The tip is drawn outside the dialog (which scrolls and clips), under the button, or above it when there is no room.
  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 416 - 8));
    setPos(window.innerHeight - r.bottom > 430 ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 });
    setOpen(true);
  };
  const sizes = settings?.attachments?.maxSizeMb ?? {};
  const limit = Math.max(sizes['findingsImport.csv'] ?? 100, sizes['findingsImport.xlsx'] ?? 100);
  const severities = Object.keys(settings?.workflow?.severityColors ?? { Critical: 1, High: 1, Medium: 1, Low: 1, Info: 1 });
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        ref={button}
        type="button"
        aria-label="Supported formats and required header row for Import Project Findings"
        aria-expanded={open}
        aria-describedby={open ? 'import-format-info' : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div
          id="import-format-info"
          role="tooltip"
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom }}
          className="z-[80] w-[26rem] max-w-[85vw] rounded-lg border border-gray-600 bg-gray-950 p-4 text-left text-xs leading-relaxed text-gray-300 shadow-2xl"
        >
          <p className="mb-2 text-sm font-semibold text-white">Import Project Findings</p>
          <p><span className="text-gray-400">Supported files:</span> <code className="text-violet-300">.csv</code> and <code className="text-violet-300">.xlsx</code> (first sheet), up to {limit} MB and 5,000 rows. Workbooks with formulas, macros or embedded objects are rejected.</p>
          <p className="mt-2 text-gray-400">First row must be exactly, in this order:</p>
          <p className="mt-1 break-words rounded bg-gray-900 p-2 font-mono text-[11px] text-emerald-300">{IMPORT_HEADERS.join(', ')}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-4">
            <li><b className="text-white">Required:</b> Name, Severity ({severities.join(', ')}), Description, Impact, Remediation, Reference.</li>
            <li><b className="text-white">Optional:</b> CVSS (0.0 to 10.0), CVSS-VEC (e.g. CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N), CVE ID (CVE-2024-12345), CWE ID (CWE-79). S.No is ignored.</li>
            <li>One row per finding; a name must be unique in the file and in the project.</li>
            <li>If any row is invalid nothing is imported. Findings are added to this project only.</li>
          </ul>
          <p className="mt-2 text-gray-400">The sample template at the bottom of the import window has these headers.</p>
        </div>,
        document.body,
      )}
    </span>
  );
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
