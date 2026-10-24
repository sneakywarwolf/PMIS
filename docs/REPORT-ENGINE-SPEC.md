# VAPT Command Center — Report Engine Specification

> **Correction (2026-10-24):** this is a historical design draft. Where it says placeholders must be yellow-highlighted (sections 3 and 5), that no longer applies: Word placeholders are detected from their literal `{…}` text. The current placeholder reference is the Reports page of the documentation site, checked against the code.

**Status:** Implemented, and since extended. Sections 1–10 are the original 2026-08-30 draft, kept as the design record; where they conflict with the code, **"Changes since the draft" below wins**.
**Draft date:** 2026-08-30 · **Status update:** 2026-10-24 (verified by reading `apps/backend/src/reports/` and `apps/backend/src/common/poc-validation.util.ts`; behaviour was not re-run end to end for this update)
**Basis:** Direct inspection of the 8 DOCX templates (`Report Template/PCI`, `Report Template/VAPT` — Web, API, Mobile, Thick-Client) and the current backend code.

---

## Changes since the draft (as of 2026-10-24)

Source for each item is the file named in brackets, under `apps/backend/src/reports/` unless stated.

### A. Decisions that were reversed or superseded

| Draft | Now |
|---|---|
| Decision 4: Document Version is manual, never auto-incremented | **Auto-incremented.** First generation is `1.0`, then `1.1`, `1.2`, … per project, never reset. The counter (`Project.reportVersionCounter`) advances only when a generation completes, so a failed run does not consume a number. `{Document Version}` resolves to this value [`reports.service.ts`, `template-parameters.ts`]. |
| Decision 6 / §1: DOCX only | **Word for all projects; Excel (`.xlsx`) additionally for Network projects.** Excel is rejected for any other project type. PDF remains removed (`reportPdfPath` is written as `null`) [`reports.service.ts`]. |
| §2.5: generation runs on request | **Queued.** `POST /reports/generate` creates a `PENDING` `ReportGeneration` and enqueues a BullMQ job (`report-generation` queue); a worker builds and uploads the file. Status is polled via `GET /reports/generate/:id/status`. One in-flight generation per project (a `PENDING` row younger than 10 minutes blocks a new one) [`report-generation.processor.ts`, `reports.service.ts`]. |
| §2.5 / §2.6: stored file linked on the project | Downloads use **signed links** (`/api/reports/download?path&fn&exp&sig`), valid one hour, checked with a constant-time signature comparison [`reports.service.ts`]. |
| §2.3: "Only findings with status APPROVED go into the report" | **Not what the code enforces.** The generation gate checks that every finding has Steps and PoC (below); `loadProjectForReport` loads every finding of the project with no status filter, and no approval check was found in `generateReport` or `preflight`. All of a project's findings go into the report. |
| §6 / §3 / §5: placeholders must be yellow-highlighted | Word placeholders are detected from literal `{…}` text; highlight is no longer required. |
| §2.1: template pinned to the project at creation | **Selected automatically** from the project's Category and Testing Type at generation. The pinned `templateId` is re-checked each time; if it is no longer active/eligible, the project is re-pointed to the eligible active template. Cert-In `Application` templates act as the umbrella for every non-Network Testing Type; for PCI/VAPT `Application` is not offered [`template-subtypes.ts`, `reports.service.ts`]. |
| §6.3: activation sets `effectiveTo` on the previous version | Still true, now **atomic**: activation takes a Postgres advisory lock per category + format, deactivates the replaced version and activates the new one in one transaction. Replaced templates referenced by reports are kept; the active template cannot be deleted [`reports.service.ts`]. |
| §2.6: file name fixed as `App-Security-Test_…_Non-Compliant.docx` | The name is built from a configurable pattern with the same parameter keys; the legacy fallback is `{Type}_{Client}_{Application}_{version}_{date}_{Compliant-|Non-Compliant-}Report.docx`. The date format comes from Admin Settings. The compliance word is empty while the project is In Progress [`reports.service.ts`]. |

### B. Added after the draft

