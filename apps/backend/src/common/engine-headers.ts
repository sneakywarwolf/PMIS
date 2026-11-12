/**
 * socket.io answers its long-polling and handshake requests below Express, so helmet never sees them. These headers make
 * sure such a response is never treated as a page (nosniff, a policy that allows nothing, no framing) or cached.
 * Accepts the Server or a Namespace (the gateways receive either).
 */
export const ENGINE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};

export function hardenEngineHeaders(serverOrNamespace: any): void {
  const io = serverOrNamespace?.server ?? serverOrNamespace; // a Namespace holds its Server in `.server`
  io?.engine?.on?.('headers', (headers: Record<string, string>) => {
    Object.assign(headers, ENGINE_SECURITY_HEADERS);
  });
}
