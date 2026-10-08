# STT — VAPT Command Center

A futuristic, scalable, web-based RBAC Project Management and Dynamic Report Generation System specifically architected for a **Vulnerability Assessment & Penetration Testing (VAPT)** team.

> **by a Lazy Tester For Lazy Testers**

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Database Schema](#database-schema)
4. [Backend Architecture](#backend-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [API Reference](#api-reference)
7. [Authentication & Authorization](#authentication--authorization)
8. [Report Generation Engine](#report-generation-engine)
9. [Key Business Logic](#key-business-logic)
10. [Quick Start](#quick-start)
11. [Environment Variables](#environment-variables)
12. [Available Scripts](#available-scripts)
13. [Project Structure](#project-structure)
14. [Default Credentials](#default-credentials)
15. [Security Features](#security-features)
16. [Development Guide](#development-guide)
17. [Known Issues & Decisions](#known-issues--decisions)

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js 15    │────▶│  NestJS 10 API  │────▶│  PostgreSQL 16  │
│   (Frontend)    │     │   (Backend)     │     │   (Primary DB)  │
│   Port: 3000    │◀────│   Port: 4000    │◀────│   Port: 5432    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │               ┌───────┴───────┐
        │               │               │
┌───────▼───────┐  ┌────▼────┐   ┌────▼────┐
│  MinIO (S3)   │  │  Redis  │   │Swagger  │
│  Port: 9000   │  │  :6379  │   │  /docs  │
└───────────────┘  └─────────┘   └─────────┘
```

**Communication Flow:**
- Frontend → Backend via REST API (`/api/*` proxied through Next.js)
- Backend → PostgreSQL via Prisma ORM
- Backend → Redis for sessions, account lockout, refresh tokens
- Backend → MinIO for DOCX template storage and report file storage
- Authentication via HTTP-only JWT cookies (access + refresh tokens)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js | 15 (App Router) |
| Frontend | React | 19 |
| Frontend | TypeScript | 5.x |
| Frontend | Tailwind CSS | 3.x |
| Frontend | Framer Motion | 11.x |
| Frontend | Recharts | 2.x |
| Frontend | Lucide React | 0.x |
| Backend | NestJS | 10 |
| Backend | Prisma | 5.x |
| Backend | TypeScript | 5.x |
| Database | PostgreSQL | 16 |
| Cache | Redis | 7 |
| Storage | MinIO | Latest |
| Report Engine | docx-templates (custom) | JSZip + @xmldom/xmldom |
| Auth | Argon2id + JWT | - |

---

## Database Schema

### Enums

| Enum | Values |
|------|--------|
| `UserRole` | `ADMIN`, `AVP`, `TEAM_LEAD`, `TESTER` |
| `ProjectStatus` | `NOT_STARTED`, `IN_PROGRESS`, `AWAITING_REVIEW`, `COMPLETED` |
| `FindingStatus` | `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED` |
| `VulnerabilityStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `ComplianceType` | `VAPT`, `CERT_IN`, `PCI`, `ASV` |
| `TemplateCategory` | `PCI`, `VAPT`, `CERT_IN`, `ASV` |
| `TemplateSubType` | `WEB`, `API`, `MOBILE`, `THICK_CLIENT` |
| `TemplateFieldCategory` | `PROJECT_INFO`, `VULNERABILITY`, `CONTACT`, `DATE`, `OTHER` |
| `NotificationType` | `USER_CREATED`, `USER_UPDATED`, `VULNERABILITY_REQUESTED`, `VULNERABILITY_APPROVED`, `VULNERABILITY_REJECTED`, `VULNERABILITY_EDITED` |
| `AuditAction` | 20+ actions (LOGIN, LOGOUT, USER_CREATED, PROJECT_CREATED, etc.) |

### Models

#### User (`users`)
- `id` (CUID), `username` (unique), `email` (unique)
- `passwordHash`, `role` (UserRole)
- `assignedTlId` → self-relation to Team Lead
- `managerId` → self-relation to Manager
- `fullName`, `phone`, `designation`
- `isActive`, `isForcePasswordChange`
- `totpSecret`, `isTotpEnabled`
- Relations: projectsOwned, projectsManaged, findings, auditLogs, templatesUploaded, vulnRequests, notifications

#### Project (`projects`)
- `id`, `name`, `clientName`, `scope`
- `startDate`, `endDate`, `status` (ProjectStatus)
- `complianceStatus` (Compliant/Non-Compliant/In-Progress)
- `complianceType` (VAPT/CERT_IN/PCI/ASV)
- `testerId`, `tlId` → User relations
- `templateId` → ReportTemplate
- `category` (TemplateCategory), `subType` (TemplateSubType)
- Report detail fields: `appVersion`, `location`, `documentVersion`, `toolsUsed`, `testingEnvironment`, `qaReviewerName`, `applicationDetails`, `testingType`, `loginSystemTypes`, `applicationNature`, `testingLimitation`
- Conditional detail fields: `mobilePlatform` (Android/iOS, shown when `subType` = `MOBILE`), `sha1` (shown when `subType` is `MOBILE` or `THICK_CLIENT`)
- `reportDocxPath`, `reportPdfPath`, `isDraft`, `generatedAt`, `approvedAt`, `approvedById`
- Relations: tester, tl, template, findings, reportGenerations

#### ReportTemplate (`report_templates`)
- `id`, `name`, `filePath`, `fileHash`
- `category`, `subType`, `projectType`
- `effectiveFrom`, `effectiveTo`, `isActive`
- `uploadedById` → User
- Relations: fields (TemplateField[]), projects, reportGenerations

#### TemplateField (`template_fields`)
- `id`, `templateId`, `name`, `normalizedName`
- `category`, `description`, `isRepeatable`, `sortOrder`

#### Vulnerability (`vulnerabilities`)
- `id`, `name`, `severity`, `cvssScore`, `cvssVector`
- `description`, `impact`, `remediation`, `references`
- `cveId`, `cweId`, `source`
- `status` (VulnerabilityStatus), `isActive`
- `requestedById`, `reviewedById`, `reviewedAt`
- Relations: findings

#### Finding (`findings`)
- `id`, `projectId`, `vulnId`
- `evidencePaths` (String[]), `testerNotes`, `status` (FindingStatus)
- `affectedInstances` (String[]), `authenticationType`, `proofOfConcept`
- `vulnerabilityDependency`, `reportStatus`
- `cvssScoreOverride`, `cvssVectorOverride`
- `createdById`
- Relations: project, vulnerability, pocSteps

#### PocStep (`poc_steps`)
- `id`, `findingId`, `stepNo`, `description`, `imagePath`

#### Notification (`notifications`)
- `id`, `userId`, `type` (NotificationType)
- `title`, `message`, `read` (boolean), `linkUrl`, `relatedId`

#### AuditLog (`audit_logs`)
- `id`, `actorId`, `action` (AuditAction)
- `targetType`, `targetId`, `targetUserId`
- `details` (JSON), `ipAddress`, `userAgent`, `timestamp`

---

## Backend Architecture

### Module Structure

```
AppModule (root)
├── ConfigModule (global, loads .env)
├── PrismaModule
├── RedisModule
├── AuthModule
│   ├── AuthService (login, logout, refresh, changePassword)
│   ├── AuthController (POST /auth/login, /logout, /refresh, /change-password)
│   ├── JwtAuthGuard (global APP_GUARD)
│   ├── RolesGuard (global APP_GUARD)
│   └── Decorators: @Roles(), @CurrentUser()
├── UsersModule
│   ├── UsersService (CRUD, team hierarchy, password reset)
│   └── UsersController (GET/POST/PUT/DELETE /users, /users/bulk-upload, /users/sample-csv, /users/team-leads, /users/managers, /users/profile)
├── ProjectsModule
│   ├── ProjectsService (CRUD, auto-status, access control)
│   └── ProjectsController (GET/POST/PUT /projects, /projects/:id/review, /projects/:id/reassign)
├── FindingsModule
│   ├── FindingsService (CRUD, POC steps)
│   └── FindingsController (GET/POST/PUT/DELETE /findings, /findings/:id/poc-steps)
├── ReportsModule
│   ├── ReportsService (template mgmt, preflight, report generation)
│   ├── DocxManipulatorService (yellow-field extraction, DOCX generation)
│   ├── StorageService (MinIO upload/download/presigned URLs)
│   └── ReportsController (POST /reports/upload-template, /reports/generate, /reports/templates, etc.)
├── VulnerabilitiesModule
│   ├── VulnerabilitiesService (CRUD, approval workflow, CSV export)
│   └── VulnerabilitiesController (GET/POST/PUT/DELETE /vulnerabilities, /vulnerabilities/pending, /vulnerabilities/export)
├── DashboardModule
│   ├── DashboardService (admin stats, team stats, vulnerability trends)
│   ├── DashboardGateway (Socket.io - currently basic)
│   └── DashboardController (GET /dashboard/admin, /dashboard/team, /dashboard/vulnerabilities)
├── NotificationsModule
│   ├── NotificationsService (create, mark read, notifyAdminsAndTLs)
│   └── NotificationsController (GET /notifications, /notifications/count, PUT /notifications/:id/read)
├── AuditModule
│   └── AuditService (comprehensive audit logging)
```

### Key Services Detail

#### AuthService (`src/auth/auth.service.ts`)
- **Login**: Accepts `username` OR `email` (two-step lookup: username exact match → email case-insensitive fallback). Checks Redis lockout, verifies Argon2 hash, generates JWT access + refresh tokens.
- **Remember Me**: Extends access token to 24h, refresh to 30d (default: 15m / 7d).
- **Account Lockout**: 5 failed attempts → 15 min lock via Redis.
- **Token Storage**: Refresh token JTI stored in Redis with expiry.

#### ProjectsService (`src/projects/projects.service.ts`)
- **Access Control**: Admin sees all. TL sees own projects + team projects. Tester sees own only.
- **Auto-Status** (line 213-231):
  - `FINDING_ADDED` + status `NOT_STARTED` → `IN_PROGRESS`
  - `REPORT_GENERATED` → `COMPLETED`
- **Update**: Does NOT allow status editing directly (auto-managed). Allows all detail fields.

#### FindingsService (`src/findings/findings.service.ts`)
- **Sorting**: Findings sorted by `cvssScoreOverride` desc (nulls last), then `vulnerability.cvssScore` desc.
- **POC Steps**: Full CRUD for stepNo, description, imagePath.
- **Access**: Testers can only edit their own DRAFT findings.

#### ReportsService (`src/reports/reports.service.ts`)
- **Template Upload**: Analyzes DOCX, extracts yellow-highlighted fields, runs dry-run generation, creates INACTIVE template.
- **Template Activation**: Deactivates previous version of same category+subType.
- **Preflight**: Checks all required project fields, tester/TL/manager profiles, approved findings, active template.
- **Report Generation**:
  1. Loads project with approved findings + POC steps
  2. Builds field rules from project data + profiles
  3. Fills contact table row-aware (AVP/TL/Tester)
  4. Fills summary findings table + detailed findings tables
  5. Embeds POC images (PNG/JPG dimension-aware, max 5.5in width)
  6. Uploads to MinIO, creates ReportGeneration record
  7. Auto-completes project status

#### DocxManipulatorService (`src/reports/docx-manipulator.service.ts`)
- **Yellow Field Extraction**: Scans `w:highlight val="yellow"` and `w:shd fill="ffff00"` in runs.
- **Run Merging**: Merges consecutive highlighted runs (Word splits placeholders across runs).
- **Field Rules**: Ordered rules, first match wins. Supports `requireAll` for merged runs.
- **Table Detection**: Detects summary table (`{Vulnerability Name}` + `{Score Value}`) and detailed table (`CVE/CWE`).
- **Image Embedding**: Registers images in `word/media/`, updates `[Content_Types].xml` and `word/_rels/document.xml.rels`, creates OpenXML drawing markup.

#### VulnerabilitiesService (`src/vulnerabilities/vulnerabilities.service.ts`)
- **Search**: Searches name, CVE ID, description (case-insensitive).
- **Approval Workflow**: Testers submit requests → Admin/TL approve/reject.
- **Export CSV**: All approved vulnerabilities, or filtered by severity.
- **Bulk Upload** (Admin only): Parses uploaded CSV, validates exact header format (`S.No, Name, Severity, CVSS, CVSS-VEC, Description, Impact, Remediation, Reference, CVE ID, CWE ID`). In a transaction: deactivates all existing vulnerabilities, inserts new ones as `APPROVED`.
- **Sample CSV**: Returns a correctly formatted sample CSV with one example row for download.
- **Notifications**: Auto-notifies requester on approve/reject/edit.

#### NotificationsService (`src/notifications/notifications.service.ts`)
- **notifyAdminsAndTLs**: Broadcasts to all ADMIN + AVP + TEAM_LEAD users.
- Used by: User creation, Vulnerability requests/approvals/rejections/edits.

---

## Frontend Architecture

### Page Structure (App Router)

```
app/
├── layout.tsx          # Root layout with AuthProvider
├── page.tsx            # Redirects to /login or /dashboard
├── login/
│   └── page.tsx        # Login form (username OR email, remember me, password)
└── dashboard/
    ├── layout.tsx      # Sidebar nav, NotificationBell, UserDropdown, auth guard
    ├── page.tsx        # Dashboard: Admin sees all data + charts; TL sees team data
    ├── projects/
    │   ├── page.tsx    # Project list: Grid/Table toggle, search, status filter
    │   ├── new/
    │   │   └── page.tsx # Create new project form
    │   └── [id]/
    │       └── page.tsx # Project detail: info card, findings list, add/edit findings
    ├── vulnerabilities/
    │   └── page.tsx    # Vuln DB: search, sort by headers, export CSV, pending approvals
    ├── users/
    │   └── page.tsx    # User mgmt: CRUD, TL dropdown, manager dropdown, password reset
    ├── reports/
    │   └── page.tsx    # Report templates: upload, activate/deactivate, view fields
    ├── profile/
    │   └── page.tsx    # My Profile: edit fullName/phone/designation, change password
    └── settings/
        └── page.tsx    # Settings page (placeholder)
```

### Key Components

#### DashboardLayout (`dashboard/layout.tsx`)
- Collapsible sidebar (256px → 72px) with Framer Motion
- Role-filtered navigation: Admin sees Users + Settings; all roles see Dashboard/Projects/Reports/Vulnerabilities
- **Nav Highlight Fix**: Dashboard uses exact match (`pathname === '/dashboard'`) to avoid highlighting when on `/dashboard/projects`
- NotificationBell: Polls every 30s, dropdown with mark-as-read
- UserDropdown: Shows fullName + role, links to Profile, Logout

#### AuthContext (`contexts/auth-context.tsx`)
- Axios instance with `baseURL: '/api'`, `withCredentials: true`
- Auto-checks `/auth/me` on mount
- Login accepts `rememberMe` flag

---

## API Reference

### Auth
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/auth/login` | `{username, password, rememberMe?}` | Returns user + sets cookies |
| POST | `/auth/logout` | - | Clears cookies |
| POST | `/auth/refresh` | - | Rotates refresh token |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | - |
| GET | `/auth/me` | - | Current user profile |

### Users (Admin only, except profile)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List all users |
| POST | `/users` | Create user |
| GET | `/users/:id` | Get user |
| PUT | `/users/:id` | Update user (fullName, phone, designation, manager, TL, etc.) |
| DELETE | `/users/:id` | Soft delete (deactivate) |
| POST | `/users/:id/reset-password` | Force password reset |
| PUT | `/users/:id/activate` | Reactivate user |
| POST | `/users/bulk-upload` | **Admin only**. Bulk add users from CSV |
| GET | `/users/sample-csv` | Download sample user CSV format |
| GET | `/users/team-leads` | List active TLs |
| GET | `/users/managers` | List active users (for manager assignment) |
| GET | `/users/profile` | Current user profile with TL + manager |
| PUT | `/users/profile` | Update own profile |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List (role-filtered) |
| POST | `/projects` | Create |
| GET | `/projects/:id` | Get detail with findings |
| PUT | `/projects/:id` | Update (no status field - auto-managed) |
| POST | `/projects/:id/review` | TL approves/rejects |
| POST | `/projects/:id/reassign` | TL reassigns tester |

### Findings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/findings/project/:projectId` | List findings |
| POST | `/findings` | Create finding (auto-updates project status) |
| PUT | `/findings/:id` | Update finding |
| DELETE | `/findings/:id` | Delete finding |
| POST | `/findings/:id/poc-steps` | Add POC step |
| PUT | `/findings/:id/poc-steps/:stepId` | Update POC step |
| DELETE | `/findings/:id/poc-steps/:stepId` | Delete POC step |
| POST | `/findings/upload-poc-image` | Upload image (multipart) |

### Vulnerabilities
| Method | Endpoint | Query Params | Description |
|--------|----------|--------------|-------------|
| GET | `/vulnerabilities` | `search`, `severity`, `sortBy`, `sortOrder` | List |
| GET | `/vulnerabilities/pending` | - | Pending approvals |
| POST | `/vulnerabilities` | - | Add (admin direct) |
| POST | `/vulnerabilities/request` | - | Request (tester → pending) |
| PUT | `/vulnerabilities/:id` | - | Update |
| DELETE | `/vulnerabilities/:id` | - | Deactivate |
| PUT | `/vulnerabilities/:id/approve` | - | Approve request |
| PUT | `/vulnerabilities/:id/reject` | - | Reject request |
| GET | `/vulnerabilities/export` | `severity` | Download CSV |
| POST | `/vulnerabilities/bulk-upload` | - | **Admin only**. Replace entire vuln DB from CSV |
| GET | `/vulnerabilities/sample-csv` | - | Download sample CSV format |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/reports/upload-template` | Upload DOCX template (multipart) |
| GET | `/reports/templates` | `?category&subType&includeInactive` |
| PUT | `/reports/templates/:id/activate` | Activate template |
| PUT | `/reports/templates/:id/deactivate` | Deactivate template |
| GET | `/reports/templates/:id/fields` | Get template fields |
| GET | `/reports/preflight/:projectId` | Check readiness |
| POST | `/reports/generate` | Generate DOCX report |
| GET | `/reports/history/:projectId` | Report generation history |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard/admin` | Admin stats |
| GET | `/dashboard/team` | TL team stats |
| GET | `/dashboard/vulnerabilities` | Vulnerability trends |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications` | List notifications |
| GET | `/notifications/count` | Unread count |
| PUT | `/notifications/:id/read` | Mark as read |
| PUT | `/notifications/read-all` | Mark all as read |

---

## Authentication & Authorization

### JWT Cookie Flow
1. User logs in → backend sets two HTTP-only cookies:
   - `access_token` (short-lived: 15min or 24h with remember me)
   - `refresh_token` (long-lived: 7d or 30d with remember me)
2. Frontend axios sends cookies automatically (`withCredentials: true`)
3. Backend `JwtAuthGuard` validates `access_token` from cookie
4. `RolesGuard` checks `@Roles()` decorator against JWT payload
5. On 401, frontend should redirect to login

### Role Permissions

| Feature | Admin | AVP | Team Lead | Tester |
|---------|-------|-----|-----------|--------|
| All Projects | ✅ | Own + Team | Own + Team | Own only |
| Create Project | ✅ | ✅ | ✅ | ❌ |
| Edit Any Project | ✅ | Own + Team | Own + Team | Own only |
| Add Findings | ✅ | Own + Team | Own + Team | Own projects |
| Edit Findings | ✅ | All | All | Own DRAFT only |
| Generate Report | ✅ | ✅ | ✅ | Own |
| User Management | ✅ | View team | View team | ❌ |
| Approve Vulns | ✅ | ✅ | ✅ | ❌ |
| Add Vuln Direct | ✅ | ✅ | ✅ | Request only |
| Templates | ✅ | View | View | View |
| **Admin Dashboard** | ✅ | ✅ | ❌ | ❌ |

> **AVP (Assistant Vice President)**: Same permissions as Team Lead + access to Admin Dashboard with global stats. Manager dropdown in User Management only shows AVP users.

---

## Report Generation Engine

### Template System
- Templates are DOCX files with **yellow-highlighted** placeholder fields
- Placeholders are matched by normalized name (lowercase, special chars → underscores)
- Templates are organized by: `ComplianceType` × `TemplateSubType` (e.g., PCI × Web)
- Only ONE template per category+subType can be active at a time

### Template Files on Disk
```
Report Template/
├── PCI/
│   ├── App-Security-Test_{Client}-{App}_Web_v1.0_YYYY-MM-DD_Non-Compliant.docx
│   ├── App-Security-Test_{Client}-{App}_API_v1.0_YYYY-MM-DD_Non-Compliant.docx
│   ├── App-Security-Test_{Client}-{App}_Mobile_v1.0_YYYY-MM-DD_Non-Compliant.docx
│   └── App-Security-Test_{Client}-{App}_Thick-Client_v1.0_YYYY-MM-DD_Non-Compliant.docx
└── VAPT/
    ├── (same 4 subtypes)
```

### Yellow Fields Auto-Filled
| Field Pattern | Data Source |
|---------------|-------------|
| `start_date` + `end_date` | Project dates (formatted: "Month DD, YYYY") |
| `client_name` | `project.clientName` |
| `app_version` | `project.name + project.appVersion` |
| `version_ex` | `project.documentVersion` |
| `tools_name` | `project.toolsUsed` |
| `details_scope` | `project.applicationDetails + project.scope` |
| `staging_uat` | `project.testingEnvironment` |
| `black_box` | `project.testingType` |
| `login_role_types` | `project.loginSystemTypes` |
| `nature_or_purpose` | `project.applicationNature` |
| `testing_limitation` | `project.testingLimitation` |
| `team_lead_name` | `project.tl.fullName` |
| `tester_name` | `project.tester.fullName` |
| `qa_reviewer_name` | `project.qaReviewerName` |
| `month_dd_yyyy` | Current date |
| Contact table rows | AVP (TL's manager), TL, Tester — phone/email/title per row |

### Report File Naming
```
App-Security-Test_{ClientName}-{AppName}_{SubType}_v{DocVersion}_{YYYY-MM-DD}_Non-Compliant.docx
```

---

## Key Business Logic

### Project Status Auto-Update
1. Project created → `NOT_STARTED`
2. First finding added → `IN_PROGRESS` (`findings.service.ts` line 112-118)
3. Report generated → `COMPLETED` (`reports.service.ts` line 412-418)

### Finding Severity Sorting
Findings displayed sorted by:
1. `cvssScoreOverride` descending (nulls last)
2. `vulnerability.cvssScore` descending

### Vulnerability Approval Flow
1. Tester clicks "Add New" → form opens with banner: "Will be submitted for approval"
2. POST `/vulnerabilities/request` → status `PENDING`
3. Admin/TL sees in "Pending Approval" tab
4. Approve → status `APPROVED`, requester gets notification
5. Reject → status `REJECTED`, requester gets notification

### Notification Triggers
- User created → notify new user + all admins/TLs
- User updated → notify affected user
- Vulnerability requested → notify all admins/TLs (excluding requester)
- Vulnerability approved/rejected → notify requester
- Vulnerability edited → notify requester (if different from editor)

---

## Quick Start

### Option A — Run with Docker (recommended, nothing to install but Docker)

**You need:** Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux), ~4 GB free RAM, ~3 GB disk.

```bash
git clone https://github.com/sneakywarwolf/VAPT_Project-Managment.git
cd VAPT_Project-Managment
cp .env.example .env          # Windows cmd: copy .env.example .env
```

Open `.env` and replace every `CHANGE_ME` with a random value (generate one with `openssl rand -hex 32`;
on Windows PowerShell: `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })`). Then:

```bash
docker compose up -d
docker compose logs backend | grep "First login"     # shows the generated admin password
```

Open **http://localhost:3000** and log in as `admin` with that password. You will be asked to choose a new password.
First start takes a minute or two (database migrations run automatically).

| Question | Answer |
|---|---|
| Different port? | Set `FRONTEND_PORT` in `.env`, then `docker compose up -d` (and set `FRONTEND_URL` to match). |
| Choose the admin password yourself? | Set `ADMIN_PASSWORD` in `.env` before the first start. |
| Want sample data to look around? | Set `SEED_DEMO=true` before the first start (adds fake users with **known, insecure** passwords - never in production). |
| Serving over HTTPS / a domain? | Put a reverse proxy (Caddy, nginx, Traefik) in front of port 3000, set `FRONTEND_URL=https://your.domain` and `COOKIE_SECURE=true`. |
| Update | Set `PMIS_VERSION` to the new tag, then `docker compose pull && docker compose up -d`. |
| Stop / start | `docker compose stop` / `docker compose start`. Data lives in Docker volumes and survives `docker compose down` (but **not** `down -v`). |
| Back up | Database: `docker compose exec postgres pg_dump -U pmis pmis > backup.sql`. Files: back up the `minio_data` volume. |
| Logs | `docker compose logs -f backend` |

Only the web UI port is published. PostgreSQL, Redis, MinIO and the API are reachable only inside the Docker network.

**Troubleshooting**
- *Port 3000 already in use* - set `FRONTEND_PORT=3001` (and `FRONTEND_URL`) in `.env`.
- *`set POSTGRES_PASSWORD in .env` error* - you skipped a `CHANGE_ME` value or `.env` is missing.
- *Backend keeps restarting* - `docker compose logs backend`. Most often a missing/placeholder JWT secret.
- *Can't log in over http after setting `COOKIE_SECURE=true`* - that setting needs HTTPS; set it back to `false` for plain http.
- *Forgot the admin password* - run `docker compose exec postgres psql -U pmis -c "DELETE FROM users WHERE username='admin'"` (check the table name in the schema) then `docker compose restart backend` to re-seed a new admin, or use the reset utility under Development.

### Option B — Development setup (Node.js 18+ and Docker)

Runs Postgres/Redis/MinIO in Docker (`docker-compose.dev.yml`, ports published on localhost, fixed local-only passwords) and the apps with npm.

```bash
# Windows
setup.bat           # first-time: installs deps, starts infra, migrates and seeds
start-dev.bat       # dev servers with visible terminals   (or start.bat for silent mode)
stop.bat            # stop everything
reset-db.bat        # interactive reset utility (users / vulnerability DB / projects / quiz / everything)
#   non-interactive: reset-db.bat --scopes "users,projects" --yes | --scopes everything --confirm RESET | --dry-run

# Linux / macOS: ./setup.sh
```

Manual:

```bash
docker compose -f docker-compose.dev.yml up -d
cp .env.dev.example apps/backend/.env       # (setup scripts do this for you)
cd apps/backend && npm install && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && npm run start:dev
cd apps/frontend && npm install && npm run dev      # new terminal
```

In dev the seed prints the generated admin password once; set `ADMIN_PASSWORD=...` before seeding to choose it, and `SEED_DEMO=true` for sample data.

| Service (dev) | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API / Swagger | http://localhost:4000 / http://localhost:4000/api/docs |
| MinIO Console | http://localhost:9001 (`vaptminioadmin` / `vaptminioadmin123`, dev only) |

---

## Environment Variables

**Docker deployment** (`.env` from `.env.example`):

| Variable | Required | Default | Secret | Purpose |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | yes | - | yes | Database password |
| `MINIO_ROOT_PASSWORD` | yes | - | yes | File-storage password |
| `JWT_ACCESS_SECRET` | yes | - | yes | Signs access tokens (backend refuses to start in production if unset) |
| `JWT_REFRESH_SECRET` | yes | - | yes | Signs refresh tokens |
| `ADMIN_PASSWORD` | no | random, printed in backend log | yes | First admin password |
| `SEED_DEMO` | no | `false` | - | Load fake demo data (insecure passwords) |
| `FRONTEND_PORT` | no | `3000` | - | Host port for the web UI |
| `FRONTEND_URL` | no | `http://localhost:3000` | - | URL users open in the browser (CORS) |
| `COOKIE_SECURE` | no | `false` | - | `true` when served over HTTPS |
| `MINIO_ROOT_USER` | no | `pmisminio` | - | File-storage user |
| `PMIS_IMAGE_REPO` / `PMIS_VERSION` | no | `sneakywarwolf` / `latest` | - | Which Docker Hub images to run (pin a version in production) |

**Development** (`apps/backend/.env` from `.env.dev.example`): additionally `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `PORT`, `NODE_ENV`, `MAX_LOGIN_ATTEMPTS`, `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`.

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `setup.bat` | First-time setup: Docker + npm install + DB migrate + seed |
| `start.bat` | Silent start: minimized terminals, logs to `backend.log` / `frontend.log` |
| `start-dev.bat` | Debug start: full terminal windows with live output |
| `stop.bat` | Stops dev servers and Docker containers (preserves data) |
| `reset-db.bat` | Reset Application: selectively or fully clears users / vulnerabilities / projects / quiz data (DB + MinIO files + sessions), restores defaults, then restarts the servers |

### Root package.json scripts
```bash
npm run docker:up      # Start Docker containers
npm run docker:down    # Stop Docker containers
npm run db:migrate     # Run Prisma migrate dev
npm run db:seed        # Run Prisma seed
npm run db:studio      # Open Prisma Studio
```

---

## Project Structure

```
vapt-command-center/
├── .env.example              # Environment variables template
├── docker-compose.yml        # PostgreSQL 16 + Redis 7 + MinIO
├── setup.bat / setup.sh      # First-time setup scripts
├── start.bat / start-dev.bat # Start scripts
├── stop.bat                  # Stop script
├── reset-db.bat              # DB reset script
│
├── Report Template/           # DOCX template files (NOT auto-seeded)
│   ├── PCI/
│   │   └── App-Security-Test_*_Web/API/Mobile/Thick-Client_*.docx
│   └── VAPT/
│       └── App-Security-Test_*_Web/API/Mobile/Thick-Client_*.docx
│
├── apps/
│   ├── backend/               # NestJS 10 API
│   │   ├── src/
│   │   │   ├── auth/          # JWT auth, guards, decorators, DTOs
│   │   │   ├── users/         # User CRUD, team hierarchy
│   │   │   ├── projects/      # Project CRUD, status auto-update, DTOs
│   │   │   ├── findings/      # Findings & POC steps
│   │   │   ├── reports/       # Template mgmt + DOCX generation engine
│   │   │   │   ├── docx-manipulator.service.ts  # Core DOCX engine
│   │   │   │   ├── reports.service.ts           # Business logic
│   │   │   │   └── storage.service.ts           # MinIO wrapper
│   │   │   ├── vulnerabilities/ # Vuln DB + approval workflow
│   │   │   ├── dashboard/     # Analytics endpoints + gateway
│   │   │   ├── notifications/ # In-app notifications
│   │   │   ├── audit/         # Audit logging service
│   │   │   ├── prisma/        # Prisma service + module
│   │   │   ├── redis/         # Redis service (lockout, tokens)
│   │   │   └── main.ts        # Bootstrap (Helmet, CORS, Swagger)
│   │   └── prisma/
│   │       ├── schema.prisma  # Full database schema
│   │       ├── seed.ts        # Seed users, vulns, projects
│   │       └── vulnerabilities.json  # Seed vulnerability data
│   │
│   └── frontend/              # Next.js 15 App Router
│       ├── src/app/
│       │   ├── login/         # Login page (username/email + remember me)
│       │   ├── dashboard/
│       │   │   ├── layout.tsx # Sidebar, NotificationBell, auth guard
│       │   │   ├── page.tsx   # Dashboard with charts (Admin/TL views)
│       │   │   ├── projects/
│       │   │   │   ├── page.tsx    # Grid/Table toggle, search, filters
│       │   │   │   ├── new/page.tsx # Create project
│       │   │   │   └── [id]/page.tsx # Project detail + findings
│       │   │   ├── vulnerabilities/
│       │   │   │   └── page.tsx # Vuln DB + pending approvals
│       │   │   ├── users/
│       │   │   │   └── page.tsx # Admin user management
│       │   │   ├── reports/
│       │   │   │   └── page.tsx # Template management
│       │   │   ├── profile/
│       │   │   │   └── page.tsx # My Profile + password change
│       │   │   └── settings/
│       │   │       └── page.tsx # Settings placeholder
│       │   ├── layout.tsx     # Root layout with AuthProvider
│       │   └── page.tsx       # Landing redirect
│       ├── src/contexts/
│       │   └── auth-context.tsx  # AuthContext + axios instance
│       ├── next.config.js     # API proxy: /api → http://localhost:4000
│       └── tailwind.config.ts # Custom cyber theme colors
│
└── docs/
    └── REPORT-ENGINE-SPEC.md  # Detailed report engine specification
```

---

## Default Credentials

There are **no fixed default passwords**. On first start the seed creates `admin` with `ADMIN_PASSWORD` if you set it, otherwise a random password printed once in the backend log (`docker compose logs backend | grep "First login"`). You must change it at first login.

With `SEED_DEMO=true` it also creates `teamlead`, `tester1`, `tester2` with the publicly documented passwords `Tl@1234567890!` / `Tester@1234567890!` - **demo only, never on a real deployment**.

> **Login**: You can use either **username** or **email** in the login field.

---

## Security Features

- **Argon2id** password hashing (memoryCost: 65536, timeCost: 3, parallelism: 4)
- **HTTP-only JWT cookies** with refresh token rotation
- **Redis-backed account lockout**: 5 failed attempts → 15 min lock
- **RBAC middleware**: `@Roles()` decorator + default-deny via global guards
- **Helmet.js** security headers + CSP
- **CORS** configured for frontend origin only
- **Input validation** with class-validator DTOs
- **Comprehensive audit logging**: Every login, CRUD, approval logged
- **Password requirements**: Minimum 14 characters

---

## Development Guide

### Adding a New Backend Module

1. Create folder under `apps/backend/src/new-module/`
2. Create `new-module.module.ts`, `.service.ts`, `.controller.ts`
3. Import in `AppModule`
4. Add Prisma model if needed, run `npx prisma migrate dev`

### Adding a New Frontend Page

1. Create folder under `apps/frontend/src/app/dashboard/new-page/`
2. Create `page.tsx` with `'use client'` if using hooks
3. Add nav item in `dashboard/layout.tsx` `navItems` array with role filter
4. Add route in backend auth guards if needed

### Modifying the DOCX Engine

Key file: `apps/backend/src/reports/docx-manipulator.service.ts`

- **Add new field matching**: Update `buildFieldRules()` in `reports.service.ts`
- **Change highlight color detection**: Modify `hasYellowHighlight()` (supports `w:highlight` and `w:shd`)
- **Add new table type**: Modify `fillFindingsTables()` detection logic
- **Change image sizing**: Adjust `MAX_IMAGE_WIDTH_EMU` constant

### Database Migrations

```bash
cd apps/backend
npx prisma migrate dev --name description_of_change
npx prisma generate
# Update seed.ts if needed
npx prisma db seed
```

---

## Known Issues & Decisions

### 1. Report Templates Not Auto-Seeded
The 8 DOCX template files in `Report Template/` are **NOT automatically imported** into the database on setup. They must be manually uploaded via the Reports page or via a seed script. The template upload flow analyzes the DOCX, extracts yellow fields, and stores metadata in `ReportTemplate` + `TemplateField` tables.

### 2. Frontend API Proxy
Next.js dev server proxies `/api/*` to `http://localhost:4000`. Configured in `apps/frontend/next.config.js`.

### 3. Docker Data Persistence
- PostgreSQL data: `postgres_data` volume (survives `docker-compose down`)
- Redis data: `redis_data` volume with AOF persistence
- MinIO data: `minio_data` volume
- **stop.bat only stops containers, does NOT delete volumes**

### 4. MinIO Bucket Creation
The `StorageService` auto-creates the bucket on first use if it doesn't exist.

### 5. TypeScript Import Style
Backend uses `import compression from 'compression'` (ESM with `esModuleInterop`). If you see `This expression is not callable` errors, check `tsconfig.json` has `"esModuleInterop": true`.

### 6. Dashboard Nav Highlighting
The sidebar uses exact match for `/dashboard` to prevent highlighting when on `/dashboard/projects`. If adding nested dashboard routes, update the `isActive` check in `layout.tsx`.

### 7. FindingModal Search
The vulnerability search in the finding modal searches after 2 characters with 300ms debounce. Results show in a dropdown. Currently supports click-to-select; keyboard navigation (↑↓Enter/Esc) may need enhancement.

### 8. Notification Toasts
The notification bell polls every 30 seconds but does **not** show popup toasts for new notifications. It only updates the badge count. Toast notifications would require tracking the previous unread count and triggering a toast on delta.

### 9. Compliance Status vs Project Status
- `complianceStatus`: Manual dropdown (Compliant/Non-Compliant/In-Progress) — user-managed
- `status`: Auto-managed (NOT_STARTED → IN_PROGRESS → COMPLETED) — system-managed

### 10. File Upload Limits
- Report generation: 50MB max
- Template upload: 10MB max
- POC images: No explicit limit, but resized to max 5.5in width in DOCX

### 11. AVP Role
Added `AVP` to `UserRole` enum. AVP has identical permissions to Team Lead plus Admin Dashboard access. The Manager dropdown in User Management filters to only AVP users. Migration: `20260831112056_add_avp_role`.

### 12. User Management Sorting
User Management table supports click-to-sort on User, Role, and Team Lead columns. Team Lead column displays the TL's `fullName` (fallback to `username`).

### 13. Email Login Reliability
### 14. User Bulk Upload Format, User Management supports bulk upload via CSV for Admin users only. Expected headers: `S.No, Full Name, Email, Mobile, Designation, Role, Team Lead, Manager`. The upload ADDS users to the existing database — it does NOT replace or alter existing users. Auto-generated usernames are derived from the email prefix. TL and Manager are looked up by `fullName` (case-insensitive); if not found, they are left blank. Duplicate emails are skipped.
Login flow now uses explicit two-step lookup: (1) exact username match via `findUnique`, (2) case-insensitive email match via `findFirst` fallback. This is more reliable than the previous `OR` query.

---

## License

[MIT](LICENSE). See [SECURITY.md](SECURITY.md) to report vulnerabilities and [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

**Disclaimer:** PMIS is a tool for managing *authorized* security testing. You are responsible for lawful use and for protecting the vulnerability and client data you store in it. The software is provided "as is", without warranty.
