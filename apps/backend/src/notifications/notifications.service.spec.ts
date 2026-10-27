import { NotificationsService } from './notifications.service';
import { DEFAULT_NOTIFICATION_RULES, NOTIFICATION_TYPES, roleReceives } from './notification-types';
import { DEFAULT_SETTINGS } from '../settings/settings.defaults';

describe('notification role rules', () => {
  const rulesWith = (type: string, off: string[]) => ({
    ...DEFAULT_NOTIFICATION_RULES,
    [type]: { AVP: !off.includes('AVP'), TEAM_LEAD: !off.includes('TEAM_LEAD'), TESTER: !off.includes('TESTER') },
  });

  it('covers every notification type PMIS creates, all on by default for every role', () => {
    expect(NOTIFICATION_TYPES.map((n) => n.type).sort()).toEqual([
      'PROJECT_ASSIGNED', 'QUIZ_ANSWER_REVEALED', 'QUIZ_QUESTION_LIVE', 'SYSTEM_UPDATE', 'USER_CREATED', 'USER_UPDATED',
      'VULNERABILITY_APPROVED', 'VULNERABILITY_CHANGE_APPROVED', 'VULNERABILITY_CHANGE_REJECTED', 'VULNERABILITY_CHANGE_REQUESTED',
      'VULNERABILITY_EDITED', 'VULNERABILITY_REJECTED', 'VULNERABILITY_REQUESTED',
    ]);
    for (const n of NOTIFICATION_TYPES) for (const role of ['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER']) expect(roleReceives(DEFAULT_SETTINGS.notifications.roleRules, n.type, role)).toBe(true);
  });

  it('a switched-off type is not received by that role, others are unaffected', () => {
    const rules = rulesWith('SYSTEM_UPDATE', ['TESTER']);
    expect(roleReceives(rules, 'SYSTEM_UPDATE', 'TESTER')).toBe(false);
    expect(roleReceives(rules, 'SYSTEM_UPDATE', 'TEAM_LEAD')).toBe(true);
    expect(roleReceives(rules, 'USER_CREATED', 'TESTER')).toBe(true);
  });

  it('an Admin always receives everything, even if a stored rule says otherwise', () => {
    const rules: any = { SYSTEM_UPDATE: { ADMIN: false, AVP: false, TEAM_LEAD: false, TESTER: false } };
    expect(roleReceives(rules, 'SYSTEM_UPDATE', 'ADMIN')).toBe(true);
    expect(roleReceives(rules, 'SYSTEM_UPDATE', 'AVP')).toBe(false);
  });

  it('a missing rule means on', () => {
    expect(roleReceives({}, 'SYSTEM_UPDATE', 'TESTER')).toBe(true);
    expect(roleReceives(undefined, 'SYSTEM_UPDATE', 'TESTER')).toBe(true);
  });
});

describe('NotificationsService applies the rules', () => {
  const users: Record<string, { id: string; role: string }> = {
    admin: { id: 'admin', role: 'ADMIN' }, avp: { id: 'avp', role: 'AVP' }, tl: { id: 'tl', role: 'TEAM_LEAD' }, t: { id: 't', role: 'TESTER' },
  };
  const make = (roleRules: any) => {
    const created: any[] = [];
    const prisma: any = {
      appSettings: { findUnique: jest.fn(async () => ({ data: { notifications: { roleRules } }, updatedAt: null, updatedById: null })) },
      user: {
        findUnique: jest.fn(async ({ where }: any) => users[where.id] ?? null),
        findMany: jest.fn(async () => Object.values(users)),
      },
      notification: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) },
    };
    return { svc: new NotificationsService(prisma), created, prisma };
  };
  const base = { title: 't', message: 'm' };
  const off = (type: string, roles: string[]) => ({ [type]: { AVP: !roles.includes('AVP'), TEAM_LEAD: !roles.includes('TEAM_LEAD'), TESTER: !roles.includes('TESTER') } });

  it('create() skips a type switched off for the recipient\'s role', async () => {
    const { svc, created } = make(off('PROJECT_ASSIGNED', ['TESTER']));
    expect(await svc.create({ userId: 't', type: 'PROJECT_ASSIGNED' as any, ...base })).toBeNull();
    expect(await svc.create({ userId: 'tl', type: 'PROJECT_ASSIGNED' as any, ...base })).not.toBeNull();
    expect(created.map((c) => c.userId)).toEqual(['tl']);
  });

  it('create() always notifies an Admin, whatever the rules', async () => {
    const { svc, created } = make(off('PROJECT_ASSIGNED', ['AVP', 'TEAM_LEAD', 'TESTER']));
    await svc.create({ userId: 'admin', type: 'PROJECT_ASSIGNED' as any, ...base });
    expect(created.map((c) => c.userId)).toEqual(['admin']);
  });

  it('notifyAllActiveUsers() sends to everyone except the roles switched off', async () => {
    const { svc, created } = make(off('SYSTEM_UPDATE', ['TESTER', 'AVP']));
    await svc.notifyAllActiveUsers({ type: 'SYSTEM_UPDATE' as any, ...base });
    expect(created.map((c) => c.userId).sort()).toEqual(['admin', 'tl']);
  });

  it('notifyAdminsAndTLs() honours the rules too', async () => {
    const { svc, created } = make(off('VULNERABILITY_REQUESTED', ['TEAM_LEAD']));
    await svc.notifyAdminsAndTLs({ type: 'VULNERABILITY_REQUESTED' as any, ...base });
    expect(created.map((c) => c.userId).sort()).toEqual(['admin', 'avp', 't']);
  });

  it('with nothing configured, every role is notified as before', async () => {
    const { svc, created } = make(undefined);
    await svc.notifyAllActiveUsers({ type: 'SYSTEM_UPDATE' as any, ...base });
    expect(created).toHaveLength(4);
  });

  it('a change applies to the very next notification (settings are read fresh)', async () => {
    const { svc, prisma, created } = make(off('SYSTEM_UPDATE', []));
    await svc.create({ userId: 't', type: 'SYSTEM_UPDATE' as any, ...base });
    prisma.appSettings.findUnique.mockResolvedValue({ data: { notifications: { roleRules: off('SYSTEM_UPDATE', ['TESTER']) } } });
    await svc.create({ userId: 't', type: 'SYSTEM_UPDATE' as any, ...base });
    expect(created).toHaveLength(1);
  });
});
