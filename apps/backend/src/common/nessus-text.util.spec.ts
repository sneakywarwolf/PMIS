import { cleanNessusText, nessusTextForReport, LINE_SEP } from './nessus-text.util';

describe('cleanNessusText', () => {
  it('joins Nessus hard-wrapped prose into one paragraph and keeps paragraph breaks', () => {
    const wrapped = [
      'The remote service supports the use of weak SSL ciphers, which could allow an',
      'attacker to decrypt traffic between the client and the server using brute',
      'force methods.',
      '',
      'Note that this is a different issue.',
    ].join('\n');
    expect(cleanNessusText(wrapped)).toBe(
      'The remote service supports the use of weak SSL ciphers, which could allow an attacker to decrypt traffic between the client and the server using brute force methods.\n\nNote that this is a different issue.',
    );
  });

  it('normalises spaces, tabs, trailing blanks and runs of blank lines without touching content', () => {
    expect(cleanNessusText('Port\t443   is   open.  \r\n\r\n\r\n\r\n   Fixed in   CVE-2016-2183 (see  note).')).toBe(
      'Port 443 is open.\n\nFixed in CVE-2016-2183 (see note).',
    );
  });

  it('keeps bullets and numbering as their own lines, with light indentation', () => {
    const text = 'Affected versions:\n  - OpenSSL 1.0.1 through 1.0.1f, which are all of them\n    vulnerable to this attack\n  - OpenSSL 1.0.2\n1. First step\n2) Second step\n        * nested item';
    expect(cleanNessusText(text)).toBe(
      'Affected versions:\n  - OpenSSL 1.0.1 through 1.0.1f, which are all of them vulnerable to this attack\n  - OpenSSL 1.0.2\n1. First step\n2) Second step\n    * nested item',
    );
  });

  it('is conservative: short lines, sentence ends and capitalised lines are not joined', () => {
    const output = 'Port: 443\nProtocol: tcp\nThe remote host is vulnerable.\nSee the advisory for details about this problem and how to fix it today\nNext Section Starts Here';
    expect(cleanNessusText(output)).toBe(output);
  });

  it('never loses or reorders characters', () => {
    const text = 'CVE-2020-1234, CVE-2021-5678: "quoted" text; a/b & <c> [d] {e} 100% done!';
    expect(cleanNessusText(text)).toBe(text);
    const squash = (s: string) => s.replace(/\s+/g, '');
    const noisy = 'A  long   line of text that is hard-wrapped by the scanner at some\n   point and continues here;\n\tthen   ends.';
    expect(squash(cleanNessusText(noisy))).toBe(squash(noisy));
  });

  it('returns empty for missing or blank input and marks line breaks for the report writer', () => {
    expect(cleanNessusText(null)).toBe('');
    expect(cleanNessusText('  \n \t ')).toBe('');
    expect(nessusTextForReport(undefined)).toBe('');
    expect(nessusTextForReport('one\n\ntwo')).toBe(`one${LINE_SEP}${LINE_SEP}two`);
  });
});
