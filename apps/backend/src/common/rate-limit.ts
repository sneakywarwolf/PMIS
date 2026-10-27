// Fixed-window rate limit decision. Self-contained (no imports) so rate-limit.check.mjs can load it.
// Only ids and counters pass through here — never request bodies, queries or headers.

export type RateLimitConfig = { perMin: number; anonPerMin: number };
export type RateLimitResult = { allowed: boolean; retryAfterSec: number; firstRejection: boolean };

const WINDOW_MS = 60_000;

// Expensive endpoints (file imports, template/report generation) get an extra, much smaller per-user budget.
const HEAVY = [
  /^POST \/findings\/(nessus\/(preview|import)|import(\/preview)?|upload-poc-image)$/,
  /^POST \/projects\/[^/]+\/nmap-import$/,
  /^POST \/reports\/(generate|templates)$/,
  /^GET \/reports\/issue-log\/[^/]+$/,
  /^GET \/vulnerabilities\/export$/,
  /^POST \/(users|vulnerabilities)\/bulk-upload$/,
];
export const isHeavyRoute = (method: string, path: string) => HEAVY.some((re) => re.test(`${method} ${path}`));

// ponytail: fixed window allows up to 2x burst across a window edge; switch to sliding window if that matters.
export async function rateLimit(
  incr: (key: string, windowMs: number) => Promise<number>,
  who: { userId?: string; ip: string },
  cfg: RateLimitConfig,
  now = Date.now(),
): Promise<RateLimitResult> {
  const [scope, id, limit] = who.userId ? ['u', who.userId, cfg.perMin] : ['ip', who.ip, cfg.anonPerMin];
  const count = await incr(`rl:${scope}:${id}:${Math.floor(now / WINDOW_MS)}`, WINDOW_MS);
  return {
    allowed: count <= limit,
    retryAfterSec: Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000),
    firstRejection: count === limit + 1,
  };
}
