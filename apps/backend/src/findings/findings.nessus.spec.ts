import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FindingsService } from './findings.service';

const XML = `<?xml version="1.0"?><NessusClientData_v2><Report name="r">
<ReportHost name="10.0.0.1">
  <ReportItem port="443" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher"><cvss3_base_score>7.5</cvss3_base_score><cvss3_vector>CVSS:3.0/AV:N</cvss3_vector><description>d</description><synopsis>s</synopsis><solution>fix</solution><plugin_output>Port 443 offers TLS 1.0
and 3DES</plugin_output></ReportItem>
  <ReportItem port="22" protocol="tcp" severity="2" pluginID="200" pluginName="SSH Weak Algorithms"><cvss_base_score>5.0</cvss_base_score><description>d</description><synopsis>s</synopsis><solution>fix</solution></ReportItem>
  <ReportItem port="80" protocol="tcp" severity="1" pluginID="300" pluginName="Already Imported"><description>d</description></ReportItem>
  <ReportItem port="21" protocol="tcp" severity="4" pluginID="400" pluginName="Not Selected"><description>d</description></ReportItem>
  <ReportItem port="8080" protocol="tcp" severity="2" pluginID="500" pluginName="Same Name As Library Finding"><description>d</description></ReportItem>
</ReportHost></Report></NessusClientData_v2>`;
const file = { originalname: 'scan.nessus', buffer: Buffer.from(XML) } as Express.Multer.File;

