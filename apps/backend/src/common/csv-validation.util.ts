import { BadRequestException } from '@nestjs/common';

export const MAX_CSV_ROWS = 200_000;
export const MAX_CSV_COLUMNS = 200;

const QUOTE = 34;
const COMMA = 44;
const CR = 13;
const LF = 10;

const limitError = () => new BadRequestException(`File exceeds the allowed size (max ${MAX_CSV_ROWS} rows and ${MAX_CSV_COLUMNS} columns).`);

/**
 * Incremental RFC 4180 reader: feed it text in any chunking and it hands each finished row to `onRow`, so a file
 * of any size can be read without ever being held whole. Quoting works as in parseCsv, which is built on it: a
 * newline inside a quoted field does not end the row, "" is a literal quote, a lone \r is ignored.
 * `maxFieldChars` (optional) cuts any single field at that length, so one runaway quoted field cannot use memory.
 */
export class CsvRowStream {
  private row: string[] = [];
  private field = '';
  private touched = false;
  private inQuotes = false;
  /** A quote was just read inside quotes: an escaped "" or the closing quote, decided by the next character. */
  private quotePending = false;

  constructor(private readonly onRow: (row: string[]) => void, private readonly opts: { maxFieldChars?: number } = {}) {}

  write(text: string): void {
    let start = 0; // where the current run of ordinary characters began; runs are appended in one piece
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (this.inQuotes) {
        if (c !== QUOTE) {
          if (!this.quotePending) continue;
          this.inQuotes = false; // the quote before this character closed the field: read it as unquoted
          this.quotePending = false;
        } else if (this.quotePending) {
          this.append('"');
          this.quotePending = false;
          start = i + 1;
          continue;
        } else {
          this.append(text.slice(start, i));
          this.quotePending = true;
          start = i + 1;
          continue;
        }
      }
      if (c === QUOTE) {
        this.append(text.slice(start, i));
        this.inQuotes = true;
        this.touched = true;
        start = i + 1;
      } else if (c === COMMA) {
        this.append(text.slice(start, i));
        this.endField();
        this.touched = true;
        start = i + 1;
      } else if (c === CR) {
        this.append(text.slice(start, i));
        start = i + 1;
      } else if (c === LF) {
        this.append(text.slice(start, i));
        this.endField();
        this.emit();
        this.touched = false;
        start = i + 1;
      }
    }
    this.append(text.slice(start));
  }

  end(): void {
    this.inQuotes = false;
    this.quotePending = false;
    if (this.touched || this.field.length > 0 || this.row.length > 0) {
      this.endField();
      this.emit();
    }
    this.touched = false;
  }

  private append(s: string): void {
    if (!s) return;
    const max = this.opts.maxFieldChars;
    if (max === undefined) this.field += s;
    else if (this.field.length < max) this.field += s.length > max - this.field.length ? s.slice(0, max - this.field.length) : s;
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
    if (this.row.length > MAX_CSV_COLUMNS) throw limitError();
  }

  private emit(): void {
    const row = this.row;
    this.row = [];
    this.onRow(row);
  }
}

/**
 * Parses full CSV content into rows of columns, honoring RFC 4180 quoting —
 * critically, a newline inside a quoted field (e.g. a multi-paragraph
 * Remediation/Description column) does NOT start a new row.
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  const stream = new CsvRowStream((row) => rows.push(row));
  stream.write(content);
  stream.end();
  assertCsvLimits(rows);
  return rows;
}

/** Parser limits: a hostile file must not be able to turn a 10-25 MB upload into millions of rows/columns. */
export function assertCsvLimits(rows: string[][]): void {
  if (rows.length > MAX_CSV_ROWS || rows.some((r) => r.length > MAX_CSV_COLUMNS)) {
    throw new BadRequestException(`File exceeds the allowed size (max ${MAX_CSV_ROWS} rows and ${MAX_CSV_COLUMNS} columns).`);
  }
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
