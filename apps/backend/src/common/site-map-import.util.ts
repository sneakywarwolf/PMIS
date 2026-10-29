import { BadRequestException } from '@nestjs/common';
import { parseUploadedFileToCsv } from './bulk-upload-file.util';
import { parseCsv, normalizeCsvHeader } from './csv-validation.util';

export interface SiteMapRow {
  directoryName: string;
  fileName: string;
}
export interface SiteMapImportResult {
  rows: SiteMapRow[];
  /** Rows that were not imported, with the reason. */
  errors: { line: number; value: string; reason: string }[];
  duplicates: number;
}

const MAX_ROWS = 20000;
const MAX_FIELD = 500;

/**
 * Reads a Site Map file (.csv or .xlsx) with the header row "Directory Name", "File Name" (any order, any case).
 * Rows with neither value are skipped; repeated Directory+File pairs are dropped. The file is only read as data.
 */
export async function parseSiteMapFile(file: Express.Multer.File | undefined): Promise<SiteMapImportResult> {
  if (!file?.buffer?.length) throw new BadRequestException('No file uploaded, or the file is empty.');
  const name = (file.originalname || '').toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) throw new BadRequestException('Only .csv and .xlsx files are allowed.');

  const rows = parseCsv((await parseUploadedFileToCsv(file)).replace(/^﻿/, '').trim());
  const header = (rows[0] || []).map(normalizeCsvHeader);
  const dir = header.indexOf('directoryname');
  const fileCol = header.indexOf('filename');
  if (dir < 0 || fileCol < 0) throw new BadRequestException('Missing column. The header row must contain: Directory Name, File Name.');
  const body = rows.slice(1);
  if (body.length > MAX_ROWS) throw new BadRequestException(`Too many rows (maximum ${MAX_ROWS}).`);

  const result: SiteMapImportResult = { rows: [], errors: [], duplicates: 0 };
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const row: SiteMapRow = { directoryName: (r[dir] ?? '').trim(), fileName: (r[fileCol] ?? '').trim() };
    if (!row.directoryName && !row.fileName) return;
    if (row.directoryName.length > MAX_FIELD || row.fileName.length > MAX_FIELD) {
      result.errors.push({ line: i + 2, value: (row.fileName || row.directoryName).slice(0, 60), reason: `Longer than ${MAX_FIELD} characters` });
      return;
    }
    const key = `${row.directoryName}\u0000${row.fileName}`;
    if (seen.has(key)) {
      result.duplicates++;
      return;
    }
    seen.add(key);
    result.rows.push(row);
  });
  if (result.rows.length === 0) throw new BadRequestException('No rows to import: the file has a header but no Directory Name / File Name values.');
  return result;
}
