import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';

const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const runs = (a: string[]) => `<w:p>${a.map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join('')}</w:p>`;
const tbl = (c: string) => `<w:tbl><w:tr><w:tc>${c}</w:tc></w:tr></w:tbl>`;
const NS = `xmlns:w="${W}"`;
const texts = (xml: string) => Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'p')).map((x) => x.textContent).join('|');

// One service instance for the whole file: sequential generations must not share state.
const svc = new DocxManipulatorService();
async function render(body: string, subType: string | null, activityType: string | null = null, category = 'CERT_IN') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  zip.file('word/header1.xml', `<?xml version="1.0"?><w:hdr ${NS}>${p('{#network}')}${p('HDR-net')}${p('{/network}')}${p('{#web}')}${p('HDR-web')}${p('{/web}')}</w:hdr>`);
  const out = await svc.generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [], [], undefined, undefined, [], [], [], undefined,
    { projectCategory: category, projectSubType: subType, activityType });
  const z = await JSZip.loadAsync(out);
  return { doc: texts(await z.file('word/document.xml').async('text')), hdr: texts(await z.file('word/header1.xml').async('text')) };
}

const block = (k: string, inner = p(`${k}-text`)) => p(`{#${k}}`) + inner + p(`{/${k}}`);
const all = ['network', 'web', 'mobile', 'tc', 'SCR'].map((k) => block(k)).join('');

describe('platform conditional blocks: regression', () => {
  it('Network report then Web report from the same template, same service: each has only its own content', async () => {
    const net = await render(all, 'NETWORK');
    const web = await render(all, 'WEB');
    const net2 = await render(all, 'NETWORK');
    expect(net.doc).toBe('network-text');
    expect(web.doc).toBe('web-text');
    expect(net2.doc).toBe('network-text');
    expect(net.hdr).toBe('HDR-net');
    expect(web.hdr).toBe('HDR-web');
  });

  it('API keeps web, drops network', async () => {
    expect((await render(all, 'API')).doc).toBe('web-text');
  });

  it.each([null, '', 'BOGUS'])('missing/unsupported platform %j keeps no platform block', async (sub) => {
    const r = await render(all, sub);
    expect(r.doc).toBe('');
    expect(r.hdr).toBe('');
  });

  it.each(['CERT_IN', 'PCI', 'VAPT'])('%s compliance type does not change platform blocks', async (c) => {
    expect((await render(all, 'WEB', null, c)).doc).toBe('web-text');
  });

  it('inline blocks, including markers split across runs, in a paragraph', async () => {
    const body = runs(['Scan ', '{#net', 'work}', 'NETONLY ', '{/ne', 'twork}', '{#web}', 'WEBONLY', '{/web}', ' done']);
    expect((await render(body, 'WEB')).doc).toBe('Scan WEBONLY done');
    expect((await render(body, 'NETWORK')).doc).toBe('Scan NETONLY  done');
  });

  it('inline block that empties a table cell keeps the cell valid', async () => {
    const out = await render(tbl(p('{#network}x{/network}')) + p('after'), 'WEB');
    expect(out.doc).toBe('|after');
  });

  it('blocks around and inside tables, several in one document', async () => {
    const body = p('a') + block('network', tbl(p('net-cell'))) + block('web', tbl(p('web-cell'))) + p('b');
    expect((await render(body, 'WEB')).doc).toBe('a|web-cell|b');
    expect((await render(body, 'NETWORK')).doc).toBe('a|net-cell|b');
  });

  it.each([
    ['VA', 'va-text'],
    ['PT', 'pt-text'],
    ['VAPT', 'va-text|pt-text'],
  ])('Network %s activity: VA/PT blocks follow the activity type', async (act, expected) => {
    const body = block('VA', p('va-text')) + block('PT', p('pt-text'));
    expect((await render(body, 'NETWORK', act)).doc).toBe(expected);
  });
});
