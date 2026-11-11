# PMIS security audit and remediation report

Branch `security-audit`, source base `d5a5d84` (v1.1.3, unreleased). Audit date 2026-11-11.

## 1. Executive summary

A source-led security review of the PMIS backend (NestJS/Prisma), frontend (Next.js), Docker deployment, dependencies and CI, with fixes
made in code and verified by unit tests and by a live test of the rebuilt Docker stack. **18 findings were confirmed and fixed**
remain open or accepted (section 8, 10 items). Nothing Critical was found. The most serious confirmed issues were privilege escalation and
cross-team access through *delegated* RBAC permissions (High when an Admin delegates those permissions; not reachable with the default matrix).

This is a single-reviewer pass (one assistant, no independent verification agents) with manual tests through the real API. It is **not** a
certification, and a clean scanner result is not a claim that PMIS is secure. Not done: a proxy-based DAST (ZAP/Burp), Semgrep (runs in CI only),
Docker Scout, a frontend type-check (no frontend `node_modules` in the worktree; the frontend was not changed), and testing against any
production data or deployment (none exists on this machine; see section 6).

## 2. Frameworks and method

Pentest/security-audit skill workflow (scope, role separation, authorization testing, bounded local evidence), OWASP Top 10, OWASP API
Security Top 10 and ASVS as checklists, CIS Docker Benchmark items for containers, SLSA principles for CI. "Used as a checklist" only; no compliance is claimed.

## 3. Architecture and attack surface (as found)

