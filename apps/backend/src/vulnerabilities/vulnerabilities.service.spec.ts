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
