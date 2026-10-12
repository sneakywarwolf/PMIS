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

// ---------------------------------------------------------------------------------------------
// Executive-summary severity charts: one for VA findings, one for PT findings
// ---------------------------------------------------------------------------------------------
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SEV = ['Critical', 'High', 'Medium', 'Low', 'Info'];

/** A bar chart with one series per severity (the layout existing templates use), all cached as 0. */
const chartXml = (title?: string) =>
  `<c:chartSpace xmlns:c="${C}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>`
  + (title ? `<c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : '')
  + '<c:plotArea><c:barChart>'
  + SEV.map((s, i) =>
    `<c:ser><c:idx val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${String.fromCharCode(66 + i)}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${s}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
    + `<c:cat><c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${s}</c:v></c:pt></c:strCache></c:strRef></c:cat>`
    + `<c:val><c:numRef><c:f>Sheet1!$${String.fromCharCode(66 + i)}$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>0</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>`).join('')
  + '</c:barChart></c:plotArea></c:chart></c:chartSpace>';

const chartRef = (rId: string) => `<w:p><w:r><w:drawing><c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="${rId}"/></w:drawing></w:r></w:p>`;

/** chart1.xml is referenced SECOND in the document and chart2.xml FIRST, so file order and document order differ. */
async function docxWithCharts(titles: [string?, string?] = []) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${chartRef('rId8')}${chartRef('rId7')}${sixTables}</w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId7" Type="x" Target="charts/chart1.xml"/><Relationship Id="rId8" Type="x" Target="charts/chart2.xml"/></Relationships>');
  zip.file('word/charts/chart1.xml', chartXml(titles[1]));
  zip.file('word/charts/chart2.xml', chartXml(titles[0]));
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

async function chartValues(buffer: Buffer, chart: 'chart1' | 'chart2') {
  const xml: string = await (await JSZip.loadAsync(buffer)).file(`word/charts/${chart}.xml`).async('text');
  return Object.fromEntries(
    [...xml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((m) => [
      m[0].match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/)![1],
      Number(m[0].match(/<c:val>[\s\S]*?<c:pt idx="0"><c:v>([^<]*)<\/c:v>/)![1]),
    ]),
  );
}

const sev = (type: 'VA' | 'PT', name: string, severity: string): FindingData => ({ ...finding(type, name, 1), severity });

describe('Network Word report: VA and PT severity charts', () => {
  const run = async (docx: Buffer, list: FindingData[], splitVaPt = true) =>
    new DocxManipulatorService().generateReport(docx, [], list, [], undefined, undefined, [], [], [], undefined, { splitVaPt });

  const list = [
    sev('VA', 'v1', 'Critical'), sev('VA', 'v2', 'High'), sev('VA', 'v3', 'High'), sev('VA', 'v4', 'Info'),
    sev('PT', 'p1', 'High'), sev('PT', 'p2', 'Medium'), sev('PT', 'p3', 'Medium'), sev('PT', 'p4', 'Low'),
  ];
  const VA_COUNTS = { Critical: 1, High: 2, Medium: 0, Low: 0, Info: 1 };
  const PT_COUNTS = { Critical: 0, High: 1, Medium: 2, Low: 1, Info: 0 };
  const ZERO = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };

  it('first chart in the document counts VA findings, second counts PT findings', async () => {
    const out = await run(await docxWithCharts(), list);
    // chart2.xml is the FIRST chart in the document -> VA; chart1.xml is the second -> PT
    expect(await chartValues(out, 'chart2')).toEqual(VA_COUNTS);
    expect(await chartValues(out, 'chart1')).toEqual(PT_COUNTS);
  });

  it('a chart titled VA or PT follows its title, whatever its position', async () => {
    const out = await run(await docxWithCharts(['PT findings by severity', 'VA findings by severity']), list);
    expect(await chartValues(out, 'chart2')).toEqual(PT_COUNTS); // first in document, titled PT
    expect(await chartValues(out, 'chart1')).toEqual(VA_COUNTS); // second in document, titled VA
  });

  it('shows zeros for a category with no findings (PT-only, VA-only)', async () => {
    const ptOnly = await run(await docxWithCharts(), list.filter((f) => f.findingType === 'PT'));
    expect(await chartValues(ptOnly, 'chart2')).toEqual(ZERO);
    expect(await chartValues(ptOnly, 'chart1')).toEqual(PT_COUNTS);
    const vaOnly = await run(await docxWithCharts(), list.filter((f) => f.findingType === 'VA'));
    expect(await chartValues(vaOnly, 'chart2')).toEqual(VA_COUNTS);
    expect(await chartValues(vaOnly, 'chart1')).toEqual(ZERO);
  });

  it('without the VA/PT split, every chart keeps the combined counts, exactly as before', async () => {
    const out = await run(await docxWithCharts(), list, false);
    const combined = { Critical: 1, High: 3, Medium: 2, Low: 1, Info: 1 };
    expect(await chartValues(out, 'chart1')).toEqual(combined);
    expect(await chartValues(out, 'chart2')).toEqual(combined);
  });
});
