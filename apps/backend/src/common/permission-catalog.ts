/**
 * Every feature that is covered by access control, and which roles may use it by default. The Admin changes these per
 * role in Settings > RBAC. Admins can always use every feature: that cannot be switched off. The Settings panel
 * itself is not a feature here: it is always and only for Admins.
 *
 * Switching a feature on for a role does not widen what that role can see of other people's data: project, finding and
 * team scoping (a Tester only reaches their own projects, a Team Lead their own team) is applied on top, as before.
 */
export const CONFIGURABLE_ROLES = ['AVP', 'TEAM_LEAD', 'TESTER'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  /** Default for AVP, Team Lead, Tester. */
  defaults: Record<ConfigurableRole, boolean>;
}

const ALL = { AVP: true, TEAM_LEAD: true, TESTER: true };
const NONE = { AVP: false, TEAM_LEAD: false, TESTER: false };
const only = (...roles: ConfigurableRole[]) => ({
  AVP: roles.includes('AVP'),
  TEAM_LEAD: roles.includes('TEAM_LEAD'),
  TESTER: roles.includes('TESTER'),
});

export const PERMISSION_GROUPS = [
  'Dashboard',
  'Projects',
  'Findings',
  'Vulnerability Database',
  'Reports',
  'Report Templates',
  'Quiz',
  'Users',
  'Retention',
  'Updates',
] as const;

