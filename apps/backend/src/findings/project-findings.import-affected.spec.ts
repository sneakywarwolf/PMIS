import { ProjectFindingsService, PROJECT_IMPORT_HEADERS } from './project-findings.service';
import { VulnerabilitiesService } from '../vulnerabilities/vulnerabilities.service';
import { parseCsv } from '../common/csv-validation.util';
import * as XLSX from 'xlsx';

const settings: any = { get: async () => ({ settings: { workflow: { severityColors: { Critical: '', High: '', Medium: '', Low: '', Info: '' } } } }) };
const svc: any = new ProjectFindingsService({} as any, {} as any, settings, new VulnerabilitiesService({} as any, {} as any, {} as any), {} as any);
const f = (csv: string, name = 'f.csv') => ({ originalname: name, buffer: Buffer.from(csv) }) as any;
const NEW = PROJECT_IMPORT_HEADERS.join(',');
const OLD = PROJECT_IMPORT_HEADERS.filter((h) => h !== 'Affected Instances').join(',');
const tail = ['5.0', '', 'd', 'i', 'r', 'ref', '', ''];

describe('Import Project Findings: Affected Instances column', () => {
  it('is the 4th column and the sample file parses with it', async () => {
    expect(PROJECT_IMPORT_HEADERS.slice(0, 5)).toEqual(['S.No', 'Name', 'Severity', 'Affected Instances', 'CVSS']);
    const rows = await svc.parseImport(f(svc.getSampleCsv()));
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].affectedInstances).toEqual(['https://app.example.com/login', 'https://app.example.com/search']);
    expect(parseCsv(svc.getSampleCsv().trim())[0]).toEqual(PROJECT_IMPORT_HEADERS);
  });

  it('keeps every line, maps later columns correctly, and treats empty as none', async () => {
    const csv = `${NEW}\n1,A,High,"10.0.0.1\n10.0.0.2\n\n 10.0.0.3 ",${tail.join(',')}\n2,B,Low,,${tail.join(',')}`;
    const [a, b] = await svc.parseImport(f(csv));
    expect(a.affectedInstances).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    expect(a.fields).toMatchObject({ name: 'A', severity: 'High', cvssScore: 5, description: 'd', references: 'ref' });
    expect(b.affectedInstances).toEqual([]);
  });

  it('still accepts the earlier 11-column layout, with no instances', async () => {
    const [r] = await svc.parseImport(f(`${OLD}\n1,A,High,${tail.join(',')}`));
    expect(r.errors).toEqual([]);
    expect(r.affectedInstances).toEqual([]);
    expect(r.fields).toMatchObject({ cvssScore: 5, description: 'd' });
  });

  it('rejects a 12-column file with the new column in the wrong place', async () => {
    const bad = NEW.replace('Severity,Affected Instances', 'Affected Instances,Severity');
    await expect(svc.parseImport(f(`${bad}\n1,A,,High,${tail.join(',')}`))).rejects.toThrow(/out of order/);
  });

  it('reads multi-line cells from .xlsx', async () => {
    const ws = XLSX.utils.aoa_to_sheet([PROJECT_IMPORT_HEADERS, ['1', 'A', 'High', 'h1\nh2', 5, '', 'd', 'i', 'r', 'ref', '', '']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const [r] = await svc.parseImport({ originalname: 'f.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) } as any);
    expect(r.errors).toEqual([]);
    expect(r.affectedInstances).toEqual(['h1', 'h2']);
  });

  it('flags too many instances on that row only', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => `h${i}`).join('\n');
    const [r] = await svc.parseImport(f(`${NEW}\n1,A,High,"${many}",${tail.join(',')}`));
    expect(r.errors.join()).toMatch(/Affected Instances/);
  });
});
