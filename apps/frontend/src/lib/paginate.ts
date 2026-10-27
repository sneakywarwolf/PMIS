// Pure paging helper (no React) so it can be unit tested with node --test.
export const FALLBACK_PAGE_SIZE = 20;

/** Pure slice used by usePagination (kept separate so it can be unit tested). */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || FALLBACK_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  return { rows: items.slice(start, start + size), page: current, pageCount, pageSize: size, total: items.length, from: items.length ? start + 1 : 0, to: Math.min(start + size, items.length) };
}
