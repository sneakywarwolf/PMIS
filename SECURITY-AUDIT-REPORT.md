# PMIS security audit and remediation report

Branch `security-audit`, source base `d5a5d84` (v1.1.3, unreleased). Audit date 2026-11-11.

## 1. Executive summary

A source-led security review of the PMIS backend (NestJS/Prisma), frontend (Next.js), Docker deployment, dependencies and CI, with fixes
made in code and verified by unit tests and by a live test of the rebuilt Docker stack. **43 findings were confirmed and fixed**
remain open or accepted (section 8, 4 items). Nothing Critical was found. The most serious confirmed issues were privilege escalation and
cross-team access through *delegated* RBAC permissions (High when an Admin delegates those permissions; not reachable with the default matrix).

This is a single-reviewer pass (one assistant, no independent verification agents) with manual tests through the real API. It is **not** a
certification, and a clean scanner result is not a claim that PMIS is secure. Not done: Burp or an *active* DAST (ZAP ran as a passive baseline, unauthenticated and then authenticated), Docker Scout, and testing
against any production data or deployment (none exists on this machine; see section 6).

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
| `npm audit --omit=dev` backend | npm bundled with Node 26.8.1 | 10 moderate before, **0 after** (NestJS 11 upgrade). Dev-only tooling (`npm audit` without `--omit=dev`) still lists 16 (ESLint plugin, `@nestjs/cli`, Jest, ts-jest); none of it is in the production image (verified), and the offered fixes are major or nonsensical downgrades |
| `npm audit --omit=dev` frontend | same | 0 |
| Trivy image scan (CI's pinned image) | 0.76.1 | backend (alpine 3.24.3 + node packages): 0 fixable High/Critical; frontend (now standalone, without npm): 0 |
| gitleaks | 8.18.4 (Docker) | 334 commits, all branches: no leaks; current files: no leaks |
| Jest (backend) | repo's | 117 suites passed, 1 skipped, 1282 tests passed, 28 skipped, `tsc --noEmit` clean, run against the NestJS 11 dependency set; frontend `node --test`: 42 pass; Chromium crawl of all 18 pages: 0 CSP violations, 0 page errors |
| Docker | 29.9.2 | images built, throwaway stack run and tested |
| Semgrep (CI's ruleset: typescript, nodejs, secrets) | 1.185.0 (Docker) | 0 findings over 362 files, run twice; 2 non-fatal rule errors on the final run (4 on the first), so not exhaustive |
| OWASP ZAP baseline (`zap-baseline.py`, AJAX spider, logged-in admin cookie) | stable image | Final run: 0 FAIL, 63 PASS, 5 WARN groups (7 alert types). All CSP, clickjacking, nosniff, COOP/COEP and Permissions-Policy alerts from the first runs are fixed (F-23, F-27, F-28). The 7 left are false positives or informational: SQL text inside a vulnerability-library entry, client IPs in the audit log shown to admins and article text, theme preferences in localStorage, cache and comment notes |
| Browser check (Playwright + Chromium) | installed locally | login, dashboard, projects and vulnerabilities render identically before and after the CSP change; injected inline scripts, `onclick` and `onerror` payloads blocked |
| Docker Scout | not run | needs a Docker Hub login |

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
| F-19 | Low-Medium | Per-IP rate limit bypass: Next's `/api` proxy forwarded the browser's own `X-Forwarded-For` untouched, so a rotating forged header gave every request a fresh anonymous bucket. | `apps/backend/src/main.ts`, new `apps/frontend/forwarded-for.js`, `Dockerfile`, `docker-compose.yml` | Fixed: the frontend appends the real peer address; the backend trusts a configurable number of hops (`TRUST_PROXY_HOPS`, default 1) | live before/after: 50/50 forged-header logins passed, now 30 then 429; the backend logs the real client address and ignores the forged one |
| F-20 | Low-Medium | A stolen access token stayed valid after a password change. | `auth/auth.service.ts`, `auth.controller.ts` | Fixed: the change ends the old session and signs the caller in on a new one (cookies refreshed) | `auth.change-password-session.spec.ts`; live: stolen token 401, caller 200 |
| F-21 | Low | Refresh-token rotation was not atomic: simultaneous refreshes with one token could all succeed. | `auth/auth.service.ts`, `redis/redis.service.ts` | Fixed: only the request whose `DEL` removes the key succeeds | `auth.service.spec.ts`; live: 6 parallel refreshes gave 1 x 200 and 5 x 401 |
| F-22 | Low | CSP allowed `'unsafe-inline'` scripts, so any injected inline script or `onclick`/`onerror` attribute would run. | `apps/frontend/src/middleware.ts`, `lib/csp.ts`, `app/layout.tsx` | Fixed: per-request nonce CSP; the two theme scripts and Next's own scripts carry it | `csp.test.ts`; Chromium: parser-inserted inline scripts and `onerror` payloads blocked (they ran before), all 8 inline scripts carry the nonce, no violations, same pages render |
| F-23 | Low | `connect-src` allowed any `ws:`/`wss:` host; no COOP/CORP headers (ZAP). | `next.config.js`, `lib/csp.ts` | Fixed: `connect-src 'self'` in production; COOP and CORP `same-origin` | `csp.test.ts`; browser re-check |
| F-24 | Low | `file-type` and `uuid` advisories. | `package.json`, lockfile | Fixed: `uuid` ^11.1.1, `file-type` ^22.3.0 override (neither is used by PMIS code) | full suite on the new lockfile |
| F-25 | Medium (least privilege) | The application ran as the PostgreSQL superuser. | `docker-compose.yml`, new `apps/backend/database/restricted-user.sql`, deployment guide | Fixed as an opt-in (`PMIS_DB_USER`/`PMIS_DB_PASSWORD`); default unchanged so existing installs keep working | live: all 31 tables moved; backend, migrations (also on an empty database), bulk upload, report generation and `pg_database_size` work as the restricted role; `COPY ... PROGRAM` is refused |
| F-26 | Low-Medium | Regression from my round-2 change, found by this review: wrapping the Redis command in `sh -c` stopped the image from dropping to the `redis` user, so Redis ran as root. | `docker-compose.yml` | Fixed: plain `redis-server` command through the image entrypoint, `cap_drop: ALL` with only the capabilities the entrypoint needs; it also repairs volume ownership | live: Redis runs as `redis`, persistence `ok`, ownership repaired; `deploy-hardening.spec.ts` |
| F-27 | Medium (dependency) | Six `@nestjs/*` 10.x advisories (core, common, platform-express, platform-socket.io, websockets, swagger, schedule): injection and DoS issues in the framework. | `apps/backend/package.json`, lockfile, `auth/auth.service.ts` | Fixed: NestJS 11 (Express 5), plus `@nestjs/config` 4, `jwt` 11, `passport` 11, `schedule` 6, `swagger` 11. Only code change: token lifetimes are numbers of seconds (newer `jsonwebtoken` types) | production `npm audit` 0 in both apps; full suite on the new set; Docker image built from the new lockfile; live: role matrix, query/parameter-pollution, 413 body limit, CORS preflight, cookie flags, sockets, 20 MB upload, Nessus and Fortify import, quiz, notifications, Excel report all behave as before |
| F-28 | Low | `style-src` allowed `'unsafe-inline'` for `<style>` elements (CSS injection), COEP missing, the fallback CSP (static files, favicon) still allowed inline scripts. | `frontend/src/lib/csp.ts`, `next.config.js` | Fixed: `<style>`/`<link>` need the request nonce (only `style=""` attributes stay open), COEP `credentialless` (page is cross-origin isolated), fallback CSP without inline scripts | `csp.test.ts`; Chromium: injected `<style>` raises `style-src-elem`, foreign stylesheet blocked, fonts load, 18 pages 0 violations |
| F-29 | Low | socket.io (engine.io) responses carry none of the security headers, because they bypass Express and helmet (ZAP: no CSP, framing or nosniff headers on `/api/ee-socket`). | new `backend/src/common/engine-headers.ts`, both gateways | Fixed: nosniff, DENY framing, `default-src 'none'`, no-store | `engine-headers.spec.ts`; live: headers present; namespace auth still connects an admin and refuses an anonymous client |
| F-30 | Low | PostgreSQL, Redis and RustFS ran with a writable root filesystem. | `docker-compose.yml` | Fixed: `read_only: true` with `/tmp` (and `/var/run/postgresql`, RustFS `/logs`) as in-memory scratch | live on the existing volumes: data persisted, DB write, object write and read, `BGSAVE` ok, health up; `deploy-hardening.spec.ts` |
| F-31 | Medium | Information disclosure, found in the fourth-round deep review: a tester could read another tester's **pending, rejected or retired vulnerability-library request** (name, description, impact...) by attaching its id to a finding on their own project. The library hides such entries by id (`visibleVuln`, 404), but `FindingsService.create` accepted any `vulnId` and returned the joined vulnerability. | `findings/findings.service.ts` | Fixed: the same visibility rule (published, or the requester's own, or a reviewer) is enforced on create; unknown and non-string ids give 404 | `findings.vuln-visibility.spec.ts`; live before/after: HTTP 201 with the description, now 404; the requester can still attach their own |
| F-32 | Medium (availability) | Quadratic regexes: `/<[^>]+>/g` and the Fortify tag patterns rescan to the end of the text for every `<` when no `>` follows. One 64 KB description took 2.5 to 2.8 s of **blocked event loop** (the server is single-threaded), and an uploaded Fortify file can hold thousands, so a tester with Fortify-import rights could stall the API for minutes. Also in the Word header/footer check and a punctuation trim in Cyberdigest. | `common/fortify-parser.util.ts`, `reports/docx-manipulator.service.ts`, `cyberdigest/summary-guard.ts`, new `common/linear-regex.util.ts` | Fixed: tag patterns run only up to the last `>` (nothing after it can match), which makes them linear; the punctuation trim is a loop | `linear-regex.util.spec.ts` (same output as the plain regex on ordinary text; 1 MB hostile input under 0.5 s); live: a 3.6 MB hostile `.fpr` is previewed in 0.4 s and the API stays responsive. The "was 2.5 s" figure is measured per element; the whole-file "minutes" is that figure times the number of fields, not a measured end-to-end run |
| F-33 | Low-Medium | Template upload: `category`, `subType` and `reportFormat` from the form were used in the storage key (`templates/<category>/<subType>/...`) and written to enum columns without validation. A bad value gave a 500 after the file had already been stored (orphaned objects), and an unknown `reportFormat` was silently treated as Word. The same for `reports/generate`. | `reports/reports.service.ts`, new `reports/template-upload-input.ts`, `reports.controller.ts` | Fixed: all fields and dates validated before anything is parsed or stored (400) | `template-upload-input.spec.ts`; live: `../../evil`, `x/y`, a bad date and `PDF` returned 500/500/500/accepted, now 400 each |
| F-34 | Low | The findings routes take inline-typed bodies, which the global validation pipe does not check: wrong types reached Prisma (500) and an out-of-range CVSS override (for example 99) or a megabyte-long value was stored and printed in reports. | `findings/findings.service.ts`, new `common/finding-input.util.ts` | Fixed: text, list and CVSS (0 to 10) validated on create and update; partial updates unchanged | `finding-input.util.spec.ts`; live: cvss 99 and an object as notes now 400 |
| F-35 | Low | Same gap in the vulnerability library: wrong types, out-of-range `cvssScore`, unknown `category` (500) and absurd lengths; change requests were stored unvalidated and applied as is on approval. | `vulnerabilities/vulnerabilities.service.ts` | Fixed: one validation in `pickContent`, also used when a change request is filed | `vulnerabilities.mass-assignment.spec.ts`; live: score 55 and a bad category now 400 |
| F-36 | Low | Settings validation used `key in object`, which is also true for inherited names (`toString`, `constructor`, `__proto__`): such keys passed validation and were stored, and a stored `toString` made `String(settings.general)` throw. No global prototype pollution (verified). Admin-only. | `settings/settings.service.ts`, `settings.store.ts` | Fixed: own-property checks, and `__proto__`/`constructor`/`prototype` are never merged | `settings.inherited-keys.spec.ts`; live: all four hostile bodies now 400 |
| F-37 | Low-Medium | JWT handling: `AuthModule` fell back to the published secret `default-secret` when `JWT_ACCESS_SECRET` was unset (used by `verify`); no algorithm was pinned; a refresh token (it carries a `jti`) was accepted as an access token whenever both secrets were configured alike (the startup check only warned); the production secret check did not reject the dev example's published values. | `auth/auth.module.ts`, `verify-access-token.ts`, `auth.service.ts`, `main.ts` | Fixed: no fallback (a missing secret fails closed), HS256 pinned, a token with a `jti` is never an access token, the example secrets are refused in production | `jwt-hardening.spec.ts` (refresh-as-access, HS512, `alg: none`, wrong secret, missing secret); live: a refresh token as the access cookie gets 401 |
| F-38 | Low-Medium | The dashboard activity feed returned whole audit rows (the stored request body, IP address, browser, ids) to anyone the activity log was delegated to. An AVP's feed spans teams although an AVP's project access does not, so another team's PoC and notes text reached them. The UI uses only who, what and when. | `dashboard/dashboard.service.ts` | Fixed: non-Admins receive only id, action, target type, time and actor | `dashboard.activity-minimal.spec.ts`; live: AVP sees 5 fields, Admin all 11 |
| F-39 | Low | A password change accepted the current password, so a user could keep an admin-issued temporary password (known to the admin). | `auth/auth.service.ts` | Fixed: the new password must differ | `auth.change-password-session.spec.ts`; live: 400, a different one 200 |
| F-40 | Low | User create and update checked duplicates case-sensitively while login matches emails ignoring case, so two accounts differing only by case could exist and the fallback would pick one arbitrarily. | `users/users.service.ts` | Fixed: case-insensitive checks | `users.case-duplicates.spec.ts`; live: 400 |
| F-41 | Informational | Responses searched for secrets: none of 16 routes returns password hashes, tokens or secrets; no open redirects or `javascript:` links in the frontend. | - | Verified, no change | live scan of the responses |
| F-17 | Informational | No guard against reverting the above. | | Added `deploy-hardening.spec.ts` | 9 tests |

## 6. Docker deployment verification

No PMIS containers or volumes existed on this machine, so there was no persistent PMIS data to preserve. Verification used a **throwaway stack**
(project name `pmisaudit`, port 3999, its own volumes, random secrets, images built from this branch):

- Images rebuilt: `apps/backend` (983 MB) and `apps/frontend` (1.89 GB, unchanged Dockerfile).
- Hardened `docker-compose.yml` brought up; all 5 services healthy; only the frontend publishes a port; backend, Postgres, Redis, RustFS publish none.
- Full `--force-recreate` of all containers: users, projects, templates and report history persisted (volumes kept).
- Used `docker compose down` only. **Not used:** `down -v`, volume pruning, database reset. The throwaway volumes `pmisaudit_postgres_data`, `pmisaudit_redis_data`, `pmisaudit_rustfs_data` and the image tags `local/pmis-*:audit`, `pmis-*:audit` are still on this machine; remove them yourself when you wish (`docker volume rm ...`).
- The test inserted data (users, projects, a bulk-uploaded vulnerability replacing the library, one template) only into that throwaway database.

## 6b. Fourth-round deep review

A hunt for flaws that earlier passes could not see because they sit in logic rather than configuration: every `any`/inline-typed request body, every client-supplied id that is checked for access to the parent but not for belonging to it, every `in`/regex/merge pattern on user data, JWT edge cases, response contents, and a timing scan of all 348 regular expressions in the backend against adversarial inputs. It found F-31 to F-40. Not found: SQL injection (no string-built SQL), SSRF outside Cyberdigest, path traversal, XXE, prototype pollution, secrets in responses, open redirects.

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
storage all "up"). Nessus and Fortify preview and import (and an XXE file refused), quiz play (no correctness in the answer response, one answer per user, tester 403s), notifications (a tester cannot mark an admin's notification read) and Excel report generation (placeholders substituted, valid workbook downloaded) were then also exercised live in the third round.

## 8. Open, accepted and recommended

| Item | Severity | Notes / recommendation |
|---|---|---|
| Login lockout can be used to lock a known account (5 failed attempts) | Low | A deliberate trade-off against brute force; it expires after 15 minutes and is per account, not per IP. |
| Restricted database user is opt-in | Medium (hardening) | Default stays the built-in superuser so upgrades never break; adopt it with the deployment-guide steps (tested live, on existing and empty databases). A fresh install cannot default to it without changing `DATABASE_URL` for everyone. |
| CSP `style-src-attr 'unsafe-inline'` | Low | React and framer-motion write `style=""` attributes, which cannot carry a nonce. Injected `<style>` blocks and foreign stylesheets are blocked. |
| Dev-only tooling advisories (16, `npm audit` without `--omit=dev`) | Informational | ESLint plugin, `@nestjs/cli`, Jest, ts-jest. Not in the production image (verified). Their fixes are major tooling upgrades; schedule them with the next dependency refresh. |
| No memory limit on PostgreSQL and RustFS | Low | Their need depends on data size; set limits after measuring on your data. All capabilities are dropped and the filesystems are read-only. |
| No Burp or active DAST; no Docker Scout | Informational | ZAP ran as a passive baseline (unauthenticated, then logged in). An active scan against this API is not useful without raising the rate limits, and it would delete and alter data on whatever it is pointed at. Run it against a disposable staging copy before a major release. |

## 9. Files changed

Backend: `auth/auth.service.ts`, `auth/dto/auth.dto.ts`, `users/users.{service,controller}.ts`, `projects/projects.{service,controller}.ts`,
`vulnerabilities/vulnerabilities.service.ts`, `quiz/quiz.service.ts`, `redis/redis.service.ts`, `common/{docx-package,bulk-upload-file}.util.ts`,
new `common/zip-limits.util.ts`, `reports/xlsx-template.service.ts`, `package.json` + lockfile. Tests added: `auth.login-enumeration`, `users.admin-escalation`,
`vulnerabilities.mass-assignment`, `zip-limits.util`, `redis.revoke-tokens`, `deploy-hardening` specs, plus updates to the users, projects and quiz specs.
Deployment: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `.github/workflows/{security,github-webpage}.yml`, both Dockerfiles, new `apps/frontend/{forwarded-for.js,src/middleware.ts,src/lib/csp.ts}`, `apps/frontend/next.config.js`, `app/layout.tsx`, new `apps/backend/database/restricted-user.sql`.
Round 3 additionally: `apps/backend/package.json` and lockfile (NestJS 11), `auth/auth.service.ts` (numeric token lifetimes), `common/engine-headers.ts`, `easter-egg/easter-egg.gateway.ts`, `dashboard/dashboard.gateway.ts`, `apps/frontend/src/lib/csp.ts`, `next.config.js`, `docker-compose.yml` (read-only data stores).
Docs: `README.md`, `site/installation.html`, `site/deployment.html`, `CHANGELOG.md`.

**Upgrade notes:** existing deployments must add `REDIS_PASSWORD` to `.env` before the next `docker compose up` (it stops with a clear message otherwise; no data is touched). Behind one reverse proxy or tunnel, also set `TRUST_PROXY_HOPS=2`, or all users share one per-IP rate limit. Every page is now rendered per request (required for the CSP nonce), which has no visible effect for this client-rendered app.
