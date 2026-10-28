import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPermissionsFor, DEFAULT_PERMISSIONS } from './rbac-defaults.ts';

test('Admin has every feature', () => {
  const p = defaultPermissionsFor('ADMIN');
  assert.ok(Object.values(p).every(Boolean));
  assert.equal(Object.keys(p).length, Object.keys(DEFAULT_PERMISSIONS).length);
});

test('defaults match the shipped rules for the other roles', () => {
  const t = defaultPermissionsFor('TESTER');
  assert.equal(t['projects.view'], true);
  assert.equal(t['quiz.play'], true);
  assert.equal(t['users.create'], false);
  assert.equal(t['users.page'], false);
  const tl = defaultPermissionsFor('TEAM_LEAD');
  assert.equal(tl['users.list'], true);
  assert.equal(tl['vulns.approve_requests'], true);
  assert.equal(defaultPermissionsFor('AVP')['vulns.request_new'], false);
});

test('an unknown role gets nothing', () => {
  assert.ok(Object.values(defaultPermissionsFor(undefined)).every((v) => v === false));
});
