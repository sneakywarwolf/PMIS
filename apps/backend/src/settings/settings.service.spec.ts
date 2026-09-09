import { Test } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../reports/storage.service';

describe('SettingsService.getSystemHealth', () => {
  let service: SettingsService;
  let prisma: { appSettings: { findUnique: jest.Mock }; $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let storage: { healthCheck: jest.Mock; getUsedBytes: jest.Mock };

  beforeEach(async () => {
    prisma = {
      appSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(),
    };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    storage = {
      healthCheck: jest.fn().mockResolvedValue({ reachable: true, bucket: 'vapt-reports', endpoint: 'localhost', port: 9000 }),
      getUsedBytes: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: {} },
        { provide: RedisService, useValue: redis },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(SettingsService);
  });

  it('computes available storage as the default quota minus live used bytes', async () => {
    prisma.$queryRaw.mockResolvedValue([{ size: BigInt(100 * 1024 * 1024) }]); // 100 MB DB
    storage.getUsedBytes.mockResolvedValue(2048 * 1024 * 1024); // 2048 MB used

    const health = await service.getSystemHealth();

    expect(health.storage.totalMb).toBe(10240);
    expect(health.storage.usedMb).toBe(2048);
    expect(health.storage.availableMb).toBe(10240 - 2048);
    expect(health.database.totalMb).toBe(10240);
    expect(health.database.usedMb).toBe(100);
    expect(health.database.availableMb).toBe(10240 - 100);
  });

  it('clamps availableMb to 0 rather than going negative when usage exceeds the quota', async () => {
    prisma.appSettings.findUnique.mockResolvedValue({
      data: { system: { totalStorageQuotaMb: 100, totalDatabaseQuotaMb: 50 } },
      updatedAt: new Date(),
      updatedById: 'admin1',
    });
    prisma.$queryRaw.mockResolvedValue([{ size: BigInt(200 * 1024 * 1024) }]); // 200 MB DB, over the 50 MB quota
    storage.getUsedBytes.mockResolvedValue(500 * 1024 * 1024); // 500 MB used, over the 100 MB quota

    const health = await service.getSystemHealth();

    expect(health.storage.availableMb).toBe(0);
    expect(health.database.availableMb).toBe(0);
  });

  it('reports null usage when the storage backend is unreachable', async () => {
    storage.healthCheck.mockResolvedValue({ reachable: false, bucket: 'vapt-reports', endpoint: 'localhost', port: 9000 });
    prisma.$queryRaw.mockResolvedValue([{ size: BigInt(0) }]);

    const health = await service.getSystemHealth();

    expect(health.storage.status).toBe('down');
    expect(health.storage.usedMb).toBeNull();
    expect(health.storage.availableMb).toBeNull();
    expect(storage.getUsedBytes).not.toHaveBeenCalled();
  });
});
