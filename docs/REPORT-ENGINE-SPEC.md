# VAPT Command Center — Report Engine Specification

**Status:** Review draft — awaiting owner approval. No code changes have been made.
**Date:** 2026-08-30
**Basis:** Direct inspection of the 8 DOCX templates (`Report Template/PCI`, `Report Template/VAPT` — Web, API, Mobile, Thick-Client) and the current backend code.

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

`findingId`, `stepNo` (int, ordered), `description` (text), `imagePath` (MinIO object). CRUD in the finding UI; images embedded at generation.

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
