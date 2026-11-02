import { DOMParser } from '@xmldom/xmldom';
import { DocxManipulatorService } from './docx-manipulator.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

async function render(body: string, category: string, subType: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  const out = await new DocxManipulatorService().generateReport(await zip.generateAsync({ type: 'nodebuffer' }), [], [], [], undefined, undefined, [], [], [], undefined,
    { projectCategory: category, projectSubType: subType });
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('text');
  return Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagNameNS(W, 'p')).map((x) => x.textContent);
}

const KINDS = ['network', 'web', 'mobile', 'tc', 'SCR'] as const;
const body = [p('intro'), ...KINDS.flatMap((k) => [p(`{#${k}}`), p(`${k}-text`), p(`{/${k}}`)]), p('outro')].join('');

describe('platform conditional blocks', () => {
  // Persisted Testing Type (subType) -> the blocks that are kept. The project category plays no part.
  it.each([
    ['CERT_IN', 'NETWORK', ['network']],
    ['PCI', 'NETWORK', ['network']],
    ['VAPT', 'NETWORK', ['network']],
    ['VAPT', 'WEB', ['web']],
    ['PCI', 'API', ['web']],
    ['VAPT', 'MOBILE', ['mobile']],
    ['PCI', 'THICK_CLIENT', ['tc']],
    ['CERT_IN', 'SCR', ['SCR']],
    ['PCI', 'SCR', ['SCR']],
    ['VAPT', 'APPLICATION', []],
  ])('%s + %s keeps %j', async (category, subType, kept) => {
    const text = (await render(body, category, subType)).join('|');
    for (const k of KINDS) expect(text.includes(`${k}-text`)).toBe(kept.includes(k));
    expect(text).toContain('intro');
    expect(text).toContain('outro');
    expect(text).not.toMatch(/\{[#/]/); // no marker is ever left behind
  });

  it('is case-insensitive and tolerates spaces in the marker', async () => {
    const text = (await render([p('{# Network }'), p('n'), p('{/ NETWORK }')].join(''), 'CERT_IN', 'NETWORK')).join('|');
    expect(text).toContain('n');
    expect(text).not.toContain('{');
  });

  it.each([['PCI'], ['VAPT'], ['CERT_IN']])('%s SCR template with no conditional markers generates normally', async (category) => {
    const text = (await render([p('intro'), p('body'), p('outro')].join(''), category, 'SCR')).join('|');
    expect(text).toBe('intro|body|outro');
  });

  it('a matched {#SCR} block is processed (kept for SCR, removed otherwise)', async () => {
    const withBlock = [p('a'), p('{#SCR}'), p('scr-only'), p('{/SCR}'), p('b')].join('');
    expect((await render(withBlock, 'PCI', 'SCR')).join('|')).toBe('a|scr-only|b');
    expect((await render(withBlock, 'PCI', 'WEB')).join('|')).toBe('a|b');
  });

  it('an opener with no closing marker is logged and left as it is, never an error', async () => {
    await expect(render([p('x'), p('{#SCR}'), p('y')].join(''), 'PCI', 'SCR')).resolves.toBeDefined();
    await expect(render([p('x'), p('{/SCR}')].join(''), 'PCI', 'SCR')).resolves.toBeDefined();
  });

  it('leaves {#VA} / {#PT} blocks as before', async () => {
    const text = (await render([p('{#VA}'), p('va'), p('{/VA}')].join(''), 'VAPT', 'WEB')).join('|');
    expect(text).toContain('va');
  });
});
