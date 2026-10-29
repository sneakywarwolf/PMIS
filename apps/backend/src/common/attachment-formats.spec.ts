import { PayloadTooLargeException } from '@nestjs/common';
import { ATTACHMENT_FORMATS, DEFAULT_ATTACHMENT_SIZES_MB, attachmentLimits } from './attachment-formats';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from './attachment-upload';

const MB = 1024 * 1024;
afterEach(() => attachmentLimits.set(undefined));

describe('attachment format catalog', () => {
  it('lists every format once, each with a default inside its allowed range', () => {
    const keys = ATTACHMENT_FORMATS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of ATTACHMENT_FORMATS) {
      expect(f.key).toBe(`${f.purpose}.${f.extension}`);
      expect(f.defaultMb).toBeGreaterThanOrEqual(1);
      expect(f.defaultMb).toBeLessThanOrEqual(f.maxMb);
    }
  });

  it('keeps the limits that applied before the setting existed', () => {
    expect(attachmentLimits.maxBytes('poc', 'a.png')).toBe(25 * MB);
    expect(attachmentLimits.maxBytes('template', 'a.docx')).toBe(25 * MB);
    expect(attachmentLimits.maxBytes('vulnBulk', 'a.csv')).toBe(10 * MB);
    expect(attachmentLimits.maxBytes('userBulk', 'a.xlsx')).toBe(10 * MB);
    expect(attachmentLimits.maxBytes('nessus', 'a.nessus')).toBe(500 * MB);
    expect(attachmentLimits.maxBytes('findingsImport', 'a.csv')).toBe(100 * MB);
  });

  it('applies a limit to its own format only, and treats .jpeg as .jpg', () => {
    attachmentLimits.set({ ...DEFAULT_ATTACHMENT_SIZES_MB, 'poc.png': 2, 'poc.jpg': 3 });
    expect(attachmentLimits.maxBytes('poc', 'x.PNG')).toBe(2 * MB);
    expect(attachmentLimits.maxBytes('poc', 'x.jpeg')).toBe(3 * MB);
    expect(attachmentLimits.maxBytes('poc', 'x.gif')).toBe(25 * MB);
    expect(attachmentLimits.maxBytes('vulnBulk', 'x.csv')).toBe(10 * MB);
  });

  it('an unrecognised extension gets the purpose\'s largest limit; bad stored values are ignored', () => {
    attachmentLimits.set({ 'poc.png': 2, 'poc.gif': 'big', 'nope.x': 5, 'poc.webp': 0 });
    expect(attachmentLimits.maxBytes('poc', 'x.bmp')).toBe(25 * MB);
    expect(attachmentLimits.maxBytes('poc', 'x.gif')).toBe(25 * MB);
    expect(attachmentLimits.maxBytes('poc', 'x.webp')).toBe(25 * MB);
    expect(attachmentLimits.largestBytes('poc')).toBe(25 * MB);
  });
});

describe('upload size checks', () => {
  const file = (name: string, mb: number) => ({ originalname: name, size: mb * MB });

  it('refuses a file over the limit of its format and accepts one at the limit', () => {
    attachmentLimits.set({ 'poc.png': 2 });
    expect(() => assertAttachmentSize('poc', file('a.png', 3))).toThrow(PayloadTooLargeException);
    expect(() => assertAttachmentSize('poc', file('a.png', 3))).toThrow(/larger than 2 MB.*\.png/);
    expect(() => assertAttachmentSize('poc', file('a.png', 2))).not.toThrow();
    expect(() => assertAttachmentSize('poc', file('a.gif', 20))).not.toThrow();
  });

  it('raising a limit lets larger files through', () => {
    attachmentLimits.set({ 'vulnBulk.csv': 50 });
    expect(() => assertAttachmentSize('vulnBulk', file('a.csv', 30))).not.toThrow();
    expect(() => assertAttachmentSize('vulnBulk', file('a.xlsx', 30))).toThrow(PayloadTooLargeException);
  });

  it('multer is given the highest value an Admin can set, so raising a limit needs no restart', () => {
    attachmentLimits.set({ 'poc.png': 1 });
    expect(attachmentMulterLimits('poc').limits.fileSize).toBe(100 * MB);
    expect(attachmentMulterLimits('nessus').limits.fileSize).toBe(500 * MB);
    expect(attachmentMulterLimits('findingsImport').limits.fileSize).toBe(100 * MB);
  });

  it('the guard refuses a declared size above the largest limit before the body is read', () => {
    attachmentLimits.set({ 'userBulk.csv': 5, 'userBulk.xlsx': 5 });
    const Guard = AttachmentSizeGuard('userBulk');
    const ctx = (len: number) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { 'content-length': String(len) } }) }) }) as any;
    const guard = new Guard();
    expect(guard.canActivate(ctx(6 * MB))).toBe(true); // within the limit plus form overhead
    expect(() => guard.canActivate(ctx(20 * MB))).toThrow(PayloadTooLargeException);
  });
});

describe('Fortify (SCR) upload limits', () => {
  it('defaults to 500 MB for .fpr / .xml / .fvdl and can be raised to 1 GB', () => {
    attachmentLimits.set(undefined);
    for (const n of ['a.fpr', 'a.xml', 'a.fvdl']) expect(attachmentLimits.maxBytes('fortify', n)).toBe(500 * 1024 * 1024);
    expect(ATTACHMENT_FORMATS.filter((f) => f.purpose === 'fortify').every((f) => f.maxMb === 1024)).toBe(true);
  });
});
