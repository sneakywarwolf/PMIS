'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mascot } from 'page-mascot';
import { CalendarClock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { formatDateTime } from '@/lib/datetime';

interface Release {
  version: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string;
}

interface AboutStatus {
  appName: string;
  author: string;
  version: string;
  changelog: string;
  latest: (Release & { available: boolean }) | null;
  releases: Release[];
  checkError: string | null;
  updaterConfigured: boolean;
  update: {
    status: 'IDLE' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    scheduledAt?: string;
    targetVersion?: string;
    finishedAt?: string;
    error?: string;
  };
}

const STATUS_LABEL: Record<AboutStatus['update']['status'], string> = {
  IDLE: 'Up to date / idle',
  SCHEDULED: 'Update scheduled',
  IN_PROGRESS: 'Update in progress',
  COMPLETED: 'Last update completed',
  FAILED: 'Last update failed',
};

/** Default schedule time: 10 minutes from now, formatted for <input type="datetime-local">. */
function defaultWhen() {
  const d = new Date(Date.now() + 10 * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function AboutPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [status, setStatus] = useState<AboutStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'check' | 'schedule' | 'cancel' | null>(null);
  const [when, setWhen] = useState(defaultWhen);

  const load = useCallback(async (path: 'status' | 'check') => {
    setError('');
    try {
      const { data } = path === 'check' ? await api.post('/update/check') : await api.get('/update/status');
      setStatus(data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load update status');
    }
  }, []);

  useEffect(() => {
    load('status');
  }, [load]);

  const run = async (kind: 'check' | 'schedule' | 'cancel') => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'check') await load('check');
      else {
        if (kind === 'schedule') await api.post('/update/schedule', { scheduledAt: new Date(when).toISOString() });
        else await api.delete('/update/schedule');
        await load('status');
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return <div className="p-6 text-gray-400">{error || 'Loading…'}</div>;
  }

  const { latest, update } = status;
  const canSchedule = isAdmin && status.updaterConfigured && !!latest?.available && update.status !== 'SCHEDULED' && update.status !== 'IN_PROGRESS';
  const rows: [string, React.ReactNode][] = [
    ['Application', status.appName],
    ['Author / Company', status.author],
    ['Current version', <span key="v" className="font-mono">v{status.version}</span>],
    ['Update status', STATUS_LABEL[update.status]],
    [
      'Latest version',
      latest ? (
        <span key="l">
          <span className="font-mono">v{latest.version}</span>{' '}
          <span className={latest.available ? 'text-emerald-400' : 'text-gray-500'}>
            {latest.available ? '— update available' : '— you are up to date'}
          </span>
        </span>
      ) : (
        <span key="l" className="text-gray-500">{status.checkError ? 'Could not check for updates' : 'No releases found'}</span>
      ),
    ],
  ];

  return (
    // Mascot sits at z-0 behind the opaque z-10 card; pt-24 leaves its head visible above the card edge.
    <div className="relative mx-auto max-w-3xl pt-24">
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 -translate-x-1/2">
        <div className="pointer-events-auto">
          <Mascot directions="/mascots/fox-directions.webp" reactions="/mascots/fox-reactions.webp" size={128} label="PMIS fox mascot" />
        </div>
      </div>

      <div className="relative z-10 space-y-6 rounded-2xl border border-cyber-border bg-cyber-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">About</h1>
            <p className="mt-1 text-sm text-gray-400">Version, release notes and updates.</p>
          </div>
          <button
            onClick={() => run('check')}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Check for updates
          </button>
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <dl className="divide-y divide-gray-800 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-gray-400">{k}</dt>
              <dd className="text-right text-white">{v}</dd>
            </div>
          ))}
        </dl>

        {update.status === 'SCHEDULED' && update.scheduledAt && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0" />
              Update to v{update.targetVersion} scheduled for {formatDateTime(update.scheduledAt)}
            </span>
            {isAdmin && (
              <button
                onClick={() => run('cancel')}
                disabled={busy !== null}
                className="rounded-md px-2 py-1 text-xs text-amber-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {update.status === 'FAILED' && update.error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">Last update failed: {update.error}</p>
        )}

        {isAdmin && (
          <div className="space-y-3 rounded-lg border border-gray-800 p-4">
            <h2 className="text-sm font-medium text-white">Schedule update</h2>
            <div className="flex items-start gap-2 text-xs text-gray-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Updates replace the application only. Your database and stored files are never reset, reseeded or overwritten.
            </div>
            {!status.updaterConfigured && (
              <p className="text-xs text-amber-400">No updater is configured on this server (set UPDATE_COMMAND), so updates cannot be installed from here.</p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="update-when" className="mb-1.5 block text-sm text-gray-300">Date &amp; time</label>
                <input id="update-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!canSchedule} />
              </div>
              <button
                onClick={() => run('schedule')}
                disabled={!canSchedule || !when || busy !== null}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'schedule' && <Loader2 className="h-4 w-4 animate-spin" />}
                Schedule update
              </button>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-2 text-sm font-medium text-white">Release notes</h2>
          {latest?.notes && (
            <div className="mb-3 rounded-lg bg-white/5 p-3">
              <p className="mb-1 text-xs tracking-wide text-gray-500">
                v{latest.version} · {formatDateTime(latest.publishedAt)}
              </p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-300">{latest.notes}</pre>
            </div>
          )}
          {status.changelog ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/5 p-3 font-sans text-sm text-gray-300">{status.changelog}</pre>
          ) : (
            !latest?.notes && <p className="text-sm text-gray-500">No release notes available.</p>
          )}
        </section>
      </div>
    </div>
  );
}
