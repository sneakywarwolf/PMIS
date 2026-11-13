import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRemaining, remainingMs } from './lock-countdown.ts';

const SERVER = '2026-11-12T10:00:00.000Z';
const EXPIRES = '2026-11-12T10:15:00.000Z';

test('time left is the server expiry minus the server clock', () => {
  assert.equal(remainingMs(EXPIRES, SERVER, 5_000, 5_000), 15 * 60_000);
});

test('it counts down with the time elapsed on the browser since the list arrived', () => {
  assert.equal(remainingMs(EXPIRES, SERVER, 5_000, 5_000 + 60_000), 14 * 60_000);
  assert.equal(remainingMs(EXPIRES, SERVER, 5_000, 5_000 + 15 * 60_000 - 1), 1);
});

test('it reaches zero exactly at the server expiry and never goes negative', () => {
  assert.equal(remainingMs(EXPIRES, SERVER, 0, 15 * 60_000), 0);
  assert.equal(remainingMs(EXPIRES, SERVER, 0, 60 * 60_000), 0);
});

test('a wrong browser clock does not change the answer: only elapsed time is taken from it', () => {
  // The browser thinks it is the year 2031 or 2019: the same 3 minutes elapsed give the same result.
  for (const browserNow of [Date.parse('2031-01-01T00:00:00Z'), Date.parse('2019-01-01T00:00:00Z')]) {
    assert.equal(remainingMs(EXPIRES, SERVER, browserNow, browserNow + 3 * 60_000), 12 * 60_000);
  }
});

test('formatting: minutes and seconds, hours when needed, rounded up', () => {
  assert.equal(formatRemaining(15 * 60_000), '15:00');
  assert.equal(formatRemaining(125_000), '2:05');
  assert.equal(formatRemaining(1), '0:01'); // still locked: never shows 0:00
  assert.equal(formatRemaining(0), '0:00');
  assert.equal(formatRemaining(3_725_000), '1:02:05');
  assert.equal(formatRemaining(-5), '0:00');
});
