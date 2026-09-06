import { ComplianceType } from '@prisma/client';
import { buildCompletionStats, CompletedProjectRow } from './completion-stats.util';

const row = (overrides: Partial<CompletedProjectRow>): CompletedProjectRow => ({
  id: 'p1',
  name: 'Project 1',
  complianceType: ComplianceType.VAPT,
  endDate: new Date('2026-06-15'),
  ...overrides,
});

describe('buildCompletionStats', () => {
  it('totals buckets compliance type across all four types', () => {
    const now = new Date('2026-09-01');
    const projects = [
      row({ id: 'p1', complianceType: ComplianceType.VAPT }),
      row({ id: 'p2', complianceType: ComplianceType.CERT_IN }),
      row({ id: 'p3', complianceType: ComplianceType.PCI }),
      row({ id: 'p4', complianceType: ComplianceType.ASV }),
      row({ id: 'p5', complianceType: ComplianceType.VAPT }),
    ];

    const result = buildCompletionStats(projects, 'month', now);

    expect(result.totalCompleted).toBe(5);
    expect(result.byType).toEqual({ VAPT: 2, CERT_IN: 1, PCI: 1, ASV: 1 });
  });

  it('groups timeline entries by month when granularity is month', () => {
    const now = new Date('2026-09-01');
    const projects = [
      row({ id: 'p1', endDate: new Date('2026-06-05'), complianceType: ComplianceType.VAPT }),
      row({ id: 'p2', endDate: new Date('2026-06-20'), complianceType: ComplianceType.PCI }),
      row({ id: 'p3', endDate: new Date('2026-07-01'), complianceType: ComplianceType.VAPT }),
    ];

    const result = buildCompletionStats(projects, 'month', now);

    const june = result.timeline.find((t) => t.period === '2026-06');
    const july = result.timeline.find((t) => t.period === '2026-07');

    expect(june?.total).toBe(2);
    expect(june?.byType.VAPT).toBe(1);
    expect(june?.byType.PCI).toBe(1);
    expect(july?.total).toBe(1);
  });

  it('groups timeline entries by quarter when granularity is quarter', () => {
    const now = new Date('2026-09-01');
    const projects = [
      row({ id: 'p1', endDate: new Date('2026-01-10') }), // Q1
      row({ id: 'p2', endDate: new Date('2026-02-10') }), // Q1
      row({ id: 'p3', endDate: new Date('2026-04-10') }), // Q2
    ];

    const result = buildCompletionStats(projects, 'quarter', now);
    const q1 = result.timeline.find((t) => t.period === '2026-Q1');
    const q2 = result.timeline.find((t) => t.period === '2026-Q2');

    expect(q1?.total).toBe(2);
    expect(q2?.total).toBe(1);
  });

  it('excludes projects older than 12 months from timeline heatmap but not totals', () => {
    const now = new Date('2026-09-01');
    const projects = [
      row({ id: 'old', endDate: new Date('2024-01-01') }), // >12mo old
      row({ id: 'recent', endDate: new Date('2026-08-01') }),
    ];

    const result = buildCompletionStats(projects, 'month', now);

    expect(result.totalCompleted).toBe(2); // all-time total unaffected
    expect(result.timeline.some((t) => t.period === '2024-01')).toBe(false);
    expect(result.heatmap.some((h) => h.date === '2024-01-01')).toBe(false);
    expect(result.timeline.some((t) => t.period === '2026-08')).toBe(true);
  });

  it('sorts portfolio by endDate descending and limits to 10', () => {
    const now = new Date('2026-12-31');
    const projects = Array.from({ length: 15 }, (_, i) =>
      row({
        id: `p${15 - i}`,
        endDate: new Date(2026, 0, 1 + i)
      })
    );

    const result = buildCompletionStats(projects, 'month', now);

    expect(result.portfolio).toHaveLength(10);
    expect(result.portfolio[0].id).toBe('p15');
    expect(result.portfolio[9].id).toBe('p6');
  });

  it('handles empty array correctly', () => {
    const now = new Date('2026-09-01');

    const result = buildCompletionStats([], 'month', now);

    expect(result.totalCompleted).toBe(0);
    expect(result.byType).toEqual({ VAPT: 0, CERT_IN: 0, PCI: 0, ASV: 0 });
    expect(result.timeline).toEqual([]);
    expect(result.heatmap).toEqual([]);
    expect(result.portfolio).toEqual([]);
  });
});
