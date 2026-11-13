import { ISSUE_LOG_DEFAULT_COLUMNS } from '../reports/issue-log';
import { DEFAULT_ATTACHMENT_SIZES_MB } from '../common/attachment-formats';
import { DEFAULT_NOTIFICATION_RULES } from '../notifications/notification-types';
import { DEFAULT_PERMISSION_MATRIX } from '../common/permission-catalog';

/** Allowed range of the lockout settings. Out-of-range or missing values can never switch the protection off. */
export const LOCKOUT_LIMITS = {
  maxAttempts: { min: 3, max: 20, fallback: 5 },
  durationMinutes: { min: 1, max: 240, fallback: 15 },
} as const;

/** Installs that set MAX_LOGIN_ATTEMPTS keep that value until an Admin saves the setting; anything unusable becomes 5. */
function defaultLockoutMaxAttempts(): number {
  const n = Number.parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '', 10);
  const { min, max, fallback } = LOCKOUT_LIMITS.maxAttempts;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Allowed range of Maximum Rows Per Import File (Import Project Findings). The whole import is one database transaction with a
 * 120 s budget and a file is parsed in memory (the file-size limit still applies on top of this). Measured with bulk inserts:
 * 10,000 rows import in ~4 s, 50,000 in ~21 s, 100,000 in ~44 s (+~120 MB RSS), so 50,000 keeps about 5x headroom on slower disks.
 * The same maximum bounds all files of one import together.
 */
export const IMPORT_ROW_LIMITS = { min: 100, max: 50_000, fallback: 10_000 } as const;

export const DEFAULT_SETTINGS = {
  general: {
    appName: 'PMIS - Project Management for Information Security',
    logoUrl: '',
    faviconUrl: '',
  },
  branding: {
    primaryColor: '#10b981',
    roleAccentColors: {
      ADMIN: '#10b981',
      AVP: '#8b5cf6',
      TEAM_LEAD: '#3b82f6',
      TESTER: '#f59e0b',
    },
  },
  appearance: {
    defaultTheme: 'dark', // 'light' | 'dark' | 'auto'
    tableDensity: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
    dashboardRefreshIntervalSeconds: 30,
    paginationDefault: 20,
  },
  workflow: {
    severityLabels: { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low', Info: 'Info' },
    severityColors: { Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#3b82f6', Info: '#6b7280' },
  },
  system: {
    attachmentRetentionDays: 90,
    projectRetentionDays: 365,
    totalStorageQuotaMb: 10240,
    totalDatabaseQuotaMb: 10240,
  },
  security: {
    sessionTimeoutMinutes: 15,
    inactivityAction: 'logout', // 'logout' | 'warn'
    passwordMinLength: 14,
    passwordRequireComplexity: true,
    // Temporary account lock after repeated failed sign-ins. Bounds are enforced in settings.service.ts (LOCKOUT_LIMITS).
    lockoutMaxAttempts: defaultLockoutMaxAttempts(),
    lockoutDurationMinutes: 15,
  },
  // Admin-set limits for file imports (Settings > System).
  imports: {
    maxRowsPerFile: IMPORT_ROW_LIMITS.fallback,
  },
  // Size limit in MB for every file format PMIS accepts, keyed "<purpose>.<extension>" (see common/attachment-formats.ts).
  attachments: {
    maxSizeMb: DEFAULT_ATTACHMENT_SIZES_MB,
  },
  // Which notifications each role receives, per notification type. Admins always receive all of them.
  notifications: {
    roleRules: DEFAULT_NOTIFICATION_RULES,
  },
  // Which roles may use each feature (Settings > RBAC). Admins can always use every feature.
  rbac: {
    permissions: DEFAULT_PERMISSION_MATRIX,
  },
  formatting: {
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h', // '12h' | '24h'
    numberFormat: 'en-IN',
    // Controls the {Report Date} template parameter specifically (reports,
    // report filenames, Issue Log filenames, ...) — see common/report-date-format.ts.
    reportDateFormat: 'YYYY-MM-DD',
    // Format of each other date placeholder in reports (the defaults are what reports always printed).
    placeholderDates: { startDate: 'Month DD, YYYY', endDate: 'DD-MM-YYYY', generationDate: 'Month DD, YYYY' },
  },
  // Issue Log columns (order = array order) — see reports/issue-log.ts.
  issueLog: {
    columns: ISSUE_LOG_DEFAULT_COLUMNS,
  },
  easterEgg: {
    enabled: true,
    maxAttempts: 40,
    matrixEffects: true,
    pasteCountsAsAttempt: false,
  },
};

export type AppSettingsShape = typeof DEFAULT_SETTINGS;

/**
 * NOTE on scope: this module stores and serves every setting listed in the
 * UI/UX spec, with server-side validation on save (see settings.service.ts).
 * Enforcement varies by setting — some are already wired into real behavior
 * (documented per-field below); others are persisted and available via
 * GET /settings for the frontend to read, but not yet actively enforced
 * everywhere they'd apply (e.g. password policy inside auth's own validators).
 * Attachment size limits and notification role rules ARE enforced: see common/attachment-formats.ts and
 * notifications.service.ts. Wiring every
 * setting into every code path it could affect is a larger follow-up, not
 * something to fake here.
 */
