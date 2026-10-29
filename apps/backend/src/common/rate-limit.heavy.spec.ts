import { HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { isHeavyRoute } from './rate-limit';

describe('isHeavyRoute', () => {
  it('flags imports, uploads and report generation only', () => {
    expect(isHeavyRoute('POST', '/reports/generate')).toBe(true);
    expect(isHeavyRoute('POST', '/findings/nessus/import')).toBe(true);
    expect(isHeavyRoute('POST', '/projects/abc/nmap-import')).toBe(true);
  expect(isHeavyRoute('POST', '/findings/fortify/preview')).toBe(true);
  expect(isHeavyRoute('POST', '/findings/fortify/import')).toBe(true);
  expect(isHeavyRoute('POST', '/projects/abc/site-map')).toBe(true);
    expect(isHeavyRoute('GET', '/reports/issue-log/abc')).toBe(true);
    expect(isHeavyRoute('POST', '/users/bulk-upload')).toBe(true);
    expect(isHeavyRoute('GET', '/projects')).toBe(false);
    expect(isHeavyRoute('GET', '/reports/generate')).toBe(false);
  });
});

describe('RateLimitGuard heavy budget', () => {
  it('throws 429 once a user exceeds the heavy per-minute budget', async () => {
    let n = 0;
    const redis: any = { incrementRateLimit: jest.fn(async (k: string) => (k.startsWith('rlh:') ? ++n : 1)) };
    const guard = new RateLimitGuard(redis, { get: (_k: string, d: number) => d } as any);
    const ctx: any = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u1' }, ip: '1.1.1.1', method: 'POST', path: '/reports/generate', route: { path: '/reports/generate' } }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    };
    for (let i = 0; i < 20; i++) await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});
