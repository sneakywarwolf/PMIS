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
