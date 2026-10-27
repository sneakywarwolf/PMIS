import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readEffectiveSettings } from '../settings/settings.store';

/**
 * The size quotas of Settings > System. Storage: a file upload is refused when it would take the bucket over its
 * quota. Database: while the database is at or over its quota, requests that add or change data are refused
 * (reads, deletes, sign-in and the settings themselves still work, so an Admin can free space or raise the quota).
 * Sizes are measured at most once a minute; saving the settings measures again at once.
 */
const CACHE_MS = 60_000;
let dbCache: { usedMb: number; at: number } | null = null;

export const resetQuotaCache = () => {
  dbCache = null;
};

export const quotaError = (what: 'database' | 'storage', usedMb: number, quotaMb: number) =>
  new HttpException(
    `The ${what} has reached its size quota of ${quotaMb} MB (about ${Math.round(usedMb)} MB used). Free up space, or ask an Admin to raise the quota in Settings > System.`,
    507,
  );

/** Paths that must keep working when the database is full. */
const EXEMPT_PREFIXES = ['/auth', '/settings', '/presence', '/notifications', '/update'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

@Injectable()
export class DatabaseQuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (!req || !WRITE_METHODS.has(String(req.method).toUpperCase())) return true;
    const path = String(req.path ?? req.url ?? '').split('?')[0];
    if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;

    const { settings } = await readEffectiveSettings(this.prisma);
    const quotaMb = settings.system.totalDatabaseQuotaMb;
    if (!dbCache || Date.now() - dbCache.at > CACHE_MS) {
      const [{ size }] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) as size`;
      dbCache = { usedMb: Number(size) / (1024 * 1024), at: Date.now() };
    }
    if (dbCache.usedMb >= quotaMb) throw quotaError('database', dbCache.usedMb, quotaMb);
    return true;
  }
}
