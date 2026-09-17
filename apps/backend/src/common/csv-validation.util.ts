import { BadRequestException } from '@nestjs/common';

/** Case/spacing/punctuation-insensitive so "CVSS-VEC", "cvss vec", "CvssVec" all match. */
export function normalizeCsvHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, '').replace(/[-_]/g, '');
}

/**
 * Confirms every required header is present before any row is read.
 * Data is looked up by header name (not column position) once validation
 * passes, so this only checks presence/naming — a reordered-but-complete
 * header row is valid, a missing/renamed one is not.
 */
export function validateCsvHeaders(actualHeaders: string[], expectedHeaders: string[]): void {
  const actualNormalized = new Set(actualHeaders.map(normalizeCsvHeader));
  const missing = expectedHeaders.filter((h) => !actualNormalized.has(normalizeCsvHeader(h)));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Invalid CSV format. Missing or incorrect header(s): ${missing.join(', ')}. Expected headers: ${expectedHeaders.join(', ')}.`,
    );
  }
}
