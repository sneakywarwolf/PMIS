# Changelog

## Unreleased
- Nessus CSV imports are more forgiving. A stray control character in plugin output (escape sequences from banners and prompts are common in big scans) no longer makes the whole file unreadable: it is replaced by a space. Files saved with semicolons or tabs between columns, or as UTF-16 text, are read too. A file with binary data at its start is still refused, now with a clearer message.
- Failed uploads say what happened: a dropped connection with how much had been sent, the server stopping after the whole file had arrived, a gateway timeout (502/503/504), or a size limit on the way (413), instead of one generic message. The Nessus dialog has a Try again button.
- Big uploads show live status. The Nessus import and Import Project Findings dialogs now show a progress bar with percent, size sent, speed and time left while the file uploads, then "the server is processing the file" with a moving bar and a running clock, so it is clear the application is working and has not stopped. The same status shows while the selected findings are created.
- Fix: if the permissions of the signed-in role cannot be loaded (a temporary error, or a backend older than the front end), the menu and pages now retry and then fall back to the shipped defaults for the role, instead of hiding every feature and sending people to the Unauthorized page. The server still enforces the real rules. Settings > RBAC says so when the backend does not send its feature list.
- Settings > RBAC (new tab): the Admin switches each feature on or off per role (AVP, Team Lead, Tester). It lists 60 features in 10 groups, including Manage quiz questions, Upload report templates, Reset passwords (temporary password), Create users, Delete projects and the Vulnerability DB approvals. Admins always have every feature (locked on); Settings itself is not listed and stays Admin only. The defaults are the rules PMIS already had, so nothing changes until an Admin changes it. The server enforces the switches on every request, and menus, pages and buttons follow them.
- Fix: the off position of the sliding switches (Sync Vuln DB, Notifications, RBAC) was drawn in the theme's accent colour in some themes; it is now grey so on and off are easy to tell apart.
- Reports: when a role may not download reports, history and status no longer include download links.
- Documentation: Backup and restore now covers all three data stores (PostgreSQL, RustFS files, Redis) plus `.env`, with tested commands for each. The MinIO to RustFS migration section was removed from the deployment page and README.
- About: a glass-style Documentation button opens https://sneakywarwolf.github.io/PMIS/ in a new tab.
- Version: the version on the About page now follows the release automatically. The release workflow also writes the tag into each app's `package.json` before building, and when you build from source with `docker compose build`, `PMIS_VERSION` in `.env` (for example `1.0.10`) is passed to the backend as `APP_VERSION`. Images built before this change still report `1.0.0`; install the next release once and it will show the right number from then on.
- Settings: every setting now has an effect; none is display-only.
  - Application Name, Logo and Favicon (upload a PNG, JPEG, GIF, WebP or ICO up to 150 KB) set the browser tab title and icon, the sidebar and the login page. The `APP_NAME` environment variable is no longer used for the About page.
  - Table Density changes the row spacing of every table. Default Pagination Size pages the Projects, Vulnerability DB and Users lists (viewers can pick another size for their view).
  - Date Format, Time Format and Number Format Locale apply to every date, time and number shown.
  - Severity Labels are shown everywhere in the app and printed in Word, Excel and Issue Log reports; Severity Colors are used for badges, charts and the heatmap. The stored severity value does not change.
  - Storage and Database quotas are enforced: uploads that would pass the storage quota are refused, and while the database is at its quota, requests that create or change data are refused with HTTP 507 (viewing, deleting, sign-in and Settings still work so space can be freed).
- Tests: a settings audit fails the build if a setting is added that nothing reads.
- Import Project Findings: an "i" beside the button lists the accepted file types, size and row limits, and the exact header row with which columns are required.
- Settings > Attachments now lists every accepted upload format (20, in 8 groups) with its own size limit, which the Admin can change (each format has a highest value; the findings import cannot go above 100 MB). Limits are enforced on every upload and apply at once. The defaults are the limits that applied before.
- Settings > Notifications: the Admin can switch each of the 13 notification types on or off for AVP, Team Lead and Tester. Admins always receive every notification and that cannot be changed. This replaces the old, unused "default enabled types" list.
- Settings change history shows the person's name, username and role.
- Add Finding: Import Project Findings moved into the dialog, beside Add Manually (both styled like Cancel and Continue). Imported findings are PT findings, which in a Network project means they are listed under PT Findings. Sync Vuln DB is now a sliding switch.
- Activity log (dashboard): each entry shows the person's name, their role in brackets, what they did, and the date and time to the second. It is now visible to Admins only; the API refuses everyone else.
- Nessus CSV import now reads the Plugin Output column (per host and port, like a .nessus file), so `{VA Output}` and the finding's evidence are filled for CSV imports. A CWE listed only in the XREF column is picked up as the CWE ID.
- Reports: a project whose saved status is In Progress now prints `{Project Status}` / `{Compliance Status}` as Non-Compliant on the red background, in Word and Excel, like a Non-Compliant project. File names and report eligibility are unchanged.
- Notifications: a new-vulnerability request now opens the Pending Approval tab, focused on that request. Older unread requests open it too.
- Security: a Vulnerability DB record that is pending, rejected or deactivated, and its audit history, can no longer be read by id by Testers other than the requester.
- Updates: the About page shows the version of the running image. The release workflow now sets `APP_VERSION` in the backend image; before, every build showed the `package.json` version (1.0.0). Release metadata from GitHub is validated.
- Signing out or switching accounts clears the settings and live-user count the previous account had loaded.
- Add Finding > Add Manually: create a finding for a vulnerability that is not in the Vulnerability DB. With Sync Vuln DB on (default) a separate approval request is also sent; the project finding is unaffected by the decision. With it off the finding stays in the project only.
- Import Project Findings: add findings from a .csv or .xlsx file (up to 100 MB, 5,000 rows) with preview and all-or-nothing validation. They stay in the project and are never synced to the Vulnerability DB.
- A step can now hold several PoC screenshots, kept in order and printed in order in the report. Every PoC image in the Word report has a black border.
- Issue Log CSV: the header row is written without surrounding quotation marks.
- Nessus imports accept `.nessus` and `.csv` files up to 500 MB. The file is read while it uploads and is never stored; only the findings you import are saved. Behind your own reverse proxy, raise its body limit to at least 512 MB (the docs example is updated).

