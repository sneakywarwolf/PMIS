/**
 * Single source of truth for date/time formatting across the app.
 * Always derives from the browser's system clock and timezone (via native
 * Date/Intl, locale left undefined so the browser's own locale applies) —
 * never a hardcoded timezone/offset/format. If the user's OS timezone
 * changes, every call here reflects it automatically on next render.
 */

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatDate(date: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, opts ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
