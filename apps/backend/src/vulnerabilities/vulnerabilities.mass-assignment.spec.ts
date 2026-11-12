import { VulnerabilitiesService } from './vulnerabilities.service';

// The controllers take `@Body() any`, so the service must not pass unknown fields (status, requestedById, ...) to Prisma.
describe('vulnerability library: no mass assignment', () => {
  const hostile = {
    name: 'XSS', severity: 'High', description: 'd', impact: 'i', remediation: 'r', references: 'x',
    status: 'APPROVED', isActive: false, requestedById: 'someone-else', reviewedById: 'admin', reviewedAt: new Date(), id: 'forced-id', source: 'x',
  };
  const allowed = ['name', 'severity', 'description', 'impact', 'remediation', 'references'].sort();
  let prisma: any;
  let svc: VulnerabilitiesService;

  beforeEach(() => {
    prisma = {
      vulnerability: {
        create: jest.fn(async ({ data }: any) => ({ id: 'v1', ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 'v1', ...data })),
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', name: 'old', severity: 'Low', status: 'APPROVED' }),
      },
    };
    svc = new VulnerabilitiesService(prisma, { create: jest.fn() } as any, { log: jest.fn() } as any);
  });

  it('create writes content fields only', async () => {
    await svc.create(hostile as any);
    expect(Object.keys(prisma.vulnerability.create.mock.calls[0][0].data).sort()).toEqual(allowed);
  });

  it('update writes content fields only', async () => {
    await svc.update('v1', hostile);
    expect(Object.keys(prisma.vulnerability.update.mock.calls[0][0].data).sort()).toEqual(allowed);
  });

  it('a request is always PENDING and attributed to the caller, whatever the body says', async () => {
    await svc.createRequest(prisma, hostile, 'me');
    const data = prisma.vulnerability.create.mock.calls[0][0].data;
    expect(data.status).toBe('PENDING');
    expect(data.requestedById).toBe('me');
    expect(data).not.toHaveProperty('isActive');
    expect(data).not.toHaveProperty('reviewedById');
    expect(data).not.toHaveProperty('id');
  });
});

describe('vulnerability CSV export', () => {
  it('neutralises a formula stored in the free-text severity column', async () => {
    const prisma: any = { vulnerability: { findMany: jest.fn().mockResolvedValue([{ name: 'n', severity: '=HYPERLINK("http://x","y")', cvssScore: 5, cvssVector: null, description: 'd', impact: 'i', remediation: 'r', references: 'x', cveId: null, cweId: null }]) } };
    const svc = new VulnerabilitiesService(prisma, {} as any, {} as any);
    const csv = await svc.exportToCsv();
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain(`'=HYPERLINK`);
  });
});

describe('vulnerability library: content types and sizes', () => {
  const svc = () => new VulnerabilitiesService({ vulnerability: { create: jest.fn(async ({ data }: any) => data), update: jest.fn(), findUnique: jest.fn() } } as any, {} as any, {} as any);
  const base = { name: 'n', severity: 'High', description: 'd', impact: 'i', remediation: 'r', references: 'x' };

  it.each([
    [{ cvssScore: '7' }], [{ cvssScore: 11 }], [{ cvssScore: -1 }], [{ cvssScore: NaN }],
    [{ name: { a: 1 } }], [{ description: 5 }], [{ severity: 'x'.repeat(501) }], [{ description: 'x'.repeat(200_001) }],
    [{ category: 'OTHER' }], [{ category: ['NETWORK'] }],
  ])('create rejects %j', async (over) => {
    await expect(svc().create({ ...base, ...over } as any)).rejects.toThrow(/must be|too long/);
  });

  it('create still accepts normal content, a null score and a valid category', async () => {
    await expect(svc().create({ ...base, cvssScore: 7.5, category: 'NETWORK' } as any)).resolves.toMatchObject({ cvssScore: 7.5 });
    await expect(svc().create({ ...base, cvssScore: null } as any)).resolves.toBeDefined();
  });
});

describe('vulnerability change requests are validated when filed (they are applied as is on approval)', () => {
  it('rejects a wrong type and keeps only content fields', async () => {
    const prisma: any = {
      vulnerability: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, name: 'n' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ assignedTlId: null }), findMany: jest.fn().mockResolvedValue([]) },
      vulnerabilityChangeRequest: { create: jest.fn(async ({ data }: any) => ({ id: 'c1', ...data })) },
    };
    const svc = new VulnerabilitiesService(prisma, { create: jest.fn() } as any, {} as any);
    await expect(svc.createChangeRequest('v1', { severity: { $ne: 1 } }, 'u1')).rejects.toThrow(/must be text/);
    await svc.createChangeRequest('v1', { severity: 'Low', status: 'APPROVED', isActive: false }, 'u1');
    expect(prisma.vulnerabilityChangeRequest.create.mock.calls[0][0].data.afterData).toEqual({ severity: 'Low' });
  });
});
