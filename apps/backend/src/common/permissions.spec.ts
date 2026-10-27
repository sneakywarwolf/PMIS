import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, PERMISSION_GROUPS, DEFAULT_PERMISSION_MATRIX } from './permission-catalog';
import { PermissionGuard, assertCan, permissionRules, Permission, PERMISSION_KEY } from './permissions';

const ctx = (user: any, handler: any = function () {}) =>
  ({ getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

describe('RBAC catalog', () => {
  it('has unique keys, known groups, and no Settings feature', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PERMISSIONS) {
      expect(PERMISSION_GROUPS).toContain(p.group);
      expect(p.key.startsWith('settings')).toBe(false);
      expect(p.label.length).toBeGreaterThan(2);
    }
  });

  it('every feature is enforced by application code (backend @Permission / permissionRules, or the front end)', () => {
    const roots = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../../frontend/src')];
    const files: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && !/(permission-catalog|\.spec|\.test)\./.test(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);
    const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const unused = PERMISSIONS.filter((p) => !text.includes(`'${p.key}'`)).map((p) => p.key);
    expect(unused).toEqual([]);
  });

  it('only the Settings controller still uses the fixed @Roles rule', () => {
    const dir = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.controller\.ts$/.test(e.name) && /@Roles\(/.test(fs.readFileSync(p, 'utf8')) && !/settings\.controller\.ts$/.test(e.name)) offenders.push(e.name);
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });

  it('defaults keep Admin-only features closed to every other role, and open ones open', () => {
    expect(DEFAULT_PERMISSION_MATRIX['users.create']).toEqual({ AVP: false, TEAM_LEAD: false, TESTER: false });
    expect(DEFAULT_PERMISSION_MATRIX['vulns.approve_requests']).toEqual({ AVP: true, TEAM_LEAD: true, TESTER: false });
    expect(DEFAULT_PERMISSION_MATRIX['vulns.request_new']).toEqual({ AVP: false, TEAM_LEAD: true, TESTER: true });
    expect(DEFAULT_PERMISSION_MATRIX['projects.view']).toEqual({ AVP: true, TEAM_LEAD: true, TESTER: true });
  });
});

describe('permissionRules and PermissionGuard', () => {
  afterEach(() => permissionRules.set(undefined));

  it('Admin may do everything, even when the saved matrix says otherwise', () => {
    permissionRules.set({ 'users.create': { AVP: false, TEAM_LEAD: false, TESTER: false } } as any);
    expect(permissionRules.can('ADMIN', 'users.create')).toBe(true);
    expect(permissionRules.can('ADMIN', 'anything.at.all')).toBe(true);
  });

  it('a saved change applies at once, and a missing feature falls back to its default', () => {
    expect(permissionRules.can('TESTER', 'quiz.play')).toBe(true);
    permissionRules.set({ 'quiz.play': { AVP: true, TEAM_LEAD: true, TESTER: false } } as any);
    expect(permissionRules.can('TESTER', 'quiz.play')).toBe(false);
    expect(permissionRules.can('TESTER', 'projects.view')).toBe(true);
    expect(permissionRules.can('TESTER', 'not.a.feature')).toBe(false);
    expect(permissionRules.can(undefined, 'quiz.play')).toBe(false);
  });

  it('forRole lists every feature for the front end', () => {
    const t = permissionRules.forRole('TESTER');
    expect(Object.keys(t).length).toBe(PERMISSIONS.length);
    expect(t['users.create']).toBe(false);
    expect(permissionRules.forRole('ADMIN')['users.create']).toBe(true);
  });

  it('the guard allows unmarked routes and refuses roles that are switched off', () => {
    const marked = function () {};
    Reflect.defineMetadata(PERMISSION_KEY, 'users.create', marked);
    const guard = new PermissionGuard({ getAllAndOverride: (k: string, [h]: any[]) => Reflect.getMetadata(k, h) } as any);
    expect(guard.canActivate(ctx({ role: 'TESTER' }))).toBe(true);
    expect(() => guard.canActivate(ctx({ role: 'TESTER' }, marked))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx({ role: 'ADMIN' }, marked))).toBe(true);
    permissionRules.set({ 'users.create': { AVP: false, TEAM_LEAD: true, TESTER: false } } as any);
    expect(guard.canActivate(ctx({ role: 'TEAM_LEAD' }, marked))).toBe(true);
    expect(() => guard.canActivate(ctx(undefined, marked))).toThrow(ForbiddenException);
  });

  it('assertCan throws for a role that is switched off', () => {
    expect(() => assertCan({ role: 'TESTER' }, 'users.create')).toThrow(ForbiddenException);
    expect(() => assertCan({ role: 'ADMIN' }, 'users.create')).not.toThrow();
  });

  it('@Permission refuses a feature that is not in the catalog', () => {
    expect(() => Permission('made.up')).toThrow(/Unknown permission/);
  });
});