1. **Categories and sub-types.** `TemplateCategory`: PCI, VAPT, **CERT_IN, ASV**. `TemplateSubType`: WEB, API, MOBILE, THICK_CLIENT, **NETWORK, APPLICATION**. A template may cover several Activity Types (`subType` + `extraSubTypes`) [`prisma/schema.prisma`, `template-subtypes.ts`].
2. **Generation gate and PoC readiness.** Generation is refused when a project has no findings, unless its Compliance Status is `Compliant`; and when any finding lacks Steps or PoC (every step needs text; every step needs an attachment). VA findings imported from Nessus (project-scoped) in Network projects are exempt; PT findings are not. `preflight` reports the same readiness (`Steps Missing` / `PoC Missing` / `Steps & PoC Missing`) [`common/poc-validation.util.ts`, `reports.service.ts`].
3. **Conditional blocks.** For Network projects, paragraphs `{#VA}…{/VA}` and `{#PT}…{/PT}` are kept or dropped by the project's Network Activity Type; an unmatched opening tag is logged and left as is. Scope and Detail Findings start on a new page in the Network Word report [`docx-manipulator.service.ts`].
4. **Status placeholders.** `{Project Status}` / `{Compliance Status}` print Compliant / Non-Compliant; the green/red cell background applies only when the placeholder is alone in its cell or paragraph, in both Word and Excel. In Progress prints nothing [`reports.service.ts`, `xlsx-template.service.ts`].
5. **Client SPOC.** Optional project fields (name, designation, email); placeholders resolve to `N/A` when empty.
6. **Template parameter mapping.** `CANONICAL_TEMPLATE_PARAMETERS` is the single registry used by the admin mapping UI and by generation (45 keys at this date, including `project.networkActivityType`, `project.totalScopeCount`, `project.quarter`, `project.mobilePlatform`, `project.sha1`, `project.externalInternal`, manager/TL/tester contact keys, and `report.generationDateIso`). Unknown keys resolve to an empty string. A drift test checks the documentation parameter table against the code [`template-parameters.ts`, `docs-parameters.spec.ts`].
7. **Audit-day split.** `splitAuditDays` divides the inclusive project duration into Planning : Information Gathering : Scanning & Exploitation = 1 : 2 : 4 (half-day steps), with Reporting fixed at 1 day [`template-parameters.ts`].
8. **Excel reports (Network).** Excel templates are uploaded and activated like Word ones; rows repeat per scope entry, port and finding, and plain-string cells are filled [`xlsx-template.service.ts`].
9. **Issue Log.** A CSV export of findings (`GET /reports/issue-log/:projectId`) with an admin-configurable column list from a fixed catalog (17 columns, 12 enabled by default; unknown or duplicate keys rejected). Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to prevent spreadsheet formula execution [`issue-log.ts`].
10. **Upload hardening.** `.docx` packages are checked by `assertSafeDocx` before parsing or storage; a `.xlsx` sent as a Word template is rejected with a message pointing to the Excel report type. Uploads are stored as inactive drafts with a field diff and dry-run result against the active version [`reports.service.ts`].
11. **Finding ordering.** Cert-In reports order findings Critical → High → Medium → Low → Info (score as tiebreak); other types order by score [`reports.service.ts`].
12. **Object storage.** Templates, PoC images and generated files are stored in an S3-compatible bucket, now **RustFS** (previously MinIO). The backend's `MINIO_*` variable names and the `minio` client are unchanged. Existing installs must migrate their files once; see the deployment guide section "Migrating from MinIO to RustFS" [`storage.service.ts`, `docker-compose.yml`].

### C. Still open or unverified

- Whether findings should be restricted to approved ones (see A); today they are not.
- Project-level screenshots (§3.5): no `ProjectScreenshot` model exists in `schema.prisma`; not implemented.
- Mobile / Thick-Client template field lists vs. the §3 mapping: not re-checked.
- `reportPdfPath` columns: still written (as `null`); removal not done.
- Excel and Word generation were not run against RustFS in an end-to-end report run for this update; only the storage operations were tested.

---

## 1. Purpose

The report engine exists to give testers **consistent, high-quality reports with minimal manual effort**:

- Standard vulnerability wording comes from a curated Vulnerability DB, so content stays constant across multiple reports.
- Project details are entered **once** (at project creation) and reused at generation time.
- People details (Tester / TL / AVP) come from user profiles — never re-typed.
- Output is **DOCX only**. The tester makes any final manual edits in Word. No PDF generation.

