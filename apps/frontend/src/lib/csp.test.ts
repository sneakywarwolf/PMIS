import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The security headers the whole app ships, including the Cyberdigest pages. A regression here would let
// third-party images, frames or scripts load from article content.
const require = createRequire(import.meta.url);
const cfg = require('../../next.config.js');

async function headers(env: string) {
  const prev = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = env;
  try {
    const h = await cfg.headers();
    return Object.fromEntries(h[0].headers.map((x: any) => [x.key, x.value])) as Record<string, string>;
  } finally {
    (process.env as any).NODE_ENV = prev;
  }
}

test('production CSP forbids remote images, frames, objects and foreign scripts', async () => {
  const h = await headers('production');
  const csp = Object.fromEntries(h['Content-Security-Policy'].split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.ok(!csp['script-src'].some((s) => /^https?:/.test(s) || s === "'unsafe-eval'"));
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['default-src'], ["'self'"]); // frames, media and workers fall back to this: same origin only
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
});

test('other protective headers stay on', async () => {
  const h = await headers('production');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(h['Cross-Origin-Resource-Policy'], 'same-origin');
});

// The per-request policy from src/middleware.ts: scripts need this request's nonce, so injected inline scripts and event
// handler attributes are refused.
import { buildCsp } from './csp.ts';

test('per-request CSP: nonce-only scripts, no unsafe-inline or unsafe-eval in production', () => {
  const csp = Object.fromEntries(buildCsp('abc123', false).split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
  assert.ok(csp['script-src'].includes("'nonce-abc123'"));
  assert.ok(!csp['script-src'].includes("'unsafe-inline'"));
  assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
  assert.ok(!csp['script-src'].some((s) => /^https?:/.test(s)));
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(csp['connect-src'], ["'self'"]); // no ws:/wss: scheme wildcard in production
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
});

test('per-request CSP: development adds only unsafe-eval (hot reload)', () => {
  assert.match(buildCsp('n', true), /script-src [^;]*'unsafe-eval'/);
  assert.notEqual(buildCsp('a', false), buildCsp('b', false)); // a new nonce changes the policy
});
