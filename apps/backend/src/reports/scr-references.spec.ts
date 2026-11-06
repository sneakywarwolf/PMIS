import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ReportsService } from './reports.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const svc = Object.create(ReportsService.prototype) as any;
const REFS = '[1] OWASP A1, OWASP, https://owasp.org/x\n[2] CWE ID 89, MITRE, https://cwe.mitre.org/data/definitions/89.html\n[3] Third, Author, https://example.com';

const finding = (classification: string | null, references: string) => ({
  id: 'x', findingType: classification ? 'VA' : 'PT', classification, cvssScoreOverride: null, affectedInstances: [],
  vulnerability: { name: 'F', severity: 'High', cvssScore: null, cvssVector: null, description: 'd', impact: 'i', remediation: 'r', references, cveId: null, cweId: null },
});

async function referencesCell(f: any) {
  const row = (a: string, b: string) => `<w:tr><w:tc><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`;
  const table = `<w:tbl>${row('{Vulnerability Name}', '{CVE/CWE}')}${row('Ref', '{Reference}')}${row('D', '{Description}')}${row('R', '{Remediation}')}</w:tbl>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${table}</w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [svc.toFindingData(f, 1, [])], []);
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const cell = Array.from(doc.getElementsByTagNameNS(W, 'tc')).find((c) => /^\[1\]/.test(c.textContent || ''));
  return cell ? { text: cell.textContent!, breaks: cell.getElementsByTagNameNS(W, 'br').length } : null;
}

describe('Fortify references in Word reports', () => {
  it('each [n] reference starts on its own line', async () => {
    const cell = (await referencesCell(finding('SCR Finding', REFS)))!;
    expect(cell.breaks).toBe(2);
    expect(cell.text.match(/\[\d\]/g)).toEqual(['[1]', '[2]', '[3]']);
  });

  it('other findings keep their references exactly as before', async () => {
    const data = svc.toFindingData(finding(null, 'Single reference'), 1, []);
    expect(data.references).toBe('Single reference');
    const pt = svc.toFindingData(finding(null, REFS), 1, []);
    expect(pt.references).toBe(REFS);
  });
});