## 1.0.10 (2026-10-25)
- The RustFS web console is disabled in the production compose file (`RUSTFS_CONSOLE_ENABLE=false`); PMIS uses only the S3 API. The docs explain how to check this.
- Documentation: the Report Engine spec (`docs/REPORT-ENGINE-SPEC.md`) now lists what changed since the original draft (automatic document versioning, Excel for Network projects, queued generation, signed downloads, automatic template selection, generation gate, Client SPOC, Issue Log).
- Reset-database messages now say "object storage" instead of MinIO.

## 1.0.9 (2026-10-25)
- Object storage is now RustFS (S3-compatible) instead of MinIO. The MINIO_IMAGE setting is gone.
- Docker images are now built natively for linux/amd64 and linux/arm64, instead of emulating arm64.
- Security: the Docker images were rebuilt to fix Docker Scout findings (backend dev dependencies pruned, Alpine packages and npm upgraded, dependency audit fixes).

## 1.0.8 (2026-10-24)
- Security: patched dependencies; images on Node 22.
- Report templates: activating a template replaces the previous one atomically under a lock, and replaced templates that existing reports refer to are kept.
- Documentation: the documentation site and README were rebuilt and checked against the report code. Corrected: Word placeholders do not need yellow highlighting, and the template activation behaviour.
- Documentation site: dark mode, search, contents sidebar, copy buttons, parameter table for every mappable report placeholder, glossary, error finder, architecture and report-flow diagrams, and a link checker and search index in CI.
- Installation page: two self-contained routes (build from GitHub, or pull from Docker Hub) with troubleshooting. Header has GitHub, LinkedIn and theme buttons.

## 1.0.7 (2026-10-24)
- CI: the security workflow runs Trivy from a digest-pinned container image.

## 1.0.6 (2026-10-24)
- Documentation: GitHub Pages site published from `site/` (overview, user guide, reports, security, deployment, API pages); README trimmed to point to it. The Pages workflow is named `github-webpage` and deploys on pushes to master.
- Setup scripts and `.env.example` updated.

## 1.0.5 (2026-10-24, includes 1.0.2 to 1.0.5)
- Reports: Network projects can use Excel templates (templates are marked Word or Excel); VA and PT findings are in separate tables with severity charts per group; `{VA Output}` is filled; `{#VA}` / `{#PT}` blocks follow the Network Activity Type; `{Project Status}` / `{Compliance Status}` print Compliant / Non-Compliant with a green / red background; `{Client SPOC ...}` placeholders; no double underscore in a file name when a value is empty; Nessus stock disclaimers are stripped from VA descriptions.
- Network Excel reports repeat rows per scope entry, port and finding; `{VA Output}` maps to Nessus plugin output.
- Network Word reports start Scope and Detail Findings on a new page.
- Network VA findings hide the PoC steps section.
- Report templates are selected automatically from category and Testing Type.
- Templates: several Activity Types in one template, category filter buttons, Word or Excel type.
- Network projects: Network Scope import (.txt, .csv, .xlsx) with an info tooltip for the supported formats, Nmap Ports, Network Activity Type (VA / PT / VAPT), bulk delete of Nessus VA findings, a caution under Testing Limitation, and VA / PT filters.
- Nessus import: plugin output becomes the PoC with an "Observe the output." step; the scan's CVSS vector is kept (or a candidate is calculated); CVSS vectors are shown without the version prefix.
- Reports can be generated when the project has findings or is Compliant; downloads are served through the API with signed, expiring links; one generation at a time per project.
- Vulnerability bulk upload: Replace or Merge mode, and repeated names in the file can be resolved by choosing which version to keep.
- Projects: completed projects can be edited with change history; long values wrap; optional Client SPOC fields for Cert-IN projects.
- Dashboard: live user count beside System Online, with a scoped list of active and idle users (default inactivity threshold 2 minutes).
- Quiz: every question still inside its 24-hour answer window is shown; late answers are unscored; revealed questions get Recently Revealed cards and notifications.
- Updates: an Admin's "Check for updates" starts the update when a newer version exists. The application is named PMIS - Project Management for Information Security.
- Security: stricter file and storage-key checks for evidence and templates, DOCX package validation, CSV / XLSX parser limits, CSRF origin check, security headers and CSP, report, retention and activity endpoints scoped to the team, sessions revoked on admin password reset, Swagger off and HSTS in production, rate limits on heavy endpoints, `POST /auth/refresh` without a cookie returns 401, and a security CI workflow (tests, dependency audit, gitleaks, semgrep, trivy, SBOM).

## 1.0.1 (2026-10-09 to 2026-10-14)
- About page with version, release notes and admin-scheduled updates; update source defaults to `sneakywarwolf/PMIS`; forced version checks are rate limited.
- Nessus import for VA findings on Network projects: summary counts, findings with a CVSS score preselected, informational plugins listed separately, findings kept in the project only.
- Project reassignment: an Admin can pick any tester, a Team Lead only within the team, and the new tester is notified.
- Production hardening: production builds in `start.bat`, scripts wait for healthy containers before migrating, configurable API proxy.

## 1.0.0 (2026-10-08)
- First public release.
