import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService, FindingData, PocImage } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;

const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>${rows.join('')}</w:tbl>`;
const gap = '<w:p><w:r><w:t>.</w:t></w:r></w:p>';

const summary = tbl(row('S.No', 'Vulnerability', 'CVSS'), row('{S No}', '{Vulnerability Name}', '{CVSS Score}'));
const detail = tbl(
  row('{S No}', '{Vulnerability Name}'),
  row('Severity', '{Severity}'),
  row('CVSS', '{CVSS Vector}'),
  row('Description', '{Vulnerability Description}'),
  row('POC Reproduction Steps', '{Fix POC Snapshot}'),
);
const template = [summary, gap, detail].join('');

/** A PNG with the given pixel size and a distinguishing marker, so each image is identifiable inside the .docx. */
function png(width: number, height: number, marker: string): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from(marker, 'latin1')]);
}

async function docxWith(bodyXml: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

const finding = (pocSteps: FindingData['pocSteps']): FindingData => ({
  no: 1, title: 'Finding', severity: 'High', cvssScore: 7, cvssVector: 'CVSS:3.1/AV:N',
  description: 'd', impact: 'i', remediation: 'r', references: '', cveId: null, cweId: null,
  affectedInstances: '', authenticationType: null, vulnerabilityDependency: null, reportStatus: 'Open', pocSteps, findingType: 'PT',
});

async function generate(findings: FindingData[], images: PocImage[]) {
  const svc = new DocxManipulatorService();
  const out = await svc.generateReport(await docxWith(template), [], findings, images);
  const zip = await JSZip.loadAsync(out);
  const doc = new DOMParser().parseFromString(await zip.file('word/document.xml').async('text'), 'text/xml');
  const rels = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('text'), 'text/xml');
  const target = new Map<string, string>();
  const relEls = rels.getElementsByTagName('Relationship');
  for (let i = 0; i < relEls.length; i++) target.set(relEls.item(i)!.getAttribute('Id')!, relEls.item(i)!.getAttribute('Target')!);
  const pics = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/picture', 'pic')) as any[];
  const embedded: Buffer[] = [];
  for (const pic of pics) {
    const blip = pic.getElementsByTagNameNS(A, 'blip')[0];
    const rid = blip.getAttributeNS(R, 'embed');
    embedded.push(await zip.file(`word/${target.get(rid)}`).async('nodebuffer'));
  }
  return { doc, pics, embedded };
}

describe('Word report: PoC snapshots', () => {
  const imgs = [png(100, 50, 'AAAA'), png(200, 100, 'BBBB'), png(300, 150, 'CCCC')];
  const images: PocImage[] = imgs.map((buffer, i) => ({ key: `k${i}`, buffer, extension: 'png' }));

  it('prints every PoC of a step, in order, under that step', async () => {
    const { embedded } = await generate([finding([{ stepNo: 1, description: 'Step one', imageKey: 'k0', imageKeys: ['k0', 'k1', 'k2'] }])], images);
    expect(embedded.map((b) => b.toString('latin1').slice(-4))).toEqual(['AAAA', 'BBBB', 'CCCC']);
  });

  it('keeps each step\'s PoCs with its own step and in the stored order after reordering', async () => {
    const { doc, embedded } = await generate(
      [finding([
        { stepNo: 1, description: 'First step', imageKey: 'k2', imageKeys: ['k2', 'k0'] },
        { stepNo: 2, description: 'Second step', imageKey: 'k1', imageKeys: ['k1'] },
      ])],
      images,
    );
    expect(embedded.map((b) => b.toString('latin1').slice(-4))).toEqual(['CCCC', 'AAAA', 'BBBB']);
    const rows = Array.from(doc.getElementsByTagNameNS(W, 'tr')) as any[];
    const stepRows = rows.filter((r) => r.getElementsByTagNameNS(W, 'drawing').length > 0);
    expect(stepRows.map((r) => r.getElementsByTagNameNS(W, 'drawing').length)).toEqual([2, 1]);
    expect(stepRows[0].textContent).toContain('First step');
    expect(stepRows[1].textContent).toContain('Second step');
  });

  it('still renders a step that only has the older single imageKey', async () => {
    const { embedded } = await generate([finding([{ stepNo: 1, description: 'Legacy', imageKey: 'k1' }])], images);
    expect(embedded.map((b) => b.toString('latin1').slice(-4))).toEqual(['BBBB']);
  });

  it('draws a solid black border around every PoC without changing its size', async () => {
    const { pics, doc } = await generate([finding([{ stepNo: 1, description: 's', imageKey: 'k0', imageKeys: ['k0', 'k1', 'k2'] }])], images);
    expect(pics).toHaveLength(3);
    for (const pic of pics) {
      const ln = pic.getElementsByTagNameNS(A, 'ln')[0];
      expect(ln).toBeTruthy();
      expect(ln.getAttribute('w')).toBe('9525');
      expect(ln.getElementsByTagNameNS(A, 'solidFill')[0].getElementsByTagNameNS(A, 'srgbClr')[0].getAttribute('val')).toBe('000000');
      // spPr child order required by the schema: xfrm, geometry, fill, ln
      const spPr = pic.getElementsByTagName('pic:spPr')[0];
      const names = Array.from(spPr.childNodes).map((n: any) => n.localName);
      expect(names).toEqual(['xfrm', 'prstGeom', 'ln']);
    }
    // Original pixel size is kept (100x50, 200x100, 300x150), so the aspect ratio is unchanged.
    const extents = (Array.from(doc.getElementsByTagNameNS(WP, 'extent')) as any[]).map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
    expect(extents).toEqual([[100, 50], [200, 100], [300, 150]].map(([w, h]) => [w * EMU_PER_PX, h * EMU_PER_PX]));
  });

  it('adds no border to anything but PoC pictures', async () => {
    const { doc } = await generate([finding([{ stepNo: 1, description: 's', imageKey: 'k0', imageKeys: ['k0'] }])], images);
    const lines = doc.getElementsByTagNameNS(A, 'ln').length;
    expect(lines).toBe(doc.getElementsByTagNameNS(WP, 'inline').length);
  });
});
