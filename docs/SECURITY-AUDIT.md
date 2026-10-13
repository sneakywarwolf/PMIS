# PMIS Security Audit and Hardening Report

Branch `worktree-security-hardening`. Method: manual code review of the backend, plus targeted frontend, Docker and CI review. Automated evidence: backend Jest (45 suites, 274 tests) and `tsc --noEmit` pass; `npm audit --omit=dev` run on both apps. **Not run:** SAST, secret scan, container scan, SBOM generation, DAST, frontend build/tests, the new CI workflow. A passing test run is not proof of absence of vulnerabilities.

## 1. Findings fixed (each has regression tests)

| ID | Sev | Finding | Fix |
|---|---|---|---|
| F1 | High | Team Lead/AVP could read/generate reports, Issue Logs, history, preflight and poll status for any team's project (only Testers were checked) | `common/project-access.util.ts` used by all report paths |
| F2 | High | `evidencePaths`/PoC `imagePath` accepted any storage key, enabling cross-project file inclusion in reports and deletion via project purge | Key allowlist `poc/<uuid>_<name>` (`upload-security.util.ts`) |
| F3 | Med | Tester could set own finding `status` (e.g. APPROVED); value unvalidated | Testers blocked, enum validated |
| F4 | Med | PoC image upload trusted client MIME type | Magic-byte sniffing; stored type is detected type |
| F5 | Med | Nmap parser lacked DTD/entity guard | Rejects DOCTYPE/ENTITY |
| F6 | Med | `/dashboard/activity` returned global audit log to Team Leads; unbounded `limit` | Scoped to own team; limit 1-100 |
| F7 | Med | `/retention/tracker` listed all teams' completed projects to every role | Scoped with `projectScopeWhere` |
| F8 | Med | Admin password reset left existing sessions valid | Revokes refresh tokens and active session |
| F9 | Med | Template upload: no package validation, raw client filename/MIME in storage key | `assertSafeDocx` (macros, ActiveX, executables, zip bomb, path traversal, DTD, remote attachedTemplate/OLE) + `safeFileName`. All 8 shipped templates verified to pass |
| F10 | Med | Swagger public in production; no HSTS/no-store/timeouts | Swagger off in prod (`ENABLE_SWAGGER=1` to opt in), HSTS when `COOKIE_SECURE=true`, `Cache-Control: no-store`, request/header timeouts |
| F11 | Med | Frontend (only published service) sent no security headers | CSP, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| F12 | Med | No tight limits on expensive endpoints | Extra per-user budget (default 20/min, `HEAVY_RATE_LIMIT_PER_MIN`) on imports, uploads, report/issue-log generation, exports |
| F13 | Med | CSV/XLSX parsers had no row/column/decompression limits | 200k rows, 200 columns, XLSX 100 MB declared / 500 entries / 50k rows |
| F16 | Med | No duplicate-submission guard on report generation (races could produce duplicate versions and unbounded queued work) | One in-flight generation per project (10 min window), 409 otherwise |
| F17 | Med | CSRF relied on SameSite=strict alone | Origin / Sec-Fetch-Site check on state-changing requests (`common/csrf.util.ts`); same-origin access via the Next proxy from any hostname still allowed |
| F14 | Low | Download filename header could carry quotes/newlines | Sanitised |
| F15 | Low | JWT secret strength/reuse not checked | Startup warnings in production |

## 2. Verified OK (no change)
Argon2id hashing; login lockout and per-user/IP rate limits; single active session with idle expiry and revocation on password change; HttpOnly + SameSite=strict cookies (Secure via `COOKIE_SECURE`); deny-by-default global `JwtAuthGuard` (`@Public` only on login, refresh, public theme); forced-password-change gating; project/finding access checks and reassignment limits; change-request review limited to target TL or Admin; admin-only settings, update, reset, template, quiz-admin routes; quiz one-attempt-per-user, active-window enforcement, scoring at reveal; CSV export formula neutralisation; Nessus DTD rejection; bulk-upload macro/formula rejection; reset script production guard and typed confirmation; update service refuses destructive commands; non-root backend container; only the frontend port is published; secrets are required env vars.

