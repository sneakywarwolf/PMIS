import { assertPocKey, assertPocKeys, sniffImageType } from './upload-security.util';
import { parseNmapXml } from './nmap-parser.util';

const ok = 'poc/123e4567-e89b-12d3-a456-426614174000_shot.png';

describe('upload-security', () => {
  it('accepts keys minted by the PoC upload endpoint', () => {
    expect(assertPocKey(ok)).toBe(ok);
    expect(assertPocKeys([ok])).toEqual([ok]);
  });

  it.each([
    'templates/abc.docx',
    'reports/x.docx',
    'poc/../templates/a.docx',
    'poc/123e4567-e89b-12d3-a456-426614174000_../../x.png',
    '/etc/passwd',
    '',
    42,
    null,
  ])('rejects %p', (k) => {
    expect(() => assertPocKey(k)).toThrow();
  });

  it('rejects non-array / oversized lists', () => {
    expect(() => assertPocKeys('x')).toThrow();
    expect(() => assertPocKeys(Array(101).fill(ok))).toThrow();
  });

  it('sniffs real image types and rejects spoofed content', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImageType(Buffer.from('<html><script>'))).toBeNull();
  });

  it('nmap parser rejects DTD/entity declarations (XXE)', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nmaprun/>';
    expect(() => parseNmapXml(xxe)).toThrow(/DTD/);
  });
});
