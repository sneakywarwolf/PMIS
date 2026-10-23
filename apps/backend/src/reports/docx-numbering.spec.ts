// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import { DocxManipulatorService } from './docx-manipulator.service';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NUMBERING = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>`;
const li = (text: string, numId: number, ilvl = 0) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function build(body: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  zip.file('word/numbering.xml', NUMBERING);
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}
const gen = async (body: string, activityType?: string) => {
  const out = await new DocxManipulatorService().generateReport(await build(body), [], [], [], undefined, undefined, [], [], [], undefined, { splitVaPt: true, activityType });
  const z = await JSZip.loadAsync(out);
  return { doc: (await z.file('word/document.xml').async('text')) as string, numbering: (await z.file('word/numbering.xml').async('text')) as string };
};
const numIds = (xml: string) => [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);

describe('Word list numbering is preserved', () => {
  const body = li('First', 1) + li('Second {Client Name}', 1) + li('Nested', 1, 1) + li('Restarted list', 2) + li('Another', 2);

  it('keeps numPr (numId, level), list style and indent through placeholder replacement; numbering.xml untouched', async () => {
    const { doc, numbering } = await gen(body);
    expect(numIds(doc)).toEqual(['1', '1', '1', '2', '2']);
    expect(doc.match(/<w:ilvl w:val="1"\/>/g)).toHaveLength(1);
    expect(doc.match(/w:pStyle w:val="ListParagraph"/g)).toHaveLength(5);
    expect(doc.match(/w:ind w:left="720" w:hanging="360"/g)).toHaveLength(5);
    expect(numbering).toBe(NUMBERING);
  });

  it('removing a VA block keeps the numbering of the content that follows', async () => {
    const block = `<w:p><w:r><w:t>{#VA}</w:t></w:r></w:p>${li('VA only', 1)}<w:p><w:r><w:t>{/VA}</w:t></w:r></w:p>`;
    const { doc } = await gen(li('Before', 1) + block + li('After', 1) + li('Restart', 2), 'PT');
    expect(doc).not.toContain('VA only');
    expect(numIds(doc)).toEqual(['1', '1', '2']);
  });
});
