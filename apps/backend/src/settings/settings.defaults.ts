export const DEFAULT_SETTINGS = {
  general: {
    appName: 'VAPT Command Center',
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
    vulnerabilityStatuses: ['PENDING', 'APPROVED', 'REJECTED'],
    projectStatuses: ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'COMPLETED'],
    defaults: {
      creationStatus: 'NOT_STARTED',
      workingStatus: 'IN_PROGRESS',
      completionStatus: 'COMPLETED',
    },
  },
  // ponytail: retention/archival periods are stored and validated here but not
  // yet enforced by a scheduled job — there's no cron/worker infra in this repo
  // yet. Add a scheduled task (e.g. @nestjs/schedule) reading these values when
  // actual deletion/archival of old attachments and completed projects is needed.
  system: {
    attachmentRetentionDays: 90,
    projectArchivalDays: 365,
  },
  security: {
    sessionTimeoutMinutes: 15,
    inactivityAction: 'logout', // 'logout' | 'warn'
    passwordMinLength: 14,
    passwordRequireComplexity: true,
  },
  attachments: {
    allowedFileTypes: ['.png', '.jpg', '.jpeg', '.pdf', '.docx'],
    maxFileSizeMb: 10,
  },
  notifications: {
    defaultEnabledTypes: ['VULNERABILITY_REQUESTED', 'VULNERABILITY_APPROVED', 'VULNERABILITY_REJECTED', 'USER_CREATED'],
  },
  formatting: {
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h', // '12h' | '24h'
    timezone: 'Asia/Kolkata',
    numberFormat: 'en-IN',
  },
};

export type AppSettingsShape = typeof DEFAULT_SETTINGS;

/**
 * NOTE on scope: this module stores and serves every setting listed in the
 * UI/UX spec, with server-side validation on save (see settings.service.ts).
 * Enforcement varies by setting — some are already wired into real behavior
 * (documented per-field below); others are persisted and available via
 * GET /settings for the frontend to read, but not yet actively enforced
 * everywhere they'd apply (e.g. attachment size/type limits at every upload
 * call site, password policy inside auth's own validators). Wiring every
 * setting into every code path it could affect is a larger follow-up, not
 * something to fake here.
 */
