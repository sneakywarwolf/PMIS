import { ProjectFindingsService, PROJECT_IMPORT_HEADERS } from './project-findings.service';
import { VulnerabilitiesService } from '../vulnerabilities/vulnerabilities.service';
import { parseCsv } from '../common/csv-validation.util';
import * as XLSX from 'xlsx';

let rowLimit: number | undefined;
const settings: any = { get: async () => ({ settings: { workflow: { severityColors: { Critical: '', High: '', Medium: '', Low: '', Info: '' } }, imports: { maxRowsPerFile: rowLimit } } }) };
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
    expect(xss.errors).toEqual([]); // a severity conflict is chosen in the preview, it is not an error
    expect(xss.severityOptions).toEqual(['Medium', 'Low']); // highest first: Medium is the default
    expect(sql.severityOptions).toBeUndefined();
    expect(sql2.severityOptions).toBeUndefined();
  });

  it('a single-row file behaves as before: no merge flag, one source row', async () => {
    const [r] = await svc.parseImport(f(`${NEW}${NL}1,A,High,,${tail.join(',')},`));
    expect(r.sourceRows).toHaveLength(1);
    const rep = (await svc.classify('p', [r]).catch(() => null)) as any;
    expect(rep === null || rep[0].merged === false).toBe(true);
  });

  describe('several files in one upload', () => {
    const row = (n: string, inst: string, poc = '') => `1,${n},High,${inst},${tail.join(',')},${poc}`;

    it('parses every file, merges same-name rows across files and labels rows with the file name', async () => {
      const a = f([NEW, row('SQLi', 'h1', 'pa'), row('XSS', 'x1')].join(NL), 'a.csv');
      const b = f([NEW, row('sqli', 'h2', 'pb'), row('CSRF', 'c1')].join(NL), 'b.csv');
      const g = await svc.parseImport([a, b]);
      expect(g).toHaveLength(3);
      const sql = g.find((x: any) => x.rawName === 'SQLi');
      expect(sql.affectedInstances).toEqual(['h1', 'h2']);
      expect(sql.sourceRows.map((r: any) => r.label)).toEqual(['a.csv, row 2', 'b.csv, row 2']);
      expect(new Set(g.flatMap((x: any) => x.sourceRows.map((r: any) => r.row))).size).toBe(4); // row ids never collide
    });

    it('a single file keeps the plain "Row N" labels', async () => {
      const [r] = await svc.parseImport(f([NEW, row('A', 'h')].join(NL)));
      expect(r.label).toBe('Row 2');
    });

    it('names the bad file, and enforces the per-file row and file-count limits', async () => {
      const bad = f(NEW.replace('Impact', 'Effect') + NL + row('A', 'h'), 'bad.csv');
      await expect(svc.parseImport([f([NEW, row('A', 'h')].join(NL), 'ok.csv'), bad])).rejects.toThrow(/^bad\.csv: /);
      const big = Array.from({ length: 10_000 }, (_, i) => row(`N${i}`, 'h'));
      expect(await svc.parseImport(f([NEW, ...big].join(NL), 'ten-k.csv'))).toHaveLength(10_000);
      await expect(svc.parseImport(f([NEW, ...big, row('extra', 'h')].join(NL)))).rejects.toThrow(/more than the limit of 10,000 rows/);
      const many = Array.from({ length: 11 }, (_, i) => f([NEW, row(`M${i}`, 'h')].join(NL), `m${i}.csv`));
      await expect(svc.parseImport(many)).rejects.toThrow(/At most 10 files/);
    });
  });

  it('groups many rows with one name in linear time', async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => `1,Same,High,h${i},${tail.join(',')},p${i % 50}`);
    const t0 = Date.now();
    const [g] = await svc.parseImport(f([NEW, ...rows].join(NL)));
    expect(g.sourceRows).toHaveLength(10_000);
    expect(g.affectedInstances).toHaveLength(10_000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('ignores a trailing comma on every line (spreadsheet export), but not a filled extra cell', async () => {
    const [ok] = await svc.parseImport(f([`${NEW},`, `1,A,High,h,${tail.join(',')},poc,`].join(NL)));
    expect(ok).toMatchObject({ errors: [], poc: 'poc' });
    const [bad] = await svc.parseImport(f([`${NEW},`, `1,A,High,h,${tail.join(',')},poc,stray`].join(NL)));
    expect(bad.errors.join()).toMatch(/columns/);
  });

  describe('Maximum Rows Per Import File', () => {
    const row = (n: string, inst = 'h') => `1,${n},High,${inst},${tail.join(',')},`;
    const make = (count: number, same = false, tag = 'N') => [NEW, ...Array.from({ length: count }, (_, i) => row(same ? 'Same' : `${tag}${i}`, `h${i}`))].join(NL);
    afterEach(() => { rowLimit = undefined; });

    it('accepts a file exactly at the limit and refuses one row over, saying the limit and the count found', async () => {
      rowLimit = 150;
      expect(await svc.parseImport(f(make(150)))).toHaveLength(150);
      await expect(svc.parseImport(f(make(151)))).rejects.toThrow(/151 data rows, more than the limit of 150 rows per file/);
    });

    it('counts source rows, so grouping same-name rows cannot get past the limit', async () => {
      rowLimit = 100;
      expect(await svc.parseImport(f(make(100, true)))).toHaveLength(1);
      await expect(svc.parseImport(f(make(101, true)))).rejects.toThrow(/101 data rows/);
    });

    it('does not count the header or blank lines', async () => {
      rowLimit = 100;
      const csv = [NEW, ...Array.from({ length: 100 }, (_, i) => row(`N${i}`)), '', ',,,,,,,,,,,,,'].join(NL);
      expect(await svc.parseImport(f(csv))).toHaveLength(100);
    });

    it('applies to .xlsx the same way', async () => {
      rowLimit = 100;
      const book = (n: number) => {
        const ws = XLSX.utils.aoa_to_sheet([PROJECT_IMPORT_HEADERS, ...Array.from({ length: n }, (_, i) => [1, `X${i}`, 'High', 'h', 5, '', 'd', 'i', 'r', 'ref', '', '', ''])]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'S');
        return { originalname: 'f.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) } as any;
      };
      expect(await svc.parseImport(book(100))).toHaveLength(100);
      await expect(svc.parseImport(book(101))).rejects.toThrow(/101 data rows.*limit of 100/);
    });

    it('is applied to every file of a multi-file upload, naming the file', async () => {
      rowLimit = 100;
      await expect(svc.parseImport([f(make(100), 'a.csv'), f(make(101), 'b.csv')])).rejects.toThrow(/^b\.csv: .*101 data rows/);
    });

    it('a limit changed while an import runs does not affect that import (read once at the start)', async () => {
      rowLimit = 200;
      const run = svc.parseImport([f(make(150, false, 'A'), 'a.csv'), f(make(150, false, 'B'), 'b.csv')]);
      rowLimit = 100; // an Admin lowers it mid-way
      await expect(run).resolves.toHaveLength(300);
      await expect(svc.parseImport(f(make(150)))).rejects.toThrow(/limit of 100/); // the next import uses the new value
    });

    it('the default limit is 10,000 when nothing is configured', async () => {
      expect(await svc.parseImport(f(make(10_000)))).toHaveLength(10_000);
      await expect(svc.parseImport(f(make(10_001)))).rejects.toThrow(/10,001 data rows.*limit of 10,000/);
    });
  });

  it('only Severity is resolved by choice: a CVSS conflict stays an error, and an invalid severity stays invalid', async () => {
    const row = (sev: string, cvss: string) => `1,A,${sev},h,${cvss},,d,i,r,ref,,,`;
    const [cv] = await svc.parseImport(f([NEW, row('High', '5.0'), row('High', '9.0')].join(NL)));
    expect(cv.errors.join()).toMatch(/Conflicting CVSS/);
    const [bad] = await svc.parseImport(f([NEW, row('High', '5'), row('Severe', '5')].join(NL)));
    expect(bad.errors.join()).toMatch(/Severity "Severe" is not supported/);
    const [empty] = await svc.parseImport(f([NEW, row('High', '5'), row('', '5')].join(NL)));
    expect(empty.errors.length).toBeGreaterThan(0); // a missing severity is never filled in
  });
});
