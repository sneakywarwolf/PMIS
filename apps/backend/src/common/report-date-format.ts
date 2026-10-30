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


/** The long style PMIS has always printed for {Start Date} and {Month DD, YYYY}: "October 05, 2026". */
export const LONG_DATE_FORMAT = 'Month DD, YYYY';

/** Formats the Admin can pick for each date placeholder (Settings > Formatting > Additional date placeholder formats). */
export const PLACEHOLDER_DATE_FORMAT_OPTIONS = [LONG_DATE_FORMAT, ...REPORT_DATE_FORMAT_OPTIONS] as const;

/** The date placeholders with their own format; the defaults are exactly what reports printed before this setting existed. */
export const DEFAULT_PLACEHOLDER_DATE_FORMATS = { startDate: LONG_DATE_FORMAT, endDate: 'DD-MM-YYYY', generationDate: LONG_DATE_FORMAT };
export type PlaceholderDateKey = keyof typeof DEFAULT_PLACEHOLDER_DATE_FORMATS;

/**
 * The formats in force. Plain module state, set when settings load or are saved (like the attachment limits), so the
 * report code can read them without being handed the settings on every call. Until set, the defaults apply.
 */
let placeholderFormats: Record<string, string> = { ...DEFAULT_PLACEHOLDER_DATE_FORMATS };
export const placeholderDateFormats = {
  /** Takes the `formatting` settings and reads its `placeholderDates`. */
  setFromSettings(formatting: { placeholderDates?: Record<string, unknown> } | undefined) {
    this.set(formatting?.placeholderDates);
  },
  set(next: Record<string, unknown> | undefined) {
    const merged: Record<string, string> = { ...DEFAULT_PLACEHOLDER_DATE_FORMATS };
    for (const [k, v] of Object.entries(next ?? {})) {
      if (k in merged && typeof v === 'string' && (PLACEHOLDER_DATE_FORMAT_OPTIONS as readonly string[]).includes(v)) merged[k] = v;
    }
    placeholderFormats = merged;
  },
  get: (key: PlaceholderDateKey) => placeholderFormats[key],
};

export function formatReportDate(date: Date, pattern: string): string {
  if (pattern === LONG_DATE_FORMAT) return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return pattern.replace('YYYY', yyyy).replace('MM', mm).replace('DD', dd);
}
