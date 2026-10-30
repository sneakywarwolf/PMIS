import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const row = (a: string, b: string) => `<w:tr><w:tc><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`;

async function render(siteMap: { directoryName: string; fileName: string }[]) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>${row('Directory', 'File')}${row('{Directory Name}', '{File Name}')}</w:tbl></w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [], [], undefined, undefined, [], [], [], undefined, { siteMap });
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  return Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'tr'))
    .map((r) => Array.from(r.getElementsByTagNameNS(W, 'tc')).map((c) => c.textContent));
}

describe('Site Map in the Word report', () => {
  it('prints one row per file, keeping the header row', async () => {
    expect(await render([{ directoryName: '/src', fileName: 'a.js' }, { directoryName: '/src/lib', fileName: 'b.js' }]))
      .toEqual([['Directory', 'File'], ['/src', 'a.js'], ['/src/lib', 'b.js']]);
  });
  it('leaves one blank row when there is no Site Map', async () => {
    expect(await render([])).toEqual([['Directory', 'File'], ['', '']]);
  });
});