export const PERMISSIONS: PermissionDef[] = [
  // Dashboard
  { key: 'dashboard.team_stats', group: 'Dashboard', label: 'Team statistics', description: 'See the team dashboard figures (projects, findings, status counts).', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'dashboard.org_stats', group: 'Dashboard', label: 'Organisation-wide statistics', description: 'See global dashboard statistics across all teams.', defaults: only('AVP') },
  { key: 'dashboard.tl_comparison', group: 'Dashboard', label: 'Compare Team Leads', description: 'See the Team Lead comparison of project status and findings.', defaults: only('AVP') },
  { key: 'dashboard.activity_log', group: 'Dashboard', label: 'Activity log', description: 'See who did what, with role and time, on the dashboard.', defaults: NONE },
  { key: 'dashboard.live_users', group: 'Dashboard', label: 'Live users list', description: 'Open the list of signed-in and idle users within their scope.', defaults: only('AVP', 'TEAM_LEAD') },

  // Projects
  { key: 'projects.view', group: 'Projects', label: 'View projects', description: 'Open the Projects page and project details, search projects (within their scope).', defaults: ALL },
  { key: 'projects.create', group: 'Projects', label: 'Create projects', description: 'Create a new project.', defaults: ALL },
  { key: 'projects.edit', group: 'Projects', label: 'Edit projects', description: 'Change project details.', defaults: ALL },
  { key: 'projects.reassign', group: 'Projects', label: 'Reassign projects', description: 'Move a project to another tester.', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'projects.delete', group: 'Projects', label: 'Delete projects', description: 'Permanently delete a project and everything in it.', defaults: NONE },
  { key: 'projects.scope_import', group: 'Projects', label: 'Import network scope and Nmap results', description: 'Import a Network Scope file or Nmap ports into a project.', defaults: ALL },

  // Findings
  { key: 'findings.view', group: 'Findings', label: 'View findings', description: 'See a project\'s findings and their details.', defaults: ALL },
  { key: 'findings.add', group: 'Findings', label: 'Add findings', description: 'Add a finding from the Vulnerability DB or manually (Add Manually).', defaults: ALL },
  { key: 'findings.edit', group: 'Findings', label: 'Edit findings and PoC steps', description: 'Change a finding and add, edit or remove its PoC steps.', defaults: ALL },
  { key: 'findings.change_status', group: 'Findings', label: 'Change finding status', description: 'Move a finding between Draft, Reviewed and the other statuses.', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'findings.delete', group: 'Findings', label: 'Delete findings', description: 'Delete a finding.', defaults: ALL },
  { key: 'findings.upload_poc', group: 'Findings', label: 'Upload PoC images', description: 'Upload PoC screenshots.', defaults: ALL },
  { key: 'findings.nessus_import', group: 'Findings', label: 'Import Nessus results', description: 'Preview and import a .nessus or Nessus .csv file.', defaults: ALL },
  { key: 'findings.fortify_import', group: 'Findings', label: 'Import Fortify results', description: 'Preview and import a Fortify .fpr or FVDL .xml file into an SCR project.', defaults: ALL },
  { key: 'findings.fortify_delete_all', group: 'Findings', label: 'Delete all Fortify findings of a project', description: 'Delete every Fortify-imported finding of an SCR project at once.', defaults: ALL },
  { key: 'findings.nessus_delete_all', group: 'Findings', label: 'Delete all Nessus findings of a project', description: 'Delete every Nessus-imported VA finding of a project at once.', defaults: ALL },
  { key: 'findings.file_import', group: 'Findings', label: 'Import Project Findings from a file', description: 'Import findings from a .csv or .xlsx file into a project.', defaults: ALL },

  // Vulnerability DB
  { key: 'vulns.view', group: 'Vulnerability Database', label: 'View the Vulnerability DB', description: 'Browse the library, open an entry and its history, see severities.', defaults: ALL },
  { key: 'vulns.export', group: 'Vulnerability Database', label: 'Export the Vulnerability DB', description: 'Download the library as a file.', defaults: ALL },
  { key: 'vulns.create', group: 'Vulnerability Database', label: 'Add entries directly', description: 'Add a library entry that is approved immediately.', defaults: NONE },
  { key: 'vulns.edit', group: 'Vulnerability Database', label: 'Edit entries directly', description: 'Change a library entry without an approval step.', defaults: NONE },
  { key: 'vulns.delete', group: 'Vulnerability Database', label: 'Deactivate entries', description: 'Deactivate (soft delete) a library entry.', defaults: NONE },
  { key: 'vulns.bulk_upload', group: 'Vulnerability Database', label: 'Bulk upload', description: 'Upload many entries from a file (Replace or Merge).', defaults: NONE },
  { key: 'vulns.request_new', group: 'Vulnerability Database', label: 'Request a new entry', description: 'Submit a new vulnerability for approval.', defaults: only('TEAM_LEAD', 'TESTER') },
  { key: 'vulns.propose_edit', group: 'Vulnerability Database', label: 'Propose an edit to an entry', description: 'Ask for a change to an approved entry.', defaults: only('TESTER') },
  { key: 'vulns.review_requests', group: 'Vulnerability Database', label: 'See pending requests', description: 'See pending new-entry requests and pending edit requests, and records still awaiting approval.', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'vulns.approve_requests', group: 'Vulnerability Database', label: 'Approve or reject new entries', description: 'Decide on a request for a new library entry.', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'vulns.approve_changes', group: 'Vulnerability Database', label: 'Approve or reject edits', description: 'Decide on a proposed edit to a library entry.', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'vulns.change_tracker', group: 'Vulnerability Database', label: 'Change Tracker', description: 'See every library change across the system.', defaults: NONE },

  // Reports
  { key: 'reports.generate', group: 'Reports', label: 'Generate reports', description: 'Open the Reports page and generate a Word or Excel report (checks, progress).', defaults: ALL },
  { key: 'reports.download', group: 'Reports', label: 'Download reports', description: 'Download a generated report.', defaults: ALL },
  { key: 'reports.issue_log', group: 'Reports', label: 'Export the Issue Log', description: 'Download the Issue Log CSV of a project.', defaults: ALL },
  { key: 'reports.history', group: 'Reports', label: 'See report history', description: 'List the reports generated for a project.', defaults: ALL },
  { key: 'reports.delete', group: 'Reports', label: 'Delete generated reports', description: 'Delete a generated report (a Tester only their own projects\').', defaults: only('TESTER') },

  // Report templates
  { key: 'templates.view', group: 'Report Templates', label: 'Browse active templates', description: 'See the active report templates and their fields.', defaults: ALL },
  { key: 'templates.view_all', group: 'Report Templates', label: 'See all templates, including inactive', description: 'See inactive and draft templates.', defaults: NONE },
  { key: 'templates.upload', group: 'Report Templates', label: 'Upload templates', description: 'Upload a Word or Excel report template.', defaults: NONE },
  { key: 'templates.edit_fields', group: 'Report Templates', label: 'Edit template fields and mappings', description: 'Add fields, edit labels and map fields to application parameters.', defaults: NONE },
  { key: 'templates.activate', group: 'Report Templates', label: 'Activate or deactivate templates', description: 'Switch a template on or off.', defaults: NONE },
  { key: 'templates.delete', group: 'Report Templates', label: 'Delete templates', description: 'Permanently delete an inactive template.', defaults: NONE },

  // Quiz
  { key: 'quiz.play', group: 'Quiz', label: 'Take part in the quiz', description: 'Open the Quiz, answer questions, see the log, scorecard and leaderboards.', defaults: ALL },
  { key: 'quiz.manage_questions', group: 'Quiz', label: 'Manage quiz questions', description: 'Create, edit, list and delete quiz questions.', defaults: NONE },
  { key: 'quiz.view_responses', group: 'Quiz', label: 'See quiz responses', description: 'See who answered a question and how.', defaults: NONE },
  { key: 'quiz.engagement', group: 'Quiz', label: 'Quiz engagement summary', description: 'See the engagement summary of the quiz.', defaults: NONE },
  { key: 'quiz.rename_team', group: 'Quiz', label: 'Rename a quiz team', description: 'Change the name of their own team on the leaderboard.', defaults: only('TEAM_LEAD') },

  // Users
  { key: 'users.page', group: 'Users', label: 'Open the Users page', description: 'See the Users item in the menu and open the page.', defaults: NONE },
  { key: 'users.list', group: 'Users', label: 'List and look up users', description: 'See users within their scope (also used for pickers such as Reassign).', defaults: only('AVP', 'TEAM_LEAD') },
  { key: 'users.create', group: 'Users', label: 'Create users (temporary password)', description: 'Create an account; a temporary password is issued.', defaults: NONE },
  { key: 'users.bulk_import', group: 'Users', label: 'Bulk import users', description: 'Create many accounts from a file.', defaults: NONE },
  { key: 'users.edit', group: 'Users', label: 'Edit users', description: 'Change a user\'s details, role and team.', defaults: NONE },
  { key: 'users.activate', group: 'Users', label: 'Activate users', description: 'Reactivate a deactivated account.', defaults: NONE },
  { key: 'users.reset_password', group: 'Users', label: 'Reset passwords (temporary password)', description: 'Force a password reset and issue a temporary password.', defaults: NONE },
  { key: 'users.deactivate', group: 'Users', label: 'Deactivate users', description: 'Deactivate an account (24 h grace period).', defaults: NONE },
  { key: 'users.hierarchy', group: 'Users', label: 'Team hierarchy and manager lists', description: 'See the team hierarchy, Team Lead and manager lists.', defaults: NONE },

  // Retention
  { key: 'retention.view', group: 'Retention', label: 'Retention tracker', description: 'Open the Retention page.', defaults: ALL },

  // Updates
  { key: 'updates.install_now', group: 'Updates', label: 'Install an update right away', description: 'Check for updates; when one is available the update starts.', defaults: NONE },
  { key: 'updates.schedule', group: 'Updates', label: 'Schedule or cancel an update', description: 'Schedule an update for a date and time, or cancel it.', defaults: NONE },
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

export type PermissionMatrix = Record<string, Record<ConfigurableRole, boolean>>;

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, { ...p.defaults }]),
);