---

## 2. End-to-End Flow

### 2.1 Project creation (data captured once)

When a user creates a project, they select the **template type** (Category: PCI / VAPT × Sub-type: Web / API / Mobile / Thick-Client) and fill the project-detail form:

| Field | Example (PCI Web) |
|---|---|
| Application Name | e.g. "Payments Portal" |
| App Version | e.g. "4.2.1" |
| Client Name | e.g. "Acme Bank" |
| Location | e.g. "Mumbai, India" |
| Current Document Version | e.g. "1.0" — **manual, never auto-incremented** |
| Start Date / End Date | testing window |
| Tools Used | e.g. "Burp Suite Pro, Nmap, OWASP ZAP" |
| Scope | in-scope URLs / endpoints |
| Testing Environment | Staging / UAT / Pre-Prod / Production |
| QA Reviewer Name | **free text** |
| Application Details / Build Details | tech stack, platform notes |
| Testing Type | Black Box / Grey Box |
| Types of Login System | login roles provided for testing |
| Nature of the Application | purpose of the application |
| Testing Limitation | free text, or "N/A" |

These values are stored on the `Project` record and pulled automatically at report generation. **No re-entry at generation time.**

### 2.2 People data — from profiles

Org hierarchy: **Tester → Team Lead (TL) → AVP** (AVP is also a user with role TL).

- `User` profiles hold: full name, email, phone/contact number, designation/title.
- Tester and TL are already assigned on the project.
- The AVP is resolved through the TL's manager link.
- The report's contact table (AVP Name / Contact Number / Email, Team Lead Name / Title, Tester Name) is filled entirely from profiles — editable in the Profile Dashboard, maintained in User Management.

### 2.3 Findings — vuln DB + project-specific data

- Tester adds findings to the project by **picking from the Vulnerability DB** (not free-typing).
- The vuln DB supplies standard content: name, severity, CVSS score + vector, description, impact, remediation, references, CVE/CWE ID.
- The finding record adds project-specific data: affected URLs/paths, authentication type, vulnerability dependency, report status (Open/Fixed), tester notes.
- **CVSS override:** the DB score/vector is the default, *not* authoritative. The tester can adjust score and vector per finding using a **built-in CVSS 3.1 calculator** (metric picker → computes vector + score). The override is stored on the finding and used in the report.
- Only findings with status **APPROVED** (reviewed by TL) go into the report.

### 2.4 POC steps — numbered, with per-step snapshots

Each finding has an ordered list of **POC steps**:

- Step number (auto), step description (text), and a **screenshot upload per step**.
- At generation, steps render under "POC reproduction steps" as numbered items, each followed by its embedded snapshot image at the template's `{Fix POC Snapshot.}` position.

### 2.5 Generation

1. User clicks **Generate Report** on the project (DOCX only).
2. Engine loads the template version pinned to the project (`Project.templateId`).
3. Pre-generation check: lists any missing data (e.g. "Tools Used is empty", "Tester phone missing from profile") so the user can fix before generating.
4. Engine fills the template — see Section 3 mapping.
5. Generated DOCX is stored and linked on the project; generation is recorded in history (who, when, template version).
6. Tester downloads, hand-edits in Word if needed, and delivers. The app does not need to track post-generation manual edits.

### 2.6 Report file naming

The generated file name follows the template's own naming convention, auto-filled from project data:

```
App-Security-Test_{Client-Name}-{Application-Name}_{SubType}_v{DocumentVersion}_{YYYY-MM-DD}_Non-Compliant.docx
```

Example: `App-Security-Test_Acme-Bank-Payments-Portal_Web_v1.0_2026-09-15_Non-Compliant.docx`

- Client Name, Application Name, Document Version → from the Project record
- SubType (Web / API / Mobile / Thick-Client) → from the project's template type
- Date → generation date
- Spaces in names are sanitized to hyphens; the trailing compliance suffix matches the template file's convention

---

## 3. Field Mapping Spec (verified against actual templates)

Templates scanned: PCI Web (50 unique fields), PCI API (50), VAPT API (48). Fields are yellow-highlighted; many placeholders are **split across multiple runs** in the DOCX XML (engine must merge runs before matching — see §7).

