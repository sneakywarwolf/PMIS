# Dashboard Completion Stats API — Design

## Context

Both the TL/Tester dashboard (Solo/Squad mirror-flip) and the Admin/AVP dashboard
need "Projects Completed" numbers broken down by compliance type (VAPT, CERT_IN,
PCI, ASV), at varying scopes (self, team, org, cross-team). This is phase 1 of a
larger dashboard rebuild (see decomposition agreed in conversation):

1. **Backend: completion stats API** (this spec)
2. TL/Tester dashboard (Solo/Squad)
3. Admin/AVP dashboard
4. Shared motion/navigation system (retrofitted once 2 & 3 exist)

## Decisions

- **Completed** = `Project.status === 'COMPLETED'`. No new "approved" concept.
- **Completion date** = `Project.endDate` (no schema change).
- **Compliance types** = all four `ComplianceType` enum values: `VAPT`, `CERT_IN`,
  `PCI`, `ASV`.
- **Timeline granularity** = caller-selectable: week / month / quarter.
- **Cross-team / leaderboard figures** = plain completed-project counts, same
  definition as above, aggregated per team — no individual tester ranking
  exposed across teams.

## API

One endpoint, scope-parameterized, backing every stats widget in both dashboards:

```
GET /dashboard/completion-stats?scope=self|team|org&tlId=<optional>&granularity=week|month|quarter
```

- `scope=self` — caller's own completed projects (Tester Solo view).
- `scope=team` — caller's own team if no `tlId` given (TL/Tester Squad view,
  includes per-member breakdown). With `tlId` set to a *different* team's TL,
  returns that team's aggregate only (cross-team explorer) — no `members` array.
- `scope=org` — org-wide totals plus per-TL/team rollup (Admin/AVP).

Authorization: `scope=org` restricted to ADMIN/AVP. `scope=team` with a foreign
`tlId` allowed for any authenticated TL/Tester (cross-team explorer is
aggregate-only, so no sensitive per-person data leaks). `scope=self` always
allowed for the caller's own id.

### Response shape

```ts
{
  totalCompleted: number,
  byType: { VAPT: number, CERT_IN: number, PCI: number, ASV: number },
  timeline: Array<{ period: string; total: number; byType: {...} }>,
  heatmap: Array<{ date: string; count: number }>,       // daily counts, last 12 months
  portfolio: Array<{ id: string; name: string; complianceType: string; endDate: string }>, // most recent 10 completed
  members?: Array<{ id: string; username: string; totalCompleted: number; byType: {...} }>, // scope=team, own team only
  teams?: Array<{ tlId: string; tlName: string; teamSize: number; totalCompleted: number; byType: {...} }>, // scope=org
}
```

`members` and `teams` are omitted (not present) when not applicable to the
requested scope.

## Implementation notes

- New method `getCompletionStats(params)` on existing `DashboardService`
  (`apps/backend/src/dashboard/dashboard.service.ts`), new route on the
  existing `DashboardController`. No new module.
- `period` grouping (week/month/quarter) done in application code over
  `endDate` — Prisma has no native date-trunc groupBy, and project volume is
  low enough that in-memory bucketing is simpler than a raw SQL query.
- Reuses existing `assignedTlId` team relation for team/org scoping — no
  schema changes required for this phase.

## Out of scope (deferred to later phases)

- Frontend rendering of any of the above (phases 2–3).
- Time-of-day theming, scroll choreography, transition families (phase 4).
- Any change to what counts as "completed" beyond project status.
