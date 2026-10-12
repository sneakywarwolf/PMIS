import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService, FindingData } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>${rows.join('')}</w:tbl>`;
const gap = '<w:p><w:r><w:t>.</w:t></w:r></w:p>';

const summary = (va: boolean) => tbl(row('S.No', 'Vulnerability', 'CVSS'), row('{S No}', va ? '{VA Vulnerability Name}' : '{Vulnerability Name}', '{CVSS Score}'));
const detail = (va: boolean) => {
  const p = va ? 'VA ' : '';
  return tbl(
    row('{S No}', `{${p}Vulnerability Name}`),
    row('Severity', `{${p}Severity}`),
    row('CVSS', `{${p}CVSS Vector}`),
    row('Description', `{${p}Vulnerability Description}`),
  );
};

/** Summary VA, Summary PT, then two VA and two PT detailed slots: the six-table Network template. */
const sixTables = [summary(true), gap, summary(false), gap, detail(true), gap, detail(true), gap, detail(false), gap, detail(false)].join('');
/** An older Network template: one summary and two detailed slots, no VA placeholders. */
const legacyTables = [summary(false), gap, detail(false), gap, detail(false)].join('');

async function docxWith(bodyXml: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

const finding = (type: 'VA' | 'PT', name: string, no: number, score = 5): FindingData => ({
  no, title: name, severity: 'High', cvssScore: score, cvssVector: `CVSS:3.1/AV:N/${name}`,
  description: `desc-${name}`, impact: `impact-${name}`, remediation: `fix-${name}`, references: '', cveId: null, cweId: null,
  affectedInstances: '', authenticationType: null, vulnerabilityDependency: null, reportStatus: 'Open', pocSteps: [], findingType: type,
});

async function generate(template: string, findings: FindingData[], splitVaPt = true) {
  const svc = new DocxManipulatorService();
  const out = await svc.generateReport(await docxWith(template), [], findings, [], undefined, undefined, [], [], [], undefined, { splitVaPt });
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tables = Array.from(doc.getElementsByTagNameNS(W, 'tbl')).map((t: any) =>
    Array.from(t.getElementsByTagNameNS(W, 't')).map((n: any) => n.textContent).join('|'),
  );
  return { xml, tables };
}

const VA = [finding('VA', 'VA-One', 1, 9.8), finding('VA', 'VA-Two', 2, 7.5), finding('VA', 'VA-Three', 3, 5)];
const PT = [finding('PT', 'PT-One', 1, 8.1), finding('PT', 'PT-Two', 2, 6.5)];
const has = (t: string, s: string) => t.includes(s);

describe('Network Word report: VA / PT tables', () => {
  it('fills the six tables from the right source: VA tables only VA findings, PT tables only PT findings', async () => {
    // findings arrive interleaved (as the score-sorted report order would give them)
    const mixed = [VA[0], PT[0], VA[1], PT[1], VA[2]].map((f, i) => ({ ...f, no: i + 1 }));
    const { xml, tables } = await generate(sixTables, mixed);

    // 1 VA summary + 1 PT summary + (2 slots + 1 clone) VA detail + 2 PT detail
    expect(tables).toHaveLength(7);
    const vaTables = tables.filter((t) => /VA-(One|Two|Three)/.test(t));
    const ptTables = tables.filter((t) => /PT-(One|Two)/.test(t));
    expect(vaTables).toHaveLength(4);
    expect(ptTables).toHaveLength(3);
    for (const t of vaTables) expect(t).not.toMatch(/PT-/);
    for (const t of ptTables) expect(t).not.toMatch(/VA-/);

    // summary rows are numbered 1..n per category, in order
    expect(tables[0]).toContain('1.|VA-One|9.8');
    expect(tables[0]).toContain('3.|VA-Three|5');
    expect(tables[1]).toContain('1.|PT-One|8.1');
    expect(tables[1]).toContain('2.|PT-Two|6.5');
    expect(tables[1]).not.toContain('3.|');

    // every detailed table keeps its own finding's fields together
    for (const name of ['VA-One', 'VA-Two', 'VA-Three', 'PT-One', 'PT-Two']) {
      const own = tables.filter((t, i) => i > 1 && t.includes(`|${name}|`) || (i > 1 && t.includes(`${name}|`)));
      expect(own).toHaveLength(1);
      expect(own[0]).toContain(`desc-${name}`);
      expect(own[0]).toContain(`AV:N/${name}`);
      for (const other of ['VA-One', 'VA-Two', 'VA-Three', 'PT-One', 'PT-Two'].filter((n) => n !== name)) {
        expect(own[0]).not.toContain(`desc-${other}`);
      }
    }
    expect(xml).not.toMatch(/\{\s*VA/i);
    expect(xml).not.toMatch(/CVSS:3\.1/); // vector printed without the version prefix
  });

  it('PT-only project (no Nessus imports): PT tables filled, VA slots removed, no VA placeholder left behind', async () => {
    const { xml, tables } = await generate(sixTables, PT);
    expect(tables.filter((t) => /VA-/.test(t))).toHaveLength(0);
    expect(tables.filter((t) => /PT-/.test(t))).toHaveLength(3); // PT summary + 2 detail slots
    expect(tables).toHaveLength(4); // VA summary (header only) + PT summary + 2 PT detail
    expect(tables[0]).toBe('S.No|Vulnerability|CVSS');
    expect(xml).not.toMatch(/\{\s*VA/i);
  });

  it('VA-only project: VA tables filled, PT slots removed', async () => {
    const { xml, tables } = await generate(sixTables, VA);
    expect(tables.filter((t) => /PT-/.test(t))).toHaveLength(0);
    expect(tables.filter((t) => /VA-/.test(t))).toHaveLength(4);
    expect(tables[1]).toBe('S.No|Vulnerability|CVSS'); // PT summary: header only
    expect(xml).not.toMatch(/\{\s*(VA|Vulnerability)/i);
  });

  it('no findings at all: placeholders are cleared from every findings table', async () => {
    const { xml, tables } = await generate(sixTables, []);
    expect(tables).toEqual(['S.No|Vulnerability|CVSS', 'S.No|Vulnerability|CVSS']);
    expect(xml).not.toMatch(/\{\s*(VA|Vulnerability)/i);
  });

  it('a template without VA tables behaves exactly as before: all findings in the existing tables', async () => {
    const mixed = [VA[0], PT[0], VA[1]].map((f, i) => ({ ...f, no: i + 1 }));
    const split = await generate(legacyTables, mixed, true);
    const plain = await generate(legacyTables, mixed, false);
    expect(split.tables).toEqual(plain.tables);
    expect(split.tables[0]).toContain('1.|VA-One|9.8');
    expect(split.tables[0]).toContain('2.|PT-One|8.1');
    expect(split.tables[0]).toContain('3.|VA-Two|7.5');
  });

  it('{VA ...} parameters resolve only for VA findings', () => {
    const svc = new DocxManipulatorService();
    expect(svc.resolveFindingParameter('va_vulnerability_name', finding('VA', 'VA-One', 1))).toBe('VA-One');
    expect(svc.resolveFindingParameter('va_vulnerability_name', finding('PT', 'PT-One', 1))).toBeUndefined();
    expect(svc.resolveFindingParameter('vulnerability_name', finding('PT', 'PT-One', 1))).toBe('PT-One'); // PT placeholders unchanged
  });
});
