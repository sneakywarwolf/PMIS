import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService, FindingData } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const cell = (inner: string) => `<w:tc><w:p>${inner}</w:p></w:tc>`;
const run = (t: string, bold = true) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}</w:rPr><w:t>${t}</w:t></w:r>`;
const boldCell = (t: string) => cell(run(t, true));
const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>
  <w:tr>${cell(run('Name'))}${cell(run('{Vulnerability Name}', false))}</w:tr>
  <w:tr>${cell(run('CVSS'))}${cell(run('{CVSS Vector}', false))}</w:tr>
  <w:tr>${cell(run('Description'))}${cell(run('{Description}', false))}</w:tr>
  <w:tr>${cell(run('Step 1:'))}${boldCell('{Fix POC Snapshot}')}</w:tr>
</w:tbl>`;

const finding = (over: Partial<FindingData>): FindingData =>
  ({ no: 1, title: 'SQLi', severity: 'High', cvssScore: null, cvssVector: null, description: 'd', impact: 'i', remediation: 'r', references: '', cveId: null, cweId: null,
    affectedInstances: '', authenticationType: null, vulnerabilityDependency: null, reportStatus: 'Open', pocSteps: [], ...over }) as any;

async function render(f: FindingData) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${table}</w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [f], [], undefined, undefined, [], [], []);
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rows = Array.from(doc.getElementsByTagNameNS(W, 'tr'));
  return rows.map((r) => Array.from(r.getElementsByTagNameNS(W, 'tc')).map((c) => Array.from(c.getElementsByTagNameNS(W, 'r')).map((x) => ({ text: x.textContent!, bold: x.getElementsByTagNameNS(W, 'b').length > 0 }))));
}

describe('Word report: finding with no Steps and no PoC', () => {
  it.each([[[]], [[{ stepNo: 1, description: '  ', imageKey: null, imageKeys: [] }]]])('prints bold "POC:" + plain text, and a blank snapshot cell (steps %j)', async (pocSteps) => {
    const rows = await render(finding({ pocSteps: pocSteps as any }));
    const [label, snapshot] = rows[3];
    expect(label.map((r) => r.text).join('')).toBe('POC: Observe the Screenshot.');
    expect(label.find((r) => r.text.startsWith('POC:'))!.bold).toBe(true);
    expect(label.filter((r) => r.text.includes('Observe')).every((r) => !r.bold)).toBe(true);
    expect(snapshot.map((r) => r.text).join('')).toBe('');
  });

  it('a step with text but no screenshot keeps "Step 1:" and leaves the snapshot blank, not N/A', async () => {
    const rows = await render(finding({ pocSteps: [{ stepNo: 1, description: 'Open the page', imageKey: null, imageKeys: [] }] as any }));
    expect(rows[3][0].map((r) => r.text).join('')).toBe('Step 1: Open the page');
    expect(rows[3][1].map((r) => r.text).join('')).toBe('');
  });

  it('scan output is still shown when there is one', async () => {
    const rows = await render(finding({ pocText: 'trace line' }));
    expect(rows[3][1].map((r) => r.text).join('')).toBe('trace line');
    expect(rows[3][1].every((r) => !r.bold)).toBe(true);
  });
});
