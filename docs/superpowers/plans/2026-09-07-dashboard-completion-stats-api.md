# Dashboard Completion Stats API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one authorization-scoped, validated endpoint (`GET /dashboard/completion-stats`) that returns "Projects Completed" totals broken down by compliance type (VAPT, CERT_IN, PCI, ASV) at self/team/org scope, backing every stats widget in the upcoming TL/Tester and Admin/AVP dashboards.

**Architecture:** Extend the existing `DashboardModule` (no new module). A new DTO validates query params via the app's existing global `ValidationPipe`. A pure helper function buckets a list of completed `Project` rows into the response shape (byType, timeline, heatmap, portfolio) so it's testable without a database. Three thin `DashboardService` methods (self/team/org) fetch the right project set via Prisma and call the helper. The controller method does authorization branching by `scope` before delegating.

**Tech Stack:** NestJS, Prisma, class-validator, Jest (unit tests, mocked `PrismaService` — matches this codebase's existing test-free-but-jest-configured backend).

**Spec:** `docs/superpowers/specs/2026-09-07-dashboard-completion-stats-design.md`

## Global Constraints

- Completed = `Project.status === 'COMPLETED'`. No other status counts.
- Completion date for bucketing = `Project.endDate`.
- Compliance types = all four `ComplianceType` enum values: `VAPT`, `CERT_IN`, `PCI`, `ASV`.
- Timeline granularity is caller-selectable: `week` | `month` | `quarter`.
- `timeline` and `heatmap` arrays are bounded to the last 12 months of data (server-side, not client-controllable).
- `scope=org` requires `ADMIN` or `AVP` role.
- `scope=team` with a foreign `tlId` (cross-team explorer) returns aggregate-only — no `members` array, ever.
- `scope=team` with no `tlId` always resolves the caller's own team server-side (never trust a client-supplied "my team" id).
- `scope=self` is always scoped to the authenticated caller's own id.
- An invalid/nonexistent `tlId` returns a zeroed empty result, not a 404/error (avoid user-enumeration via error responses).
- All queries go through Prisma's typed query builder — no `$queryRaw`/string-interpolated SQL.
- Query params (`scope`, `granularity`, `tlId`) are validated via a DTO with `class-validator`; the app's global `ValidationPipe` already has `whitelist: true, forbidNonWhitelisted: true` so unknown params 400 automatically.

---

### Task 1: Query DTO with validation

**Files:**
- Create: `apps/backend/src/dashboard/dto/completion-stats-query.dto.ts`
- Test: `apps/backend/src/dashboard/dto/completion-stats-query.dto.spec.ts`

**Interfaces:**
- Produces: `CompletionStatsQueryDto` class with fields `scope: 'self' | 'team' | 'org'`, `granularity: 'week' | 'month' | 'quarter'`, `tlId?: string`. Later tasks import this type and rely on these exact field names.

- [ ] **Step 1: Write failing test**

```typescript
// apps/backend/src/dashboard/dto/completion-stats-query.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CompletionStatsQueryDto } from './completion-stats-query.dto';

describe('CompletionStatsQueryDto', () => {
  it('accepts a valid self-scope payload with no tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'self', granularity: 'month' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid team-scope payload with tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'team', granularity: 'week', tlId: 'clx123' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid scope value', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'DROP TABLE projects', granularity: 'month' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('scope');
  });

  it('rejects an invalid granularity value', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'self', granularity: 'century' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('granularity');
  });

  it('rejects a non-string tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'team', granularity: 'month', tlId: { $ne: null } });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('tlId');
  });

  it('rejects a missing scope', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { granularity: 'month' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest dashboard/dto/completion-stats-query.dto.spec.ts`
Expected: FAIL with "Cannot find module './completion-stats-query.dto'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/backend/src/dashboard/dto/completion-stats-query.dto.ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export type CompletionStatsScope = 'self' | 'team' | 'org';
export type CompletionStatsGranularity = 'week' | 'month' | 'quarter';

export class CompletionStatsQueryDto {
  @IsIn(['self', 'team', 'org'])
  scope: CompletionStatsScope;

  @IsIn(['week', 'month', 'quarter'])
  granularity: CompletionStatsGranularity;

  @IsOptional()
  @IsString()
  tlId?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest dashboard/dto/completion-stats-query.dto.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/dashboard/dto/completion-stats-query.dto.ts apps/backend/src/dashboard/dto/completion-stats-query.dto.spec.ts
git commit -m "feat: add validated query DTO for dashboard completion-stats endpoint"
```

---

### Task 2: Pure stats-shaping helper (bucketing logic)

**Files:**
- Create: `apps/backend/src/dashboard/completion-stats.util.ts`
- Test: `apps/backend/src/dashboard/completion-stats.util.spec.ts`

**Interfaces:**
- Consumes: `ComplianceType` enum from `@prisma/client` (`VAPT`, `CERT_IN`, `PCI`, `ASV`).
- Produces: `buildCompletionStats(projects: CompletedProjectRow[], granularity: CompletionStatsGranularity, now?: Date): CompletionStatsBase` — pure function, no I/O. Later tasks (Task 3) call this exact function name with this exact signature.
- Produces: `CompletedProjectRow` interface `{ id: string; name: string; complianceType: ComplianceType; endDate: Date }`.
- Produces: `CompletionStatsBase` interface:
  ```typescript
  interface CompletionStatsBase {
    totalCompleted: number;
    byType: Record<ComplianceType, number>;
    timeline: Array<{ period: string; total: number; byType: Record<ComplianceType, number> }>;
    heatmap: Array<{ date: string; count: number }>;
    portfolio: Array<{ id: string; name: string; complianceType: ComplianceType; endDate: string }>;
  }
  ```

- [ ] **Step 1: Write failing test**

```typescript
// apps/backend/src/dashboard/completion-stats.util.spec.ts
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
  it('totals and buckets by compliance type across all four types', () => {
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

  it('excludes projects older than 12 months from timeline and heatmap but not from totals', () => {
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

  it('returns at most the 10 most recently completed projects in portfolio, newest first', () => {
    const projects = Array.from({ length: 15 }, (_, i) =>
      row({ id: `p${i}`, endDate: new Date(2026, 0, i + 1) }),
    );

    const result = buildCompletionStats(projects, 'month', new Date('2026-12-31'));

    expect(result.portfolio).toHaveLength(10);
    expect(result.portfolio[0].id).toBe('p14');
    expect(result.portfolio[9].id).toBe('p5');
  });

  it('returns zeroed stats for an empty project list', () => {
    const result = buildCompletionStats([], 'month', new Date());

    expect(result.totalCompleted).toBe(0);
    expect(result.byType).toEqual({ VAPT: 0, CERT_IN: 0, PCI: 0, ASV: 0 });
    expect(result.timeline).toEqual([]);
    expect(result.heatmap).toEqual([]);
    expect(result.portfolio).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest dashboard/completion-stats.util.spec.ts`
Expected: FAIL with "Cannot find module './completion-stats.util'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/backend/src/dashboard/completion-stats.util.ts
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
  now: Date = new Date(),
): CompletionStatsBase {
  const byType = emptyByType();
  for (const p of projects) {
    byType[p.complianceType]++;
  }

  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12);
  const recentProjects = projects.filter((p) => p.endDate >= twelveMonthsAgo);

  const timelineMap = new Map<string, { total: number; byType: Record<ComplianceType, number> }>();
  const heatmapMap = new Map<string, number>();
  for (const p of recentProjects) {
    const period = periodKey(p.endDate, granularity);
    if (!timelineMap.has(period)) {
      timelineMap.set(period, { total: 0, byType: emptyByType() });
    }
    const bucket = timelineMap.get(period)!;
    bucket.total++;
    bucket.byType[p.complianceType]++;

    const dateKey = p.endDate.toISOString().slice(0, 10);
    heatmapMap.set(dateKey, (heatmapMap.get(dateKey) ?? 0) + 1);
  }

  const timeline = Array.from(timelineMap.entries())
    .map(([period, v]) => ({ period, total: v.total, byType: v.byType }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const heatmap = Array.from(heatmapMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const portfolio = [...projects]
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest dashboard/completion-stats.util.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/dashboard/completion-stats.util.ts apps/backend/src/dashboard/completion-stats.util.spec.ts
git commit -m "feat: add pure completion-stats bucketing helper (timeline/heatmap/portfolio)"
```

---

### Task 3: DashboardService completion-stats methods

**Files:**
- Modify: `apps/backend/src/dashboard/dashboard.service.ts`
- Test: `apps/backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `buildCompletionStats`, `CompletedProjectRow`, `CompletionStatsBase` from `./completion-stats.util` (Task 2). Consumes `CompletionStatsGranularity` from `./dto/completion-stats-query.dto` (Task 1).
- Produces (added to `DashboardService`, consumed by Task 4's controller):
  - `getSelfCompletionStats(userId: string, granularity: CompletionStatsGranularity): Promise<CompletionStatsBase>`
  - `getTeamCompletionStats(tlId: string, granularity: CompletionStatsGranularity, includeMembers: boolean): Promise<CompletionStatsBase & { members?: Array<{ id: string; username: string; totalCompleted: number; byType: Record<ComplianceType, number> }> }>` — returns a zeroed `CompletionStatsBase` (with `members: []` if `includeMembers`) when `tlId` does not resolve to an active `TEAM_LEAD`.
  - `getOrgCompletionStats(granularity: CompletionStatsGranularity): Promise<CompletionStatsBase & { teams: Array<{ tlId: string; tlName: string; teamSize: number; totalCompleted: number; byType: Record<ComplianceType, number> }> }>`

- [ ] **Step 1: Write failing test**

```typescript
// apps/backend/src/dashboard/dashboard.service.spec.ts
import { Test } from '@nestjs/testing';
import { ComplianceType, ProjectStatus, UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

function project(overrides: any) {
  return {
    id: 'p1',
    name: 'Proj',
    status: ProjectStatus.COMPLETED,
    complianceType: ComplianceType.VAPT,
    endDate: new Date('2026-08-01'),
    testerId: 'tester-1',
    tlId: 'tl-1',
    ...overrides,
  };
}

describe('DashboardService.completion stats', () => {
  let service: DashboardService;
  let prisma: { project: { findMany: jest.Mock }; user: { findMany: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      project: { findMany: jest.fn() },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  it('getSelfCompletionStats only queries the caller\'s own completed projects', async () => {
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1' })]);

    const result = await service.getSelfCompletionStats('tester-1', 'month');

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { testerId: 'tester-1', status: ProjectStatus.COMPLETED },
      select: { id: true, name: true, complianceType: true, endDate: true },
    });
    expect(result.totalCompleted).toBe(1);
  });

  it('getTeamCompletionStats returns zeroed stats for a tlId that is not a real TEAM_LEAD', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.getTeamCompletionStats('not-a-tl', 'month', true);

    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(result.totalCompleted).toBe(0);
    expect(result.members).toEqual([]);
  });

  it('getTeamCompletionStats omits members when includeMembers is false (cross-team explorer)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'tl-1', role: UserRole.TEAM_LEAD, username: 'tl1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'tester-1', username: 'tester1' }]);
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1' })]);

    const result = await service.getTeamCompletionStats('tl-1', 'month', false);

    expect(result.members).toBeUndefined();
    expect(result.totalCompleted).toBe(1);
  });

  it('getTeamCompletionStats includes per-member breakdown when includeMembers is true', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'tl-1', role: UserRole.TEAM_LEAD, username: 'tl1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'tester-1', username: 'tester1' }]);
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1', testerId: 'tester-1' })]);

    const result = await service.getTeamCompletionStats('tl-1', 'month', true);

    expect(result.members).toEqual([
      { id: 'tester-1', username: 'tester1', totalCompleted: 1, byType: { VAPT: 1, CERT_IN: 0, PCI: 0, ASV: 0 } },
    ]);
  });

  it('getOrgCompletionStats aggregates totals per team', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'tl-1', username: 'tl1' }]) // all TLs
      .mockResolvedValueOnce([{ id: 'tester-1', username: 'tester1' }]); // testers under tl-1
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1', tlId: 'tl-1' })]);

    const result = await service.getOrgCompletionStats('month');

    expect(result.totalCompleted).toBe(1);
    expect(result.teams).toEqual([
      { tlId: 'tl-1', tlName: 'tl1', teamSize: 1, totalCompleted: 1, byType: { VAPT: 1, CERT_IN: 0, PCI: 0, ASV: 0 } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest dashboard/dashboard.service.spec.ts`
Expected: FAIL — `service.getSelfCompletionStats is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `apps/backend/src/dashboard/dashboard.service.ts` (alongside existing methods, same class, same `PrismaService` injection already present):

```typescript
import { ProjectStatus, UserRole, ComplianceType } from '@prisma/client';
import { buildCompletionStats, CompletedProjectRow } from './completion-stats.util';
import { CompletionStatsGranularity } from './dto/completion-stats-query.dto';

// ... inside DashboardService class:

private readonly completedProjectSelect = {
  id: true,
  name: true,
  complianceType: true,
  endDate: true,
} as const;

async getSelfCompletionStats(userId: string, granularity: CompletionStatsGranularity) {
  const rows = await this.prisma.project.findMany({
    where: { testerId: userId, status: ProjectStatus.COMPLETED },
    select: this.completedProjectSelect,
  });
  return buildCompletionStats(rows as CompletedProjectRow[], granularity);
}

async getTeamCompletionStats(tlId: string, granularity: CompletionStatsGranularity, includeMembers: boolean) {
  const tl = await this.prisma.user.findUnique({ where: { id: tlId } });
  if (!tl || tl.role !== UserRole.TEAM_LEAD) {
    const empty = buildCompletionStats([], granularity);
    return includeMembers ? { ...empty, members: [] } : empty;
  }

  const testers = await this.prisma.user.findMany({
    where: { assignedTlId: tlId, isActive: true },
    select: { id: true, username: true },
  });
  const testerIds = testers.map((t) => t.id);

  const rows = await this.prisma.project.findMany({
    where: {
      status: ProjectStatus.COMPLETED,
      OR: [{ tlId }, { testerId: { in: testerIds } }],
    },
    select: { ...this.completedProjectSelect, testerId: true },
  });

  const base = buildCompletionStats(rows as CompletedProjectRow[], granularity);
  if (!includeMembers) {
    return base;
  }

  const members = testers.map((tester) => {
    const testerRows = rows.filter((r) => r.testerId === tester.id) as CompletedProjectRow[];
    const memberStats = buildCompletionStats(testerRows, granularity);
    return {
      id: tester.id,
      username: tester.username,
      totalCompleted: memberStats.totalCompleted,
      byType: memberStats.byType,
    };
  });

  return { ...base, members };
}

async getOrgCompletionStats(granularity: CompletionStatsGranularity) {
  const rows = await this.prisma.project.findMany({
    where: { status: ProjectStatus.COMPLETED },
    select: { ...this.completedProjectSelect, tlId: true },
  });
  const base = buildCompletionStats(rows as CompletedProjectRow[], granularity);

  const teamLeads = await this.prisma.user.findMany({
    where: { role: UserRole.TEAM_LEAD, isActive: true },
    select: { id: true, username: true },
  });

  const teams = await Promise.all(
    teamLeads.map(async (tl) => {
      const testers = await this.prisma.user.findMany({
        where: { assignedTlId: tl.id, isActive: true },
        select: { id: true },
      });
      const teamRows = rows.filter(
        (r) => r.tlId === tl.id || testers.some((t) => t.id === (r as any).testerId),
      ) as CompletedProjectRow[];
      const teamStats = buildCompletionStats(teamRows, granularity);
      return {
        tlId: tl.id,
        tlName: tl.username,
        teamSize: testers.length,
        totalCompleted: teamStats.totalCompleted,
        byType: teamStats.byType,
      };
    }),
  );

  return { ...base, teams };
}
```

Note: `getOrgCompletionStats`'s per-team filter needs `testerId` selected too — add `testerId: true` to that query's `select` alongside `tlId: true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest dashboard/dashboard.service.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/dashboard/dashboard.service.ts apps/backend/src/dashboard/dashboard.service.spec.ts
git commit -m "feat: add self/team/org completion-stats methods to DashboardService"
```

---

### Task 4: Controller endpoint with scope authorization

**Files:**
- Modify: `apps/backend/src/dashboard/dashboard.controller.ts`
- Test: `apps/backend/src/dashboard/dashboard.controller.spec.ts`

**Interfaces:**
- Consumes: `CompletionStatsQueryDto` (Task 1), `DashboardService.getSelfCompletionStats/getTeamCompletionStats/getOrgCompletionStats` (Task 3).
- Produces: `GET /dashboard/completion-stats` route, authenticated via existing global auth guard + this controller's own scope check (no `@Roles` decorator on the route itself, since allowed roles depend on the runtime `scope` value, not a fixed set).

- [ ] **Step 1: Write failing test**

```typescript
// apps/backend/src/dashboard/dashboard.controller.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardController } from './dashboard.controller';

function makeUser(overrides: any) {
  return { id: 'user-1', role: UserRole.TESTER, assignedTlId: null, ...overrides };
}

describe('DashboardController.getCompletionStats', () => {
  let service: {
    getSelfCompletionStats: jest.Mock;
    getTeamCompletionStats: jest.Mock;
    getOrgCompletionStats: jest.Mock;
  };
  let controller: DashboardController;

  beforeEach(() => {
    service = {
      getSelfCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
      getTeamCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
      getOrgCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
    };
    controller = new DashboardController(service as any);
  });

  it('scope=self always uses the caller\'s own id, ignoring any tlId param', async () => {
    const user = makeUser({ id: 'tester-1' });
    await controller.getCompletionStats({ scope: 'self', granularity: 'month', tlId: 'someone-else' } as any, user as any);
    expect(service.getSelfCompletionStats).toHaveBeenCalledWith('tester-1', 'month');
  });

  it('scope=org rejects a TESTER with ForbiddenException', async () => {
    const user = makeUser({ role: UserRole.TESTER });
    await expect(
      controller.getCompletionStats({ scope: 'org', granularity: 'month' } as any, user as any),
    ).rejects.toThrow(ForbiddenException);
    expect(service.getOrgCompletionStats).not.toHaveBeenCalled();
  });

  it('scope=org allows ADMIN', async () => {
    const user = makeUser({ role: UserRole.ADMIN });
    await controller.getCompletionStats({ scope: 'org', granularity: 'quarter' } as any, user as any);
    expect(service.getOrgCompletionStats).toHaveBeenCalledWith('quarter');
  });

  it('scope=team with no tlId resolves a TEAM_LEAD\'s own team', async () => {
    const user = makeUser({ id: 'tl-1', role: UserRole.TEAM_LEAD });
    await controller.getCompletionStats({ scope: 'team', granularity: 'week' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-1', 'week', true);
  });

  it('scope=team with no tlId resolves a TESTER\'s assigned team', async () => {
    const user = makeUser({ id: 'tester-1', role: UserRole.TESTER, assignedTlId: 'tl-9' });
    await controller.getCompletionStats({ scope: 'team', granularity: 'month' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-9', 'month', true);
  });

  it('scope=team with a foreign tlId (cross-team explorer) requests aggregate-only', async () => {
    const user = makeUser({ id: 'tester-1', role: UserRole.TESTER, assignedTlId: 'tl-9' });
    await controller.getCompletionStats({ scope: 'team', granularity: 'month', tlId: 'tl-other' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-other', 'month', false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx jest dashboard/dashboard.controller.spec.ts`
Expected: FAIL — `controller.getCompletionStats is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `apps/backend/src/dashboard/dashboard.controller.ts` (new imports plus new route method):

```typescript
import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { CompletionStatsQueryDto } from './dto/completion-stats-query.dto';

// ... inside DashboardController class, alongside existing routes:

@Get('completion-stats')
@ApiOperation({ summary: 'Get Projects Completed stats (self/team/org scope) by compliance type' })
async getCompletionStats(@Query() query: CompletionStatsQueryDto, @CurrentUser() user: User) {
  const { scope, granularity, tlId } = query;

  if (scope === 'org') {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.AVP) {
      throw new ForbiddenException('Access denied. Required role: ADMIN or AVP');
    }
    return this.dashboardService.getOrgCompletionStats(granularity);
  }

  if (scope === 'team') {
    if (tlId && tlId !== user.id) {
      return this.dashboardService.getTeamCompletionStats(tlId, granularity, false);
    }
    const ownTlId = user.role === UserRole.TEAM_LEAD ? user.id : (user as any).assignedTlId;
    if (!ownTlId) {
      return this.dashboardService.getTeamCompletionStats('__none__', granularity, true);
    }
    return this.dashboardService.getTeamCompletionStats(ownTlId, granularity, true);
  }

  return this.dashboardService.getSelfCompletionStats(user.id, granularity);
}
```

`CurrentUser` here returns the full Prisma `User` (already the pattern used by `getVulnerabilityTrends`), which includes `assignedTlId` per the schema.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx jest dashboard/dashboard.controller.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run full dashboard test suite**

Run: `cd apps/backend && npx jest dashboard`
Expected: PASS (all dto/util/service/controller specs, ~23 tests total)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/dashboard/dashboard.controller.ts apps/backend/src/dashboard/dashboard.controller.spec.ts
git commit -m "feat: add GET /dashboard/completion-stats endpoint with scope-based authorization"
```

---

## Self-Review Notes

- **Spec coverage:** Endpoint shape, all four compliance types, week/month/quarter granularity, 12-month bound on timeline/heatmap, self/team/org scoping, cross-team aggregate-only, `tlId` empty-result-not-error, DTO validation, Prisma-only queries — each has a task/step above.
- **Type consistency:** `CompletionStatsGranularity`/`CompletionStatsScope` (Task 1) reused verbatim in Task 2 and 3 signatures; `CompletedProjectRow`/`CompletionStatsBase` (Task 2) reused verbatim in Task 3; service method names/signatures in Task 3 match exactly what Task 4's controller calls.
- **Scope check:** This plan implements backend only (phase 1 of 4 from the design doc). Frontend dashboards (phases 2–3) and the shared motion system (phase 4) are deliberately separate plans, written after this one ships.
