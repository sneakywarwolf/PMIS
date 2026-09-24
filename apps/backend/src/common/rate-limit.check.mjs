// Run: node src/common/rate-limit.check.mjs
import assert from 'node:assert/strict';
import { rateLimit } from './rate-limit.ts';

const store = new Map();
const incr = async (k) => { store.set(k, (store.get(k) ?? 0) + 1); return store.get(k); };
const cfg = { perMin: 3, anonPerMin: 2 };
const t = 120_000 + 15_000; // 15s into a window

// Per-user limit, first rejection flagged once, Retry-After = rest of window.
const u = [];
for (let i = 0; i < 5; i++) u.push(await rateLimit(incr, { userId: 'a', ip: '1.1.1.1' }, cfg, t));
assert.deepEqual(u.map((r) => r.allowed), [true, true, true, false, false]);
assert.deepEqual(u.map((r) => r.firstRejection), [false, false, false, true, false]);
assert.equal(u[3].retryAfterSec, 45);

// Other user and anonymous traffic from the same IP have their own buckets.
assert.equal((await rateLimit(incr, { userId: 'b', ip: '1.1.1.1' }, cfg, t)).allowed, true);
assert.equal((await rateLimit(incr, { ip: '1.1.1.1' }, cfg, t)).allowed, true);
assert.equal((await rateLimit(incr, { ip: '1.1.1.1' }, cfg, t)).allowed, true);
assert.equal((await rateLimit(incr, { ip: '1.1.1.1' }, cfg, t)).allowed, false);

// Next window resets.
assert.equal((await rateLimit(incr, { userId: 'a', ip: '1.1.1.1' }, cfg, t + 60_000)).allowed, true);
console.log('rate-limit check passed');
