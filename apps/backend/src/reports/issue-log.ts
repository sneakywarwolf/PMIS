/**
 * Issue Log column catalog. Keys are the finding-parameter names already
 * understood by DocxManipulatorService.resolveFindingParameter (the existing
 * Application Parameter Registry) — this file only decides which of them
 * appear in the Issue Log and in what order; it never resolves values itself.
 * `constant` columns are Issue-Log-only and don't exist in the registry.
 */
export interface IssueLogColumnDef {
  key: string;
  label: string;
  constant?: string;
}

export interface IssueLogColumnConfig {
  key: string;
  label: string; // display only (for the admin UI); headers always come from the catalog
  enabled: boolean;
}

export const ISSUE_LOG_CATALOG: IssueLogColumnDef[] = [
  { key: 's_no', label: 'S. No' },
  { key: 'vulnerability_name', label: 'Vulnerability Name' },
  { key: 'affected_url', label: 'Affected URL' },
  { key: 'severity', label: 'Risk Rating' },
  { key: 'cvss_score', label: 'CVSS Base Score' },
  { key: 'cvss_vector', label: 'CVSS Vector' },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Description' },
  { key: 'impact', label: 'Impact' },
  { key: 'remediation', label: 'Remediation' },
  { key: 'panacea_remarks', label: 'Panacea Remarks', constant: 'N/A' },
  { key: 'client_remarks', label: 'Client Remarks', constant: 'N/A' },
  // Available to enable from Admin Settings; off by default.
  { key: 'cve_id', label: 'CVE ID' },
  { key: 'cwe_id', label: 'CWE ID' },
  { key: 'references', label: 'References' },
  { key: 'authentication_type', label: 'Authentication Type' },
  { key: 'vulnerability_dependency', label: 'Vulnerability Dependency' },
];

const DEFAULT_ENABLED = 12; // the standard headers, in order
export const ISSUE_LOG_DEFAULT_COLUMNS: IssueLogColumnConfig[] = ISSUE_LOG_CATALOG.map((c, i) => ({
  key: c.key,
  label: c.label,
  enabled: i < DEFAULT_ENABLED,
}));

const CATALOG_BY_KEY = new Map(ISSUE_LOG_CATALOG.map((c) => [c.key, c]));

/** Stored config -> ordered, enabled column defs. Unknown keys are dropped. */
export function resolveIssueLogColumns(stored: IssueLogColumnConfig[] | undefined): IssueLogColumnDef[] {
  const cols = (stored?.length ? stored : ISSUE_LOG_DEFAULT_COLUMNS).filter((c) => c.enabled && CATALOG_BY_KEY.has(c.key));
  return cols.map((c) => CATALOG_BY_KEY.get(c.key)!);
}

export function validateIssueLogColumns(columns: any): string | null {
  if (!Array.isArray(columns)) return 'issueLog.columns must be an array';
  const seen = new Set<string>();
  for (const c of columns) {
    if (!c || typeof c.key !== 'string' || !CATALOG_BY_KEY.has(c.key)) return `issueLog.columns has unknown column "${c?.key}"`;
    if (typeof c.enabled !== 'boolean') return `issueLog.columns["${c.key}"].enabled must be a boolean`;
    if (seen.has(c.key)) return `issueLog.columns has duplicate column "${c.key}"`;
    seen.add(c.key);
  }
  if (!columns.some((c: IssueLogColumnConfig) => c.enabled)) return 'issueLog.columns needs at least one enabled column';
  return null;
}

// Prefix formula-triggering leading characters so Excel doesn't execute finding text.
const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

// Header labels come from the fixed catalog, so they are written as plain text and only quoted when CSV syntax
// requires it (comma, quote or line break). Data cells always stay quoted, and neutralised, as before.
const headerCell = (label: string) => (/[",\r\n]/.test(label) ? csvCell(label) : label);

export function buildIssueLogCsv(columns: IssueLogColumnDef[], rows: string[][]): string {
  const lines = [columns.map((c) => headerCell(c.label)).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