### 3.1 Project-info fields (body + tables 0/1/3/4)

| Template placeholder | Source |
|---|---|
| `{Application Name _App-Version}` / `{API Name _App-Version}` | Project: Application Name + App Version |
| `{Client Name, Location}` | Project: Client Name + Location |
| `{Version ex – 1.0 or 2.0}` | Project: Current Document Version |
| `Start Date { Month DD, YYYY}` / `End Date { Month DD, YYYY}` | Project: Start Date / End Date (formatted "Month DD, YYYY") |
| `{ Month DD, YYYY}` (table 3, report date) | Generation date, formatted |
| `Tools Name` | Project: Tools Used |
| `{Application Details-Scope` / `Scope` | Project: Application Details + Scope |
| `{Staging/ UAT/ Pred-Prod/ Production}` | Project: Testing Environment |
| `QA Reviewer Name` | Project: QA Reviewer Name (free text) |
| `{Application Build Details}` | Project: Application/Build Details |
| `{Black Box/Grey Box}` | Project: Testing Type |
| `{Mention the Login Role Types Provided for Testing}` | Project: Types of Login System |
| `{Write Nature or Purpose of Application}` | Project: Nature of the Application |
| `{Write testing limitation if applicable otherwise put N/A}` | Project: Testing Limitation (default "N/A") |

### 3.2 People fields (table 2 + body)

