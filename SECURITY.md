# Security Policy

PMIS stores sensitive vulnerability and client data, so security reports are taken seriously.

**Report privately** via GitHub: *Security* tab → *Report a vulnerability* (private advisory). Please don't open public issues for vulnerabilities. Include steps to reproduce, affected version and impact. Expect an acknowledgement within a few days.

Supported: the latest released version.

Deployment hardening checklist: random secrets in `.env`, HTTPS + `COOKIE_SECURE=true`, only the web port exposed, regular backups, change the admin password at first login, no `SEED_DEMO` in production.
