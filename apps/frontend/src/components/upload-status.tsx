'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { IDLE, UploadSnapshot, etaText, furthest, formatBytes, formatClock, nextSpeed, percentOf } from '@/lib/upload-progress';

/**
 * Live status of one file request: the upload (bytes, speed, time left) and then the server's processing time, so
 * people can see the application is working and has not stopped responding. Pass `onProgress` to axios as
 * `onUploadProgress`, call `begin()` before the request and `finish()` after it, whatever the outcome.
 */
export function useUploadStatus() {
  const [snap, setSnap] = useState<UploadSnapshot>(IDLE);
  const latestRef = useRef<UploadSnapshot>(IDLE);
  const startedAt = useRef(0);
  const uploadedAt = useRef(0);
  const last = useRef<{ loaded: number; at: number } | null>(null);
  const speed = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTick = () => { if (tick.current) { clearInterval(tick.current); tick.current = null; } };

  const begin = useCallback((total: number) => {
    stopTick();
    startedAt.current = Date.now();
    uploadedAt.current = 0;
    last.current = null;
    speed.current = 0;
    latestRef.current = { ...IDLE, phase: 'uploading', total };
    setSnap({ ...IDLE, phase: 'uploading', total });
    // The clock keeps running between progress events, so a stalled or slow phase still visibly moves.
    tick.current = setInterval(() => {
      const now = Date.now();
      setSnap((s) => s.phase === 'idle' || s.phase === 'done' ? s : {
        ...s,
        elapsed: Math.floor((now - startedAt.current) / 1000),
        processingElapsed: uploadedAt.current ? Math.floor((now - uploadedAt.current) / 1000) : 0,
      });
    }, 1000);
  }, []);

  const onProgress = useCallback((e: { loaded: number; total?: number }) => {
    const now = Date.now();
    const total = e.total ?? 0;
    // Stale or out-of-order events must not pull the bar back.
    const loaded = furthest(latestRef.current.loaded, e.loaded);
    speed.current = nextSpeed(speed.current, last.current, loaded, now);
    last.current = { loaded, at: now };
    const complete = total > 0 && loaded >= total;
    if (complete && !uploadedAt.current) uploadedAt.current = now;
    latestRef.current = { ...latestRef.current, phase: complete ? 'processing' : 'uploading', loaded, total: total || latestRef.current.total, speed: speed.current };
    setSnap((s) => ({
      ...s,
      phase: complete ? 'processing' : 'uploading',
      loaded: furthest(s.loaded, e.loaded),
      total: total || s.total,
      speed: speed.current,
    }));
  }, []);

  const finish = useCallback(() => {
    stopTick();
    setSnap(IDLE);
  }, []);

  // Where the request had got to, for explaining a failure (state may not have caught up when the error arrives).
  const latest = useCallback(() => ({ ...latestRef.current, elapsed: startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0 }), []);

  useEffect(() => stopTick, []);
  return { snap, begin, onProgress, finish, latest };
}

export function UploadStatus({ snap, fileName, working = 'Reading and checking the file' }: { snap: UploadSnapshot; fileName?: string; working?: string }) {
  if (snap.phase === 'idle') return null;
  const processing = snap.phase === 'processing';
  const pct = percentOf(snap.loaded, snap.total);
  const eta = etaText(snap.loaded, snap.total, snap.speed);
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 space-y-3" data-testid="upload-status">
      <div className="flex items-center gap-2 text-sm text-white">
        {processing ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <UploadCloud className="w-4 h-4 text-emerald-400" />}
        <span className="font-medium">{processing ? `${working}…` : 'Uploading…'}</span>
        {fileName && <span className="text-gray-500 truncate">{fileName}</span>}
        <span className="ml-auto font-mono text-xs text-gray-400 tabular-nums">{formatClock(snap.elapsed)}</span>
      </div>

      {/* One fixed track for every phase. The fill is anchored left and is never translated: uploading grows its
          width, processing fills it and animates only the stripes inside, so nothing in the layout moves. */}
      <div className="h-2 w-full rounded-full bg-gray-700 overflow-hidden relative" aria-hidden="true">
        <div
          className={`absolute inset-y-0 left-0 rounded-full bg-emerald-500 ${processing ? 'pmis-processing w-full' : 'transition-[width] duration-300 ease-out'}`}
          style={processing ? undefined : { width: `${pct}%` }}
        />
      </div>

      {/* Both phases get the same reserved height, so switching between them does not resize the panel. */}
      {processing ? (
        <div className="space-y-1 text-xs text-gray-400 min-h-[3.75rem]">
          <p className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Upload complete ({formatBytes(snap.total)}).</p>
          <p>The server is processing the file. Large files can take several minutes. Working for {formatClock(snap.processingElapsed)} — please keep this window open; nothing is wrong.</p>
        </div>
      ) : (
        <p className="text-xs text-gray-400 tabular-nums min-h-[3.75rem]">
          {pct}% · {formatBytes(snap.loaded)} of {formatBytes(snap.total)}
          {snap.speed > 0 && ` · ${formatBytes(snap.speed)}/s`}
          {eta && ` · ${eta}`}
        </p>
      )}
    </div>
  );
}
