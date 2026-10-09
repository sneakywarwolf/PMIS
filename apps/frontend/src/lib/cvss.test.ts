import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCvssPrefix } from './cvss.ts';

test('removes the CVSS version prefix and nothing else', () => {
  const v = 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  for (const p of ['CVSS:3.1/', 'CVSS:3.0/', 'CVSS:2.0/', 'cvss:3.1/']) assert.equal(stripCvssPrefix(p + v), v);
  assert.equal(stripCvssPrefix(v), v);
  assert.equal(stripCvssPrefix('AV:N/AC:L/Au:N/C:P/I:P/A:P'), 'AV:N/AC:L/Au:N/C:P/I:P/A:P');
  assert.equal(stripCvssPrefix(null), '');
  assert.equal(stripCvssPrefix('  CVSS:3.1/AV:N  '), 'AV:N');
});
