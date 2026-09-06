import { ComplianceType } from '@prisma/client';
import { CompletionStatsGranularity } from './dto/completion-stats-query.dto';

export interface CompletedProjectRow {
  id: string;
  name: string;
  complianceType: ComplianceType;
  endDate: Date;
}

export interface CompletionStatsBase {
  totalCompleted: number;
  byType: Record<ComplianceType, number>;
  timeline: Array<{ period: string; total: number; byType: Record<ComplianceType, number> }>;
  heatmap: Array<{ date: string; count: number }>;
  portfolio: Array<{ id: string; name: string; complianceType: ComplianceType; endDate: string }>;
}

const ALL_TYPES: ComplianceType[] = [
  ComplianceType.VAPT,
  ComplianceType.CERT_IN,
  ComplianceType.PCI,
  ComplianceType.ASV,
];

function emptyByType(): Record<ComplianceType, number> {
  return { VAPT: 0, CERT_IN: 0, PCI: 0, ASV: 0 } as Record<ComplianceType, number>;
}

function periodKey(date: Date, granularity: CompletionStatsGranularity): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-11
  if (granularity === 'quarter') {
    return `${year}-Q${Math.floor(month / 3) + 1}`;
  }
  if (granularity === 'month') {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  // week: ISO-like year-week bucket
  const firstDayOfYear = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((date.getTime() - firstDayOfYear.getTime()) / 86400000) + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function buildCompletionStats(
  projects: CompletedProjectRow[],
  granularity: CompletionStatsGranularity,
  now?: Date
): CompletionStatsBase {
  const _now = now || new Date();
  const byType = emptyByType();

  projects.forEach((p) => {
    byType[p.complianceType]++;
  });

  const twelveMonthsAgo = new Date(_now);
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);

  const recentProjects = projects.filter((p) => p.endDate >= twelveMonthsAgo);

  const timelineMap = new Map<string, { total: number; byType: Record<ComplianceType, number> }>();
  const heatmapMap = new Map<string, number>();

  recentProjects.forEach((p) => {
    const period = periodKey(p.endDate, granularity);
    if (!timelineMap.has(period)) {
      timelineMap.set(period, { total: 0, byType: emptyByType() });
    }
    const bucket = timelineMap.get(period)!;
    bucket.total++;
    bucket.byType[p.complianceType]++;

    const dateKey = p.endDate.toISOString().slice(0, 10);
    heatmapMap.set(dateKey, (heatmapMap.get(dateKey) || 0) + 1);
  });

  const timeline = Array.from(timelineMap.entries())
    .map(([period, v]) => ({ period, total: v.total, byType: v.byType }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const heatmap = Array.from(heatmapMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const portfolio = [...projects]
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      complianceType: p.complianceType,
      endDate: p.endDate.toISOString().slice(0, 10),
    }));

  return { totalCompleted: projects.length, byType, timeline, heatmap, portfolio };
}

export { ALL_TYPES };
