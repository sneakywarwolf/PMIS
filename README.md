# PMIS-Project Management for Information Security

A self-hosted, role-based web application for Vulnerability Assessment & Penetration Testing (VAPT) teams: engagements, findings and evidence, a shared vulnerability library, scan imports, and Word/Excel report generation.

**Documentation: https://sneakywarwolf.github.io/PMIS/**

> PMIS is for **authorized** security testing only. It stores sensitive client and vulnerability data; operators are responsible for lawful use and for protecting that data.

## Quick start (Docker)

Requires Docker with Compose v2, Git and OpenSSL. Full guide, Windows commands and troubleshooting: [Installation](https://sneakywarwolf.github.io/PMIS/installation.html).

```bash
git clone https://github.com/sneakywarwolf/PMIS.git
cd PMIS
cp .env.example .env

# 1. Fill the four required secrets with random values
for k in POSTGRES_PASSWORD MINIO_ROOT_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  sed -i.bak "s|^$k=CHANGE_ME|$k=$(openssl rand -hex 32)|" .env
done; rm -f .env.bak

# 2. Choose a MinIO image (required: minio/minio is no longer on Docker Hub).
#    Use a publisher you trust; the image must include the `mc` client.
echo 'MINIO_IMAGE=chainguard/minio:latest' >> .env

# 3. Build and start
docker compose up -d --build

# 4. When `docker compose ps` shows the backend healthy, get the first admin password
docker compose logs backend | grep "First login"
```

Open http://localhost:3000, sign in as `admin` with that password, and set a new one when prompted. There is no fixed default password. Before other people use PMIS, put it behind HTTPS and complete the [production checklist](https://sneakywarwolf.github.io/PMIS/deployment.html#checklist).

**Prebuilt images:** the only published release on Docker Hub, 1.0.0, predates security improvements in the current code. Build from source, as above, until a newer release is published.

## Repository layout

| Path | Contents |
|---|---|
| `apps/backend/` | NestJS API and Prisma schema |
| `apps/frontend/` | Next.js web interface |
| `docker-compose.yml` | Production stack (only the web port is published) |
| `docker-compose.dev.yml` | Local development infrastructure, with fixed local-only credentials. Never use it in production |
| `Report Template/` | Sample Word report templates (upload them under Reports) |
| `docs/` | Design and review documents |
| `site/` | Source of the documentation website |

## Links

- [Security policy](SECURITY.md): report vulnerabilities privately, not in public issues
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
