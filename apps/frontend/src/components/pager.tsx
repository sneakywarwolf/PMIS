'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/lib/datetime';

interface PagerProps {
  page: number;
  pageCount: number;
  pageSize: number;
  from: number;
  to: number;
  total: number;
  configured: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
}

/** Footer for a list paged with usePagination. Renders nothing when everything fits on one page at the default size. */
export function Pager(p: PagerProps) {
  if (p.total <= Math.min(p.configured, p.pageSize) && p.pageSize === p.configured) return null;
  const sizes = Array.from(new Set([10, 20, 50, 100, p.configured])).sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-gray-400" data-testid="pager">
      <span>Showing {formatNumber(p.from)}–{formatNumber(p.to)} of {formatNumber(p.total)}</span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          Rows
          <select value={p.pageSize} onChange={(e) => p.setPageSize(parseInt(e.target.value))} className="px-1.5 py-1 rounded bg-gray-800/50 border border-gray-700 text-white" aria-label="Rows per page">
            {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)} aria-label="Previous page" className="p-1.5 rounded bg-gray-800/50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
        <span>Page {p.page} of {p.pageCount}</span>
        <button type="button" disabled={p.page >= p.pageCount} onClick={() => p.setPage(p.page + 1)} aria-label="Next page" className="p-1.5 rounded bg-gray-800/50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
