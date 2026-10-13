import { canAccessProject, projectScopeWhere } from './project-access.util';

describe('projectScopeWhere', () => {
  it('scopes each role and matches nothing for unknown roles', () => {
    expect(projectScopeWhere({ id: 'a', role: 'ADMIN' })).toEqual({});
    expect(projectScopeWhere({ id: 't1', role: 'TESTER' })).toEqual({ testerId: 't1' });
    expect(projectScopeWhere({ id: 'tl1', role: 'TEAM_LEAD' })).toEqual({ OR: [{ tlId: 'tl1' }, { tester: { assignedTlId: 'tl1' } }] });
    expect(projectScopeWhere({ id: 'x', role: 'GUEST' })).toEqual({ id: { in: [] } });
  });
});

const project = { testerId: 't1', tlId: 'tl1', tester: { assignedTlId: 'tl1' } };

describe('canAccessProject', () => {
  it('admin sees everything', () => expect(canAccessProject({ id: 'a', role: 'ADMIN' }, project)).toBe(true));
  it('own tester / own team lead / own AVP allowed', () => {
    expect(canAccessProject({ id: 't1', role: 'TESTER' }, project)).toBe(true);
    expect(canAccessProject({ id: 'tl1', role: 'TEAM_LEAD' }, project)).toBe(true);
    expect(canAccessProject({ id: 'tl1', role: 'AVP' }, project)).toBe(true);
  });
  it('other tester, other team lead, other AVP denied', () => {
    expect(canAccessProject({ id: 't2', role: 'TESTER' }, project)).toBe(false);
    expect(canAccessProject({ id: 'tl2', role: 'TEAM_LEAD' }, project)).toBe(false);
    expect(canAccessProject({ id: 'tl2', role: 'AVP' }, project)).toBe(false);
  });
  it('denies unknown roles and a lead with no scope data', () => {
    expect(canAccessProject({ id: 'x', role: 'GUEST' }, project)).toBe(false);
    expect(canAccessProject({ id: 'tl1', role: 'TEAM_LEAD' }, { testerId: 't1' })).toBe(false);
  });
});
