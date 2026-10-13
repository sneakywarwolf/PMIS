const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth on top of SameSite=strict cookies. State-changing requests that a browser marks as
 * cross-origin (Origin header differs from the app origin, or Sec-Fetch-Site: cross-site) are refused.
 * Non-browser clients send neither header and are unaffected (they cannot ride a victim's cookies).
 */
export function isCrossSiteWrite(
  method: string,
  headers: { origin?: string; 'sec-fetch-site'?: string; host?: string; 'x-forwarded-host'?: string },
  allowedOrigin: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const origin = headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.origin === new URL(allowedOrigin).origin) return false;
      // Same-origin as the browser sees it through the Next proxy (LAN IP, 127.0.0.1, ...): the Origin host
      // equals the Host the request was addressed to. A cross-site attacker's Origin can never match.
      return ![headers['x-forwarded-host'], headers.host].some((h) => h && h.split(',')[0].trim() === o.host);
    } catch {
      return true; // "null" or malformed Origin
    }
  }
  return headers['sec-fetch-site'] === 'cross-site';
}
