/**
 * Every notification PMIS creates, and who it goes to. The Admin can switch each one off per role (AVP, Team Lead,
 * Tester) in Settings > Notifications. Admins always receive every notification: that cannot be changed.
 */
export interface NotificationTypeInfo {
  type: string;
  label: string;
  description: string;
}

export const NOTIFICATION_TYPES: NotificationTypeInfo[] = [
  { type: 'VULNERABILITY_REQUESTED', label: 'New vulnerability submitted', description: 'Someone submitted a new vulnerability for approval. Sent to Admins, AVPs and Team Leads.' },
  { type: 'VULNERABILITY_APPROVED', label: 'Vulnerability approved', description: 'A vulnerability you submitted was approved. Sent to the person who submitted it.' },
  { type: 'VULNERABILITY_REJECTED', label: 'Vulnerability rejected', description: 'A vulnerability you submitted was rejected. Sent to the person who submitted it.' },
  { type: 'VULNERABILITY_EDITED', label: 'Vulnerability edited by an Admin', description: 'An Admin changed a library entry a person had submitted.' },
  { type: 'VULNERABILITY_CHANGE_REQUESTED', label: 'Change to a vulnerability requested', description: 'A Tester proposed an edit to an approved vulnerability. Sent to the reviewers.' },
  { type: 'VULNERABILITY_CHANGE_APPROVED', label: 'Vulnerability change approved', description: 'A proposed edit was approved. Sent to the person who proposed it.' },
  { type: 'VULNERABILITY_CHANGE_REJECTED', label: 'Vulnerability change rejected', description: 'A proposed edit was rejected. Sent to the person who proposed it.' },
  { type: 'PROJECT_ASSIGNED', label: 'Project assigned', description: 'A project was assigned or reassigned to the person.' },
  { type: 'USER_CREATED', label: 'User account created', description: 'A new account was created. Sent to the new user and to Admins, AVPs and Team Leads.' },
  { type: 'USER_UPDATED', label: 'User account updated', description: 'An account was changed. Sent to the user and to the person who made the change.' },
  { type: 'QUIZ_QUESTION_LIVE', label: 'Quiz question is live', description: 'Today\'s quiz question was published. Sent to everyone.' },
  { type: 'QUIZ_ANSWER_REVEALED', label: 'Quiz answer revealed', description: 'The answer to a quiz question was revealed. Sent to everyone.' },
  { type: 'SYSTEM_UPDATE', label: 'System update', description: 'An update was scheduled, is about to start, or has finished. Sent to everyone.' },
];

/** Roles whose notifications the Admin can switch. Admin is not listed: it always receives all of them. */
export const CONFIGURABLE_NOTIFICATION_ROLES = ['AVP', 'TEAM_LEAD', 'TESTER'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_NOTIFICATION_ROLES)[number];

export type NotificationRoleRules = Record<string, Record<ConfigurableRole, boolean>>;

/** Everything on for every role, as it was before the setting existed. */
export const DEFAULT_NOTIFICATION_RULES: NotificationRoleRules = Object.fromEntries(
  NOTIFICATION_TYPES.map((n) => [n.type, { AVP: true, TEAM_LEAD: true, TESTER: true }]),
);

/** Whether a user with this role gets this notification. Admins always do; a rule that is missing means on. */
export function roleReceives(rules: NotificationRoleRules | undefined, type: string, role: string): boolean {
  if (role === 'ADMIN') return true;
  return (rules?.[type] as any)?.[role] !== false;
}
