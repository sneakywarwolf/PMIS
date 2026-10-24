# PMIS Role Access Matrix

Derived from the code on 2026-10-23 (branch `nessus-import`). Sources: `@Roles(...)` decorators on backend
controllers, ownership checks in services, and `navItems` in `apps/frontend/src/app/dashboard/layout.tsx`.
Update this file when `@Roles` decorators or service-level access checks change.

Legend: ✅ allowed · ❌ not allowed · 🔸 allowed with scope limits (see notes)

## Navigation (sidebar)

| Menu item | Admin | AVP | Team Lead | Tester |
|---|---|---|---|---|
| Dashboard, Projects, Reports, Vulnerabilities, Quiz, Retention, About | ✅ | ✅ | ✅ | ✅ |
| Users | ✅ | ❌ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ | ❌ |

## Features

| Area / action | Admin | AVP | Team Lead | Tester |
|---|---|---|---|---|
| **Projects** – list / open / search | ✅ all | 🔸 own + own team's | 🔸 own + own team's | 🔸 own only |
| Projects – create, edit | ✅ | 🔸 | 🔸 | 🔸 |
| Projects – reassign tester | ✅ any | 🔸 own team | 🔸 own team | ❌ |
| Projects – delete | ✅ | ❌ | ❌ | ❌ |
| **Findings** – view / add / edit | ✅ all | 🔸 own + team's projects | 🔸 own + team's projects | 🔸 own projects; edits only their own findings |
| Findings – change status | ✅ | ✅ | ✅ | ❌ |
| **Reports** – generate / download / preflight / history | ✅ | 🔸 accessible projects | 🔸 accessible projects | 🔸 own projects |
| Reports – delete a generated report | ✅ | ❌ | ❌ | 🔸 own projects only |
| Report templates – upload, activate, deactivate, delete, edit fields | ✅ | ❌ | ❌ | ❌ |
| Template parameter registry (`/reports/templates/parameters`), all-templates list | ✅ | ❌ | ❌ | ❌ |
| **Vulnerability library** – browse, export | ✅ | ✅ | ✅ | ✅ |
| Library – add, edit, delete, bulk upload, change tracker | ✅ | ❌ | ❌ | ❌ |
| Library – request a new entry | ✅ | ❌ | ✅ | ✅ |
| Library – submit change request (edit existing entry) | ❌ | ❌ | ❌ | ✅ |
| Library – approve / reject pending entries and change requests | ✅ | ✅ | ✅ | ❌ |
| **Users** – list, view | ✅ | ✅ | ✅ | ❌ |
| Users – create, edit, activate, reset password, delete, bulk upload | ✅ | ❌ | ❌ | ❌ |
| Users – team hierarchy, team-leads / managers lists | ✅ | ❌ | ❌ | ❌ |
| Own profile – view / edit | ✅ | ✅ | ✅ | ✅ |
| **Dashboard** – team view | ✅ | ✅ | ✅ | ❌ |
| Dashboard – admin overview, TL comparison | ✅ | ✅ | ❌ | ❌ |
| Dashboard – activity feed | ✅ | ✅ | ✅ | ❌ |
| Dashboard – scope of data | org-wide | org-wide | own team | own work |
| **Live users** (count badge + list) | ✅ everyone | 🔸 self + their Team Leads + those teams | 🔸 self + their testers | ❌ |
| **Settings** – change, history, system health | ✅ | ❌ | ❌ | ❌ |
| Software update – schedule / cancel | ✅ | ❌ | ❌ | ❌ |
| **Quiz** – play, scorecard, leaderboards | ✅ | ✅ | ✅ | ✅ |
| Quiz – manage questions, view responses, engagement stats | ✅ | ❌ | ❌ | ❌ |
| Quiz – rename team | ✅ | ❌ | ✅ | ❌ |
| Notifications, Retention tracker | ✅ | ✅ | ✅ | ✅ |

## Notes

- **Project scope is the same for AVP and Team Lead**: a project is accessible when the user is its `tlId` or the
  tester's `assignedTlId` (`projects.service.ts` `checkProjectAccess` / `accessWhere`). AVP is *not* org-wide for
  projects; only Admin is. AVP's org-wide reach is on the dashboard (admin overview, TL comparison).
- **Admin can act as a Team Lead** (included in `TL_ROLES` in `users.service.ts`) and can lead testers.
- **Testers** cannot change finding status and can only touch findings they created.
- "Create/edit" on projects and findings has no `@Roles` decorator; access is enforced per project in the service
  (ownership/team checks), so the 🔸 reflects those checks.
- Verify against code before relying on this for a security review; it is a documentation snapshot, not enforcement.
