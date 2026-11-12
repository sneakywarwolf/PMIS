import { replaceTags, trimTrailingPunctuation } from './linear-regex.util';
import { cleanRichText } from './fortify-parser.util';

const time = (fn: () => void) => { const t = Date.now(); fn(); return Date.now() - t; };

describe('linear tag stripping', () => {
  it('gives the same result as the plain regex on ordinary text', () => {
    const cases = ['plain', 'a <b>bold</b> c', '<p>one</p><p>two</p>', 'x < y and y > z', '<a href="x">link</a> tail <', '<<>>', '<>', 'no tags > here', '<br/>text<br />more'];
    for (const c of cases) expect(replaceTags(c, /<[^>]+>/g, ' ')).toBe(c.replace(/<[^>]+>/g, ' '));
  });

  it('keeps a trailing "<" run (no closing ">") exactly as the regex would', () => {
    expect(replaceTags('keep <b <b <b', /<[^>]+>/g, ' ')).toBe('keep <b <b <b');
  });

  it.each(['<b ', '<a ', '<p ', '<Replace '])('cleanRichText stays fast on %j repeated to 1 MB (was 2.5 s per 64 KB)', (unit) => {
    expect(time(() => cleanRichText(unit.repeat(Math.floor(1_000_000 / unit.length))))).toBeLessThan(500);
  });

  it('still cleans real Fortify markup', () => {
    expect(cleanRichText('&lt;Paragraph&gt;Uses &lt;Replace key="Foo"/&gt;.&lt;/Paragraph&gt;', { Foo: 'bar' })).toBe('Uses bar.');
  });

  it('trailing punctuation trim is linear and equivalent', () => {
    for (const c of ['1.', '1.5.', '2026-11-12-', '3,', '7', '1:/-.,']) expect(trimTrailingPunctuation(c)).toBe(c.replace(/[.,:/-]+$/, ''));
    expect(time(() => trimTrailingPunctuation('1' + '-'.repeat(1_000_000)))).toBeLessThan(200);
  });
});
