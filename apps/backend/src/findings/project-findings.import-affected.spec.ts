import { ProjectFindingsService, PROJECT_IMPORT_HEADERS } from './project-findings.service';
import { VulnerabilitiesService } from '../vulnerabilities/vulnerabilities.service';
import { parseCsv } from '../common/csv-validation.util';
import * as XLSX from 'xlsx';

const settings: any = { get: async () => ({ settings: { workflow: { severityColors: { Critical: '', High: '', Medium: '', Low: '', Info: '' } } } }) };
const svc: any = new ProjectFindingsService({} as any, {} as any, settings, new VulnerabilitiesService({} as any, {} as any, {} as any), {} as any);
const f = (csv: string, name = 'f.csv') => ({ originalname: name, buffer: Buffer.from(csv) }) as any;
const NEW = PROJECT_IMPORT_HEADERS.join(',');
const NO_POC = PROJECT_IMPORT_HEADERS.filter((h) => h !== 'POC/Results').join(',');
const OLD = PROJECT_IMPORT_HEADERS.filter((h) => h !== 'Affected Instances' && h !== 'POC/Results').join(',');
const tail = ['5.0', '', 'd', 'i', 'r', 'ref', '', '']; // CVSS ... CWE ID
const NL = '\n';

describe('Import Project Findings: Affected Instances and POC/Results columns', () => {
  it('Affected Instances is the 4th column, POC/Results the last, and the sample file parses', async () => {
    expect(PROJECT_IMPORT_HEADERS.slice(0, 5)).toEqual(['S.No', 'Name', 'Severity', 'Affected Instances', 'CVSS']);
    expect(PROJECT_IMPORT_HEADERS[PROJECT_IMPORT_HEADERS.length - 1]).toBe('POC/Results');
    const rows = await svc.parseImport(f(svc.getSampleCsv()));
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].affectedInstances).toEqual(['https://app.example.com/login', 'https://app.example.com/search']);
    expect(rows[0].poc).toMatch(/OR 1=1/);
    expect(parseCsv(svc.getSampleCsv().trim())[0]).toEqual(PROJECT_IMPORT_HEADERS);
  });

  it('keeps every instance line, maps later columns correctly, and treats empty as none', async () => {
    const csv = [NEW, `1,A,High,"10.0.0.1${NL}10.0.0.2${NL}${NL} 10.0.0.3 ",${tail.join(',')},`, `2,B,Low,,${tail.join(',')},`].join(NL);
    const [a, b] = await svc.parseImport(f(csv));
    expect(a.affectedInstances).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    expect(a.fields).toMatchObject({ name: 'A', severity: 'High', cvssScore: 5, description: 'd', references: 'ref' });
    expect(b.affectedInstances).toEqual([]);
  });

  it('still accepts older layouts: 11 columns, or without POC/Results', async () => {
    const [r] = await svc.parseImport(f(`${OLD}${NL}1,A,High,${tail.join(',')}`));
    expect(r).toMatchObject({ errors: [], affectedInstances: [], poc: '' });
    expect(r.fields).toMatchObject({ cvssScore: 5, description: 'd' });
    const [p] = await svc.parseImport(f(`${NO_POC}${NL}1,A,High,h,${tail.join(',')}`));
    expect(p).toMatchObject({ errors: [], affectedInstances: ['h'], poc: '' });
  });

  it('rejects the new columns in the wrong place', async () => {
    const bad = NEW.replace('Severity,Affected Instances', 'Affected Instances,Severity');
    await expect(svc.parseImport(f(`${bad}${NL}1,A,,High,${tail.join(',')},`))).rejects.toThrow(/out of order/);
    const badPoc = NEW.replace(',POC/Results', '').replace('Name,', 'Name,POC/Results,');
    await expect(svc.parseImport(f(`${badPoc}${NL}1,A,,High,${tail.join(',')}`))).rejects.toThrow(/out of order/);
  });

  it('reads multi-line cells (instances, POC/Results) from .xlsx', async () => {
    const ws = XLSX.utils.aoa_to_sheet([PROJECT_IMPORT_HEADERS, ['1', 'A', 'High', 'h1\nh2', 5, '', 'd', 'i', 'r', 'ref', '', '', 'p1\np2']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const [r] = await svc.parseImport({ originalname: 'f.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) } as any);
    expect(r.errors).toEqual([]);
    expect(r.affectedInstances).toEqual(['h1', 'h2']);
    expect(r.poc).toBe('p1\np2');
  });

  it('flags too many instances on that row only', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => `h${i}`).join(NL);
    const [r] = await svc.parseImport(f(`${NEW}${NL}1,A,High,"${many}",${tail.join(',')},`));
    expect(r.errors.join()).toMatch(/Affected Instances/);
  });

  it('groups by normalised name; keeps instances and POCs; flags conflicts; leaves look-alike names apart', async () => {
    const row = (n: string, sev: string, inst: string, poc: string) => `1,${n},${sev},${inst},${tail.join(',')},${poc}`;
    const g = await svc.parseImport(f([NEW,
      row('SQL Injection', 'High', '10.0.0.1', 'r1'), row('  sql   injection ', 'High', '10.0.0.2', 'r2'), row('SQL Injection', 'High', '10.0.0.1', 'r1'),
      row('SQL Injection 2', 'High', '10.0.0.9', 'x'), row('XSS', 'Low', 'a', ''), row('XSS', 'Medium', 'b', '')].join(NL)));
    expect(g).toHaveLength(3);
    const [sql, sql2, xss] = g;
    expect(sql.sourceRows).toHaveLength(3);
    expect(sql.errors).toEqual([]);
    expect(sql.affectedInstances).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(sql.poc).toBe(`10.0.0.1${NL}r1${NL}${NL}10.0.0.2${NL}r2`);
    expect(sql.fields.name).toBe('SQL Injection');
    expect(sql2.sourceRows).toHaveLength(1);
    expect(xss.errors.join()).toMatch(/Conflicting Severity/);
  });

  it('a single-row file behaves as before: no merge flag, one source row', async () => {
    const [r] = await svc.parseImport(f(`${NEW}${NL}1,A,High,,${tail.join(',')},`));
    expect(r.sourceRows).toHaveLength(1);
    const rep = (await svc.classify('p', [r]).catch(() => null)) as any;
    expect(rep === null || rep[0].merged === false).toBe(true);
  });
});
