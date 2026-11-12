import { NextRequest, NextResponse } from 'next/server';
import { buildCsp } from '@/lib/csp';

/**
 * Per-request script nonce. The static CSP in next.config.js still allows 'unsafe-inline' scripts as a fallback layer; this
 * adds a stricter policy on every page: only scripts carrying this request's nonce (Next's own bootstrap scripts and the two
 * theme scripts in app/layout.tsx) may run, so an injected <script> or inline handler is refused even if one ever got into the page.
 * The browser enforces both policies, so the stricter one wins. Styles keep 'unsafe-inline': React and framer-motion set
 * inline style attributes, which cannot carry a nonce.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = buildCsp(nonce, dev);

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp); // Next reads the nonce from the request header to tag its own scripts
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

// Pages only: not the /api proxy, static files or prefetches.
export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
