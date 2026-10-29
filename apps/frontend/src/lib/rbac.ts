/**
 * Which feature (Settings > RBAC) opens each dashboard page. Checked in the browser on every navigation and for the
 * menu and the Ctrl+K palette; the backend's PermissionGuard is the real enforcement boundary, this only stops the
 * UI from showing pages a role cannot use. The Settings page is not a feature: it is Admin only, always.
 */
export const ADMIN_ONLY_ROUTE_PREFIXES = ['/dashboard/settings'];

/** Most specific first. A page opens when the role may use any one of the listed features. */
export const ROUTE_PERMISSIONS: [string, string[]][] = [
  ['/dashboard/quiz/manage', ['quiz.manage_questions']],
  ['/dashboard/quiz', ['quiz.play']],
  ['/dashboard/projects/new', ['projects.create']],
  ['/dashboard/projects', ['projects.view']],
  ['/dashboard/reports', ['reports.generate', 'templates.view']],
  ['/dashboard/vulnerabilities', ['vulns.view']],
  ['/dashboard/retention', ['retention.view']],
  ['/dashboard/users', ['users.page']],
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The features that open this page ([] when any signed-in user may open it). */
export function featuresForRoute(pathname: string): string[] {
  return ROUTE_PERMISSIONS.find(([prefix]) => under(pathname, prefix))?.[1] ?? [];
}

/** `can` answers for the signed-in user; Admins pass everything except nothing is hidden from them. */
export function isRouteAllowed(pathname: string, role: string | undefined, can: (key: string) => boolean): boolean {
  if (!role) return false;
  if (ADMIN_ONLY_ROUTE_PREFIXES.some((p) => under(pathname, p))) return role === 'ADMIN';
  const features = featuresForRoute(pathname);
  return features.length === 0 || features.some(can);
}
