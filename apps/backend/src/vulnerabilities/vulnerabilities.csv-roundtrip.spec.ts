import { BadRequestException } from '@nestjs/common';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { parseCsv, validateExactCsvHeaders } from '../common/csv-validation.util';

// An exported library file must upload again as it is: the exporter, the sample file and the importer share one header row.
describe('vulnerability library CSV: export, sample and import agree', () => {
  const row = (over: any = {}) => ({ name: 'SQL Injection', severity: 'High', cvssScore: 8.1, cvssVector: 'AV:N/AC:L', description: 'Desc, with comma', impact: 'Impact', remediation: 'Fix "it"', references: 'https://ref', cveId: 'CVE-1', cweId: 'CWE-89', ...over });
  const svc = (rows: any[] = [row()]) => new VulnerabilitiesService({ vulnerability: { findMany: jest.fn().mockResolvedValue(rows) } } as any, {} as any, {} as any);

  it('the export starts with exactly the header row the importer requires', async () => {
    const s = svc();
    const csv = await s.exportToCsv();
    expect(parseCsv(csv)[0]).toEqual([...s.EXPECTED_HEADERS]);
    expect(() => validateExactCsvHeaders(s.normalizeImportHeaders(parseCsv(csv)[0]), s.EXPECTED_HEADERS)).not.toThrow();
  });

  it('the sample file and the export have the same header row', async () => {
    const s = svc();
    expect(parseCsv(s.getSampleCsv())[0]).toEqual(parseCsv(await s.exportToCsv())[0]);
  });

  it('the data survives the round trip (commas and quotes included)', async () => {
    const s = svc();
    const parsed = parseCsv(await s.exportToCsv());
    expect(parsed[1]).toEqual(['1', 'SQL Injection', 'High', '8.1', 'AV:N/AC:L', 'Desc, with comma', 'Impact', 'Fix "it"', 'https://ref', 'CVE-1', 'CWE-89']);
  });

  it('a file exported by an earlier version (header "References") is still accepted', () => {
    const s = svc();
    const old = ['S.No', 'Name', 'Severity', 'CVSS', 'CVSS-VEC', 'Description', 'Impact', 'Remediation', 'References', 'CVE ID', 'CWE ID'];
    expect(() => validateExactCsvHeaders(s.normalizeImportHeaders(old), s.EXPECTED_HEADERS)).not.toThrow();
  });

  it('the exact-header rule is otherwise unchanged: wrong, missing, extra or reordered headers are still refused', () => {
    const s = svc();
    const base = [...s.EXPECTED_HEADERS];
    const swapped = [...base]; [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    for (const bad of [base.slice(0, -1), [...base, 'Extra'], swapped, base.map((h) => (h === 'Name' ? 'Title' : h)), base.map((h) => h.toLowerCase())]) {
      expect(() => validateExactCsvHeaders(s.normalizeImportHeaders(bad), s.EXPECTED_HEADERS)).toThrow(BadRequestException);
    }
  });

  it('the old spelling is only accepted in its own column, not as a second Reference column', () => {
    const s = svc();
    const dup = [...s.EXPECTED_HEADERS, 'References'];
    expect(() => validateExactCsvHeaders(s.normalizeImportHeaders(dup), s.EXPECTED_HEADERS)).toThrow(BadRequestException);
  });
});
