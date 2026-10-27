import { StorageService } from './storage.service';

describe('StorageService storage quota', () => {
  const make = (quotaMb: number, usedBytes: number) => {
    const config = { get: (_k: string, d?: any) => d } as any;
    const prisma = { appSettings: { findUnique: jest.fn().mockResolvedValue({ data: { system: { totalStorageQuotaMb: quotaMb } }, updatedAt: new Date(), updatedById: null }) } } as any;
    const svc = new StorageService(config, prisma);
    const put = jest.fn().mockResolvedValue(undefined);
    (svc as any).minioClient = { putObject: put };
    svc.getUsedBytes = jest.fn().mockResolvedValue(usedBytes);
    return { svc, put, prisma };
  };

  it('accepts an upload that fits', async () => {
    const { svc, put } = make(10, 1024 * 1024);
    await expect(svc.uploadFile('a', Buffer.alloc(1024), 'text/plain')).resolves.toBe('a');
    expect(put).toHaveBeenCalled();
  });

  it('refuses an upload that would pass the quota, with 507, and stores nothing', async () => {
    const { svc, put } = make(1, 1024 * 1024 - 10);
    await expect(svc.uploadFile('a', Buffer.alloc(100), 'text/plain')).rejects.toMatchObject({ status: 507 });
    expect(put).not.toHaveBeenCalled();
  });

  it('counts uploads made since the last measurement and recovers when the quota is raised', async () => {
    const { svc, put, prisma } = make(1, 0);
    await svc.uploadFile('a', Buffer.alloc(700 * 1024), 'x');
    await expect(svc.uploadFile('b', Buffer.alloc(700 * 1024), 'x')).rejects.toMatchObject({ status: 507 });
    prisma.appSettings.findUnique.mockResolvedValue({ data: { system: { totalStorageQuotaMb: 5 } }, updatedAt: new Date(), updatedById: null });
    svc.resetUsage();
    await expect(svc.uploadFile('b', Buffer.alloc(700 * 1024), 'x')).resolves.toBe('b');
    expect(put).toHaveBeenCalledTimes(2);
  });
});
