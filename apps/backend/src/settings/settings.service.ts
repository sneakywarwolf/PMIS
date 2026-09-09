import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../reports/storage.service';
import { DEFAULT_SETTINGS } from './settings.defaults';

const SETTINGS_ID = 'singleton';

const THEME_OPTIONS = ['light', 'dark', 'auto'];
const DENSITY_OPTIONS = ['compact', 'comfortable', 'spacious'];
const INACTIVITY_OPTIONS = ['logout', 'warn'];
const TIME_FORMAT_OPTIONS = ['12h', '24h'];

function isPlainObject(v: any) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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

  const system = patch.system;
  if (system?.attachmentRetentionDays !== undefined) {
    const v = system.attachmentRetentionDays;
    if (typeof v !== 'number' || v < 1 || v > 3650) errors.push('system.attachmentRetentionDays must be a number between 1 and 3650');
  }
  if (system?.projectArchivalDays !== undefined) {
    const v = system.projectArchivalDays;
    if (typeof v !== 'number' || v < 1 || v > 3650) errors.push('system.projectArchivalDays must be a number between 1 and 3650');
  }

  return errors;
}

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private redisService: RedisService,
    private storageService: StorageService,
  ) {}

  async get() {
    const row = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    const stored = row ? (row.data as any) : {};
    return {
      settings: deepMerge(DEFAULT_SETTINGS, stored),
      updatedAt: row?.updatedAt ?? null,
      updatedById: row?.updatedById ?? null,
    };
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
    const merged = deepMerge(deepMerge(DEFAULT_SETTINGS, before), patch);

    await this.prisma.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, data: merged, updatedById: actorId },
      update: { data: merged, updatedById: actorId },
    });

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
    let dbStatus: 'up' | 'down' = 'down';
    let dbSizeMb: number | null = null;
    try {
      const [{ size }] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) as size`;
      dbStatus = 'up';
      dbSizeMb = Math.round(Number(size) / (1024 * 1024));
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
        sizeMb: dbSizeMb,
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
