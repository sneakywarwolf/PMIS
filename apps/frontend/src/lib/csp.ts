/** The per-request Content-Security-Policy set by src/middleware.ts. Pure, so it can be tested without Next. */
export function buildCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    // The app's only socket (/easter-egg) is same-origin and long-polling, so 'self' covers it; a ws:/wss: scheme source would let
    // script talk to any host. Development adds them for Next's hot-reload socket.
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
