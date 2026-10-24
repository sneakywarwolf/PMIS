# Changelog

## Unreleased
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
