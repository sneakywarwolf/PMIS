import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';
import { resolveTemplateParameter } from './template-parameters';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('empty {App-Version}', () => {
  it('stays blank in a Word report (body and table cell), never "N/A"', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>V:{App-Version}|</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{App-Version}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`);
    const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [{ match: ['app_version'], value: '' }], [], []);
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
    const text = Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'p')).map((x) => x.textContent);
    expect(text).toEqual(['V:|', '']);
  });
  it('resolves to an empty string for mapped parameters', () => {
    expect(resolveTemplateParameter('project.appVersion', { appVersion: '' }, () => '')).toBe('');
    expect(resolveTemplateParameter('project.appVersion', {}, () => '')).toBe('');
  });
});
