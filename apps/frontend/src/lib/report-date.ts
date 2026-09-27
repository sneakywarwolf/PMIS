/**
 * Frontend counterpart to the backend's report-date-format util
 * (apps/backend/src/common/report-date-format.ts) — same token scheme,
 * same default. Client-side generated files (e.g. Issue Log CSV) that
 * embed {Report Date} must go through this single function rather than
 * formatting the date themselves, so the admin-configured format setting
 * (settings.formatting.reportDateFormat) applies everywhere consistently.
 */
export const DEFAULT_REPORT_DATE_FORMAT = 'YYYY-MM-DD';

export function formatReportDate(date: Date, pattern?: string): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return (pattern || DEFAULT_REPORT_DATE_FORMAT).replace('YYYY', yyyy).replace('MM', mm).replace('DD', dd);
}
