import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';
import { parseUploadedFileToCsv } from './bulk-upload-file.util';
import { parseCsv, normalizeCsvHeader } from './csv-validation.util';

export interface ScopeRow {
  ip: string;
  domainHostname: string;
  purpose: string;
}
export interface ScopeImportResult {
  rows: ScopeRow[];
  /** Lines/rows that were not imported, with the reason. */
  errors: { line: number; value: string; reason: string }[];
  duplicates: number;
}

const MAX_ROWS = 5000;
const MAX_FIELD = 255;

/** A single IPv4/IPv6 address or a CIDR range (e.g. 10.0.0.0/24). */
function isValidTarget(v: string): boolean {
  const [addr, prefix, ...rest] = v.split('/');
  if (rest.length) return false;
  const version = isIP(addr);
  if (!version) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

/**
 * Reads an uploaded scope file. .txt: one IP per line. .csv/.xlsx: columns IP, Domain, Purpose (header row
 * required; Domain and Purpose may be empty). Valid rows are returned, bad ones are reported with their line
 * and the reason; repeated IP+domain pairs (in the file, or already in `existing`) are dropped, not duplicated.
 */
export async function parseNetworkScopeFile(file: Express.Multer.File | undefined, existing: ScopeRow[] = []): Promise<ScopeImportResult> {
  if (!file?.buffer?.length) throw new BadRequestException('No file uploaded, or the file is empty.');
  const name = (file.originalname || '').toLowerCase();

  let raw: { line: number; cells: string[] }[];
  if (name.endsWith('.txt')) {
    const text = file.buffer.toString('utf-8');
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new BadRequestException('File does not appear to be a valid text file.');
    raw = text.split(/\r?\n/).map((l, i) => ({ line: i + 1, cells: [l.trim(), '', ''] })).filter((r) => r.cells[0]);
  } else if (name.endsWith('.csv') || name.endsWith('.xlsx')) {
    const rows = parseCsv((await parseUploadedFileToCsv(file)).replace(/^﻿/, '').trim());
    const header = (rows[0] || []).map(normalizeCsvHeader);
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const ip = col('ip', 'ipaddress');
    const domain = col('domain', 'domainhostname', 'hostname');
    const purpose = col('purpose');
    if (ip < 0) throw new BadRequestException('Missing column: IP. Expected columns: IP, Domain, Purpose.');
    raw = rows
      .slice(1)
      .map((r, i) => ({ line: i + 2, cells: [r[ip] ?? '', domain < 0 ? '' : r[domain] ?? '', purpose < 0 ? '' : r[purpose] ?? ''] }))
      .filter((r) => r.cells.some((c) => c.trim()));
  } else {
    throw new BadRequestException('Only .txt, .csv and .xlsx files are allowed.');
  }
  if (raw.length > MAX_ROWS) throw new BadRequestException(`Too many rows (maximum ${MAX_ROWS}).`);

  const key = (r: ScopeRow) => `${r.ip.toLowerCase()}|${r.domainHostname.toLowerCase()}`;
  const seen = new Set(existing.map(key));
  const result: ScopeImportResult = { rows: [], errors: [], duplicates: 0 };
  for (const { line, cells } of raw) {
    const row: ScopeRow = { ip: cells[0].trim(), domainHostname: cells[1].trim(), purpose: cells[2].trim() };
    if (!isValidTarget(row.ip)) {
      result.errors.push({ line, value: row.ip.slice(0, 60), reason: 'Not a valid IP address' });
    } else if (row.domainHostname.length > MAX_FIELD || row.purpose.length > MAX_FIELD) {
      result.errors.push({ line, value: row.ip, reason: `Domain/Purpose longer than ${MAX_FIELD} characters` });
    } else if (seen.has(key(row))) {
      result.duplicates++;
    } else {
      seen.add(key(row));
      result.rows.push(row);
    }
  }
  return result;
}
