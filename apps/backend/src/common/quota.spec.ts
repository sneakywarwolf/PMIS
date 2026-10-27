import { HttpException } from '@nestjs/common';
import { DatabaseQuotaGuard, resetQuotaCache } from './quota';

const ctx = (method: string, path: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, path, url: path }) }) }) as any;

describe('DatabaseQuotaGuard', () => {
  const make = (usedMb: number, quotaMb: number) => {
    const prisma = {
      appSettings: { findUnique: jest.fn().mockResolvedValue({ data: { system: { totalDatabaseQuotaMb: quotaMb } }, updatedAt: new Date(), updatedById: null }) },
      $queryRaw: jest.fn().mockResolvedValue([{ size: BigInt(Math.round(usedMb * 1024 * 1024)) }]),
    };
    return { guard: new DatabaseQuotaGuard(prisma as any), prisma };
  };

  beforeEach(() => resetQuotaCache());

  it('lets writes through while under the quota', async () => {
    const { guard } = make(10, 100);
    await expect(guard.canActivate(ctx('POST', '/projects'))).resolves.toBe(true);
  });

  it('refuses POST/PUT/PATCH with 507 at or over the quota', async () => {
    const { guard } = make(100, 100);
    for (const m of ['POST', 'PUT', 'PATCH']) {
      await expect(guard.canActivate(ctx(m, '/projects'))).rejects.toMatchObject({ status: 507 });
    }
    await expect(guard.canActivate(ctx('POST', '/projects'))).rejects.toBeInstanceOf(HttpException);
  });

  it('never blocks reads or deletes, so space can be freed', async () => {
    const { guard, prisma } = make(500, 100);
    await expect(guard.canActivate(ctx('GET', '/projects'))).resolves.toBe(true);
    await expect(guard.canActivate(ctx('DELETE', '/projects/1'))).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps sign-in, settings, presence, notifications and updates available', async () => {
    const { guard } = make(500, 100);
    for (const p of ['/auth/login', '/settings', '/presence/heartbeat', '/notifications/read-all', '/update/apply']) {
      await expect(guard.canActivate(ctx('POST', p))).resolves.toBe(true);
      await expect(guard.canActivate(ctx('PUT', p))).resolves.toBe(true);
    }
  });

  it('recovers once the quota is raised and the cache is reset', async () => {
    const { guard, prisma } = make(100, 100);
    await expect(guard.canActivate(ctx('POST', '/projects'))).rejects.toMatchObject({ status: 507 });
    prisma.appSettings.findUnique.mockResolvedValue({ data: { system: { totalDatabaseQuotaMb: 200 } }, updatedAt: new Date(), updatedById: null });
    await expect(guard.canActivate(ctx('POST', '/projects'))).resolves.toBe(true);
  });
});
