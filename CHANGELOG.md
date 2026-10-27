# Changelog

## Unreleased
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
- Network Excel reports repeat rows per scope entry, port and finding; `{VA Output}` maps to Nessus plugin output.
- Network Word reports start Scope and Detail Findings on a new page.
- Network VA findings hide the PoC steps section.
- Report templates are selected automatically from category and Testing Type.
- Security: patched dependencies; images on Node 22.
- Documentation: the documentation site and README were rebuilt and checked against the report code. Corrected: Word placeholders do not need yellow highlighting, and the template activation behaviour.
- Documentation: the Report Engine spec (`docs/REPORT-ENGINE-SPEC.md`) now lists what changed since the original draft (automatic document versioning, Excel for Network projects, queued generation, signed downloads, automatic template selection, generation gate, Client SPOC, Issue Log).
- Reset-database messages now say "object storage" instead of MinIO.
- Object storage is now RustFS (S3-compatible) instead of MinIO. Existing installs must copy their files across once: see https://sneakywarwolf.github.io/PMIS/deployment.html#migrate-minio. New installs need no extra setup, and the MINIO_IMAGE setting is gone.
- The RustFS web console is disabled in the production compose file (`RUSTFS_CONSOLE_ENABLE=false`); PMIS uses only the S3 API. The docs explain how to check this.
- Docker images are now built natively for linux/amd64 and linux/arm64, instead of emulating arm64.

## 1.0.0
- First public release.
