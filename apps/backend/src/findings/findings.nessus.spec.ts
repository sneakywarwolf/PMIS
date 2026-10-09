import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindingsService } from './findings.service';

const XML = `<?xml version="1.0"?><NessusClientData_v2><Report name="r">
<ReportHost name="10.0.0.1">
  <ReportItem port="443" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher"><cvss3_base_score>7.5</cvss3_base_score><cvss3_vector>CVSS:3.0/AV:N</cvss3_vector><description>d</description><synopsis>s</synopsis><solution>fix</solution></ReportItem>
  <ReportItem port="22" protocol="tcp" severity="2" pluginID="200" pluginName="SSH Weak Algorithms"><cvss_base_score>5.0</cvss_base_score><description>d</description><synopsis>s</synopsis><solution>fix</solution></ReportItem>
  <ReportItem port="80" protocol="tcp" severity="1" pluginID="300" pluginName="Already Imported"><description>d</description></ReportItem>
  <ReportItem port="21" protocol="tcp" severity="4" pluginID="400" pluginName="Not Selected"><description>d</description></ReportItem>
</ReportHost></Report></NessusClientData_v2>`;
const file = { originalname: 'scan.nessus', buffer: Buffer.from(XML) } as Express.Multer.File;

function setup(opts: { role: string; subType?: string; testerId?: string }) {
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', subType: opts.subType ?? 'NETWORK', testerId: opts.testerId ?? 'u1', tlId: null, status: 'IN_PROGRESS', tester: { assignedTlId: null } }),
      update: jest.fn(),
    },
    vulnerability: {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.status === 'APPROVED' ? [{ id: 'v-tls', name: 'tls weak cipher', cveId: null, cvssScore: 7.5 }] : []),
      ),
    },
    finding: {
      findMany: jest.fn().mockResolvedValue([{ vulnId: 'v-x', testerNotes: 'Imported from Nessus. [Nessus plugin 300]' }]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'f-' + data.vulnId, ...data })),
    },
  };
  const audit: any = { log: jest.fn() };
  const vulns: any = {
    create: jest.fn().mockResolvedValue({ id: 'v-new' }),
    request: jest.fn().mockResolvedValue({ id: 'v-req' }),
  };
  const user: any = { id: 'u1', role: opts.role };
  return { svc: new FindingsService(prisma, audit, vulns), prisma, vulns, user };
}

describe('FindingsService Nessus import', () => {
  it('previews statuses without writing anything', async () => {
    const { svc, prisma, user } = setup({ role: 'TESTER' });
    const { items } = await svc.previewNessus('p1', file, user);
    expect(Object.fromEntries(items.map((i) => [i.key, i.status]))).toEqual({
      '100': 'ready', '200': 'needs-approval', '300': 'duplicate', '400': 'needs-approval',
    });
    expect(prisma.finding.create).not.toHaveBeenCalled();
  });

  it('Admin: imports only selected findings, adding library entries via the existing Admin path', async () => {
    const { svc, prisma, vulns, user } = setup({ role: 'ADMIN' });
    const r = await svc.importNessus('p1', file, ['100', '200', '300'], user, 'ip', 'ua');
    expect(r.created.map((c) => c.key)).toEqual(['100', '200']);
    expect(r.skipped.map((s) => s.key)).toEqual(['300']);
    expect(vulns.create).toHaveBeenCalledTimes(1);
    expect(vulns.create.mock.calls[0][0]).toMatchObject({ name: 'SSH Weak Algorithms', severity: 'Medium', category: 'NETWORK' });
    const created = prisma.finding.create.mock.calls.map((c: any) => c[0].data);
    expect(created).toHaveLength(2); // plugin 400 was not selected
    expect(created[0]).toMatchObject({ vulnId: 'v-tls', affectedInstances: ['10.0.0.1:443/tcp'], status: 'DRAFT' });
    expect(created[0].testerNotes).toContain('[Nessus plugin 100]');
    expect(created[0].cvssScoreOverride).toBeUndefined(); // same score as the library entry
    expect(created[1]).toMatchObject({ vulnId: 'v-new', cvssScoreOverride: 5 }); // new entry from Nessus CVSS v2
  });

  it('Tester: unmatched findings go through the approval request, no finding is created', async () => {
    const { svc, prisma, vulns, user } = setup({ role: 'TESTER' });
    const r = await svc.importNessus('p1', file, ['100', '200'], user, 'ip', 'ua');
    expect(vulns.request).toHaveBeenCalledTimes(1);
    expect(vulns.request.mock.calls[0][1]).toBe('u1');
    expect(vulns.create).not.toHaveBeenCalled();
    expect(r.requested.map((x) => x.key)).toEqual(['200']);
    expect(r.created.map((x) => x.key)).toEqual(['100']);
    expect(prisma.finding.create).toHaveBeenCalledTimes(1);
  });

  it('reports unknown plugin IDs instead of importing them', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN' });
    const r = await svc.importNessus('p1', file, ['999'], user, 'ip', 'ua');
    expect(r.failed).toHaveLength(1);
    expect(prisma.finding.create).not.toHaveBeenCalled();
  });

  it('rejects empty selection, non-Network projects and other testers\' projects', async () => {
    await expect(setup({ role: 'ADMIN' }).svc.importNessus('p1', file, [], { id: 'u1', role: 'ADMIN' } as any, '', '')).rejects.toThrow(BadRequestException);
    const web = setup({ role: 'ADMIN', subType: 'WEB' });
    await expect(web.svc.previewNessus('p1', file, web.user)).rejects.toThrow(BadRequestException);
    const other = setup({ role: 'TESTER', testerId: 'someone-else' });
    await expect(other.svc.previewNessus('p1', file, other.user)).rejects.toThrow(ForbiddenException);
  });
});
