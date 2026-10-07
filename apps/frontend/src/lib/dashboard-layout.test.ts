import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, normalize, move } from './dashboard-layout.ts';

test('normalize drops unknown ids, de-duplicates and appends missing sections', () => {
  const p = normalize({ order: ['charts', 'bogus', 'charts', 'rankings'], hidden: ['heatmap', 'nope', 7] });
  assert.deepEqual(p.order.slice(0, 2), ['charts', 'rankings']);
  assert.equal(p.order.length, SECTIONS.length);
  assert.deepEqual(p.hidden, ['heatmap']);
});

test('normalize survives garbage', () => {
  for (const bad of [null, undefined, 'x', 42, { order: 'no' }]) {
    assert.equal(normalize(bad).order.length, SECTIONS.length);
  }
});

test('move swaps neighbours and stops at the ends', () => {
  assert.deepEqual(move(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(move(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(move(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
});