- **Frontend** `apps/frontend`: Next.js 15.5.28, published on `FRONTEND_PORT` (3000). Proxies `/api/*` to the backend. CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` set in `next.config.js`. No `dangerouslySetInnerHTML` with user data (two static inline scripts in `layout.tsx`); tokens live in HttpOnly cookies; `localStorage` holds only theme and layout preferences.
- **Backend** `apps/backend`: NestJS 10, port 4000, **not published** by `docker-compose.yml`. Global guards in order: JWT (cookie), rate limit, roles, permission (RBAC matrix), DB quota. Only 4 `@Public` routes (login, refresh, public theme, signed report download). 15 controllers, about 150 routes; every non-public route is behind the global JWT guard.
- **Data**: PostgreSQL 16.4 (Prisma, raw SQL only for row locks, advisory locks and `pg_database_size`, all parameterised), Redis 7.4 (sessions, lockout counters, rate limits, BullMQ), RustFS (S3 API, console disabled, internal only).
- **Inputs**: Nessus/CSV, Fortify FPR/XML, CSV/XLSX bulk imports, Nmap XML, site-map, Word/Excel templates, PoC images. All pass through size guards, type sniffing and bounded parsers (XXE/DTD refused).
- **Outbound**: Cyberdigest feeds (guarded by `safeFetch`/`net-guard`), GitHub releases check.
- **Containers**: frontend (published), backend, postgres, redis, rustfs on one internal network.

## 4. Tools run

| Tool | Version | Result |
|---|---|---|
| `npm audit --omit=dev` backend | npm bundled with Node 26.8.1 | 10 moderate before, 9 after (see F-open-4); 0 high/critical |
| `npm audit --omit=dev` frontend | same | 0 |
| Trivy image scan (CI's pinned image) | 0.76.1 | backend (alpine 3.24.3 + node packages): 0 fixable High/Critical; frontend: 0 |
| gitleaks | 8.18.4 (Docker) | 334 commits, all branches: no leaks; current files: no leaks |
| Jest (backend) | repo's | 107 suites passed, 1 skipped, 1202 tests passed, 28 skipped, `tsc --noEmit` clean |
| Docker | 29.9.2 | images built, throwaway stack run and tested |
| Semgrep, Docker Scout, ZAP/Burp | not run | see section 1 |

## 5. Vulnerability register

Severity is my qualitative rating (impact and preconditions); **CVSS v4.0 scores were not computed** because deployment details needed for the
environmental metrics are not in the repository.

| ID | Severity | Finding | Where | Status | Validation |
|---|---|---|---|---|---|
| F-01 | High (if user management is delegated) | A role given `users.reset_password`/`users.edit`/`users.create`/`users.deactivate` could reset or edit an Admin, promote anyone to Admin, or manage any team's users. | `users/users.service.ts`, `users.controller.ts` | Fixed: non-Admins manage only Testers assigned to them and can only assign the Tester role and their own team (also in bulk upload) | `users.admin-escalation.spec.ts`; live: TL got 403 resetting the Admin and another team's tester, promoting to ADMIN, creating an ADMIN |
| F-02 | Medium-High (if `projects.delete` is delegated) | `DELETE /projects/:id` had no team scoping. | `projects/projects.service.ts` | Fixed: same access check as other project routes | `projects.service.spec.ts`; live: TL got 403 on another team's project, 200 on own |
| F-03 | Medium | Account enumeration: unknown/disabled accounts skipped the password hash (timing) and never produced the "locked" message; locked real accounts also skipped the hash. | `auth/auth.service.ts` | Fixed: same hash work and same lock message on every rejection | `auth.login-enumeration.spec.ts`; live: steady-state timing equal (about 0.1 s both) |
| F-04 | Medium | Vulnerability library mass assignment: create/edit/request bodies (`any`) went to Prisma unfiltered, so `status`, `isActive`, `requestedById`, `reviewedById`, `id` could be forged. | `vulnerabilities/vulnerabilities.service.ts` | Fixed: only the 11 content fields are written | `vulnerabilities.mass-assignment.spec.ts`; live before/after: hostile request body gave HTTP 500 (FK violation), now 201 and always `PENDING` |
| F-05 | Low-Medium | Zip-bomb guard trusted sender-declared sizes (a forged header passed). | `common/docx-package.util.ts`, `bulk-upload-file.util.ts` | Fixed: `common/zip-limits.util.ts` counts real inflated bytes | `zip-limits.util.spec.ts` (forged-header bomb) |
| F-06 | Low-Medium | Redis `KEYS` scan in token revocation blocks Redis (runs on password change/reset). | `redis/redis.service.ts` | Fixed: `SCAN` | `redis.revoke-tokens.spec.ts` |
| F-07 | Low | Email login fallback loaded up to 500 users with hashes and missed users beyond 500. | `auth/auth.service.ts` | Fixed: one case-insensitive DB query | covered by login specs |
| F-08 | Low | No length cap on login password (large input into argon2). | `auth/dto/auth.dto.ts` | Fixed: max 128 | live: 200-char password gets 400 |
| F-09 | Low | Quiz: the answer response returned `isCorrect` immediately, against the service's own "hidden until reveal" rule. | `quiz/quiz.service.ts` | Fixed: not returned (frontend ignores that response) | `quiz.service.spec.ts` |
| F-10 | Low | Regex built from an id read from an uploaded xlsx template without escaping. | `reports/xlsx-template.service.ts` | Fixed: escaped | existing xlsx specs |
| F-11 | Medium | Redis had no authentication; any container on the network could read or alter sessions, rate limits and job queues. | `docker-compose.yml` | Fixed: `--requirepass`, backend uses it, healthcheck authenticates | live: unauthenticated `PING` returns `NOAUTH`; app connects |
| F-12 | Medium | `docker-compose.dev.yml` published PostgreSQL, Redis and the S3 API on all interfaces with fixed, known credentials. | `docker-compose.dev.yml` | Fixed: bound to 127.0.0.1 | `deploy-hardening.spec.ts` |
| F-13 | Low | Frontend/backend containers had default capabilities, writable root filesystem, no process cap. | `docker-compose.yml` | Fixed: `cap_drop: ALL`, `no-new-privileges`, `read_only` with `/tmp` and `.next/cache` tmpfs, `pids_limit` | live: uploads, template upload, report generation, signed download all work; `docker inspect` confirms flags |
| F-14 | Medium | CI: GitHub Actions referenced by mutable tags (`@v4`...) in two workflows; gitleaks binary downloaded without a checksum; semgrep unpinned. | `.github/workflows/*` | Fixed: SHA-pinned, SHA-256 verified, semgrep 1.185.0 | `deploy-hardening.spec.ts` |
| F-15 | Medium | Dependency `qs` below the patched version (several DoS advisories). | `apps/backend/package.json`, lockfile | Fixed: override `^6.16.1` (resolves to 6.17.1) | 102 backend suites pass on a clean install of the new lockfile; the other 3 read repo files outside `apps/backend` and were not applicable in the scratch copy; they pass in the worktree |
| F-16 | Informational | Docs said four secrets; `redis-cli SAVE` backup command needed auth. | `site/*.html`, `README.md` | Fixed | link checker |
| F-18 | Low-Medium | Vulnerability CSV export wrote the free-text `severity` column unescaped, so a stored `=HYPERLINK(...)` became a live formula when an approved entry was exported and opened in Excel; the `severity` query value also went into the download filename unsanitised. | `vulnerabilities/vulnerabilities.service.ts`, `vulnerabilities.controller.ts` | Fixed: escaped like the other columns; filename restricted to `[a-z0-9_-]` | `vulnerabilities.mass-assignment.spec.ts`; live: export shows `'=HYPERLINK(...)`, filename `vulnerabilities-a__b.csv` (found in the second pass) |
| F-17 | Informational | No guard against reverting the above. | | Added `deploy-hardening.spec.ts` | 9 tests |

## 6. Docker deployment verification

No PMIS containers or volumes existed on this machine, so there was no persistent PMIS data to preserve. Verification used a **throwaway stack**
(project name `pmisaudit`, port 3999, its own volumes, random secrets, images built from this branch):

- Images rebuilt: `apps/backend` (983 MB) and `apps/frontend` (1.89 GB, unchanged Dockerfile).
- Hardened `docker-compose.yml` brought up; all 5 services healthy; only the frontend publishes a port; backend, Postgres, Redis, RustFS publish none.
- Full `--force-recreate` of all containers: users, projects, templates and report history persisted (volumes kept).
- Used `docker compose down` only. **Not used:** `down -v`, volume pruning, database reset. The throwaway volumes `pmisaudit_postgres_data`, `pmisaudit_redis_data`, `pmisaudit_rustfs_data` and the image tags `local/pmis-*:audit`, `pmis-*:audit` are still on this machine; remove them yourself when you wish (`docker volume rm ...`).
- The test inserted data (users, projects, a bulk-uploaded vulnerability replacing the library, one template) only into that throwaway database.

## 6a. Second pass

The audit was re-run after the first round of fixes: all gates re-run (type-check, full suite), the backend image rebuilt, the throwaway stack brought up again on its existing volumes (restart persistence) and the live matrix repeated. New this pass: F-18. Checked and found sound: Word output (text goes through the DOM `textContent`, no hyperlink or external relationship is ever written), issue-log CSV (already neutralises formulas), the other `@Body() any` controllers (explicit field picks), dashboard scoping, presence. All earlier fixes held, including after a restart (the delegated-RBAC settings persisted and the limits still applied to the second Team Lead and team).

## 7. Authorization matrix (live, against the running stack)

Roles tested: Admin, Team Lead x2 (two teams), Tester x2. All results as expected (403/404 unless noted):
Tester reading/changing another team's project, findings, report history; Tester reassigning; Team Lead opening or reassigning a project of another
team; Tester on `/users`, `/settings` PUT, `/settings/system-health`, `/dashboard/admin`, `/update/schedule`, vulnerability create; Tester escalating own
role; cross-site write with a foreign `Origin` (403); forged and tampered report-download signatures (403); Swagger hidden in production (404); unauthenticated API (401);
forced password change enforced before any other route (403 then 200). Plus the delegated-permission cases in F-01/F-02.

Functional regression exercised live: login/logout, forced password change, project create/edit, PoC upload (and a disguised non-image rejected),
vulnerability CSV bulk upload, template upload/activate, preflight, report generation, signed download, system-health (database, Redis and
storage all "up"). Nessus/Fortify imports, quiz play, notifications and Excel reports were covered by the existing unit suites, not re-run live.

## 8. Open, accepted and recommended

| Item | Severity | Notes / recommendation |
|---|---|---|
| Rate-limit bypass with a forged `X-Forwarded-For` | Low-Medium | Documented in `main.ts:38`. Put a reverse proxy that overwrites the header in front, or configure Next to. The per-account lockout still limits brute force. |
| Session survives a password change | Low-Medium | A stolen access token lives until idle timeout. Fix revokes the active session on change; it signs the user out right after the change, so left for a product decision. Confirmed live. |
| Refresh-token rotation is not atomic | Low | Two simultaneous refreshes with one token can both succeed. Needs an atomic `GETDEL`; changes existing test expectations. |
| 9 moderate `npm audit` advisories (`@nestjs/*` 10, `file-type`, `uuid`) | Low | Fixes need NestJS 11/12 or `uuid` 14 (breaking), and npm's automatic "fix" would downgrade `@nestjs/common`. CI gate is high/critical. Plan a NestJS major upgrade. |
| App database user is the Postgres superuser (`POSTGRES_USER`) | Medium | Least privilege needs a migration/role split (owner for migrations, restricted role for runtime). Not attempted without a staging database. |
| Postgres, Redis, RustFS run without `cap_drop`/read-only | Low | Their entrypoints need privileges to start; Redis has `no-new-privileges`. Revisit per image. |
| CSP still allows `'unsafe-inline'` scripts | Low | Needed for Next's bootstrap and the static theme script; moving to nonces is a larger change. |
| `npm install -g npm@latest` in both Dockerfiles | Low | Unpinned at build time; pin once the bundled-npm advisories are fixed upstream. |
| No memory limits on containers | Low | Left out deliberately: 500 MB Nessus imports need headroom. Set limits after measuring. |
| Frontend image is 1.89 GB | Informational | Includes dev/build tooling in `node_modules`; Next "standalone" output would shrink it. |

## 9. Files changed

Backend: `auth/auth.service.ts`, `auth/dto/auth.dto.ts`, `users/users.{service,controller}.ts`, `projects/projects.{service,controller}.ts`,
`vulnerabilities/vulnerabilities.service.ts`, `quiz/quiz.service.ts`, `redis/redis.service.ts`, `common/{docx-package,bulk-upload-file}.util.ts`,
new `common/zip-limits.util.ts`, `reports/xlsx-template.service.ts`, `package.json` + lockfile. Tests added: `auth.login-enumeration`, `users.admin-escalation`,
`vulnerabilities.mass-assignment`, `zip-limits.util`, `redis.revoke-tokens`, `deploy-hardening` specs, plus updates to the users, projects and quiz specs.
Deployment: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `.github/workflows/{security,github-webpage}.yml`.
Docs: `README.md`, `site/installation.html`, `site/deployment.html`, `CHANGELOG.md`.

**Upgrade note:** existing deployments must add `REDIS_PASSWORD` to `.env` before the next `docker compose up` (it stops with a clear message otherwise; no data is touched).
