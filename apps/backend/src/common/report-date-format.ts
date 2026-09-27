/**
 * Single source of truth for formatting the {Report Date} parameter —
 * every module that renders it (report content, report filenames, Issue
 * Log filenames, etc.) must go through formatReportDate() below rather
 * than formatting the date itself, so a setting change takes effect
 * everywhere at once.
 */
export const REPORT_DATE_FORMAT_OPTIONS = [
  'YYYY-MM-DD',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD.MM.YYYY',
  'YYYY/MM/DD',
] as const;

export type ReportDateFormat = typeof REPORT_DATE_FORMAT_OPTIONS[number];

export const DEFAULT_REPORT_DATE_FORMAT: ReportDateFormat = 'YYYY-MM-DD';

export function formatReportDate(date: Date, pattern: string): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return pattern.replace('YYYY', yyyy).replace('MM', mm).replace('DD', dd);
}
