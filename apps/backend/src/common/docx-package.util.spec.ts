import JSZip from 'jszip';
import { assertSafeDocx, safeFileName } from './docx-package.util';

async function pkg(extra: Record<string, string> = {}, contentTypes = '<Types/>'): Promise<Buffer> {
  const z = new JSZip();
  z.file('[Content_Types].xml', contentTypes);
  z.file('word/document.xml', '<w:document/>');
  for (const [k, v] of Object.entries(extra)) z.file(k, v);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('assertSafeDocx', () => {
  it('accepts a plain package, including external hyperlinks', async () => {
    const rels = '<Relationships><Relationship Type="http://x/hyperlink" Target="https://a.b" TargetMode="External"/></Relationships>';
    await expect(assertSafeDocx(await pkg({ 'word/_rels/document.xml.rels': rels }))).resolves.toBeUndefined();
  });

  it.each([
    ['not a zip', Buffer.from('hello world')],
  ])('rejects %s', async (_n, b) => {
    await expect(assertSafeDocx(b as Buffer)).rejects.toThrow();
  });

  it('rejects a zip missing word/document.xml', async () => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<Types/>');
    await expect(assertSafeDocx(await z.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow();
  });

  it('rejects macros, ActiveX, executables and macro content types', async () => {
    await expect(assertSafeDocx(await pkg({ 'word/vbaProject.bin': 'x' }))).rejects.toThrow(/macros/);
    await expect(assertSafeDocx(await pkg({ 'word/activeX/a.xml': '<a/>' }))).rejects.toThrow();
    await expect(assertSafeDocx(await pkg({ 'word/embeddings/run.exe': 'MZ' }))).rejects.toThrow();
    await expect(assertSafeDocx(await pkg({}, '<Types>application/vnd.ms-word.document.macroEnabled.main+xml</Types>'))).rejects.toThrow();
  });

  it('rejects path traversal entries and DTD/entity declarations (XXE)', async () => {
    await expect(assertSafeDocx(await pkg({ '../evil.xml': '<a/>' }))).rejects.toThrow();
    await expect(assertSafeDocx(await pkg({ 'word/x.xml': '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a/>' }))).rejects.toThrow(/DTD/);
  });

  it('rejects remote attached-template and OLE links', async () => {
    const rels = '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil/t.dotm" TargetMode="External"/></Relationships>';
    await expect(assertSafeDocx(await pkg({ 'word/_rels/settings.xml.rels': rels }))).rejects.toThrow(/external/);
  });
});

describe('safeFileName', () => {
  it('strips paths and unsafe characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\x\\{Client} report.docx')).toBe('_Client_report.docx');
    expect(safeFileName('')).toBe('file');
  });
});
