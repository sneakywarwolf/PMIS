'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Loader2 } from 'lucide-react';
import { api } from '@/contexts/auth-context';
import { formatDateTime } from '@/lib/datetime';

interface UpdateInfo {
  version: string;
  update: { status: string; scheduledAt?: string; targetVersion?: string };
}

const SEEN_KEY = 'pmis.update.inProgress';

/**
 * Mounted once in the dashboard layout for every user. Shows a banner while an update is
 * scheduled, blocks the UI while it runs, and reloads the app once it has finished. While the
 * server restarts the status call fails; that is treated as "still updating" if we last saw it
 * in progress, so users never see a broken page mid-update.
 */
export function UpdateGate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const poll = async () => {
      let next = 15_000;
      try {
        const { data } = await api.get<UpdateInfo>('/update/status');
        const inProgress = data.update.status === 'IN_PROGRESS';
        if (inProgress) {
          sessionStorage.setItem(SEEN_KEY, data.version);
          next = 4_000;
        } else if (sessionStorage.getItem(SEEN_KEY)) {
          // Update finished (or failed): drop the marker; reload so the new version is loaded.
          sessionStorage.removeItem(SEEN_KEY);
          if (data.update.status === 'COMPLETED') {
            window.location.reload();
            return;
          }
        }
        setUnreachable(false);
        setInfo(data);
      } catch {
        if (sessionStorage.getItem(SEEN_KEY)) {
          setUnreachable(true);
          next = 3_000;
        }
      }
      if (!stopped) timer = setTimeout(poll, next);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const inProgress = info?.update.status === 'IN_PROGRESS' || unreachable;

  if (inProgress) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-4 bg-cyber-bg/95 backdrop-blur-sm"
      >
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
        <p className="text-lg font-semibold text-white">System update in progress. Please wait...</p>
        <p className="text-sm text-gray-400">This page will reload automatically when the update is done.</p>
      </div>
    );
  }

  if (info?.update.status === 'SCHEDULED' && info.update.scheduledAt) {
    return (
      <Link
        href="/dashboard/about"
        className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400 transition-colors hover:bg-amber-500/20"
      >
        <CalendarClock className="h-4 w-4 shrink-0" />
        <span>
          System update to v{info.update.targetVersion} scheduled for {formatDateTime(info.update.scheduledAt)}.
        </span>
      </Link>
    );
  }

  return null;
}
