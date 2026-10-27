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
- Object storage is now RustFS (S3-compatible) instead of MinIO. Existing installs must copy their files across once: see https://sneakywarwolf.github.io/PMIS/deployment.html#migrate-minio. New installs need no extra setup, and the MINIO_IMAGE setting is gone.
- Docker images are now built natively for linux/amd64 and linux/arm64, instead of emulating arm64.

## 1.0.0
- Initial release.
- About page with version, release notes and admin-scheduled updates (code only; data is never reset).
