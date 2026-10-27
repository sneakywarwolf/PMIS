import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresForRoute, isRouteAllowed } from './rbac.ts';

const only = (...keys: string[]) => (k: string) => keys.includes(k);

test('Settings is Admin only whatever the matrix says', () => {
  assert.equal(isRouteAllowed('/dashboard/settings', 'ADMIN', () => true), true);
  assert.equal(isRouteAllowed('/dashboard/settings', 'TESTER', () => true), false);
  assert.equal(isRouteAllowed('/dashboard/settings/anything', 'AVP', () => true), false);
});

test('pages follow their feature', () => {
  assert.deepEqual(featuresForRoute('/dashboard/users'), ['users.page']);
  assert.equal(isRouteAllowed('/dashboard/users', 'TEAM_LEAD', only('users.page')), true);
  assert.equal(isRouteAllowed('/dashboard/users', 'TEAM_LEAD', only()), false);
  assert.equal(isRouteAllowed('/dashboard/projects/abc', 'TESTER', only()), false);
  assert.equal(isRouteAllowed('/dashboard/projects/abc', 'TESTER', only('projects.view')), true);
});

test('the quiz manage page is more specific than the quiz page', () => {
  assert.deepEqual(featuresForRoute('/dashboard/quiz/manage'), ['quiz.manage_questions']);
  assert.deepEqual(featuresForRoute('/dashboard/quiz/arcade'), ['quiz.play']);
});

test('Reports opens with generating or browsing templates', () => {
  assert.equal(isRouteAllowed('/dashboard/reports', 'TESTER', only('templates.view')), true);
  assert.equal(isRouteAllowed('/dashboard/reports', 'TESTER', only()), false);
});

test('pages without a feature are open to every signed-in user', () => {
  assert.equal(isRouteAllowed('/dashboard', 'TESTER', only()), true);
  assert.equal(isRouteAllowed('/dashboard/about', 'TESTER', only()), true);
  assert.equal(isRouteAllowed('/dashboard', undefined, () => true), false);
});

test('creating a project needs its own feature', () => {
  assert.deepEqual(featuresForRoute('/dashboard/projects/new'), ['projects.create']);
  assert.equal(isRouteAllowed('/dashboard/projects/new', 'TESTER', only('projects.view')), false);
});
