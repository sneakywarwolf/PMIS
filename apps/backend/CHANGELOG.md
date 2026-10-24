# Changelog

## Unreleased
- Object storage is now RustFS (S3-compatible) instead of MinIO. Existing installs must copy their files across once: see https://sneakywarwolf.github.io/PMIS/deployment.html#migrate-minio. New installs need no extra setup, and the MINIO_IMAGE setting is gone.
- Docker images are now built natively for linux/amd64 and linux/arm64, instead of emulating arm64.

## 1.0.0
- Initial release.
- About page with version, release notes and admin-scheduled updates (code only; data is never reset).
