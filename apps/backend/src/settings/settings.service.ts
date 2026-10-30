import { Injectable, BadRequestException, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../reports/storage.service';
import { DEFAULT_SETTINGS } from './settings.defaults';
import { validateIssueLogColumns } from '../reports/issue-log';
import { REPORT_DATE_FORMAT_OPTIONS, PLACEHOLDER_DATE_FORMAT_OPTIONS, DEFAULT_PLACEHOLDER_DATE_FORMATS, placeholderDateFormats } from '../common/report-date-format';
import { ATTACHMENT_FORMATS, ATTACHMENT_FORMAT_BY_KEY, ATTACHMENT_PURPOSES, attachmentLimits } from '../common/attachment-formats';
import { CONFIGURABLE_NOTIFICATION_ROLES, NOTIFICATION_TYPES } from '../notifications/notification-types';
import { resetQuotaCache } from '../common/quota';
import { SETTINGS_ID, deepMerge, isPlainObject, pruneUnknown, readEffectiveSettings } from './settings.store';
import { CONFIGURABLE_ROLES, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_KEYS } from '../common/permission-catalog';
import { permissionRules } from '../common/permissions';

// Keep in sync with apps/frontend/src/lib/themes.ts (THEME_IDS) — the
// single source of truth for the actual token values per theme.
const THEME_OPTIONS = ['dark', 'midnight-azure', 'obsidian-turquoise', 'copper-noir', 'titanium-flux', 'quantum-emerald', 'holographic-noir'];
const DENSITY_OPTIONS = ['compact', 'comfortable', 'spacious'];
const INACTIVITY_OPTIONS = ['logout', 'warn'];
const TIME_FORMAT_OPTIONS = ['12h', '24h'];
const DATE_FORMAT_OPTIONS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/** A logo or favicon is empty, a path on this site, or a small embedded image (the page's CSP allows no other source). */
export function validateImageSource(v: unknown): string | null {
  if (typeof v !== 'string') return 'must be text';
  if (v === '') return null;
  if (v.length > 300_000) return 'is too large (use an image under about 200 KB)';
  if (/^\/(?!\/)[^\s"'<>]*$/.test(v)) return null;
  if (/^data:image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(v)) return null;
  return 'must be empty, a path on this site such as /logo.png, or an uploaded PNG, JPEG, GIF, WebP or ICO image';
}

/**
 * Validates only the fields present in the patch (partial updates are
 * allowed — each settings category saves independently in the UI).
 * Unknown top-level categories/keys are rejected to prevent silent typos
 * from being stored forever.
 */
function validatePatch(patch: any) {
  const errors: string[] = [];
  const knownCategories = Object.keys(DEFAULT_SETTINGS);

  for (const category of Object.keys(patch)) {
    if (!knownCategories.includes(category)) {
      errors.push(`Unknown settings category "${category}"`);
      continue;
    }
    const value = patch[category];
    if (!isPlainObject(value)) {
      errors.push(`"${category}" must be an object`);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (!(key in (DEFAULT_SETTINGS as any)[category])) {
        errors.push(`Unknown setting "${category}.${key}"`);
      }
    }
  }

  const general = patch.general;
  if (general?.appName !== undefined && (typeof general.appName !== 'string' || !general.appName.trim() || general.appName.length > 80)) {
    errors.push('general.appName must be text of 1 to 80 characters');
  }
  for (const key of ['logoUrl', 'faviconUrl'] as const) {
    const err = general?.[key] !== undefined ? validateImageSource(general[key]) : null;
    if (err) errors.push(`general.${key} ${err}`);
  }

  const labels = patch.workflow?.severityLabels;
  if (labels !== undefined) {
    if (!isPlainObject(labels)) errors.push('workflow.severityLabels must be an object');
    else {
      for (const [sev, label] of Object.entries(labels)) {
        if (!(sev in DEFAULT_SETTINGS.workflow.severityLabels)) errors.push(`Unknown severity "${sev}" in workflow.severityLabels`);
        else if (typeof label !== 'string' || !label.trim() || label.length > 30) errors.push(`The label for ${sev} must be text of 1 to 30 characters`);
      }
    }
  }

  const appearance = patch.appearance;
  if (appearance?.defaultTheme !== undefined && !THEME_OPTIONS.includes(appearance.defaultTheme)) {
    errors.push(`appearance.defaultTheme must be one of ${THEME_OPTIONS.join(', ')}`);
  }
  if (appearance?.tableDensity !== undefined && !DENSITY_OPTIONS.includes(appearance.tableDensity)) {
    errors.push(`appearance.tableDensity must be one of ${DENSITY_OPTIONS.join(', ')}`);
  }
  if (appearance?.dashboardRefreshIntervalSeconds !== undefined) {
    const v = appearance.dashboardRefreshIntervalSeconds;
    if (typeof v !== 'number' || v < 5 || v > 3600) errors.push('appearance.dashboardRefreshIntervalSeconds must be a number between 5 and 3600');
  }
  if (appearance?.paginationDefault !== undefined) {
    const v = appearance.paginationDefault;
    if (typeof v !== 'number' || v < 5 || v > 200) errors.push('appearance.paginationDefault must be a number between 5 and 200');
  }

  const security = patch.security;
  if (security?.sessionTimeoutMinutes !== undefined) {
    const v = security.sessionTimeoutMinutes;
    if (typeof v !== 'number' || v < 1 || v > 1440) errors.push('security.sessionTimeoutMinutes must be a number between 1 and 1440');
  }
  if (security?.inactivityAction !== undefined && !INACTIVITY_OPTIONS.includes(security.inactivityAction)) {
    errors.push(`security.inactivityAction must be one of ${INACTIVITY_OPTIONS.join(', ')}`);
  }
  if (security?.passwordMinLength !== undefined) {
    const v = security.passwordMinLength;
    if (typeof v !== 'number' || v < 8 || v > 64) errors.push('security.passwordMinLength must be a number between 8 and 64');
  }

  const sizes = patch.attachments?.maxSizeMb;
  if (sizes !== undefined) {
    if (!isPlainObject(sizes)) {
      errors.push('attachments.maxSizeMb must be an object');
    } else {
      for (const [key, v] of Object.entries(sizes)) {
        const format = ATTACHMENT_FORMAT_BY_KEY.get(key);
        if (!format) errors.push(`Unknown file format "${key}"`);
        else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > format.maxMb) {
          errors.push(`The size limit for ${format.label} (${format.purpose}) must be a whole number of MB between 1 and ${format.maxMb}`);
        }
      }
    }
  }

  const rules = patch.notifications?.roleRules;
  if (rules !== undefined) {
    if (!isPlainObject(rules)) {
      errors.push('notifications.roleRules must be an object');
    } else {
      const known = new Set(NOTIFICATION_TYPES.map((n) => n.type));
      for (const [type, perRole] of Object.entries(rules)) {
        if (!known.has(type)) {
          errors.push(`Unknown notification type "${type}"`);
        } else if (!isPlainObject(perRole)) {
          errors.push(`notifications.roleRules.${type} must be an object`);
        } else {
          for (const [role, on] of Object.entries(perRole as Record<string, unknown>)) {
            if (role === 'ADMIN') errors.push('Admins always receive every notification; it cannot be changed');
            else if (!(CONFIGURABLE_NOTIFICATION_ROLES as readonly string[]).includes(role)) errors.push(`Unknown role "${role}" for ${type}`);
            else if (typeof on !== 'boolean') errors.push(`notifications.roleRules.${type}.${role} must be true or false`);
          }
        }
      }
    }
  }

  const perms = patch.rbac?.permissions;
  if (perms !== undefined) {
    if (!isPlainObject(perms)) {
      errors.push('rbac.permissions must be an object');
    } else {
      for (const [feature, perRole] of Object.entries(perms)) {
        if (!PERMISSION_KEYS.has(feature)) {
          errors.push(`Unknown feature "${feature}"`);
        } else if (!isPlainObject(perRole)) {
          errors.push(`rbac.permissions.${feature} must be an object`);
        } else {
          for (const [role, on] of Object.entries(perRole as Record<string, unknown>)) {
            if (role === 'ADMIN') errors.push('Admins always have every permission; it cannot be changed');
            else if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) errors.push(`Unknown role "${role}" for ${feature}`);
            else if (typeof on !== 'boolean') errors.push(`rbac.permissions.${feature}.${role} must be true or false`);
          }
        }
      }
    }
  }

  const formatting = patch.formatting;
  if (formatting?.dateFormat !== undefined && !DATE_FORMAT_OPTIONS.includes(formatting.dateFormat)) {
    errors.push(`formatting.dateFormat must be one of ${DATE_FORMAT_OPTIONS.join(', ')}`);
  }
  if (formatting?.numberFormat !== undefined) {
    const loc = formatting.numberFormat;
    let valid = false;
    try {
      valid = typeof loc === 'string' && Intl.NumberFormat.supportedLocalesOf([loc]).length > 0;
    } catch {
      valid = false;
    }
    if (!valid) errors.push('formatting.numberFormat must be a valid locale such as en-IN, en-US or de-DE');
  }
  if (formatting?.timeFormat !== undefined && !TIME_FORMAT_OPTIONS.includes(formatting.timeFormat)) {
    errors.push(`formatting.timeFormat must be one of ${TIME_FORMAT_OPTIONS.join(', ')}`);
  }
  if (formatting?.reportDateFormat !== undefined && !REPORT_DATE_FORMAT_OPTIONS.includes(formatting.reportDateFormat)) {
    errors.push(`formatting.reportDateFormat must be one of ${REPORT_DATE_FORMAT_OPTIONS.join(', ')}`);
  }

  if (formatting?.placeholderDates !== undefined) {
    const pd = formatting.placeholderDates;
    if (!pd || typeof pd !== 'object' || Array.isArray(pd)) errors.push('formatting.placeholderDates must be an object');
    else {
      for (const [key, value] of Object.entries(pd)) {
        if (!(key in DEFAULT_PLACEHOLDER_DATE_FORMATS)) errors.push(`Unknown date placeholder "${key}"`);
        else if (!(PLACEHOLDER_DATE_FORMAT_OPTIONS as readonly string[]).includes(value as string)) {
          errors.push(`formatting.placeholderDates.${key} must be one of ${PLACEHOLDER_DATE_FORMAT_OPTIONS.join(', ')}`);
        }
      }
    }
  }

  const system = patch.system;
  if (system?.attachmentRetentionDays !== undefined) {
    const v = system.attachmentRetentionDays;
    if (typeof v !== 'number' || v < 1 || v > 3650) errors.push('system.attachmentRetentionDays must be a number between 1 and 3650');
  }
  if (system?.projectRetentionDays !== undefined) {
    const v = system.projectRetentionDays;
    if (typeof v !== 'number' || v < 1 || v > 3650) errors.push('system.projectRetentionDays must be a number between 1 and 3650');
  }
  if (system?.totalStorageQuotaMb !== undefined) {
    const v = system.totalStorageQuotaMb;
    if (typeof v !== 'number' || v < 1) errors.push('system.totalStorageQuotaMb must be a positive number');
  }
  if (system?.totalDatabaseQuotaMb !== undefined) {
    const v = system.totalDatabaseQuotaMb;
    if (typeof v !== 'number' || v < 1) errors.push('system.totalDatabaseQuotaMb must be a positive number');
  }

  if (patch.issueLog?.columns !== undefined) {
    const err = validateIssueLogColumns(patch.issueLog.columns);
    if (err) errors.push(err);
  }

  const egg = patch.easterEgg;
  for (const key of ['enabled', 'matrixEffects', 'pasteCountsAsAttempt']) {
    if (egg?.[key] !== undefined && typeof egg[key] !== 'boolean') errors.push(`easterEgg.${key} must be a boolean`);
  }
  if (egg?.maxAttempts !== undefined) {
    const v = egg.maxAttempts;
    if (!Number.isInteger(v) || v < 30 || v > 50) errors.push('easterEgg.maxAttempts must be an integer between 30 and 50');
  }

  return errors;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private redisService: RedisService,
    @Inject(forwardRef(() => StorageService)) private storageService: StorageService,
  ) {}

  /** Loads the saved attachment limits so upload checks use them from the first request. */
  async onModuleInit() {
    try {
      await this.get(); // also loads the attachment limits and the RBAC matrix
    } catch {
      // The database is not reachable yet: the defaults stay in force until the next settings load.
    }
  }

  async get() {
    const { settings, updatedAt, updatedById } = await readEffectiveSettings(this.prisma);
    attachmentLimits.set(settings.attachments.maxSizeMb);
    permissionRules.set(settings.rbac.permissions);
    placeholderDateFormats.setFromSettings(settings.formatting);
    return {
      settings,
      updatedAt,
      updatedById,
      // What the Settings screen needs to list: the file formats PMIS accepts, and the notifications it sends.
      attachmentFormats: { purposes: ATTACHMENT_PURPOSES, formats: ATTACHMENT_FORMATS },
      notificationTypes: NOTIFICATION_TYPES,
      permissionCatalog: { groups: PERMISSION_GROUPS, permissions: PERMISSIONS },
    };
  }

  /**
   * The Admin-chosen default theme and the application name, logo and favicon, so the login page can render
   * them before anyone is authenticated. Deliberately returns no other setting.
   */
  async getPublicTheme(): Promise<{ defaultTheme: string; appName: string; logoUrl: string; faviconUrl: string }> {
    const { settings } = await this.get();
    return {
      defaultTheme: settings.appearance.defaultTheme,
      // Name, logo and favicon are branding, shown on the login page and the browser tab before anyone signs in.
      appName: settings.general.appName,
      logoUrl: settings.general.logoUrl,
      faviconUrl: settings.general.faviconUrl,
    };
  }

  // The idle-timeout lookup runs on every authenticated request, so cache it
  // briefly instead of hitting the DB each time.
  // ponytail: per-process cache — other instances pick up a change within the
  // TTL; move to Redis pub/sub if instant propagation matters.
  private timeoutCache: { seconds: number; at: number } | null = null;
  private static readonly TIMEOUT_CACHE_MS = 10_000;

  async getSessionTimeoutSeconds(): Promise<number> {
    const now = Date.now();
    if (this.timeoutCache && now - this.timeoutCache.at < SettingsService.TIMEOUT_CACHE_MS) {
      return this.timeoutCache.seconds;
    }
    const { settings } = await this.get();
    const seconds = settings.security.sessionTimeoutMinutes * 60;
    this.timeoutCache = { seconds, at: now };
    return seconds;
  }

  /** Validates a user-supplied password against the admin-configured security policy. */
  async validatePassword(password: string): Promise<string[]> {
    const { settings } = await this.get();
    const { passwordMinLength, passwordRequireComplexity } = settings.security;
    const errors: string[] = [];

    if (password.length < passwordMinLength) {
      errors.push(`Password must be at least ${passwordMinLength} characters`);
    }
    if (passwordRequireComplexity) {
      if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
      if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
      if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
      if (!/[^a-zA-Z0-9]/.test(password)) errors.push('Password must contain a symbol');
    }
    return errors;
  }

  async update(patch: any, actorId: string, ipAddress: string, userAgent: string) {
    const errors = validatePatch(patch);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }

    const row = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    const before = row ? (row.data as any) : {};
    const merged = deepMerge(deepMerge(DEFAULT_SETTINGS, pruneUnknown(DEFAULT_SETTINGS, before)), patch);

    await this.prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, data: merged, updatedById: actorId },
      update: { data: merged, updatedById: actorId },
    });

    this.timeoutCache = null;
    // A changed quota applies to the very next request, not after the measurement cache runs out.
    resetQuotaCache();
    this.storageService.resetUsage?.();

    await this.auditService.log({
      actorId,
      action: 'SETTINGS_UPDATED',
      targetType: 'SETTINGS',
      targetId: SETTINGS_ID,
      ipAddress,
      userAgent,
      details: { changed: patch },
    });

    return this.get();
  }

  async getSystemHealth() {
    const { settings } = await this.get();
    const storageQuotaMb = settings.system.totalStorageQuotaMb;
    const dbQuotaMb = settings.system.totalDatabaseQuotaMb;

    let dbStatus: 'up' | 'down' = 'down';
    let dbUsedMb: number | null = null;
    try {
      const [{ size }] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) as size`;
      dbStatus = 'up';
      dbUsedMb = Math.round(Number(size) / (1024 * 1024));
    } catch {
      dbStatus = 'down';
    }

    let redisStatus: 'up' | 'down' = 'down';
    try {
      redisStatus = (await this.redisService.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      redisStatus = 'down';
    }

    const storage = await this.storageService.healthCheck();
    let storageUsedMb: number | null = null;
    if (storage.reachable) {
      try {
        storageUsedMb = Math.round((await this.storageService.getUsedBytes()) / (1024 * 1024));
      } catch {
        storageUsedMb = null;
      }
    }

    return {
      backend: {
        port: Number(process.env.PORT) || 4000,
        nodeEnv: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsedMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      },
      database: {
        status: dbStatus,
        port: 5432,
        totalMb: dbQuotaMb,
        usedMb: dbUsedMb,
        availableMb: dbUsedMb != null ? Math.max(0, dbQuotaMb - dbUsedMb) : null,
      },
      redis: {
        status: redisStatus,
        port: 6379,
      },
      storage: {
        status: storage.reachable ? 'up' : 'down',
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        port: storage.port,
        totalMb: storageQuotaMb,
        usedMb: storageUsedMb,
        availableMb: storageUsedMb != null ? Math.max(0, storageQuotaMb - storageUsedMb) : null,
      },
    };
  }

  async getHistory(limit = 20) {
    return this.prisma.auditLog.findMany({
      where: { targetType: 'SETTINGS' },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, username: true, fullName: true, role: true } } },
    });
  }
}
