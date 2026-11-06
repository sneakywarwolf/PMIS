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
});
