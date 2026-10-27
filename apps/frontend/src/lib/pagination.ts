import { useEffect, useMemo, useState } from 'react';
import { useBranding } from '@/contexts/branding-context';
import { FALLBACK_PAGE_SIZE, paginate } from './paginate';

/**
 * Pages a list using Settings > Appearance > Default Pagination Size. `resetKey` (filters, search, tab) sends the
 * viewer back to page 1 when it changes.
 */
export function usePagination<T>(items: T[], resetKey: string = '') {
  const { settings } = useBranding();
  const configured = Number(settings?.appearance?.paginationDefault) || FALLBACK_PAGE_SIZE;
  const [pageSize, setPageSize] = useState(configured);
  const [page, setPage] = useState(1);
  useEffect(() => { setPageSize(configured); setPage(1); }, [configured]);
  useEffect(() => { setPage(1); }, [resetKey]);
  const result = useMemo(() => paginate(items, page, pageSize), [items, page, pageSize]);
  return { ...result, configured, setPage, setPageSize: (n: number) => { setPageSize(n); setPage(1); } };
}
