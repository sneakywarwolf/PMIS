import { BadRequestException } from '@nestjs/common';

// Keys produced by POST /findings/upload-poc-image. Anything else (templates/, reports/, other prefixes,
// traversal) must never be stored on a finding: report generation reads these keys and project purge deletes them.
const POC_KEY = /^poc\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9._-]{1,200}$/;

export function assertPocKey(key: unknown): string {
  if (typeof key !== 'string' || !POC_KEY.test(key) || key.includes('..')) {
    throw new BadRequestException('Invalid evidence file reference');
  }
  return key;
}

export function assertPocKeys(keys: unknown): string[] {
  if (!Array.isArray(keys) || keys.length > 100) throw new BadRequestException('Invalid evidence file list');
  return keys.map(assertPocKey);
}

/** Detects the real image type from magic bytes; the client-supplied MIME type is never trusted. */
export function sniffImageType(b: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
