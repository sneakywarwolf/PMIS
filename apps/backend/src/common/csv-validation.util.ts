import { BadRequestException } from '@nestjs/common';

/**
 * Parses full CSV content into rows of columns, honoring RFC 4180 quoting —
 * critically, a newline inside a quoted field (e.g. a multi-paragraph
 * Remediation/Description column) does NOT start a new row. Splitting the
 * raw text on "\n" before parsing quotes (the naive approach) breaks on any
 * such field, so this parses the whole content as one character stream.
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldTouched = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      fieldTouched = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      fieldTouched = true;
    } else if (char === '\r') {
      // consumed as part of a \r\n pair below, or ignored for a lone \r
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldTouched = false;
    } else {
      field += char;
      fieldTouched = true;
    }
  }

  if (fieldTouched || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

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

/**
 * Strict variant: headers must match expectedHeaders exactly — same names,
 * same order, no extra or missing columns. Used where the template format
 * is fixed and reordering/extra columns should be rejected rather than
 * tolerated.
 */
export function validateExactCsvHeaders(actualHeaders: string[], expectedHeaders: string[]): void {
  const trimmed = actualHeaders.map((h) => h.trim());
  if (trimmed.length === expectedHeaders.length && trimmed.every((h, i) => h === expectedHeaders[i])) {
    return;
  }

  const missing = expectedHeaders.filter((h) => !trimmed.includes(h));
  const extra = trimmed.filter((h) => !expectedHeaders.includes(h));
  const misplaced = expectedHeaders
    .map((h, i) => ({ header: h, expectedPos: i + 1, actualPos: trimmed.indexOf(h) + 1 }))
    .filter((h) => h.actualPos > 0 && h.actualPos !== h.expectedPos);

  const reasons: string[] = [];
  if (missing.length > 0) reasons.push(`missing header(s): ${missing.join(', ')}`);
  if (extra.length > 0) reasons.push(`unexpected/extra header(s): ${extra.join(', ')}`);
  if (missing.length === 0 && extra.length === 0 && misplaced.length > 0) {
    reasons.push(
      `header(s) out of order: ${misplaced.map((h) => `"${h.header}" is in column ${h.actualPos}, expected column ${h.expectedPos}`).join('; ')}`,
    );
  }
  if (reasons.length === 0) reasons.push('header row does not match the required format');

  throw new BadRequestException(
    `Invalid CSV format — ${reasons.join('; ')}. Required header row (exact names and order): ${expectedHeaders.join(', ')}.`,
  );
}
