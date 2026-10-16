import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService, FindingData } from './docx-manipulator.service';
import { nessusTextForReport } from '../common/nessus-text.util';

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

// ---------------------------------------------------------------------------------------------
// {VA Output} and Nessus text cleanup
// ---------------------------------------------------------------------------------------------
describe('Network Word report: {VA Output} and VA text cleanup', () => {
  const vaDetail = tbl(
    row('{S No}', '{VA Vulnerability Name}'),
    row('CVSS', '{VA CVSS Vector}'),
    row('Description', '{VA Vulnerability Description}'),
    row('Output', '{VA Output}'),
    row('Impact', '{VA Vulnerability Impact}'),
  );
  const ptDetail = tbl(row('{S No}', '{Vulnerability Name}'), row('CVSS', '{CVSS Vector}'), row('Description', '{Vulnerability Description}'), row('Impact', '{Vulnerability Impact}'));
  const template = [summary(true), gap, summary(false), gap, vaDetail, gap, vaDetail, gap, vaDetail, gap, ptDetail].join('');

  const WRAPPED = 'The remote service supports the use of weak SSL ciphers, which could allow an\nattacker to decrypt traffic.\n\nSecond   paragraph.';
  const va = (name: string, output: string | null): FindingData => ({
    ...finding('VA', name, 1),
    description: nessusTextForReport(WRAPPED),
    impact: 'Impact\n  keeps   its raw\nspacing',
    pocText: output === null ? null : nessusTextForReport(output),
  });

  async function render(findings: FindingData[]) {
    const out = await new DocxManipulatorService().generateReport(await docxWith(template), [], findings, [], undefined, undefined, [], [], [], undefined, { splitVaPt: true });
    const xml: string = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const detailTables = Array.from(doc.getElementsByTagNameNS(W, 'tbl')).slice(2) as any[];
    const text = (t: any) => Array.from(t.getElementsByTagNameNS(W, 't')).map((n: any) => n.textContent).join('|');
    return { xml, detailTables, text };
  }

  it('each VA table gets only its own finding\'s plugin output, cleaned, with real line breaks', async () => {
    const { detailTables, text, xml } = await render([
      va('VA-A', 'Port 443 offers TLS 1.0\nand 3DES'),
      va('VA-B', 'Line one\n\n\n\n   Line   two'),
      va('VA-C', 'Only C'),
    ]);
    const vaTables = detailTables.filter((t) => /VA-/.test(text(t)));
    expect(vaTables).toHaveLength(3);
    const byName = (n: string) => vaTables.find((t) => text(t).includes(n))!;
    expect(text(byName('VA-A'))).toContain('Port 443 offers TLS 1.0|and 3DES'); // short lines keep their break
    expect(text(byName('VA-A'))).not.toMatch(/Line one|Only C/);
    expect(text(byName('VA-B'))).toContain('Line one||Line two');               // blank lines collapse to one, spaces tidied
    expect(text(byName('VA-C'))).toContain('Only C');
    expect(text(byName('VA-C'))).not.toMatch(/TLS 1\.0|Line one/);
    expect(xml).not.toContain(' ');                                         // marker fully converted
    expect(xml).toContain('<w:br');
  });

  it('Description is unwrapped and tidied; Impact is left exactly as stored', async () => {
    const { detailTables, text } = await render([va('VA-A', 'x'), va('VA-B', 'y'), va('VA-C', 'z')]);
    const t = text(detailTables.find((d) => text(d).includes('VA-A')));
    expect(t).toContain('weak SSL ciphers, which could allow an attacker to decrypt traffic.||Second paragraph.');
    expect(t).toContain('Impact\n  keeps   its raw\nspacing');
  });

  it('missing or empty plugin output leaves {VA Output} empty, never invented or left as a placeholder', async () => {
    const { detailTables, text, xml } = await render([va('VA-A', null), va('VA-B', ''), va('VA-C', '   \n ')]);
    for (const t of detailTables.filter((d) => /VA-/.test(text(d)))) expect(text(t)).toMatch(/Output\|\|?Impact|Output\|Impact|Output\|?$/);
    expect(xml).not.toMatch(/\{\s*VA/i);
    expect(xml).not.toMatch(/N\/A/);
  });

  it('PT findings are untouched by the cleanup, and {VA Output} never resolves for them', async () => {
    const pt: FindingData = { ...finding('PT', 'PT-A', 1), description: 'Raw   PT\n  description', pocText: 'pt output' };
    const { detailTables, text } = await render([va('VA-A', 'x'), pt]);
    const ptTable = detailTables.find((d) => text(d).includes('PT-A'))!;
    expect(text(ptTable)).toContain('Raw   PT\n  description');
    expect(text(ptTable)).not.toContain('pt output');
    expect(new DocxManipulatorService().resolveFindingParameter('va_output', pt)).toBeUndefined();
    expect(new DocxManipulatorService().resolveFindingParameter('va_output', va('V', 'q'))).toBe('q');
    expect(new DocxManipulatorService().resolveFindingParameter('va_output', va('V', null))).toBe('');
  });
});

describe('{#VA}/{#PT} activity blocks', () => {
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const body = [p('intro'), p('{#VA}'), p('va-text'), tbl(row('va-table', 'x')), p('{/VA}'), p('{#PT}'), p('pt-text'), p('{/PT}'), p('outro')].join('');

  const run = async (activityType?: string | null) => {
    const svc = new DocxManipulatorService();
    const out = await svc.generateReport(await docxWith(body), [], [], [], undefined, undefined, [], [], [], undefined, { activityType });
    return (await JSZip.loadAsync(out)).file('word/document.xml').async('text') as Promise<string>;
  };

  it.each([
    ['VA', ['va-text', 'va-table'], ['pt-text']],
    ['PT', ['pt-text'], ['va-text', 'va-table']],
    ['VAPT', ['va-text', 'va-table', 'pt-text'], []],
    [undefined, ['va-text', 'va-table', 'pt-text'], []],
  ])('%s keeps %j and drops %j, never leaving markers', async (activity, kept, dropped) => {
    const xml = await run(activity);
    for (const k of kept) expect(xml).toContain(k);
    for (const d of dropped) expect(xml).not.toContain(d);
    expect(xml).toContain('intro');
    expect(xml).toContain('outro');
    expect(xml).not.toMatch(/\{[#/](VA|PT)\}/);
  });

  it('does not report markers as template fields', async () => {
    const fields = await new DocxManipulatorService().extractPlaceholderFields(await docxWith(body));
    expect(fields).toEqual([]);
  });
});

describe('{#VA}/{#PT} blocks keep formatting, breaks and spacing', () => {
  const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440"/></w:sectPr>';
  const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const fmt = (t: string) =>
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/><w:spacing w:before="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri"/><w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
  const blank = '<w:p/>';
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const sectBreak = `<w:p><w:pPr>${SECT}</w:pPr></w:p>`;
  const M = (m: string) => para(m);

  const run = async (body: string, activityType?: string | null) => {
    const svc = new DocxManipulatorService();
    const out = await svc.generateReport(await docxWith(body), [], [], [], undefined, undefined, [], [], [], undefined, { activityType });
    return (await JSZip.loadAsync(out)).file('word/document.xml').async('text') as Promise<string>;
  };
  /** Top-level body children as a readable list: text, [blank], [pagebreak], [table]; "[sect]" is appended when a section break is attached. */
  const outline = (xml: string) => {
    const body = new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'body').item(0)!;
    return (Array.from(body.childNodes as any as Element[]).filter((n) => n.nodeType === 1)).map((n) => {
      if (n.localName === 'tbl') return '[table]';
      const text = Array.from(n.getElementsByTagNameNS(W, 't') as any as Element[]).map((t) => t.textContent).join('');
      const kind = text || (n.getElementsByTagNameNS(W, 'br').length ? '[pagebreak]' : '[blank]');
      return kind + (n.getElementsByTagNameNS(W, 'sectPr').length ? '[sect]' : '');
    });
  };

  const layout = [
    para('intro'), blank,
    M('{#VA}'), fmt('va-heading'), tbl(row('va-cell', 'x')), pageBreak, para('va-end'), M('{/VA}'),
    blank,
    M('{#PT}'), fmt('pt-heading'), para('pt-end'), M('{/PT}'),
    blank, para('outro'),
  ].join('');

  const both = ['intro', '[blank]', 'va-heading', '[table]', '[pagebreak]', 'va-end', '[blank]', 'pt-heading', 'pt-end', '[blank]', 'outro'];
  it.each([
    ['VA', ['intro', '[blank]', 'va-heading', '[table]', '[pagebreak]', 'va-end', '[blank]', 'outro']],
    ['PT', ['intro', '[blank]', 'pt-heading', 'pt-end', '[blank]', 'outro']],
    ['VAPT', both],
    [undefined, both],
  ])('%s: exact structure, no leftover gaps, no markers', async (activity, expected) => {
    expect(outline(await run(layout, activity as string | undefined))).toEqual(expected);
  });

  it('kept content keeps its run and paragraph formatting untouched', async () => {
    const xml = await run(layout, 'VAPT');
    expect(xml).toContain('<w:rFonts w:ascii="Calibri"/><w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/><w:jc w:val="center"/><w:spacing w:before="240"/>');
    expect(xml).not.toMatch(/\{[#/](VA|PT)\}/);
  });

  it('a page break inside an excluded block goes with it; one in kept content stays', async () => {
    expect(outline(await run(layout, 'PT'))).not.toContain('[pagebreak]');
    expect(outline(await run(layout, 'VA'))).toContain('[pagebreak]');
  });

  it('a break that removal makes adjacent to another is collapsed, so no blank page appears', async () => {
    const body = [para('a'), pageBreak, M('{#VA}'), para('va'), M('{/VA}'), pageBreak, para('b')].join('');
    expect(outline(await run(body, 'PT'))).toEqual(['a', '[pagebreak]', 'b']);
    expect(outline(await run(body, 'VA'))).toEqual(['a', '[pagebreak]', 'va', '[pagebreak]', 'b']);
  });

  it('a break that was already adjacent in the template, outside any block, is left alone', async () => {
    const body = [para('a'), pageBreak, pageBreak, M('{#VA}'), para('va'), M('{/VA}'), para('b')].join('');
    expect(outline(await run(body, 'PT'))).toEqual(['a', '[pagebreak]', '[pagebreak]', 'b']);
  });

  it('a section break closing an excluded block moves to the paragraph before it, so the retained section keeps its settings', async () => {
    const body = [para('keep'), M('{#VA}'), para('va'), sectBreak, M('{/VA}'), para('next')].join('');
    const xml = await run(body, 'PT');
    expect(outline(xml)).toEqual(['keep[sect]', 'next']);
    expect(xml).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
  });

  it('a section break that only belonged to excluded content is dropped; kept ones stay in place', async () => {
    const body = [para('keep'), sectBreak, M('{#VA}'), para('va'), sectBreak, M('{/VA}'), para('next')].join('');
    expect(outline(await run(body, 'PT'))).toEqual(['keep', '[blank][sect]', 'next']);
    expect(outline(await run(body, 'VA'))).toEqual(['keep', '[blank][sect]', 'va', '[blank][sect]', 'next']);
  });

  it('a marker paragraph that also holds a page break keeps the break when the block is kept, loses it with the block', async () => {
    const markerWithBreak = '<w:p><w:r><w:t>{#VA}</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
    const body = [para('a'), markerWithBreak, para('va'), M('{/VA}'), para('b')].join('');
    expect(outline(await run(body, 'VA'))).toEqual(['a', '[pagebreak]', 'va', 'b']);
    expect(outline(await run(body, 'PT'))).toEqual(['a', 'b']);
  });

  it('blank paragraphs that are part of retained content are never removed', async () => {
    const body = [para('a'), blank, blank, M('{#VA}'), para('va'), M('{/VA}'), para('b'), blank, para('c')].join('');
    expect(outline(await run(body, 'PT'))).toEqual(['a', '[blank]', '[blank]', 'b', '[blank]', 'c']);
  });

  it('a template without markers is unchanged', async () => {
    const body = [para('a'), blank, blank, pageBreak, pageBreak, fmt('h'), tbl(row('x', 'y'))].join('');
    for (const activity of ['VA', 'PT', 'VAPT', undefined]) {
      expect(outline(await run(body, activity as string | undefined))).toEqual(['a', '[blank]', '[blank]', '[pagebreak]', '[pagebreak]', 'h', '[table]']);
    }
  });
});
