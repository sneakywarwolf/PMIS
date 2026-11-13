/**
 * The countdown for a temporary lock. The server decides when a lock ends (`expiresAt`, a server timestamp); the browser only
 * displays how long is left. To stay correct when the visitor's clock is wrong, the time left is measured against the server's
 * clock: `serverTime` is when the list was produced, and the browser adds the time that has passed on its own clock since the
 * response arrived (`fetchedAt`). A skewed browser clock cancels out, because only elapsed time is taken from it.
 */
export function remainingMs(expiresAt: string, serverTime: string, fetchedAt: number, now: number): number {
  const serverNow = Date.parse(serverTime) + (now - fetchedAt);
  return Math.max(0, Date.parse(expiresAt) - serverNow);
}

/** 125000 -> "2:05", 3725000 -> "1:02:05". Rounds up, so the display never shows 0:00 while the lock still holds. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export const LOCK_REASON_TEXT: Record<string, string> = {
  TOO_MANY_FAILED_LOGINS: 'Too many failed sign-in attempts',
};
