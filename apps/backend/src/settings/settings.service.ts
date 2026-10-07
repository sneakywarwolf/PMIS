import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../reports/storage.service';
import { DEFAULT_SETTINGS } from './settings.defaults';
import { validateIssueLogColumns } from '../reports/issue-log';
import { REPORT_DATE_FORMAT_OPTIONS } from '../common/report-date-format';

const SETTINGS_ID = 'singleton';

// Keep in sync with apps/frontend/src/lib/themes.ts (THEME_IDS) — the
// single source of truth for the actual token values per theme.
const THEME_OPTIONS = ['dark', 'midnight-azure', 'obsidian-turquoise', 'copper-noir', 'titanium-flux', 'quantum-emerald', 'holographic-noir'];
const DENSITY_OPTIONS = ['compact', 'comfortable', 'spacious'];
const INACTIVITY_OPTIONS = ['logout', 'warn'];
const TIME_FORMAT_OPTIONS = ['12h', '24h'];

function isPlainObject(v: any) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Drops any key from `data` that no longer exists in `base`, recursively.
 * Prevents settings retired from a past schema version (e.g. an old
 * workflow/system field) from resurfacing via the DB and then being
 * rejected as "unknown" when the client saves them straight back.
 */
function pruneUnknown(base: any, data: any): any {
  if (!isPlainObject(data)) return data;
  const result: any = {};
  for (const key of Object.keys(data)) {
    if (!(key in base)) continue;
    result[key] = isPlainObject(base[key]) ? pruneUnknown(base[key], data[key]) : data[key];
  }
  return result;
}

function deepMerge(base: any, patch: any): any {
  if (!isPlainObject(patch)) return base;
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (isPlainObject(patch[key]) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
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

  const attachments = patch.attachments;
  if (attachments?.maxFileSizeMb !== undefined) {
    const v = attachments.maxFileSizeMb;
    if (typeof v !== 'number' || v < 1 || v > 500) errors.push('attachments.maxFileSizeMb must be a number between 1 and 500');
  }
  if (attachments?.allowedFileTypes !== undefined && !Array.isArray(attachments.allowedFileTypes)) {
    errors.push('attachments.allowedFileTypes must be an array');
  }

  const formatting = patch.formatting;
  if (formatting?.timeFormat !== undefined && !TIME_FORMAT_OPTIONS.includes(formatting.timeFormat)) {
    errors.push(`formatting.timeFormat must be one of ${TIME_FORMAT_OPTIONS.join(', ')}`);
  }
  if (formatting?.reportDateFormat !== undefined && !REPORT_DATE_FORMAT_OPTIONS.includes(formatting.reportDateFormat)) {
    errors.push(`formatting.reportDateFormat must be one of ${REPORT_DATE_FORMAT_OPTIONS.join(', ')}`);
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
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private redisService: RedisService,
    @Inject(forwardRef(() => StorageService)) private storageService: StorageService,
  ) {}

  async get() {
    const row = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    const stored = row ? (row.data as any) : {};
    return {
      settings: deepMerge(DEFAULT_SETTINGS, pruneUnknown(DEFAULT_SETTINGS, stored)),
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
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
      include: { actor: { select: { id: true, username: true } } },
    });
  }
}
