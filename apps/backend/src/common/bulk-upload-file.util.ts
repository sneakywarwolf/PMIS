import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

// Multer cap for every file upload, so oversized files are rejected while streaming instead of buffered in memory.
export const UPLOAD_LIMITS = { limits: { fileSize: 25 * 1024 * 1024, files: 1 } };
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // 'PK\x03\x04'

// Zip entries that indicate macros, embedded objects, or external links —
// none of these can appear in a legitimate data-only .xlsx.
const DANGEROUS_ENTRY_PATTERNS = [
  /^xl\/vbaProject\.bin$/i,
  /^xl\/embeddings\//i,
  /^xl\/oleObjects\//i,
  /^xl\/activeX\//i,
  /^xl\/externalLinks\//i,
];

/**
 * Turns an uploaded bulk-upload file (.csv or .xlsx) into plain CSV text,
 * rejecting anything that isn't inert data before a single row is read.
 * Never evaluates file content — formulas, macros, and embedded objects are
 * treated as reasons to reject, not to execute.
 */
export async function parseUploadedFileToCsv(file?: Express.Multer.File): Promise<string> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('No file uploaded, or the file is empty.');
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('File is too large. Maximum upload size is 10MB.');
  }

  const name = (file.originalname || '').toLowerCase();
  const isZip = file.buffer.subarray(0, 4).equals(ZIP_MAGIC);

  if (name.endsWith('.xlsx')) {
    if (!isZip) {
      throw new BadRequestException('File is not a valid .xlsx file.');
    }
    return parseXlsxToCsv(file.buffer);
  }

  if (name.endsWith('.csv')) {
    // A .csv can never legitimately be a zip container (that's what an
    // .xlsx/.xlsm actually is) — reject content that's been mislabeled.
    if (isZip) {
      throw new BadRequestException('File content does not match .csv format (looks like a binary/Office file).');
    }
    const text = file.buffer.toString('utf-8');
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) {
      throw new BadRequestException('File does not appear to be a valid text CSV.');
    }
    return text;
  }

  throw new BadRequestException('Only .csv and .xlsx files are allowed.');
}

async function parseXlsxToCsv(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BadRequestException('File is not a valid .xlsx file.');
  }

  const entryNames = Object.keys(zip.files);
  if (entryNames.some((entry) => DANGEROUS_ENTRY_PATTERNS.some((p) => p.test(entry)))) {
    throw new BadRequestException(
      'File rejected: macros, embedded objects, or external links are not allowed in bulk upload files.',
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, bookVBA: true });
  } catch {
    throw new BadRequestException('File is not a valid .xlsx file.');
  }

  if (workbook.vbaraw) {
    throw new BadRequestException('File rejected: macro-enabled workbooks are not allowed.');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new BadRequestException('The uploaded workbook has no sheets.');
  }

  const hasFormula = Object.keys(sheet).some((key) => key[0] !== '!' && (sheet[key] as XLSX.CellObject)?.f);
  if (hasFormula) {
    throw new BadRequestException('File rejected: formulas are not allowed in bulk upload files. Use static values only.');
  }

  return XLSX.utils.sheet_to_csv(sheet);
}
