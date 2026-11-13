import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ReportsService } from './reports.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const svc = Object.create(ReportsService.prototype) as any;

const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const row = (a: string, b: string) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;

// Same shape as a finding row the report reads: PT finding (no classification), project-only (Import Project Findings).
const imported = (proofOfConcept: string | null, affected: string[]) => ({
  id: 'x', findingType: 'PT', classification: null, projectScoped: true, cvssScoreOverride: null, affectedInstances: affected, proofOfConcept,
  vulnerability: { name: 'SQLi', severity: 'High', cvssScore: null, cvssVector: null, description: 'd', impact: 'i', remediation: 'r', references: 'ref', cveId: null, cweId: null },
});

async function render(f: any) {
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>${row('Name', '{Vulnerability Name}')}${row('Affected', '{Affected Instances}')}${row('CVSS', '{CVSS Vector}')}${row('Description', '{Description}')}${row('Step 1:', '{Fix POC Snapshot}')}</w:tbl>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${table}</w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [svc.toFindingData(f, 1, [])], []);
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagNameNS(W, 'tr')).map((r) => Array.from(r.getElementsByTagNameNS(W, 'tc')).map((c) => c.textContent));
}

describe('Imported POC/Results in the Word report', () => {
  it('fills {Fix POC Snapshot} and {Affected Instances} through the existing placeholders', async () => {
    const rows = await render(imported('10.0.0.1\nproof one\n\n10.0.0.2\nproof two', ['10.0.0.1', '10.0.0.2']));
    expect(rows[1][1]).toContain('10.0.0.1');
    expect(rows[1][1]).toContain('10.0.0.2');
    for (const t of ['proof one', 'proof two']) expect(rows[4][1]).toContain(t);
  });

  it('an empty POC/Results keeps the existing blank snapshot cell', async () => {
    const rows = await render(imported(null, []));
    expect(rows[4][1]).toBe('');
  });

  it('data from other sources is untouched: a Vulnerability-DB finding never prints a stored POC text', () => {
    const f: any = { ...imported('stray', []), projectScoped: false };
    expect(svc.toFindingData(f, 1, []).pocText).toBeNull();
  });
});
