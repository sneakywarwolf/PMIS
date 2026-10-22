// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import { XlsxTemplateService } from './xlsx-template.service';

const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function workbook() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', `<workbook xmlns="${M}"><sheets><sheet name="Cover" sheetId="1" r:id="rId1" xmlns:r="x"/><sheet name="Details" sheetId="2" r:id="rId2" xmlns:r="x"/></sheets><calcPr calcId="191029"/></workbook>`);
  zip.file('xl/sharedStrings.xml',
    `<sst xmlns="${M}" count="5" uniqueCount="5">`
    + '<si><t>Client: {Client Name}</t></si>'                                   // 0 plain, used on both sheets
    + '<si><r><rPr><b/></rPr><t xml:space="preserve">Tester: {Tes</t></r><r><t>ter Name}</t></r></si>' // 1 placeholder split across runs
    + '<si><t>Static heading, no placeholder</t></si>'                         // 2
    + '<si><t>{Unknown Thing} and {Client Name}</t></si>'                      // 3 one unresolved, one resolved
    + '<si><t>Line {Scope}</t></si>'                                           // 4
    + '</sst>');
  zip.file('xl/worksheets/sheet1.xml',
    `<worksheet xmlns="${M}"><sheetData>`
    + '<row r="1"><c r="A1" s="3" t="s"><v>0</v></c><c r="B1" s="4" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c><c r="C2"><f>B2*2</f><v>84</v></c></row>'
    + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>');
  zip.file('xl/worksheets/sheet2.xml',
    `<worksheet xmlns="${M}"><sheetData>`
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>3</v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>Inline {Tester Name}</t></is></c><c r="B2" t="s"><v>4</v></c></row>'
    + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const values: Record<string, string> = { 'Client Name': 'Acme', 'Tester Name': 'Asha', Scope: '10.0.0.0/24\nDMZ' };
const resolve = (raw: string) => values[raw];

describe('XlsxTemplateService', () => {
  const svc = new XlsxTemplateService();

  it('finds placeholders on every worksheet, once each', async () => {
    expect(await svc.extractPlaceholders(await workbook())).toEqual(['Client Name', 'Tester Name', 'Unknown Thing', 'Scope']);
  });

  it('fills every sheet with the same resolver, including repeats, split runs and inline strings', async () => {
    const out = await JSZip.loadAsync(await svc.fill(await workbook(), resolve));
    const shared = await out.file('xl/sharedStrings.xml')!.async('text');
    expect(shared).toContain('Client: Acme');
    expect(shared).toContain('Tester: Asha');           // split across two runs
    expect(shared).toContain('{Unknown Thing} and Acme'); // unresolved stays literal, resolved one fills
    expect(shared).toContain('Line 10.0.0.0/24\nDMZ');
    expect(shared).toContain('Static heading, no placeholder');
    expect(await out.file('xl/worksheets/sheet2.xml')!.async('text')).toContain('Inline Asha');
  });

  it('leaves structure, styles, formulas, numbers, merges and sheet names exactly as uploaded', async () => {
    const before = await JSZip.loadAsync(await workbook());
    const after = await JSZip.loadAsync(await svc.fill(await workbook(), resolve));
    expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
    // sheet1 has no inline strings, so it is byte-identical; sheet2 only differs in the inline text
    expect(await after.file('xl/worksheets/sheet1.xml')!.async('text')).toBe(await before.file('xl/worksheets/sheet1.xml')!.async('text'));
    const wb = await after.file('xl/workbook.xml')!.async('text');
    expect(wb).toContain('name="Cover"');
    expect(wb).toContain('name="Details"');
    expect(wb.indexOf('Cover')).toBeLessThan(wb.indexOf('Details'));
    expect(wb).toContain('fullCalcOnLoad="1"');
    // rich-text formatting of the first run survives the split-run merge
    expect(await after.file('xl/sharedStrings.xml')!.async('text')).toContain('<b/>');
  });

  it('rejects a file that is not a workbook', async () => {
    await expect(svc.fill(Buffer.from('nope'), resolve)).rejects.toBeTruthy();
    const zip = new JSZip();
    zip.file('hello.txt', 'x');
    await expect(svc.extractPlaceholders(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/valid .xlsx/);
  });
});

describe('XlsxTemplateService {Project Status}', () => {
  const svc = new XlsxTemplateService();
  const STYLES =
    `<styleSheet xmlns="${M}"><fonts count="1"><font><sz val="11"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyBorder="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>';

  async function book() {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('xl/workbook.xml', `<workbook xmlns="${M}"><sheets><sheet name="S" sheetId="1" r:id="rId1" xmlns:r="x"/></sheets></workbook>`);
    zip.file('xl/styles.xml', STYLES);
    zip.file('xl/sharedStrings.xml', `<sst xmlns="${M}" count="3" uniqueCount="3"><si><t>{Project Status}</t></si><si><t>Client: {Client Name}</t></si><si><t>Result</t></si></sst>`);
    zip.file('xl/worksheets/sheet1.xml',
      `<worksheet xmlns="${M}"><sheetData><row r="1">`
      + '<c r="A1" s="1" t="s"><v>2</v></c><c r="B1" s="1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c>'
      + '<c r="D1" t="inlineStr"><is><t>{Compliance Status}</t></is></c></row></sheetData></worksheet>');
    return zip.generateAsync({ type: 'nodebuffer' });
  }
  const open = async (buf: Buffer) => {
    const z = await JSZip.loadAsync(buf);
    return {
      sheet: await z.file('xl/worksheets/sheet1.xml').async('text'),
      styles: await z.file('xl/styles.xml').async('text'),
      shared: await z.file('xl/sharedStrings.xml').async('text'),
    };
  };
  const styleOf = (sheet: string, ref: string) => /s="(\d+)"/.exec(new RegExp(`<c r="${ref}"[^>]*>`).exec(sheet)![0])?.[1] ?? '0';
  const resolve = (raw: string) => (raw === 'Client Name' ? 'Acme' : undefined);

  it.each([
    ['Compliant', 'Compliant', 'FF92D050'],
    ['Non-Compliant', 'Non-Compliant', 'FFFF0000'],
  ])('%s: prints the text and fills only the status cells, as a copy of their own style', async (status, text, rgb) => {
    const { sheet, styles, shared } = await open(await svc.fill(await book(), resolve, { complianceStatus: status }));
    expect(shared).toContain(`>${text}</t>`);
    expect(shared).not.toContain('{Project Status}');
    expect(sheet).toContain(`>${text}<`); // the inline {Compliance Status} cell
    expect(styles).toContain(`<fgColor rgb="${rgb}"/>`);
    expect(styles).toContain('<fills count="3">');
    expect(styles).toContain('<cellXfs count="4">'); // original 2 + a clone for style 1 + a clone for the default style
    // B1 (was style 1) and D1 (was default) get new styles that keep what they had; A1 and C1 are untouched.
    expect(styleOf(sheet, 'A1')).toBe('1');
    expect(sheet).not.toMatch(/<c r="C1"[^>]* s=/);
    const b1 = Number(styleOf(sheet, 'B1'));
    expect(b1).toBeGreaterThanOrEqual(2);
    const xfs = [...styles.matchAll(/<xf\b[^>]*?(?:\/>|>.*?<\/xf>)/gs)].map((m) => m[0]);
    expect(xfs[b1]).toContain('fillId="2"');
    expect(xfs[b1]).toContain('<alignment horizontal="center"/>'); // alignment of the original style 1 kept
    expect(xfs[Number(styleOf(sheet, 'D1'))]).toContain('fillId="2"');
  });

  it.each(['In-Progress', null, undefined, 'other'])('%s: empty text, no style or colour change at all', async (status) => {
    const { sheet, styles, shared } = await open(await svc.fill(await book(), resolve, { complianceStatus: status as string | null | undefined }));
    expect(shared).not.toContain('{Project Status}');
    expect(shared).toMatch(/<si><t[^>]*(\/>|><\/t>)<\/si>/); // empty text, either serialisation
    expect(styles).toBe(STYLES.startsWith('<?xml') ? STYLES : (await open(await book())).styles); // styles part not rewritten
    expect(styleOf(sheet, 'B1')).toBe('1');
    expect(sheet).not.toMatch(/<c r="D1"[^>]* s=/);
  });

  it('without the options argument (existing callers) the placeholder is simply emptied', async () => {
    const { shared } = await open(await svc.fill(await book(), resolve));
    expect(shared).not.toContain('{Project Status}');
  });

  it('other placeholders still resolve as before', async () => {
    const { shared } = await open(await svc.fill(await book(), resolve, { complianceStatus: 'Compliant' }));
    expect(shared).toContain('Client: Acme');
  });

  it('the status placeholders are still listed when the template is analysed', async () => {
    expect(await svc.extractPlaceholders(await book())).toEqual(expect.arrayContaining(['Project Status', 'Compliance Status', 'Client Name']));
  });
});
