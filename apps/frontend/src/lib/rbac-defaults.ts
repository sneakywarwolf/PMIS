/**
 * What each role may do when the server has not (yet) said: the shipped defaults of Settings > RBAC, as
 * [AVP, Team Lead, Tester]. Used only if the permissions cannot be loaded, so a hiccup never locks people out of
 * features they normally have; the server still enforces the real rules on every request. Kept identical to
 * apps/backend/src/common/permission-catalog.ts by a backend test.
 */
export const DEFAULT_PERMISSIONS: Record<string, [boolean, boolean, boolean]> = {
  'dashboard.team_stats': [true, true, false],
  'dashboard.org_stats': [true, false, false],
  'dashboard.tl_comparison': [true, false, false],
  'dashboard.activity_log': [false, false, false],
  'dashboard.live_users': [true, true, false],
  'projects.view': [true, true, true],
  'projects.create': [true, true, true],
  'projects.edit': [true, true, true],
  'projects.reassign': [true, true, false],
  'projects.delete': [false, false, false],
  'projects.scope_import': [true, true, true],
  'findings.view': [true, true, true],
  'findings.add': [true, true, true],
  'findings.edit': [true, true, true],
  'findings.change_status': [true, true, false],
  'findings.delete': [true, true, true],
  'findings.upload_poc': [true, true, true],
  'findings.nessus_import': [true, true, true],
  'findings.fortify_import': [true, true, true],
  'findings.fortify_delete_all': [true, true, true],
  'findings.nessus_delete_all': [true, true, true],
  'findings.file_import': [true, true, true],
  'vulns.view': [true, true, true],
  'vulns.export': [true, true, true],
  'vulns.create': [false, false, false],
  'vulns.edit': [false, false, false],
  'vulns.delete': [false, false, false],
  'vulns.bulk_upload': [false, false, false],
  'vulns.request_new': [false, true, true],
  'vulns.propose_edit': [false, false, true],
  'vulns.review_requests': [true, true, false],
  'vulns.approve_requests': [true, true, false],
  'vulns.approve_changes': [true, true, false],
  'vulns.change_tracker': [false, false, false],
  'reports.page': [false, false, false],
  'reports.generate': [true, true, true],
  'reports.download': [true, true, true],
  'reports.issue_log': [true, true, true],
  'reports.history': [true, true, true],
  'reports.delete': [false, false, true],
  'templates.view': [true, true, true],
  'templates.view_all': [false, false, false],
  'templates.upload': [false, false, false],
  'templates.edit_fields': [false, false, false],
  'templates.activate': [false, false, false],
  'templates.delete': [false, false, false],
  'quiz.play': [true, true, true],
  'quiz.manage_questions': [false, false, false],
  'quiz.view_responses': [false, false, false],
  'quiz.engagement': [false, false, false],
  'quiz.rename_team': [false, true, false],
  'users.page': [false, false, false],
  'users.list': [true, true, false],
  'users.create': [false, false, false],
  'users.bulk_import': [false, false, false],
  'users.edit': [false, false, false],
  'users.activate': [false, false, false],
  'users.reset_password': [false, false, false],
  'users.deactivate': [false, false, false],
  'users.hierarchy': [false, false, false],
  'retention.view': [true, true, true],
  'updates.install_now': [false, false, false],
  'updates.schedule': [false, false, false],
};

export function defaultPermissionsFor(role: string | undefined): Record<string, boolean> {
  const idx = role === 'AVP' ? 0 : role === 'TEAM_LEAD' ? 1 : role === 'TESTER' ? 2 : null;
  const out: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(DEFAULT_PERMISSIONS)) out[key] = role === 'ADMIN' || (idx !== null && v[idx]);
  return out;
}