function setup(opts: { role: string; subType?: string; testerId?: string; findingCreateFails?: boolean; exposure?: string | null }) {
  let n = 0;
  const prisma: any = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', subType: opts.subType ?? 'NETWORK', testerId: opts.testerId ?? 'u1', tlId: null, status: 'IN_PROGRESS', tester: { assignedTlId: null }, externalInternal: opts.exposure === undefined ? 'External' : opts.exposure }),
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
    pocStep: { create: jest.fn().mockResolvedValue({}) },
    // Deliberately absent: any use of the global library would throw `undefined.findMany/create`.
    vulnerability: undefined,
  };
  const audit: any = { log: jest.fn() };
  const user: any = { id: 'u1', role: opts.role };
  return { svc: new FindingsService(prisma, audit, { deleteFile: jest.fn() } as any), prisma, user };
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
      projectId: 'p1', source: 'nessus', classification: 'VA Finding', sourceKey: '100', name: 'TLS Weak Cipher', severity: 'High',
      cvssScore: 7.5, cvssVector: 'CVSS:3.0/AV:N', impact: 's', remediation: 'fix',
    });
    const findings = prisma.finding.create.mock.calls.map((c: any) => c[0].data);
    expect(findings[0]).toMatchObject({ projectId: 'p1', projectVulnId: 'pv1', affectedInstances: ['10.0.0.1:443/tcp'], status: 'DRAFT', createdById: 'u1' });
    expect(findings[0].vulnId).toBeUndefined();
  });

  it('keeps a scan-provided vector, calculates a missing one from score + exposure, and never changes the score', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN', exposure: 'External' });
    await svc.importNessus('p1', file, ['100', '200'], user, 'ip', 'ua');
    const [withVector, withoutVector] = prisma.projectVulnerability.create.mock.calls.map((c: any) => c[0].data);
    expect(withVector).toMatchObject({ cvssScore: 7.5, cvssVector: 'CVSS:3.0/AV:N', cvssVectorSource: 'nessus' });
    expect(withoutVector).toMatchObject({ cvssScore: 5, cvssVectorSource: 'calculated' });
    expect(withoutVector.cvssVector).toMatch(/^AV:N\/AC:.\/Au:.\/C:.\/I:.\/A:.$/); // 5.0 came from CVSS v2
  });

  it('leaves the vector unresolved when the project has no exposure set', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN', exposure: null });
    await svc.importNessus('p1', file, ['200'], user, 'ip', 'ua');
    expect(prisma.projectVulnerability.create.mock.calls[0][0].data).toMatchObject({ cvssScore: 5, cvssVector: null, cvssVectorSource: 'unresolved' });
  });

  it('stores plugin output as the PoC with one "Observe the output." step; none when the scan has no output', async () => {
    const { svc, prisma, user } = setup({ role: 'ADMIN' });
    await svc.importNessus('p1', file, ['100', '200'], user, 'ip', 'ua');
    const [withOutput, without] = prisma.finding.create.mock.calls.map((c: any) => c[0].data);
    expect(withOutput.proofOfConcept).toBe('Port 443 offers TLS 1.0\nand 3DES');
    expect(without.proofOfConcept).toBeUndefined();
    expect(prisma.pocStep.create).toHaveBeenCalledTimes(1); // only the finding that has output
    expect(prisma.pocStep.create).toHaveBeenCalledWith({ data: { findingId: 'f1', stepNo: 1, description: 'Observe the output.' } });
  });

  it('keeps each host\'s output with its host, and truncates visibly', () => {
    expect(FindingsService.nessusPocText([])).toBeNull();
    expect(FindingsService.nessusPocText([{ at: 'h:1/tcp', text: 'a' }, { at: 'h2:1/tcp', text: 'b' }])).toBe('[h:1/tcp]\na\n\n[h2:1/tcp]\nb');
    const big = FindingsService.nessusPocText([{ at: 'h', text: 'x'.repeat(40000) }])!;
    expect(big.endsWith('\n[output truncated]')).toBe(true);
    expect(big.length).toBeLessThan(32100);
  });

  it('the preview does not carry plugin outputs', async () => {
    const { svc, user } = setup({ role: 'ADMIN' });
    const { items } = await svc.previewNessus('p1', file, user);
    expect(items.every((i: any) => !('pluginOutputs' in i))).toBe(true);
  });

  describe('adding plugin output to findings imported before output was captured', () => {
    // plugin 100 has output in the file; 300 does not. Both were imported earlier.
    const older = (findingsOf100: any[]) => (p: any) => {
      p.projectVulnerability.findMany.mockImplementation(({ select }: any) =>
        select.findings && select.findings.where
          ? Promise.resolve([{ findings: findingsOf100 }])
          : Promise.resolve([{ sourceKey: '100', findings: findingsOf100 }, { sourceKey: '300', findings: [{ proofOfConcept: null, affectedInstances: ['10.0.0.1:80/tcp'] }] }]));
      p.finding.update = jest.fn().mockResolvedValue({});
    };

    it('previews as "refresh" only when the file has output and the existing finding has none', async () => {
      const { svc, prisma, user } = setup({ role: 'ADMIN' });
      older([{ id: 'fOld', proofOfConcept: null, pocSteps: [], affectedInstances: ['10.0.0.1:443/tcp'] }])(prisma);
      const { items } = await svc.previewNessus('p1', file, user);
      const status = Object.fromEntries(items.map((i: any) => [i.key, i.status]));
      expect(status['100']).toBe('refresh');   // has output in the file, finding has none
      expect(status['300']).toBe('duplicate'); // nothing to add: the file has no output for it
    });

    it('is not offered again once the finding has its output', async () => {
      const { svc, prisma, user } = setup({ role: 'ADMIN' });
      older([{ id: 'fOld', proofOfConcept: 'already here', pocSteps: [], affectedInstances: ['10.0.0.1:443/tcp'] }])(prisma);
      const { items } = await svc.previewNessus('p1', file, user);
      expect(items.find((i: any) => i.key === '100')!.status).toBe('duplicate');
    });

    it('writes only the output and the one step, on the existing finding, creating nothing else', async () => {
      const { svc, prisma, user } = setup({ role: 'ADMIN' });
      older([{ id: 'fOld', proofOfConcept: null, pocSteps: [], affectedInstances: ['10.0.0.1:443/tcp'] }])(prisma);
      const r = await svc.importNessus('p1', file, ['100'], user, 'ip', 'ua');
      expect(r.refreshed).toEqual([{ key: '100', name: 'TLS Weak Cipher' }]);
      expect(r.created).toHaveLength(0);
      expect(prisma.finding.update).toHaveBeenCalledWith({ where: { id: 'fOld' }, data: { proofOfConcept: 'Port 443 offers TLS 1.0\nand 3DES' } });
      expect(prisma.pocStep.create).toHaveBeenCalledWith({ data: { findingId: 'fOld', stepNo: 1, description: 'Observe the output.' } });
      expect(prisma.projectVulnerability.create).not.toHaveBeenCalled();
      expect(prisma.finding.create).not.toHaveBeenCalled();
    });

    it('never overwrites existing output or duplicates an existing step', async () => {
      const { svc, prisma, user } = setup({ role: 'ADMIN' });
      older([{ id: 'hasPoc', proofOfConcept: 'mine', pocSteps: [], affectedInstances: ['10.0.0.1:443/tcp'] }, { id: 'hasStep', proofOfConcept: null, pocSteps: [{ id: 's1' }], affectedInstances: ['10.0.0.1:443/tcp'] }])(prisma);
      await svc.importNessus('p1', file, ['100'], user, 'ip', 'ua');
      expect(prisma.finding.update).toHaveBeenCalledTimes(1);
      expect(prisma.finding.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'hasStep' } }));
      expect(prisma.pocStep.create).not.toHaveBeenCalled();
    });
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