## 3. Release decision: **BLOCK**
No known unresolved Critical finding. Blocked because: (a) one High dependency finding is open (R1); (b) required gates have not been executed (container scan, SAST, secret scan, SBOM, DAST); (c) items R2-R4 below are unresolved Medium risks relative to the brief (admin MFA, DB privileges). Re-evaluate after the CI workflow runs green and R1-R4 are closed or formally accepted.

## 4. Residual risk register
| ID | Sev | Risk | Proposed owner / date |
|---|---|---|---|
| R1 | High | Frontend: PostCSS bundled in Next.js (GHSA-qx2v-qp2m-jg93 and related); fix needs a Next major upgrade. Build-time CSS processing, not request-reachable, but unresolved | Maintainer, upgrade Next, TBD |
| R2 | Med | No MFA for Admin accounts; no self-service reset flow (admin-issued temp passwords only) | Maintainer, TBD |
| R3 | Med | App connects to Postgres as the `pmis` superuser and runs `migrate deploy` at start. Splitting migrate and runtime roles changes deployment; not done to avoid breaking existing volumes | Maintainer, TBD |
| R4 | Low | Mitigated by F17 (Origin check + SameSite=strict); no synchroniser token. Browsers that omit both Origin and Sec-Fetch-Site on writes are not covered | Maintainer, TBD |
| R5 | Med | `minio/minio:latest` and base images not pinned by digest; no TLS/auth beyond the internal Docker network for Redis/Postgres/MinIO; no encryption at rest configured | Operator, TBD |
| R6 | Low | Backend moderate/low npm advisories (qs, uuid, etc.); fix may be breaking | Maintainer, TBD |
| R7 | Low | Rate limiter fails open if Redis is down (deliberate availability trade-off) | Accepted |
| R8 | Low | `completion-stats?scope=team&tlId=` returns other teams' aggregate counts (no member data); appears intended for team comparison | Accepted pending product confirmation |
| R9 | Low | Any Team Lead/AVP/Admin can approve global-library vulnerability requests (existing business rule) | Accepted pending product confirmation |
| R10 | Low | Malware scanning/quarantine of uploads not implemented; no DAST; audit log retention/immutability not reviewed | Operator, TBD |
| R11 | Low | Report-generation concurrency (duplicate submissions) and multi-step transaction boundaries only partly reviewed | Maintainer, TBD |
| R13 | Info | CSP allows Google Fonts hosts (`globals.css` imports them); self-hosting the fonts would remove the third-party dependency. Frontend CSP not yet verified in a browser | Maintainer, TBD |
| R12 | Info | CSP allows `'unsafe-inline'` scripts/styles (Next bootstrap and static theme script); nonce-based CSP is a later improvement | Maintainer, TBD |

## 5. Production configuration checklist
- Set `NODE_ENV=production` (backend refuses weak or missing JWT secrets), two different 32+ char secrets, `COOKIE_SECURE=true` behind HTTPS, `FRONTEND_URL` exact origin.
- Terminate TLS in front; overwrite `X-Forwarded-For` at the proxy.
- Leave `ENABLE_SWAGGER` unset; `SEED_DEMO=false`; set `ADMIN_PASSWORD` or read the one-time log value.
- Pin `PMIS_VERSION` and `MINIO_IMAGE`; do not publish Postgres/Redis/MinIO ports (production compose already doesn't).
- Do not set `RESET_ALLOW_PRODUCTION` or `UPDATE_COMMAND` unless intended.

## 6. Regression confirmation
Existing suites (quiz, leaderboard, reports, dashboard, nessus, users, projects) all pass unchanged apart from one constructor argument added to `UsersService` in test setup. No migrations, seeds or data operations were added or run; no stored data was touched. Shipped report templates validate. Not exercised: end-to-end report generation against a live stack.

## 7. Re-run on every change
`.github/workflows/security.yml` runs tests, `npm audit`, gitleaks, semgrep, Trivy image scans and an SBOM. It has not yet run.
