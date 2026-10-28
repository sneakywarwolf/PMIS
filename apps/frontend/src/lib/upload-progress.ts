/** Pure helpers behind the live upload / processing status (kept free of React so they can be unit tested). */

export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'done';

export interface UploadSnapshot {
  phase: UploadPhase;
  loaded: number;
  total: number;
  /** Bytes per second, smoothed over recent progress events. */
  speed: number;
  /** Whole seconds since the upload began. */
  elapsed: number;
  /** Whole seconds since the file finished uploading (server working). */
  processingElapsed: number;
}

export const IDLE: UploadSnapshot = { phase: 'idle', loaded: 0, total: 0, speed: 0, elapsed: 0, processingElapsed: 0 };

export function formatBytes(n: number): string {
  if (!isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** 75 -> "1:15", 3700 -> "1:01:40". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** "about 42 s left" / "about 3 min left"; null when it cannot be estimated yet. */
export function etaText(loaded: number, total: number, speed: number): string | null {
  if (!(speed > 0) || total <= loaded) return null;
  const s = Math.ceil((total - loaded) / speed);
  if (s < 60) return `about ${s} s left`;
  if (s < 3600) return `about ${Math.ceil(s / 60)} min left`;
  return `about ${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min left`;
}

export function percentOf(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.floor((loaded / total) * 100));
}

/**
 * Folds one progress event into the running speed. `prev` is the previous sample (time in ms); the speed is
 * smoothed so the estimate does not jump around.
 */
export function nextSpeed(prevSpeed: number, prev: { loaded: number; at: number } | null, loaded: number, now: number): number {
  if (!prev || now <= prev.at || loaded <= prev.loaded) return prevSpeed;
  const instant = ((loaded - prev.loaded) * 1000) / (now - prev.at);
  return prevSpeed > 0 ? prevSpeed * 0.7 + instant * 0.3 : instant;
}
