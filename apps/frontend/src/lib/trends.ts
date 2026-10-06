import type { Row } from '@/lib/use-engagements';
import { SEVERITY_KEYS } from '@/lib/risk';

const WEEK = 7 * 24 * 3600 * 1000;

/**
 * Weekly KPI series derived from project start/end dates.
 * ponytail: reconstructs history from dates, not real snapshots (findings are
 * attributed to their project's start week). Swap for a time-series endpoint
 * if exact historical counts matter.
 */
export function weeklySeries(rows: Row[], weeks = 8, now = Date.now()) {
  const edges = Array.from({ length: weeks }, (_, i) => now - (weeks - 1 - i) * WEEK);
  const startedBy = (r: Row, edge: number) => +new Date(r.startDate) <= edge;
  const vulnTotal = (r: Row) => SEVERITY_KEYS.reduce((n, k) => n + r.vulnCounts[k], 0);
  return {
    total: edges.map((e) => rows.filter((r) => startedBy(r, e)).length),
    active: edges.map((e) => rows.filter((r) => startedBy(r, e) && (!r.endDate || +new Date(r.endDate) > e)).length),
    vulns: edges.map((e) => rows.reduce((n, r) => n + (startedBy(r, e) ? vulnTotal(r) : 0), 0)),
  };
}

/** Change over the most recent week of a series. */
export const weeklyDelta = (s: number[]) => (s.length > 1 ? s[s.length - 1] - s[s.length - 2] : 0);
