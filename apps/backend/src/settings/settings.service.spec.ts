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

  it('rejects out-of-range or wrongly typed easterEgg settings', async () => {
    await expect(service.update({ easterEgg: { maxAttempts: 29 } }, 'a', 'ip', 'ua')).rejects.toThrow(/maxAttempts/);
    await expect(service.update({ easterEgg: { maxAttempts: 40.5 } }, 'a', 'ip', 'ua')).rejects.toThrow(/maxAttempts/);
    await expect(service.update({ easterEgg: { pasteCountsAsAttempt: 'yes' } }, 'a', 'ip', 'ua')).rejects.toThrow(/boolean/);
    await expect(service.update({ easterEgg: { sneaky: true } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown setting/);
  });

  describe('attachment size and notification rules', () => {
    it('accepts a valid size per format and rejects unknown formats, non-integers and out-of-range values', async () => {
      (prisma.appSettings as any).upsert = jest.fn();
      (service as any).auditService = { log: jest.fn() };
      await expect(service.update({ attachments: { maxSizeMb: { 'poc.png': 10 } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ attachments: { maxSizeMb: { 'poc.png': 0 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/between 1 and 100/);
      await expect(service.update({ attachments: { maxSizeMb: { 'poc.png': 101 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/between 1 and 100/);
      await expect(service.update({ attachments: { maxSizeMb: { 'poc.png': 2.5 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/whole number/);
      await expect(service.update({ attachments: { maxSizeMb: { 'nessus.csv': 501 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/between 1 and 500/);
      await expect(service.update({ attachments: { maxSizeMb: { 'fortify.fpr': 1024 } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ attachments: { maxSizeMb: { 'fortify.fpr': 1025 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/between 1 and 1024/);
      await expect(service.update({ attachments: { maxSizeMb: { 'exe.exe': 5 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown file format/);
      await expect(service.update({ attachments: { maxSizeMb: 'big' } }, 'a', 'ip', 'ua')).rejects.toThrow(/object/);
    });

    it('the findings import can be lowered but never raised above 100 MB', async () => {
      (prisma.appSettings as any).upsert = jest.fn();
      (service as any).auditService = { log: jest.fn() };
      await expect(service.update({ attachments: { maxSizeMb: { 'findingsImport.csv': 50 } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ attachments: { maxSizeMb: { 'findingsImport.csv': 101 } } }, 'a', 'ip', 'ua')).rejects.toThrow(/between 1 and 100/);
    });

    it('saving sizes puts them in force for uploads straight away', async () => {
      const { attachmentLimits } = require('../common/attachment-formats');
      (prisma.appSettings as any).upsert = jest.fn().mockImplementation(async ({ update }: any) => { prisma.appSettings.findUnique.mockResolvedValue({ data: update.data }); });
      (service as any).auditService = { log: jest.fn() };
      await service.update({ attachments: { maxSizeMb: { 'poc.png': 3 } } }, 'a', 'ip', 'ua');
      expect(attachmentLimits.maxBytes('poc', 'x.png')).toBe(3 * 1024 * 1024);
      attachmentLimits.set(undefined);
    });

    it('notification rules: only AVP, Team Lead and Tester can be switched, Admin cannot', async () => {
      (prisma.appSettings as any).upsert = jest.fn();
      (service as any).auditService = { log: jest.fn() };
      await expect(service.update({ notifications: { roleRules: { SYSTEM_UPDATE: { TESTER: false } } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ notifications: { roleRules: { SYSTEM_UPDATE: { ADMIN: false } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Admins always receive/);
      await expect(service.update({ notifications: { roleRules: { NOT_A_TYPE: { TESTER: false } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown notification type/);
      await expect(service.update({ notifications: { roleRules: { SYSTEM_UPDATE: { TESTER: 'no' } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/true or false/);
      await expect(service.update({ notifications: { roleRules: { SYSTEM_UPDATE: { INTERN: false } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown role/);
    });

    it('get() lists the formats and notification types for the Settings screen', async () => {
      const res = await service.get();
      expect(res.attachmentFormats.formats.length).toBeGreaterThan(15);
      expect(res.notificationTypes.map((n) => n.type)).toContain('SYSTEM_UPDATE');
      expect(res.settings.attachments.maxSizeMb['poc.png']).toBe(25);
    });
  });
  describe('identity, labels and formats', () => {
    const ok = () => { (prisma.appSettings as any).upsert = jest.fn(); (service as any).auditService = { log: jest.fn() }; };
    const png = 'data:image/png;base64,iVBORw0KGgo=';

    it('validates application name, logo and favicon', async () => {
      ok();
      await expect(service.update({ general: { appName: 'Acme VAPT', logoUrl: png, faviconUrl: '/favicon.ico' } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ general: { appName: '   ' } }, 'a', 'ip', 'ua')).rejects.toThrow(/appName/);
      await expect(service.update({ general: { appName: 'x'.repeat(81) } }, 'a', 'ip', 'ua')).rejects.toThrow(/appName/);
      await expect(service.update({ general: { logoUrl: 'https://evil.example/x.png' } }, 'a', 'ip', 'ua')).rejects.toThrow(/logoUrl/);
      await expect(service.update({ general: { faviconUrl: 'data:text/html;base64,AAAA' } }, 'a', 'ip', 'ua')).rejects.toThrow(/faviconUrl/);
      await expect(service.update({ general: { logoUrl: '//evil.example/x.png' } }, 'a', 'ip', 'ua')).rejects.toThrow(/logoUrl/);
    });

    it('validates severity labels and display formats', async () => {
      ok();
      await expect(service.update({ workflow: { severityLabels: { Critical: 'Severe' } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ workflow: { severityLabels: { Critical: '' } } }, 'a', 'ip', 'ua')).rejects.toThrow(/label for Critical/);
      await expect(service.update({ workflow: { severityLabels: { BOGUS: 'x' } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown severity/);
      await expect(service.update({ formatting: { dateFormat: 'YYYY-MM-DD', timeFormat: '12h', numberFormat: 'de-DE' } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ formatting: { dateFormat: 'DD.MM' } }, 'a', 'ip', 'ua')).rejects.toThrow(/dateFormat/);
      await expect(service.update({ formatting: { numberFormat: 'not a locale!!' } }, 'a', 'ip', 'ua')).rejects.toThrow(/numberFormat/);
    });

    it('getPublicTheme exposes only theme, name, logo and favicon', async () => {
      prisma.appSettings.findUnique.mockResolvedValue({ data: { general: { appName: 'Acme', logoUrl: png } }, updatedAt: new Date(), updatedById: 'x' });
      const res = await service.getPublicTheme();
      expect(Object.keys(res).sort()).toEqual(['appName', 'defaultTheme', 'faviconUrl', 'logoUrl']);
      expect(res.appName).toBe('Acme');
      expect(res.logoUrl).toBe(png);
    });
  });
  describe('RBAC settings', () => {
    const ok = () => { (prisma.appSettings as any).upsert = jest.fn(); (service as any).auditService = { log: jest.fn() }; };

    it('accepts per-role switches and rejects Admin, unknown features and roles, and non-booleans', async () => {
      ok();
      await expect(service.update({ rbac: { permissions: { 'quiz.play': { TESTER: false } } } }, 'a', 'ip', 'ua')).resolves.toBeDefined();
      await expect(service.update({ rbac: { permissions: { 'quiz.play': { ADMIN: false } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Admins always have every permission/);
      await expect(service.update({ rbac: { permissions: { 'settings.update': { TESTER: true } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown feature/);
      await expect(service.update({ rbac: { permissions: { 'quiz.play': { INTERN: true } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/Unknown role/);
      await expect(service.update({ rbac: { permissions: { 'quiz.play': { TESTER: 'no' } } } }, 'a', 'ip', 'ua')).rejects.toThrow(/true or false/);
    });

    it('a saved switch is in force straight away, and get() lists the catalog', async () => {
      const { permissionRules } = require('../common/permissions');
      (prisma.appSettings as any).upsert = jest.fn().mockImplementation(async ({ update }: any) => { prisma.appSettings.findUnique.mockResolvedValue({ data: update.data }); });
      (service as any).auditService = { log: jest.fn() };
      const res = await service.update({ rbac: { permissions: { 'quiz.play': { TESTER: false } } } }, 'a', 'ip', 'ua');
      expect(permissionRules.can('TESTER', 'quiz.play')).toBe(false);
      expect(permissionRules.can('AVP', 'quiz.play')).toBe(true);
      expect(res.permissionCatalog.permissions.length).toBeGreaterThan(50);
      permissionRules.set(undefined);
    });
  });
});