describe('Nessus import: merging the same plugin from another scan', () => {
  const xml = (host: string) => `<?xml version="1.0"?><NessusClientData_v2><Report name="r"><ReportHost name="${host}">
<ReportItem port="443" protocol="tcp" severity="3" pluginID="100" pluginName="TLS Weak Cipher"><description>d</description></ReportItem>
</ReportHost></Report></NessusClientData_v2>`;
  const scan = (host: string) => ({ originalname: 's.nessus', buffer: Buffer.from(xml(host)) } as Express.Multer.File);

  function mergeSetup(existing: string[]) {
    const { svc, prisma, user } = setup({ role: 'TESTER' });
    prisma.projectVulnerability.findMany.mockResolvedValue([
      { sourceKey: '100', findings: [{ id: 'f1', proofOfConcept: 'out', affectedInstances: existing }] },
    ]);
    prisma.finding.update = jest.fn().mockResolvedValue({});
    return { svc, prisma, user };
  }

  it('previews as merge when the scan adds a host, duplicate when it adds nothing', async () => {
    const a = mergeSetup(['10.0.0.1:443/tcp']);
    expect((await a.svc.previewNessus('p1', scan('10.0.0.2'), a.user)).items[0].status).toBe('merge');
    expect((await a.svc.previewNessus('p1', scan('10.0.0.1'), a.user)).items[0].status).toBe('duplicate');
  });

  it('keeps existing instances and appends only the new ones; creates no second finding', async () => {
    const { svc, prisma, user } = mergeSetup(['10.0.0.1:443/tcp']);
    const r = await svc.importNessus('p1', scan('10.0.0.2'), ['100'], user, 'ip', 'ua');
    expect(r.merged).toEqual([{ key: '100', name: 'TLS Weak Cipher' }]);
    expect(prisma.finding.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { affectedInstances: ['10.0.0.1:443/tcp', '10.0.0.2:443/tcp'] } });
    expect(prisma.finding.create).not.toHaveBeenCalled();
    expect(prisma.projectVulnerability.create).not.toHaveBeenCalled();
  });

  it('a finding whose record has no finding left is not offered for merge', async () => {
    const { svc, prisma, user } = setup({ role: 'TESTER' });
    prisma.projectVulnerability.findMany.mockResolvedValue([{ sourceKey: '100', findings: [] }]);
    expect((await svc.previewNessus('p1', scan('10.0.0.2'), user)).items[0].status).toBe('duplicate');
  });
});
