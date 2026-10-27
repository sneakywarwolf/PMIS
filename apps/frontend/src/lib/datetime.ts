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

/** DD/MM/YYYY */
export function formatDate(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

/** DD/MM/YYYY, HH:MM (24-hour) */
export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** DD/MM/YYYY, HH:MM:SS (24-hour), for logs where the exact second matters */
export function formatDateTimeSeconds(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(d)}, ${formatTime(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** HH:MM (24-hour) */
export function formatTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
