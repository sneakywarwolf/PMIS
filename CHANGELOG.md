# Changelog

## Unreleased
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
