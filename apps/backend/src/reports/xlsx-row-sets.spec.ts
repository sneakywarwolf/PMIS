import { RowSet, XlsxTemplateService } from './xlsx-template.service';
import { ReportsService } from './reports.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { LINE_SEP } from '../common/nessus-text.util';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const SHARED = ['Scope', '{IP}', '{Domain&Hostname}', '{Purpose}', '{Tester Name}', 'Notes', '{VA Vulnerability Name}', '{VA Output}', 'Open'];
const sst = `<sst xmlns="${NS}">${SHARED.map((t) => `<si><t>${t.replace('&', '&amp;')}</t></si>`).join('')}</sst>`;
const SCOPE = `<worksheet xmlns="${NS}"><dimension ref="A1:D8"/><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row>
<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" t="s"><v>3</v></c></row>
<row r="4"><c r="A4" t="s"><v>5</v></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5"><f>SUM(1,2)</f><v>3</v></c></row>
<row r="8"><c r="A8" t="s"><v>5</v></c></row>
</sheetData><mergeCells count="3"><mergeCell ref="A1:D1"/><mergeCell ref="A4:D4"/><mergeCell ref="C2:D2"/></mergeCells>
<conditionalFormatting sqref="D2"><cfRule type="cellIs" priority="1" operator="equal"><formula>"x"</formula></cfRule></conditionalFormatting>
<pageSetup orientation="portrait"/></worksheet>`;
const VA = `<worksheet xmlns="${NS}"><dimension ref="A1:C3"/><sheetData>
<row r="1"><c r="A1" t="s"><v>5</v></c></row>
<row r="3" ht="15" customHeight="1"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c></row>
</sheetData><autoFilter ref="A1:C3"/></worksheet>`;
const WB = `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Scope IP" sheetId="1" r:id="rId1"/><sheet name="VA Details" sheetId="2" r:id="rId2"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'VA Details'!$A$1:$C$3</definedName></definedNames><calcPr calcId="1"/></workbook>`;
const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`;

async function book() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', WB);
  zip.file('xl/_rels/workbook.xml.rels', RELS);
  zip.file('xl/sharedStrings.xml', sst);
  zip.file('xl/worksheets/sheet1.xml', SCOPE);
  zip.file('xl/worksheets/sheet2.xml', VA);
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}
const read = async (buf: Buffer, file: string) => (await (await JSZip.loadAsync(buf)).file(file).async('text')) as string;
/** Cell texts by reference; shared-string cells are looked up in the workbook's sharedStrings. */
async function sheet(buf: Buffer, file: string) {
  const strings = [...(await read(buf, 'xl/sharedStrings.xml')).matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'));
  const xml = await read(buf, file);
  const cells = Object.fromEntries([...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map((m) => {
    const inner = m[3] ?? '';
    return [m[1], m[2].includes('t="s"') ? strings[+/<v>(\d+)<\/v>/.exec(inner)![1]] : inner.replace(/<[^>]+>/g, '')];
  }));
  return { xml, cells };
}

const scopeSet = (rows: [string, string, string][]): RowSet => ({
  claims: (n) => n.includes('IP') && n.includes('Purpose'),
  rows: rows.map(([ip, d, p]) => (raw: string) => (raw === 'IP' ? ip : raw.startsWith('Domain') ? d : raw === 'Purpose' ? p : undefined)),
});
const vaSet = (rows: [string, string][]): RowSet => ({
  claims: (n) => n.some((x) => x.startsWith('VA ')),
  rows: rows.map(([name, out]) => (raw: string) => (raw === 'VA Vulnerability Name' ? name : raw === 'VA Output' ? out : undefined)),
});
const resolve = (raw: string) => (raw === 'Tester Name' ? 'Asha' : undefined);

describe('Excel repeating rows', () => {
  const svc = new XlsxTemplateService();
  const sets = [scopeSet([['10.0.0.1', 'a.example', 'Web'], ['10.0.0.2', 'b.example', 'DB'], ['10.0.0.3', 'c.example', 'AD']]), vaSet([['VA-A', 'out A\nline 2'], ['VA-B', '']])];

  it('one row per scope entry / finding, each keeping its own values; the rows below move down', async () => {
    const out = await svc.fill(await book(), resolve, { rowSets: sets });
    const scope = (await sheet(out, 'xl/worksheets/sheet1.xml')).cells;
    expect([scope.B2, scope.B3, scope.B4]).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
    expect([scope.C2, scope.C3, scope.C4]).toEqual(['a.example', 'b.example', 'c.example']);
    expect([scope.D2, scope.D3, scope.D4]).toEqual(['Web', 'DB', 'AD']);
    expect([scope.A2, scope.A3, scope.A4]).toEqual(['1', '2', '3']); // running number continues
    expect(scope.A6).toBe('Notes');  // was row 4
    expect(scope.A7).toBe('Asha');   // was row 5, still filled by the ordinary pass
    expect(scope.A10).toBe('Notes'); // was row 8
    const va = (await sheet(out, 'xl/worksheets/sheet2.xml')).cells;
    expect([va.A3, va.B3, va.C3, va.A4, va.B4, va.C4]).toEqual(['VA-A', 'out A\nline 2', 'Open', 'VA-B', '', 'Open']);
  });

  it('merges, conditional formats, the dimension, filters and formulas follow the move; nothing is unmerged', async () => {
    const out = await svc.fill(await book(), resolve, { rowSets: sets });
    const s1 = await read(out, 'xl/worksheets/sheet1.xml');
    const merges = [...s1.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]);
    expect(merges).toEqual(expect.arrayContaining(['A1:D1', 'A6:D6', 'C2:D2', 'C3:D3', 'C4:D4']));
    expect(merges).toHaveLength(5);
    expect(s1).toContain('<mergeCells count="5"');
    expect(s1).toContain('<dimension ref="A1:D10"');
    expect(s1).toContain('sqref="D2:D4"');
    expect(s1).toContain('<f>SUM(1,2)</f>');
    expect(s1).toContain('<pageSetup orientation="portrait"');
    const s2 = await read(out, 'xl/worksheets/sheet2.xml');
    expect(s2).toContain('<autoFilter ref="A1:C4"');
    expect(s2).toContain('<dimension ref="A1:C4"');
    expect(s2).toMatch(/<row r="4"[^>]*ht="15" customHeight="1"/);
    expect(await read(out, 'xl/workbook.xml')).toContain("'VA Details'!$A$1:$C$4");
  });

  it('no records: the row stays once with its placeholders emptied; a lone record changes nothing structural', async () => {
    const none = await svc.fill(await book(), resolve, { rowSets: [scopeSet([]), vaSet([])] });
    const v = (await sheet(none, 'xl/worksheets/sheet1.xml')).cells;
    expect([v.B2, v.C2, v.D2]).toEqual(['', '', '']);
    expect(v.A4).toBe('Notes');
    const one = await svc.fill(await book(), resolve, { rowSets: [scopeSet([['1.1.1.1', 'h', 'p']]), vaSet([['X', 'y']])] });
    expect(await read(one, 'xl/worksheets/sheet1.xml')).toContain('<dimension ref="A1:D8"');
  });

  it('without row sets the workbook behaves exactly as before', async () => {
    const out = await svc.fill(await book(), (r) => (r === 'IP' ? '9.9.9.9' : r === 'Tester Name' ? 'Asha' : undefined));
    const s1 = (await sheet(out, 'xl/worksheets/sheet1.xml')).cells;
    expect([s1.B2, s1.A5]).toEqual(['9.9.9.9', 'Asha']);
    expect(await read(out, 'xl/worksheets/sheet1.xml')).toContain('<dimension ref="A1:D8"');
  });
});

describe('Excel row sets from project data', () => {
  const rec = (name: string, type: 'VA' | 'PT', poc: string | null, hosts: string[]) => ({
    findingType: type, classification: type === 'VA' ? 'VA Finding' : null, proofOfConcept: poc, affectedInstances: hosts, cvssScoreOverride: null, cvssVectorOverride: null,
    authenticationType: null, vulnerabilityDependency: null, reportStatus: 'Open',
    vulnerability: { name, severity: 'High', cvssScore: 7, cvssVector: 'AV:N', description: 'd', impact: 'i', remediation: 'r', references: '', cveId: 'CVE-1', cweId: null },
  });
  const sets = (project: object): RowSet[] =>
    (new (ReportsService as any)(null, null, new DocxManipulatorService(), new XlsxTemplateService(), null, null, null, null) as any).excelRowSets({ category: 'VAPT' }, project);
  const project = {
    subType: 'NETWORK',
    networkScope: [{ ip: '10.0.0.1', domainHostname: 'a', purpose: 'Web' }, { ip: '10.0.0.2', domainHostname: '', purpose: 'DB' }],
    nmapPorts: [{ ip: '10.0.0.1', port: '443', protocol: 'tcp', service: 'https', status: 'open' }],
    findings: [rec('VA-A', 'VA', 'plugin A', ['h1']), rec('VA-B', 'VA', null, ['h2']), rec('PT-A', 'PT', null, ['h3'])],
  };

  it('{VA Output} is each VA finding\'s own plugin output; empty stays empty; PT findings never get one', () => {
    const [, , va, pt] = sets(project);
    expect(va.rows).toHaveLength(2);
    expect(va.rows.map((r) => r('VA Vulnerability Name'))).toEqual(['VA-A', 'VA-B']);
    expect(va.rows.map((r) => r('VA Output'))).toEqual(['plugin A', '']);
    expect(pt.rows.map((r) => r('Vulnerability Name'))).toEqual(['PT-A']);
    expect(pt.rows[0]('VA Output')).toBeUndefined();
  });

  it('scope and port rows keep their IP / host / purpose together; blanks read NA', () => {
    const [scope, ports] = sets(project);
    expect(scope.rows.map((r) => [r('IP'), r('Domain&Hostname'), r('Purpose')])).toEqual([['10.0.0.1', 'a', 'Web'], ['10.0.0.2', 'NA', 'DB']]);
    expect(ports.rows.map((r) => [r('nmap IP'), r('Port'), r('Protocol'), r('Service'), r('Status')])).toEqual([['10.0.0.1', '443', 'tcp', 'https', 'open']]);
  });

  it('multi-line scan text gets real line breaks', () => {
    const [, , va] = sets({ ...project, findings: [rec('VA-A', 'VA', `one${LINE_SEP}two`, [])] });
    expect(va.rows[0]('VA Output')).toBe('one\ntwo');
  });
});
