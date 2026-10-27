/**
 * Runs against a real PostgreSQL database, because the guarantees tested here (all-or-nothing imports, one
 * request per name, isolation between projects) are transactional. Skipped unless PMIS_TEST_DATABASE_URL points
 * at a database with the migrations applied; it creates its own rows (unique per run) and removes them again.
 *
 *   PMIS_TEST_DATABASE_URL=postgresql://postgres:pw@localhost:55432/pmis npx jest project-findings.integration
 */
import { PrismaClient, UserRole, VulnerabilityStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VulnerabilitiesService } from '../vulnerabilities/vulnerabilities.service';
import { FindingsService } from './findings.service';
import { ProjectFindingsService } from './project-findings.service';

const URL = process.env.PMIS_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('project-only findings (real database)', () => {
  const run = `t${Date.now().toString(36)}`;
  let prisma: PrismaClient;
  let findings: FindingsService;
  let svc: ProjectFindingsService;
  let vulns: VulnerabilitiesService;
  let admin: any, tl: any, tester: any, otherTester: any, avp: any;
  let projA: any, projB: any, projOther: any, projAvp: any;
  const created = { userIds: [] as string[], projectIds: [] as string[] };

  const settings: any = { get: async () => ({ settings: { workflow: { severityColors: { Critical: '', High: '', Medium: '', Low: '', Info: '' } } } }) };
  const goodFields = (name: string, extra: any = {}) => ({
    name, severity: 'High', cvssScore: 7.5, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    description: 'Description', impact: 'Impact', remediation: 'Fix', references: 'https://example.test', cveId: 'CVE-2024-12345', cweId: 'CWE-79', ...extra,
  });
  const n = (s: string) => `${run} ${s}`;
  const vulnCount = (where: any = {}) => prisma.vulnerability.count({ where: { name: { startsWith: run }, ...where } });
  const findingCount = (projectId: string) => prisma.finding.count({ where: { projectId } });

  const HEAD = 'S.No,Name,Severity,CVSS,CVSS-VEC,Description,Impact,Remediation,Reference,CVE ID,CWE ID';
  const csvRow = (i: number, name: string, over: Record<number, string> = {}) => {
    const cols = [String(i), name, 'High', '7.5', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', 'He said "hi", ok', 'Impact', 'Fix', 'https://x.test', 'CVE-2024-1234', 'CWE-79'];
    Object.entries(over).forEach(([k, v]) => (cols[Number(k)] = v));
    return cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
  };
  const csvFile = (rows: string[], head = HEAD, name = 'f.csv'): any => ({ originalname: name, buffer: Buffer.from([head, ...rows].join('\n')) });
  const xlsxBuffer = (aoa: any[][], mutate?: (ws: XLSX.WorkSheet) => void) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    mutate?.(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Findings');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const audit = new AuditService(prisma as any);
    vulns = new VulnerabilitiesService(prisma as any, new NotificationsService(prisma as any), audit);
    findings = new FindingsService(prisma as any, audit, {} as any);
    svc = new ProjectFindingsService(prisma as any, audit, settings, vulns, findings);

    const mkUser = async (role: UserRole, name: string, extra: any = {}) => {
      const u = await prisma.user.create({ data: { username: `${run}-${name}`, email: `${run}-${name}@example.test`, passwordHash: 'x', role, ...extra } });
      created.userIds.push(u.id);
      return u;
    };
    admin = await mkUser(UserRole.ADMIN, 'admin');
    avp = await mkUser(UserRole.AVP, 'avp');
    tl = await mkUser(UserRole.TEAM_LEAD, 'tl');
    tester = await mkUser(UserRole.TESTER, 'tester', { assignedTlId: tl.id });
    otherTester = await mkUser(UserRole.TESTER, 'other', { assignedTlId: tl.id });
    const mkProject = async (name: string, testerId: string, subType: any = 'WEB', tlId: string = tl.id) => {
      const p = await prisma.project.create({ data: { name: `${run}-${name}`, clientName: 'c', startDate: new Date(), testerId, tlId, subType } });
      created.projectIds.push(p.id);
      return p;
    };
    projA = await mkProject('A', tester.id);
    projB = await mkProject('B', tester.id, 'NETWORK');
    projOther = await mkProject('Other', otherTester.id);
    projAvp = await mkProject('Avp', tester.id, 'WEB', avp.id);
  });

  afterAll(async () => {
    const pids = created.projectIds;
    await prisma.pocStep.deleteMany({ where: { finding: { projectId: { in: pids } } } });
    await prisma.finding.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.projectVulnerability.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.project.deleteMany({ where: { id: { in: pids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: created.userIds } }, { message: { contains: run } }] } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: created.userIds } } });
    await prisma.vulnerability.deleteMany({ where: { name: { startsWith: run } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.$disconnect();
  });

  describe('Add Manually', () => {
    it('Sync Vuln DB OFF: creates the finding in this project only, with no database entry or request', async () => {
      const name = n('off');
      const res = await svc.createManual({ projectId: projA.id, ...goodFields(name), syncVulnDb: false }, tester, 'ip', 'ua');
      expect(res.sync).toEqual({ status: 'not_requested' });
      expect(res.finding.findingType).toBe('PT');
      expect(res.finding.vulnerability.name).toBe(name);
      expect(await vulnCount()).toBe(0);
      const rec = await prisma.projectVulnerability.findFirst({ where: { name } });
      expect(rec).toMatchObject({ projectId: projA.id, source: 'manual' });
      // not visible in the global DB, nor in other projects
      expect((await vulns.findAll(name, undefined, undefined, UserRole.ADMIN)).length).toBe(0);
      expect(await findingCount(projOther.id)).toBe(0);
      expect((await findings.findByProject(projB.id, admin)).some((f: any) => f.vulnerability.name === name)).toBe(false);
    });

    it('Sync Vuln DB ON (the default): finding is usable at once; a separate PENDING request is created, never published', async () => {
      const name = n('on');
      const res = await svc.createManual({ projectId: projA.id, ...goodFields(name) }, tester, 'ip', 'ua');
      expect(res.sync.status).toBe('requested');
      const found = await findings.findOne(res.finding.id, tester);
      expect(found.vulnerability.name).toBe(name);
      const pending = await prisma.vulnerability.findMany({ where: { name } });
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ status: VulnerabilityStatus.PENDING, requestedById: tester.id, category: 'APPLICATION_API' });
      // unapproved: invisible to testers' search, visible to the approvers' list
      expect((await vulns.findAll(name, undefined, undefined, UserRole.TESTER)).length).toBe(0);
      expect((await vulns.findAll(name, undefined, undefined, UserRole.ADMIN)).length).toBe(1);
      // the project finding does not point at the global record
      expect(found.vulnId).toBeNull();
    });

    it('maps a Network project to the Network category', async () => {
      const name = n('net');
      await svc.createManual({ projectId: projB.id, ...goodFields(name) }, tester, 'ip', 'ua');
      expect((await prisma.vulnerability.findFirst({ where: { name } }))?.category).toBe('NETWORK');
    });

    it('rejection and approval of the database request leave the project finding untouched', async () => {
      const name = n('review');
      const res = await svc.createManual({ projectId: projA.id, ...goodFields(name) }, tester, 'ip', 'ua');
      const req = (await prisma.vulnerability.findFirst({ where: { name } }))!;
      await vulns.reject(req.id, admin.id);
      let f = await findings.findOne(res.finding.id, tester);
      expect(f.vulnerability.name).toBe(name);
      expect((await prisma.vulnerability.findUnique({ where: { id: req.id } }))?.status).toBe('REJECTED');
      await vulns.approve(req.id, admin.id);
      f = await findings.findOne(res.finding.id, tester);
      expect(f.vulnerability.name).toBe(name);
      expect(f.projectScoped).toBe(true);
    });

    it('a retry does not create a second finding or a second database request', async () => {
      const name = n('retry');
      await svc.createManual({ projectId: projA.id, ...goodFields(name) }, tester, 'ip', 'ua');
      await expect(svc.createManual({ projectId: projA.id, ...goodFields(name.toUpperCase().replace(run.toUpperCase(), run)) }, tester, 'ip', 'ua')).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.finding.count({ where: { projectId: projA.id, projectVulnerability: { name } } })).toBe(1);
      expect(await vulnCount({ name })).toBe(1);
    });

    it('the same vulnerability added in a second project makes no duplicate request', async () => {
      const name = n('twoprojects');
      await svc.createManual({ projectId: projA.id, ...goodFields(name) }, tester, 'ip', 'ua');
      const second = await svc.createManual({ projectId: projB.id, ...goodFields(name) }, tester, 'ip', 'ua');
      expect(second.sync.status).toBe('already_pending');
      expect(await vulnCount({ name })).toBe(1);
    });

    it('a failing database request never blocks or undoes the project finding', async () => {
      const name = n('fail');
      const spy = jest.spyOn(vulns, 'createRequest').mockRejectedValueOnce(new Error('db down'));
      const res = await svc.createManual({ projectId: projA.id, ...goodFields(name) }, tester, 'ip', 'ua');
      spy.mockRestore();
      expect(res.sync.status).toBe('failed');
      expect((await findings.findOne(res.finding.id, tester)).vulnerability.name).toBe(name);
      expect(await vulnCount({ name })).toBe(0);
    });

    it('validates on the server: required fields, severity, CVSS, ids; nothing is saved', async () => {
      const before = await findingCount(projA.id);
      const bad = [
        { ...goodFields(n('v1')), name: '' },
        { ...goodFields(n('v2')), severity: 'Catastrophic' },
        { ...goodFields(n('v3')), cvssScore: 11 },
        { ...goodFields(n('v4')), cvssVector: 'nope' },
        { ...goodFields(n('v5')), cveId: 'CVE-1' },
        { ...goodFields(n('v6')), impact: '' },
      ];
      for (const b of bad) await expect(svc.createManual({ projectId: projA.id, ...b }, tester, 'ip', 'ua')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.createManual({ projectId: projA.id, ...goodFields(n('v7')), syncVulnDb: 'yes' }, tester, 'ip', 'ua')).rejects.toBeInstanceOf(BadRequestException);
      expect(await findingCount(projA.id)).toBe(before);
      expect(await prisma.vulnerability.count({ where: { name: { in: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'].map(n) } } })).toBe(0);
    });

    it('keeps role and project authorization: another tester cannot add to this project', async () => {
      await expect(svc.createManual({ projectId: projA.id, ...goodFields(n('rbac')) }, otherTester, 'ip', 'ua')).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.projectVulnerability.count({ where: { name: n('rbac') } })).toBe(0);
    });

    it('an AVP who has access may add the finding but cannot ask for a database entry', async () => {
      const res = await svc.createManual({ projectId: projAvp.id, ...goodFields(n('avp')) }, avp, 'ip', 'ua');
      expect(res.sync.status).toBe('not_permitted');
      expect(await findingCount(projAvp.id)).toBe(1);
      expect(await vulnCount({ name: n('avp') })).toBe(0);
      // and an AVP without access to the project is refused outright
      await expect(svc.createManual({ projectId: projA.id, ...goodFields(n('avp2')) }, avp, 'ip', 'ua')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a manual finding is a PT finding that needs Steps and PoC (VA exemption does not apply)', async () => {
      const res = await svc.createManual({ projectId: projB.id, ...goodFields(n('pt')), syncVulnDb: false }, tester, 'ip', 'ua');
      const f = await findings.findOne(res.finding.id, tester);
      expect(f.findingType).toBe('PT');
      expect(f.pocReadiness).toBe('both_missing');
    });
  });

  describe('Import Project Findings', () => {
    it('imports a CSV as project-only findings: no global entry, no approval request, quotes preserved', async () => {
      const vBefore = await prisma.vulnerability.count();
      const names = [n('i1'), n('i2'), n('i3')];
      const out = await svc.importFindings(projA.id, csvFile(names.map((x, i) => csvRow(i + 1, x))), tester, 'ip', 'ua');
      expect(out).toMatchObject({ created: 3, skipped: [] });
      expect(out).not.toHaveProperty('sync');
      expect(await prisma.vulnerability.count()).toBe(vBefore);
      const recs = await prisma.projectVulnerability.findMany({ where: { name: { in: names } } });
      expect(recs).toHaveLength(3);
      expect(recs.every((r) => r.source === 'import' && r.projectId === projA.id)).toBe(true);
      expect(recs[0].description).toBe('He said "hi", ok');
      expect((await findings.findByProject(projOther.id, admin)).length).toBe(0);
    });

    it('preview writes nothing and reports new / duplicate / invalid rows', async () => {
      const before = await findingCount(projA.id);
      const file = csvFile([csvRow(1, n('p-new')), csvRow(2, n('i1')), csvRow(3, n('p-bad'), { 2: 'Nope' })]);
      const pv = await svc.previewImport(projA.id, file, tester);
      expect(pv).toMatchObject({ total: 3, newCount: 1, duplicateCount: 1, invalidCount: 1, canImport: false });
      expect(pv.rows.find((r) => r.row === 4)?.errors?.[0]).toMatch(/Severity/);
      expect(await findingCount(projA.id)).toBe(before);
    });

    it('rejects invalid files without creating partial records', async () => {
      const before = await findingCount(projA.id);
      const recs = await prisma.projectVulnerability.count({ where: { projectId: projA.id } });
      const file = csvFile([csvRow(1, n('ok-1')), csvRow(2, n('bad-2'), { 3: '99' }), csvRow(3, n('ok-3'))]);
      await expect(svc.importFindings(projA.id, file, tester, 'ip', 'ua')).rejects.toBeInstanceOf(BadRequestException);
      expect(await findingCount(projA.id)).toBe(before);
      expect(await prisma.projectVulnerability.count({ where: { projectId: projA.id } })).toBe(recs);
    });

    it('is all-or-nothing even when the database refuses a row part-way through', async () => {
      // An orphaned record (no finding) holds the key of row 2, so the insert of row 2 fails after row 1 succeeded.
      await prisma.projectVulnerability.create({ data: { projectId: projA.id, source: 'import', sourceKey: `name:${n('atomic-2').toLowerCase()}`, classification: 'PT Finding', name: n('atomic-2'), severity: 'High', description: 'd', impact: 'i', remediation: 'r', references: 'x' } });
      const before = await findingCount(projA.id);
      const recs = await prisma.projectVulnerability.count({ where: { projectId: projA.id } });
      const file = csvFile([csvRow(1, n('atomic-1')), csvRow(2, n('atomic-2')), csvRow(3, n('atomic-3'))]);
      await expect(svc.importFindings(projA.id, file, tester, 'ip', 'ua')).rejects.toBeInstanceOf(ConflictException);
      expect(await findingCount(projA.id)).toBe(before);
      expect(await prisma.projectVulnerability.count({ where: { projectId: projA.id } })).toBe(recs);
    });

    it('does not duplicate on a repeat import, and says nothing was imported', async () => {
      const file = csvFile([csvRow(1, n('rep-1')), csvRow(2, n('rep-2'))]);
      await svc.importFindings(projA.id, file, tester, 'ip', 'ua');
      const again = csvFile([csvRow(1, n('rep-1')), csvRow(2, n('rep-2'))]);
      await expect(svc.importFindings(projA.id, again, tester, 'ip', 'ua')).rejects.toThrow(/Nothing to import/);
      const mixed = csvFile([csvRow(1, n('rep-1')), csvRow(2, n('rep-3'))]);
      const out = await svc.importFindings(projA.id, mixed, tester, 'ip', 'ua');
      expect(out.created).toBe(1);
      expect(out.skipped).toEqual([{ row: 2, name: n('rep-1'), reason: 'Already in this project' }]);
    });

    it('rejects duplicate rows inside the file, wrong or missing headers, empty and extra-column files', async () => {
      const dup = csvFile([csvRow(1, n('d1')), csvRow(2, n('D1'))]);
      await expect(svc.importFindings(projA.id, dup, tester, 'ip', 'ua')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.previewImport(projA.id, csvFile([csvRow(1, n('h'))], HEAD.replace('Impact', 'Effect')), tester)).rejects.toThrow(/Invalid CSV format/);
      await expect(svc.previewImport(projA.id, csvFile([csvRow(1, n('h'))], HEAD.replace(',CWE ID', '')), tester)).rejects.toThrow(/missing header/);
      await expect(svc.previewImport(projA.id, csvFile([]), tester)).rejects.toThrow(/no data rows/);
      await expect(svc.previewImport(projA.id, { originalname: 'e.csv', buffer: Buffer.alloc(0) } as any, tester)).rejects.toThrow(/empty/);
      const wide = svc.previewImport(projA.id, csvFile([csvRow(1, n('w')) + ',extra']), tester);
      expect((await wide).rows[0].status).toBe('invalid');
    });

    it('validates the real file type, not the extension', async () => {
      const xlsx = xlsxBuffer([HEAD.split(','), ['1', n('x-type'), 'High', 7.5, '', 'd', 'i', 'r', 'ref', '', '']]);
      await expect(svc.previewImport(projA.id, { originalname: 'findings.csv', buffer: xlsx } as any, tester)).rejects.toThrow(/does not match .csv/);
      await expect(svc.previewImport(projA.id, { originalname: 'findings.xlsx', buffer: Buffer.from('a,b\n1,2') } as any, tester)).rejects.toThrow(/not a valid .xlsx/);
      await expect(svc.previewImport(projA.id, { originalname: 'findings.txt', buffer: Buffer.from('x') } as any, tester)).rejects.toThrow(/Only .csv and .xlsx/);
    });

    it('imports an .xlsx workbook the same way', async () => {
      const buf = xlsxBuffer([HEAD.split(','), ['1', n('xl-1'), 'Medium', 5, '', 'd', 'i', 'r', 'ref', '', ''], ['2', n('xl-2'), 'Low', '', '', 'd', 'i', 'r', 'ref', 'CVE-2023-0001', '']]);
      const out = await svc.importFindings(projA.id, { originalname: 'f.xlsx', buffer: buf } as any, tester, 'ip', 'ua');
      expect(out.created).toBe(2);
      expect((await prisma.projectVulnerability.findFirst({ where: { name: n('xl-1') } }))).toMatchObject({ source: 'import', severity: 'Medium', cvssScore: 5 });
    });

    it('rejects workbooks with formulas, macros or embedded objects (never executed)', async () => {
      const withFormula = xlsxBuffer([HEAD.split(','), ['1', n('f-1'), 'High', '', '', 'd', 'i', 'r', 'ref', '', '']], (ws) => { ws.F2 = { t: 'n', f: '1+1', v: 2 }; });
      await expect(svc.previewImport(projA.id, { originalname: 'f.xlsx', buffer: withFormula } as any, tester)).rejects.toThrow(/formulas are not allowed/);
      const zip = await JSZip.loadAsync(xlsxBuffer([HEAD.split(','), ['1', n('m-1'), 'High', '', '', 'd', 'i', 'r', 'ref', '', '']]));
      zip.file('xl/vbaProject.bin', 'macro');
      const macro = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
      await expect(svc.previewImport(projA.id, { originalname: 'm.xlsx', buffer: macro } as any, tester)).rejects.toThrow(/macros|embedded/);
      expect(await prisma.projectVulnerability.count({ where: { name: { in: [n('f-1'), n('m-1')] } } })).toBe(0);
    });

    it('enforces the size and row limits', async () => {
      await expect(svc.previewImport(projA.id, { originalname: 'big.csv', buffer: Buffer.alloc(100 * 1024 * 1024 + 1, 97) } as any, tester)).rejects.toThrow(/too large.*100MB/);
      const rows = Array.from({ length: 5001 }, (_, i) => `${i},${n('r' + i)},High,,,d,i,r,ref,,`);
      await expect(svc.previewImport(projA.id, { originalname: 'rows.csv', buffer: Buffer.from([HEAD, ...rows].join('\n')) } as any, tester)).rejects.toThrow(/more than 5000 rows/);
    });

    it('keeps project authorization for imports', async () => {
      await expect(svc.importFindings(projA.id, csvFile([csvRow(1, n('auth'))]), otherTester, 'ip', 'ua')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('offers a sample file with the exact expected headers', () => {
      expect(svc.getSampleCsv().split('\n')[0]).toBe(HEAD);
    });

    it('imported findings are PT findings and show up only in this project', async () => {
      const list = await findings.findByProject(projA.id, tester);
      const imported = list.filter((f: any) => f.projectVulnerability === undefined && f.vulnerability.name.startsWith(n('i')));
      expect(imported.length).toBeGreaterThan(0);
      expect(imported.every((f: any) => f.findingType === 'PT' && f.classification === null)).toBe(true);
      expect((await findings.findByProject(projB.id, admin)).some((f: any) => f.vulnerability.name === n('i1'))).toBe(false);
    });
  });

  describe('Multiple PoCs per step', () => {
    const key = (s: string) => `poc/00000000-0000-4000-8000-${Buffer.from(`${run}${s}`).toString('hex').slice(-12).padStart(12, '0')}_${s}.png`;
    let findingId: string;
    beforeAll(async () => {
      const res = await svc.createManual({ projectId: projA.id, ...goodFields(n('poc')), syncVulnDb: false }, tester, 'ip', 'ua');
      findingId = res.finding.id;
    });

    it('stores several PoCs on one step and keeps their order after reload', async () => {
      const keys = ['a', 'b', 'c'].map(key);
      const step = await findings.addPocStep(findingId, { stepNo: 1, description: 'Step', imagePaths: keys }, tester);
      expect([step.imagePath, ...step.extraImagePaths]).toEqual(keys);
      const reloaded = await findings.findOne(findingId, tester);
      const s = reloaded.pocSteps[0];
      expect([s.imagePath, ...s.extraImagePaths]).toEqual(keys);
      // reorder + remove one
      const next = [keys[2], keys[0]];
      await findings.updatePocStep(findingId, step.id, { imagePaths: next }, tester);
      const again = (await findings.findOne(findingId, tester)).pocSteps[0];
      expect([again.imagePath, ...again.extraImagePaths]).toEqual(next);
      expect(again.description).toBe('Step');
    });

    it('still accepts the older single imagePath, and a single PoC per step keeps working', async () => {
      const one = key('single');
      const step = await findings.addPocStep(findingId, { stepNo: 2, description: 'Legacy', imagePath: one }, tester);
      expect(step).toMatchObject({ imagePath: one, extraImagePaths: [] });
      const replaced = await findings.updatePocStep(findingId, step.id, { imagePath: key('single2') }, tester);
      expect(replaced).toMatchObject({ imagePath: key('single2'), extraImagePaths: [] });
      const f = await findings.findOne(findingId, tester);
      expect(f.pocReadiness).toBe('ready');
    });

    it('never lets evidence be shared: a PoC attached elsewhere is refused', async () => {
      const other = await svc.createManual({ projectId: projA.id, ...goodFields(n('poc2')), syncVulnDb: false }, tester, 'ip', 'ua');
      await expect(findings.addPocStep(other.finding.id, { stepNo: 1, description: 's', imagePaths: [key('c')] }, tester)).rejects.toThrow(/already attached/);
      await expect(findings.addPocStep(findingId, { stepNo: 3, description: 's', imagePaths: [key('dup'), key('dup')] }, tester)).rejects.toThrow(/twice/);
      await expect(findings.addPocStep(findingId, { stepNo: 3, description: 's', imagePaths: ['../../etc/passwd'] }, tester)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not let a different tester modify the finding\'s PoCs', async () => {
      await expect(findings.addPocStep(findingId, { stepNo: 9, description: 's' }, otherTester)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
