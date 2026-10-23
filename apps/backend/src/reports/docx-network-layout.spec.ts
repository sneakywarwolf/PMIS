import { DocxManipulatorService } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const heading = (t: string, lvl: 1 | 2, numId: number) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${lvl}"/><w:numPr><w:ilvl w:val="${lvl - 1}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
// Word's empty spacer paragraph: no text, only a tab *stop* in its properties.
const spacer = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1500"/></w:tabs></w:pPr></w:p>';
const chart = '<w:drawing><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/></w:drawing>';
// The PT risk matrix chart lives in the same paragraph as the {#PT} marker.
const ptMarkerWithChart = `<w:p><w:r>${chart}</w:r><w:r><w:t>{#PT}</w:t></w:r></w:p>`;

async function run(body: string, activityType: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [], [], undefined, undefined, [], [], [], undefined, { activityType });
  return (await (await JSZip.loadAsync(out)).file('word/document.xml').async('text')) as string;
}

const template = [
  heading('Detail Findings', 1, 27),
  para('{#VA}'), heading('Details of VA Findings', 2, 40), para('va-body'), para('{/VA}'),
  spacer, spacer, spacer, spacer,
  ptMarkerWithChart, heading('Details of PT Findings', 2, 40), para('pt-body'), para('{/PT}'),
  heading('Appendix', 1, 40),
].join('');

describe('Network template: PT risk matrix, numbering and spacing', () => {
  it.each([['PT', 1], ['VAPT', 1], ['VA', 0]])('%s: the risk-matrix chart sharing the {#PT} paragraph is kept only when PT is kept', async (type, charts) => {
    const xml = await run(template, type);
    expect(xml.match(/<w:drawing>/g)?.length ?? 0).toBe(charts);
    expect(xml).not.toMatch(/\{[#/](VA|PT)\}/);
  });

  it('Details headings join the parent heading list; the Appendix list is untouched', async () => {
    const xml = await run(template, 'VAPT');
    const numIds = (name: string) => xml.match(new RegExp(`${name}</w:t>`))! && [...xml.split(name)[0].matchAll(/<w:numId w:val="(\d+)"\/>/g)].pop()![1];
    expect(numIds('Details of VA Findings')).toBe('27');
    expect(numIds('Details of PT Findings')).toBe('27');
    expect(numIds('Appendix')).toBe('40');
  });

  it('the spacer run between blocks is trimmed to two whichever blocks survive; a template without markers is unchanged', async () => {
    const spacers = (xml: string) => xml.match(/<w:tabs>/g)?.length ?? 0;
    expect(spacers(await run(template, 'VAPT'))).toBe(2);
    expect(spacers(await run(template, 'PT'))).toBe(2);
    expect(spacers(await run(template, 'VA'))).toBe(2);
    expect(spacers(await run(para('a') + spacer + spacer + spacer + para('b'), 'VAPT'))).toBe(3);
  });
});

describe('Network template: Scope and Detail Findings start on a new page', () => {
  const h = (t: string, style = 'Heading1') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const tblEl = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const withSplit = async (body: string, split = true) => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
    const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [], [], undefined, undefined, [], [], [], undefined, { splitVaPt: split });
    return (await (await JSZip.loadAsync(out)).file('word/document.xml').async('text')) as string;
  };
  const pbb = (xml: string) => xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0;

  it('both headings get pageBreakBefore, right after pStyle, without any new paragraph', async () => {
    const body = para('intro') + tblEl + para('') + h('Scope', 'Heading') + para('body') + tblEl + h('Detail Findings') + h('Details of VA Findings', 'Heading2');
    const xml = await withSplit(body);
    expect(xml).toContain('<w:pStyle w:val="Heading"/><w:pageBreakBefore/></w:pPr><w:r><w:t>Scope');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr><w:r><w:t>Detail Findings');
    expect(pbb(xml)).toBe(2);
    expect(xml.match(/<w:p[ >]/g)!.length).toBe(body.match(/<w:p[ >]/g)!.length);
  });

  it('no second break where the template already has one (page break, heading flag) or at the top of the document', async () => {
    expect(pbb(await withSplit(para('a') + pageBreak + h('Scope', 'Heading') + para('b') + pageBreak + para('') + h('Detail Findings')))).toBe(0);
    expect(pbb(await withSplit(h('Scope', 'Heading') + para('x')))).toBe(0);
  });

  it('only Heading-styled paragraphs and only Network reports are touched', async () => {
    const body = para('a') + tblEl + para('Scope') + para('b') + h('Methodology');
    expect(pbb(await withSplit(body))).toBe(0);
    expect(pbb(await withSplit(para('a') + h('Scope', 'Heading'), false))).toBe(0);
  });
});
