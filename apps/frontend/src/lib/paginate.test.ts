import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './paginate.ts';

const items = Array.from({ length: 45 }, (_, i) => i + 1);

test('first page', () => {
  const r = paginate(items, 1, 20);
  assert.equal(r.rows.length, 20);
  assert.equal(r.pageCount, 3);
  assert.equal(r.from, 1);
  assert.equal(r.to, 20);
});

test('last page is partial and out-of-range pages are clamped', () => {
  const r = paginate(items, 99, 20);
  assert.equal(r.page, 3);
  assert.deepEqual(r.rows, [41, 42, 43, 44, 45]);
  assert.equal(r.to, 45);
});

test('empty list', () => {
  const r = paginate([], 1, 20);
  assert.equal(r.pageCount, 1);
  assert.equal(r.from, 0);
  assert.equal(r.rows.length, 0);
});

test('invalid size falls back', () => {
  assert.equal(paginate(items, 1, 0).pageSize, 20);
});
