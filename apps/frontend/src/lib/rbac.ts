/**
 * Single source of truth for which roles can view a given dashboard route.
 * Checked client-side in dashboard/layout.tsx on every navigation; the
 * backend's RolesGuard is the real enforcement boundary (see
 * apps/backend/src/auth/guards/roles.guard.ts) — this only prevents the UI
 * from rendering pages a role has no API access to anyway.
 */
export const ADMIN_ONLY_ROUTE_PREFIXES = ['/dashboard/settings', '/dashboard/users', '/dashboard/quiz/manage', '/dashboard/reports/templates'];

export function isRouteAllowed(pathname: string, role: string | undefined): boolean {
  if (!role) return false;
  const isAdminOnly = ADMIN_ONLY_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !isAdminOnly || role === 'ADMIN';
}
