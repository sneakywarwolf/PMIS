import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaText, formatBytes, formatClock, nextSpeed, percentOf } from './upload-progress.ts';

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(480 * 1024 * 1024), '480 MB');
  assert.equal(formatBytes(2.5 * 1024 ** 3), '2.5 GB');
});

test('formatClock', () => {
  assert.equal(formatClock(5), '0:05');
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatClock(3700), '1:01:40');
});

test('percentOf never exceeds 100 and handles an unknown total', () => {
  assert.equal(percentOf(50, 200), 25);
  assert.equal(percentOf(300, 200), 100);
  assert.equal(percentOf(10, 0), 0);
});

test('etaText', () => {
  assert.equal(etaText(0, 100, 0), null);
  assert.equal(etaText(100, 100, 5), null);
  assert.equal(etaText(0, 420, 10), 'about 42 s left');
  assert.equal(etaText(0, 6000, 10), 'about 10 min left');
});

test('nextSpeed smooths and ignores stalled samples', () => {
  assert.equal(nextSpeed(0, null, 100, 1000), 0);
  assert.equal(nextSpeed(0, { loaded: 0, at: 0 }, 1000, 1000), 1000);
  assert.equal(nextSpeed(1000, { loaded: 1000, at: 1000 }, 1000, 2000), 1000);
  const s = nextSpeed(1000, { loaded: 0, at: 0 }, 3000, 1000);
  assert.ok(s > 1000 && s < 3000);
});
