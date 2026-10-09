import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindingsService } from './findings.service';

const XML = `<?xml version="1.0"?><NessusClientData_v2><Report name="r">
<ReportHost name="10.0.0.1">
  <ReportItem port="443" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher"><cvss3_base_score>7.5</cvss3_base_score><cvss3_vector>CVSS:3.0/AV:N</cvss3_vector><description>d</description><synopsis>s</synopsis><solution>fix</solution></ReportItem>
  <ReportItem port="22" protocol="tcp" severity="2" pluginID="200" pluginName="SSH Weak Algorithms"><cvss_base_score>5.0</cvss_base_score><description>d</description><synopsis>s</synopsis><solution>fix</solution></ReportItem>
  <ReportItem port="80" protocol="tcp" severity="1" pluginID="300" pluginName="Already Imported"><description>d</description></ReportItem>
  <ReportItem port="21" protocol="tcp" severity="4" pluginID="400" pluginName="Not Selected"><description>d</description></ReportItem>
  <ReportItem port="8080" protocol="tcp" severity="2" pluginID="500" pluginName="Same Name As Library Finding"><description>d</description></ReportItem>
</ReportHost></Report></NessusClientData_v2>`;
const file = { originalname: 'scan.nessus', buffer: Buffer.from(XML) } as Express.Multer.File;

function setup(opts: { role: string; subType?: string; testerId?: string; findingCreateFails?: boolean }) {
  let n = 0;
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', subType: opts.subType ?? 'NETWORK', testerId: opts.testerId ?? 'u1', tlId: null, status: 'IN_PROGRESS', tester: { assignedTlId: null } }),
      update: jest.fn(),
    },
    projectVulnerability: {
      findMany: jest.fn().mockResolvedValue([{ sourceKey: '300' }]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'pv' + ++n, ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      // ownership lookup used by create(): only records of project p1 exist
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.projectId === 'p1' ? { id: where.id } : null)),
    },
    finding: {
      // existing finding that came from the GLOBAL library and shares a name with plugin 500
      findMany: jest.fn().mockResolvedValue([{ vulnerability: { name: 'Same Name As Library Finding' }, projectVulnerability: null }]),
      create: jest.fn().mockImplementation(({ data }: any) =>
        opts.findingCreateFails
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ id: 'f' + n, ...data, vulnerability: null, projectVulnerability: { id: data.projectVulnId } }),
      ),
    },
    // Deliberately absent: any use of the global library would throw `undefined.findMany/create`.
    vulnerability: undefined,
  };
  const audit: any = { log: jest.fn() };
  const user: any = { id: 'u1', role: opts.role };
  return { svc: new FindingsService(prisma, audit), prisma, user };
}

describe('FindingsService Nessus import (project-scoped)', () => {
  it('previews as new/duplicate without writing anything', async () => {
    const { svc, prisma, user } = setup({ role: 'TESTER' });
    const { items } = await svc.previewNessus('p1', file, user);
    expect(Object.fromEntries(items.map((i) => [i.key, i.status]))).toEqual({
      '100': 'new', '200': 'new', '300': 'duplicate', '400': 'new', '500': 'duplicate',
    });
    expect(prisma.finding.create).not.toHaveBeenCalled();
    expect(prisma.projectVulnerability.create).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'TESTER'])('%s: imports only selected findings into the project, never touching the global library', async (role) => {
    const { svc, prisma, user } = setup({ role });
    const r = await svc.importNessus('p1', file, ['100', '200', '300', '500'], user, 'ip', 'ua');
    expect(r.created.map((c) => c.key)).toEqual(['100', '200']);
    expect(r.skipped.map((s) => s.key)).toEqual(['300', '500']);
    expect(prisma.projectVulnerability.create).toHaveBeenCalledTimes(2); // plugin 400 was not selected

    const records = prisma.projectVulnerability.create.mock.calls.map((c: any) => c[0].data);
    expect(records[0]).toMatchObject({
      projectId: 'p1', source: 'nessus', sourceKey: '100', name: 'TLS Weak Cipher', severity: 'High',
      cvssScore: 7.5, cvssVector: 'CVSS:3.0/AV:N', impact: 's', remediation: 'fix',
    });
    const findings = prisma.finding.create.mock.calls.map((c: any) => c[0].data);
    expect(findings[0]).toMatchObject({ projectId: 'p1', projectVulnId: 'pv1', affectedInstances: ['10.0.0.1:443/tcp'], status: 'DRAFT', createdById: 'u1' });
    expect(findings[0].vulnId).toBeUndefined();
  });

  it('removes the project record if its finding cannot be created', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN', findingCreateFails: true });
    const r = await svc.importNessus('p1', file, ['100'], user, 'ip', 'ua');
    expect(r.failed).toHaveLength(1);
    expect(r.created).toHaveLength(0);
    expect(prisma.projectVulnerability.deleteMany).toHaveBeenCalledWith({ where: { id: 'pv1' } });
  });

  it('create() refuses a projectVulnId from another project, or both/neither vulnerability source', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN' });
    // project p1 is accessible (mock), but the record id is looked up for project 'p2' -> not owned
    prisma.project.findUnique.mockResolvedValue({ id: 'p2', subType: 'NETWORK', testerId: 'u1', tlId: null, status: 'IN_PROGRESS', tester: { assignedTlId: null } });
    await expect(svc.create({ projectId: 'p2', projectVulnId: 'foreign', testerNotes: 'x' }, user, 'ip', 'ua')).rejects.toThrow(ForbiddenException);
    await expect(svc.create({ projectId: 'p1', vulnId: 'v', projectVulnId: 'pv', testerNotes: 'x' }, user, 'ip', 'ua')).rejects.toThrow(BadRequestException);
    await expect(svc.create({ projectId: 'p1', testerNotes: 'x' }, user, 'ip', 'ua')).rejects.toThrow(BadRequestException);
    expect(prisma.finding.create).not.toHaveBeenCalled();
  });

  it('reports unknown plugin IDs instead of importing them', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN' });
    const r = await svc.importNessus('p1', file, ['999'], user, 'ip', 'ua');
    expect(r.failed).toHaveLength(1);
    expect(prisma.finding.create).not.toHaveBeenCalled();
  });

  it("rejects empty selection, non-Network projects and other testers' projects", async () => {
    await expect(setup({ role: 'ADMIN' }).svc.importNessus('p1', file, [], { id: 'u1', role: 'ADMIN' } as any, '', '')).rejects.toThrow(BadRequestException);
    const web = setup({ role: 'ADMIN', subType: 'WEB' });
    await expect(web.svc.previewNessus('p1', file, web.user)).rejects.toThrow(BadRequestException);
    const other = setup({ role: 'TESTER', testerId: 'someone-else' });
    await expect(other.svc.previewNessus('p1', file, other.user)).rejects.toThrow(ForbiddenException);
  });
});
