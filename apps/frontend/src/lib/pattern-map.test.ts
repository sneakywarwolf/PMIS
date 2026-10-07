import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAMP, TIERS, cfgFor, makePattern } from './pattern-map.ts';

test('rounds 1-6 follow the fixed easy ramp, never random', () => {
  for (let n = 1; n <= RAMP.length; n++) {
    assert.deepEqual(cfgFor(n, () => 0.99), RAMP[n - 1]);
    assert.deepEqual(cfgFor(n, () => 0), RAMP[n - 1]);
  }
  assert.ok(RAMP.every((c) => c.grid <= 4 && c.length <= 5));
});

test('from round 7 every tier is reachable and fits its grid', () => {
  const labels = new Set<string>();
  for (let i = 0; i < TIERS.length; i++) {
    for (const r of [0, 0.5, 0.999]) {
      const picks = [i / TIERS.length + 0.001, r];
      let call = 0;
      const c = cfgFor(7, () => picks[call++ % 2]);
      labels.add(c.label);
      assert.ok(c.length >= 3 && c.length <= c.grid ** 2, `${c.label} length ${c.length}`);
    }
  }
  assert.equal(labels.size, TIERS.length);
});

test('makePattern returns distinct in-grid tiles of the requested length', () => {
  const cfg = { grid: 5, length: 11, step: 240, label: 'x' };
  for (let i = 0; i < 50; i++) {
    const p = makePattern(cfg);
    assert.equal(p.length, 11);
    assert.equal(new Set(p).size, 11);
    assert.ok(p.every((t) => t >= 0 && t < 25));
  }
});
