# Changelog

## Unreleased
- Settings: Application Name, Logo, Favicon, Table Density, Pagination Size, Date/Time/Number formats, Severity Labels and the Storage/Database quotas are now applied (validation added for each). `GET /settings/public-theme` also returns the application name, logo and favicon.
- Quotas: `DatabaseQuotaGuard` (HTTP 507 for POST/PUT/PATCH at the database quota, except auth, settings, presence, notifications and update) and a storage quota check before every upload.
- Reports and Issue Log print the Admin's severity labels.
- Settings: per-format attachment size limits (enforced on all uploads) and per-role notification switches (Admin always receives everything). The old attachments and notifications fields are replaced.
- The settings history includes the actor's name and role.
- The dashboard activity endpoint is Admin only and returns each actor's name and role.
- Nessus CSV import reads Plugin Output (so `{VA Output}` is filled) and a CWE in the XREF column.
- In Progress projects print as Non-Compliant (red) for the project status placeholder in Word and Excel reports.
- New-vulnerability notifications open the Pending Approval tab on that request.
- Pending, rejected and deactivated library records, and their history, are no longer readable by id by other Testers.
- The About page shows the version of the running image (APP_VERSION set by the release workflow); GitHub release data is validated.
- Add Finding > Add Manually, with an optional Sync Vuln DB approval request; Import Project Findings from .csv/.xlsx (project only).
- Several PoC screenshots per step, in order, with a black border in the Word report.
- Issue Log CSV header row no longer has surrounding quotation marks.

## 1.0.10 (2026-10-25)
- Reset-database tooling messages say "object storage" instead of MinIO.

## 1.0.9 (2026-10-25)
- Object storage is now RustFS (S3-compatible) instead of MinIO. The MINIO_IMAGE setting is gone.
- Docker images are now built natively for linux/amd64 and linux/arm64, instead of emulating arm64.
- Image: production dependencies pruned of dev packages; Alpine packages and npm upgraded to clear Docker Scout findings.

## 1.0.8 (2026-10-24)
- Images on Node 22 with patched dependencies; template activation is atomic and keeps replaced templates that reports use.

## 1.0.5 (2026-10-24, includes 1.0.2 to 1.0.5)
- Reports: Excel reports for Network projects, separate VA / PT tables and charts, `{#VA}` / `{#PT}` blocks, status placeholders with green / red background, Client SPOC placeholders, signed download links, automatic template selection.
- Security hardening: storage-key allowlist, magic-byte image check, DOCX package validation, CSV / XLSX limits, CSRF origin check, team-scoped endpoints, rate limits on heavy endpoints.
- Nessus import keeps plugin output and the scan's CVSS vector; Network Scope import; live-user list.

## 1.0.1 (2026-10-09 to 2026-10-14)
- Nessus import for VA findings, About / update endpoints, project reassignment rules.

## 1.0.0 (2026-10-08)
- Initial release.
- About page with version, release notes and admin-scheduled updates (code only; data is never reset).
