import { UserRole } from '@prisma/client';

type Actor = { id: string; role: UserRole | string };
type ProjectScope = { testerId: string; tlId?: string | null; tester?: { assignedTlId?: string | null } | null };

/**
 * Same rule as ProjectsService.checkProjectAccess: Admin sees everything, a Team Lead/AVP sees projects of
 * their own team, a Tester sees only their own. Deny by default (unknown role, missing scope data).
 */
/** Prisma `where` equivalent of canAccessProject, for list/aggregate queries. Unknown roles match nothing. */
export function projectScopeWhere(user: Actor): Record<string, unknown> {
  if (user.role === UserRole.ADMIN) return {};
  if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
    return { OR: [{ tlId: user.id }, { tester: { assignedTlId: user.id } }] };
  }
  if (user.role === UserRole.TESTER) return { testerId: user.id };
  return { id: { in: [] } };
}

export function canAccessProject(user: Actor, project: ProjectScope): boolean {
  if (user.role === UserRole.ADMIN) return true;
  if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
    return project.tlId === user.id || project.tester?.assignedTlId === user.id;
  }
  if (user.role === UserRole.TESTER) return project.testerId === user.id;
  return false;
}
