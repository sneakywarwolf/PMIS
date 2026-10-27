/**
 * Single source of truth for date/time formatting across the app.
 * Derives from the browser's system clock and local calendar fields (never
 * a hardcoded timezone/offset) — if the user's OS timezone changes, every
 * call here reflects it automatically on next render.
 *
 * Date display format is fixed app-wide as DD/MM/YYYY. Any new UI that
 * displays a date must use formatDate()/formatDateTime() from here rather
 * than calling toLocaleDateString()/toLocaleString() directly, so the
 * format stays consistent without hunting down every call site later.
 */

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export interface DisplayFormats {
  dateFormat: DateFormat;
  timeFormat: '12h' | '24h';
  numberFormat: string;
}

const DEFAULT_FORMATS: DisplayFormats = { dateFormat: 'DD/MM/YYYY', timeFormat: '24h', numberFormat: 'en-IN' };
let formats: DisplayFormats = { ...DEFAULT_FORMATS };

/**
 * Applies the Admin's Settings > Formatting choices to every date, time and number shown. Called when the settings
 * load and reset (no argument) when the session ends. Unknown values fall back to the defaults.
 */
export function configureFormats(next?: Partial<DisplayFormats> | null) {
  const dateOk = (v: unknown): v is DateFormat => v === 'DD/MM/YYYY' || v === 'MM/DD/YYYY' || v === 'YYYY-MM-DD';
  formats = {
    dateFormat: dateOk(next?.dateFormat) ? next!.dateFormat : DEFAULT_FORMATS.dateFormat,
    timeFormat: next?.timeFormat === '12h' ? '12h' : '24h',
    numberFormat: typeof next?.numberFormat === 'string' && next.numberFormat ? next.numberFormat : DEFAULT_FORMATS.numberFormat,
  };
}

/** Per the Admin's date format (DD/MM/YYYY unless changed). */
export function formatDate(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  switch (formats.dateFormat) {
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    default: return `${day}/${month}/${year}`;
  }
}

/** Date and time, per the Admin's formats. */
export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** Date and time to the second, for logs where the exact second matters. */
export function formatDateTimeSeconds(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(d)}, ${formatTime(d, true)}`;
}

/** 24-hour HH:MM, or 12-hour h:MM AM/PM when the Admin chose that. */
export function formatTime(date: Date | string | number, withSeconds = false): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = withSeconds ? `:${String(d.getSeconds()).padStart(2, '0')}` : '';
  if (formats.timeFormat === '12h') {
    const h = d.getHours() % 12 || 12;
    return `${h}:${minutes}${seconds} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${minutes}${seconds}`;
}

/** A number with the Admin's locale for grouping and separators (en-IN unless changed). */
export function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat(formats.numberFormat).format(n);
  } catch {
    return String(n);
  }
}

/**
 * Converts a stored timestamp into the yyyy-MM-dd value an
 * <input type="date"> needs, using the LOCAL calendar date — not
 * date.toISOString().split('T')[0], which reads the UTC calendar date and
 * silently shifts the day for timezones behind UTC.
 */
export function toDateInputValue(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