| Template placeholder | Source |
|---|---|
| `AVP Name` / `Contact Number` / `Email id` | AVP user profile (resolved via TL's manager link) |
| `Team Lead Name` / `Title` | TL user profile |
| `{Tester Name}` | Tester user profile (project's assigned tester) |

### 3.3 Summary of Findings (template table 8)

Fill the template's **existing** table by cloning its data-row format — one row per approved finding:

| Template placeholder | Source |
|---|---|
| `{Vulnerability Name}` | Vulnerability DB: name |
| `{Score Value}` | Finding CVSS override → else Vulnerability DB: cvssScore |

(Row set also includes S.No / Severity / Status per the template's column layout; severity and report status come from the vuln DB / finding.)

### 3.4 Detailed Findings (template table 9 block, cloned per finding)

| Template placeholder | Source |
|---|---|
| `{Vulnerability Name}` | Vulnerability DB: name |
| `{Score Value /Vector}` | Finding CVSS override → else DB score + vector |
| `CVE/CWE ID` | Vulnerability DB: cveId / cweId (else "N/A") |
| `{Affected URL and Paths}` | Finding: affected instances |
| `{Mention Applicable Authentication Type}` | Finding: authentication type |
| `{Vulnerability Description in Detail.}` | Vulnerability DB: description (+ impact, remediation per template layout) |
| `{Vulnerability Reference Link URL}` | Vulnerability DB: references |
| `[Write POC reproduction Steps.]` | Finding: POC steps (numbered, with descriptions) |
| `{Fix POC Snapshot.}` | Finding: per-step snapshot images, embedded |

### 3.5 Project-level screenshots (body — PCI Web)

- `<Put Application UI screenshots>` and `<Put Burp Sitemap screenshots>` appear in the body.
- **Open decision (see §8):** recommended approach — allow screenshot uploads at project level and auto-embed; fallback — leave for manual Word editing since DOCX is hand-editable.

---

## 4. Data Model Additions

### 4.1 `Project` — 11 new fields

`appVersion`, `location`, `documentVersion`, `toolsUsed`, `testingEnvironment`, `qaReviewerName`, `applicationDetails`, `testingType`, `loginSystemTypes`, `applicationNature`, `testingLimitation` (+ keep existing `name`, `clientName`, `scope`, `startDate`, `endDate`, `templateId`).

### 4.2 `User` — profile fields

`fullName`, `phone`, `designation` (title). AVP resolution: TL-type users get an `assignedAvpId` link (manager), or equivalent hierarchy field.

### 4.3 `Finding` — CVSS override

Nullable `cvssScoreOverride` + `cvssVectorOverride`. Report logic: override if present, else vuln DB value.

### 4.4 New model `PocStep`

`findingId`, `stepNo` (int, ordered), `description` (text), `imagePath` (object-storage key). CRUD in the finding UI; images embedded at generation.

### 4.5 Optional: `ProjectScreenshot`

`projectId`, `kind` (APP_UI / BURP_SITEMAP), `imagePath` — only if §3.5 auto-embed is approved.

---

## 5. CVSS 3.1 Calculator (frontend)

- Metric picker UI (AV, AC, PR, UI, S, C, I, A) inside the finding form.
- Computes the vector string and base score client-side; writes both to the finding's override fields.
- Severity label derived from score per CVSS 3.1 bands.

---

## 6. Template Versioning & Safe Upload (Admin)

**Principle: templates are immutable and versioned — never overwrite, always upload a new version.**

1. **Upload as draft** — new DOCX for a category + sub-type. Old version untouched.
2. **Automatic validation** before activation:
   - Mandatory placeholders present (summary table: `{Vulnerability Name}`, `{Score Value}`; detailed block: score/vector, CVE/CWE, affected URLs, auth type, description, references, POC steps, snapshot).
   - Field diff vs. previous version (new/removed fields shown to admin).
   - Findings tables detected structurally.
   - **Dry-run generation** against a dummy project — must render without error.
3. **Review & activate** — admin sets `effectiveFrom`; previous version auto-gets `effectiveTo` and deactivates. Old file + field records are kept permanently.
4. **Per-project pinning** — projects keep the template version they were created with; old projects regenerate in their original format. New projects use the active version.
5. **Formatting rules shown on the upload screen** — yellow-highlight every placeholder; keep placeholder text contiguous; don't rename mandatory placeholders; keep findings-table header rows intact. Violations fail validation with a specific message, never a runtime crash.

Schema support already present: `effectiveFrom`, `effectiveTo`, `isActive`, `fileHash`.

---

## 7. Engine Rebuild Items (`docx-manipulator.service.ts`)

| # | Change | Reason (found by inspection) |
|---|---|---|
| 1 | Merge runs split mid-placeholder before extraction/replacement | Real templates split e.g. `{`, `Client Name, Location`, `}` into 3 runs; current extractor registers garbage fields like `{` |
| 2 | Fill the template's **existing** summary + detailed-findings tables by cloning row formats | Current code appends new generic tables at the end → duplicated, wrongly-styled sections |
| 3 | Remove hardcoded CVSS vector in generated content | Currently emits `AV:N/AC:L/.../H` regardless of the actual finding |
| 4 | Embed images (POC snapshots, project screenshots) into the DOCX | Currently only text bullet lists of file paths |
| 5 | Drop PDF generation entirely | Owner decision: DOCX only |
| 6 | Replace the generation-time `fieldData` form with automatic pulls from Project + profiles + findings | Data is entered once at creation, per owner flow |
| 7 | Replace fragile substring matching with exact normalized placeholder matching | Substrings like "description"/"score" collide across fields |
| 8 | Pre-generation completeness check (missing data report) | Prevents broken reports |

---

## 8. Decisions Log (agreed 2026-08-30)

1. AVP = user with TL role (manager of the TL); details from User Management profiles.
2. QA Reviewer Name = free text at project creation.
3. CVSS per-finding override allowed, via built-in calculator; DB value is the default, not authoritative.
4. Document Version is manual — never auto-incremented.
5. Single tester per project; no multi-tester support.
6. DOCX only; tester hand-edits after generation. No PDF.
7. Templates are versioned/immutable with validation + dry-run before activation.
8. Generated report file name follows the template naming convention, auto-filled from project data (§2.6).

## 9. Open Items

- [ ] Project-level screenshots (§3.5): auto-embed uploads vs. manual Word editing.
- [ ] Mobile / Thick-Client templates: verify their field lists match this mapping (only Web/API scanned in detail so far).
- [ ] Whether vuln DB curation is restricted to TL/Admin (recommended, for content consistency).
- [ ] `reportPdfPath` columns in schema — keep for compatibility or remove in the schema migration.

## 10. Updated Roadmap Position

- Phase 4 (Report Engine) scope is now fully defined by this document: schema additions → profile UI → project form → POC steps UI → CVSS calculator → engine rebuild → template versioning flow → end-to-end verification against all 8 templates.
