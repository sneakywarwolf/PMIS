import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService, FindingData } from './docx-manipulator.service';
import { ReportsService } from './reports.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const svc = Object.create(ReportsService.prototype) as any;
const fortify = (name: string, severity: string, impact = 'Narrative impact text') =>
  ({ id: name, findingType: 'VA', classification: 'SCR Finding', cvssScoreOverride: null, vulnerability: { name, severity, cvssScore: null, cvssVector: null, description: 'd', impact, remediation: 'r', references: '', cveId: null, cweId: null }, affectedInstances: [] });
const other = (severity: string) => ({ id: 'x', findingType: 'PT', classification: null, cvssScoreOverride: null, vulnerability: { name: 'X', severity, cvssScore: null, cvssVector: null, description: 'd', impact: 'Narrative impact text', remediation: 'r', references: '', cveId: null, cweId: null }, affectedInstances: [] });
const data = (f: any, no = 1): FindingData => svc.toFindingData(f, no, []);
const resolve = (f: FindingData, name: string) => new DocxManipulatorService().resolveFindingParameter(name, f);

describe('{Likelihood} / {Impact} for Fortify findings in SCR projects', () => {
  it.each([
    ['Critical', 'High', 'High'],
    ['High', 'Medium', 'High'],
    ['Medium', 'Medium', 'Medium'],
    ['Low', 'Low', 'Medium'],
    ['Info', 'Low', 'Low'],
  ])('%s: Likelihood %s, Impact %s', (severity, likelihood, impact) => {
    const d = data(fortify('F', severity));
    expect(resolve(d, 'likelihood')).toBe(likelihood);
    expect(resolve(d, 'impact')).toBe(impact);
  });

  it('{Vulnerability Impact} and every other context keep the narrative impact', () => {
    expect(resolve(data(fortify('F', 'High')), 'vulnerability_impact')).toBe('Narrative impact text');
    expect(resolve(data(other('High')), 'impact')).toBe('Narrative impact text');
    expect(resolve(data(other('High')), 'likelihood')).toBeUndefined(); // not a Fortify finding: left as before
  });

  it('prints nothing for a severity the matrix does not support', () => {
    const d = data(fortify('F', 'Weird'));
    expect(resolve(d, 'likelihood')).toBe('');
    expect(resolve(d, 'impact')).toBe('');
  });

  it('follows the severity shown for the finding (a CVSS override moves it), and keeps the original stored severity', () => {
    const f: any = fortify('F', 'Low');
    f.cvssScoreOverride = 9.5; // Critical
    const d = data(f);
    expect(resolve(d, 'likelihood')).toBe('High');
    expect(resolve(d, 'impact')).toBe('High');
    expect(f.vulnerability.severity).toBe('Low'); // stored Fortify severity untouched
  });

  it('each finding in a Word report keeps its own values', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    const row = (a: string, b: string) => `<w:tr><w:tc><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`;
    const detail = `<w:tbl>${row('{Vulnerability Name}', '{CVE/CWE}')}${row('L', '{Likelihood}')}${row('I', '{Impact}')}${row('N', '{Vulnerability Impact}')}${row('D', '{Description}')}${row('R', '{Remediation}')}</w:tbl>`;
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${detail}<w:p/>${detail}</w:body></w:document>`);
    const findings = [data(fortify('First', 'Critical'), 1), data(fortify('Second', 'Low'), 2)];
    const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], findings, []);
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
    const cells = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'tc')).map((c) => c.textContent);
    const at = (i: number) => cells.slice(i * 12, i * 12 + 12);
    expect(at(0)).toEqual(expect.arrayContaining(['First', 'High', 'High', 'Narrative impact text']));
    expect(at(1)).toEqual(expect.arrayContaining(['Second', 'Low', 'Medium', 'Narrative impact text']));
  });
});
