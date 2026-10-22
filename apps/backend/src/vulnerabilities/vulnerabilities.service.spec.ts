import { Test } from '@nestjs/testing';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException } from '@nestjs/common';

function makePrismaMock(): any {
  return {
    vulnerability: {
      updateMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  } as any;
}

let prisma: ReturnType<typeof makePrismaMock>;

describe('VulnerabilitiesService.bulkUpload', () => {
  let service: VulnerabilitiesService;
  let audit: { log: jest.Mock };

  const CSV = [
    'S.No,Name,Severity,CVSS,CVSS-VEC,Description,Impact,Remediation,Reference,CVE ID,CWE ID',
    '1,SQL Injection,High,8.1,VEC,Desc,Impact text,Remediate it,https://ref,CVE-1,CWE-89',
  ].join('\n');

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VulnerabilitiesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: { create: jest.fn(), notifyAdminsAndTLs: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(VulnerabilitiesService);
  });

  it('rejects an invalid category before touching the database', async () => {
    await expect(
      service.bulkUpload(CSV, 'BOGUS', 'admin1', '127.0.0.1', 'jest'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scopes the soft-delete to the uploaded category only, leaving the other category untouched', async () => {
    await service.bulkUpload(CSV, 'NETWORK', 'admin1', '127.0.0.1', 'jest');

    expect(prisma.vulnerability.updateMany).toHaveBeenCalledWith({
      where: { category: 'NETWORK' },
      data: { isActive: false },
    });
    expect(prisma.vulnerability.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ name: 'SQL Injection', category: 'NETWORK' })],
    });
  });

  const dupCsv = [
    'S.No,Name,Severity,CVSS,CVSS-VEC,Description,Impact,Remediation,Reference,CVE ID,CWE ID',
    '1,SQL Injection,High,8.1,VEC,First desc,Impact,Fix,https://ref,CVE-1,CWE-89',
    '2,XSS,Medium,5.0,VEC,Desc,Impact,Fix,https://ref,,',
    '3,  sql   injection ,Critical,9.8,VEC,Second desc,Impact,Fix,https://ref,CVE-2,CWE-89',
  ].join('\n');

  it('rejects names repeated in the file (ignoring case and spacing), lists the competing rows, and writes nothing', async () => {
    const err: any = await service.bulkUpload(dupCsv, 'NETWORK', 'admin1', '127.0.0.1', 'jest').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse();
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0]).toMatchObject({ key: 'sql injection', name: 'SQL Injection' });
    expect(body.duplicates[0].rows.map((r: any) => [r.row, r.severity, r.description])).toEqual([[2, 'High', 'First desc'], [4, 'Critical', 'Second desc']]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.vulnerability.createMany).not.toHaveBeenCalled();
  });

  it('keeps only the version the admin picked and uploads the rest unchanged', async () => {
    const result = await service.bulkUpload(dupCsv, 'NETWORK', 'admin1', '127.0.0.1', 'jest', { 'sql injection': 4 });
    const data = prisma.vulnerability.createMany.mock.calls[0][0].data;
    expect(data.map((r: any) => [r.name, r.severity])).toEqual([['XSS', 'Medium'], ['  sql   injection '.trim(), 'Critical']]);
    expect(data.every((r: any) => !('sourceRow' in r))).toBe(true);
    expect(result.count).toBe(2);
    expect(result.message).toContain('1 duplicate row left out');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ duplicatesRemoved: 1 }) }));
  });

  it('a choice that points at a row that is not one of the duplicates does not count', async () => {
    await expect(service.bulkUpload(dupCsv, 'NETWORK', 'admin1', '127.0.0.1', 'jest', { 'sql injection': 3 })).rejects.toThrow(BadRequestException);
    expect(prisma.vulnerability.createMany).not.toHaveBeenCalled();
  });

  it('rejects a CSV with a missing/renamed required header, and never touches the database', async () => {
    const badCsv = [
      'S.No,Name,Severity,CVSS Score,CVSS-VEC,Description,Impact,Remediation,Reference,CVE ID,CWE ID',
      '1,SQL Injection,High,8.1,VEC,Desc,Impact text,Remediate it,https://ref,CVE-1,CWE-89',
    ].join('\n');

    await expect(
      service.bulkUpload(badCsv, 'NETWORK', 'admin1', '127.0.0.1', 'jest'),
    ).rejects.toThrow(/missing header\(s\): CVSS; unexpected\/extra header\(s\): CVSS Score/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Header order is validated exactly (commit 6b05406); earlier behaviour accepted any order.
  it('rejects headers in a different order, and never touches the database', async () => {
    const reorderedCsv = [
      'CVSS,S.No,Severity,Name,CVSS-VEC,Description,Impact,Remediation,Reference,CVE ID,CWE ID',
      '8.1,1,High,SQL Injection,VEC,Desc,Impact text,Remediate it,https://ref,CVE-1,CWE-89',
    ].join('\n');

    await expect(
      service.bulkUpload(reorderedCsv, 'NETWORK', 'admin1', '127.0.0.1', 'jest'),
    ).rejects.toThrow(/out of order/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.vulnerability.createMany).not.toHaveBeenCalled();
  });
});
