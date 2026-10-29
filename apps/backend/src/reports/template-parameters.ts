/**
 * Canonical list of application parameters a template field can be mapped to.
 * Single source of truth for both the admin mapping UI and generation-time
 * value resolution, so a key here always resolves the same way everywhere.
 */
export const CANONICAL_TEMPLATE_PARAMETERS: { key: string; label: string }[] = [
  { key: 'project.startDate', label: 'Project Start Date' },
  { key: 'project.endDate', label: 'Project End Date' },
  { key: 'project.startEndDateRange', label: 'Start & End Date (combined)' },
  { key: 'project.qaReviewerName', label: 'QA Reviewer Name' },
  { key: 'project.teamLeadName', label: 'Team Lead Name' },
  { key: 'project.testerName', label: 'Tester Name' },
  { key: 'project.appNameVersion', label: 'Application Name & Version (combined)' },
  { key: 'project.applicationName', label: 'Application Name' },
  { key: 'project.appVersion', label: 'App Version' },
  { key: 'project.documentVersion', label: 'Document Version' },
  { key: 'project.clientNameLocation', label: 'Client Name & Location (combined)' },
  { key: 'project.clientName', label: 'Client Name' },
  { key: 'project.clientSpocName', label: 'Client SPOC Name' },
  { key: 'project.clientSpocDesignation', label: 'Client SPOC Designation' },
  { key: 'project.clientSpocEmail', label: 'Client SPOC Email ID' },
  { key: 'report.generationDate', label: 'Report Generation Date' },
  { key: 'report.name', label: 'Report Name (Generated Filename)' },
  { key: 'project.platformType', label: 'Testing Type (Platform)' },
  { key: 'project.toolsUsed', label: 'Tools Used' },
  { key: 'project.detailsAndScope', label: 'Application Details & Scope (combined)' },
  { key: 'project.scope', label: 'Scope' },
  { key: 'project.testingEnvironment', label: 'Testing Environment' },
  { key: 'project.testingType', label: 'Testing Type (Black/Grey Box)' },
  { key: 'project.loginSystemTypes', label: 'Login/Role Types' },
  { key: 'project.applicationNature', label: 'Nature/Purpose of Application' },
  { key: 'project.testingLimitation', label: 'Testing Limitation' },
  { key: 'project.applicationDetails', label: 'Build Details' },
  { key: 'project.mobilePlatform', label: 'Mobile Platform (Android/iOS)' },
  { key: 'project.sha1', label: 'SHA-1 Hash' },
  { key: 'project.externalInternal', label: 'Scope Exposure (External/Internal)' },
  { key: 'project.networkActivityType', label: 'Network Activity Type (VA/PT/VAPT)' },
  { key: 'project.totalScopeCount', label: 'Total Scope Count' },
  { key: 'project.quarter', label: 'Quarter' },
  { key: 'report.generationDateIso', label: 'Report Date (format set in Admin Settings)' },
  { key: 'manager.fullName', label: 'Manager Name' },
  { key: 'manager.designation', label: 'Manager Designation' },
  { key: 'manager.phone', label: 'Manager Phone' },
  { key: 'manager.email', label: 'Manager Email' },
  { key: 'teamLead.designation', label: 'Team Lead Designation' },
  { key: 'teamLead.phone', label: 'Team Lead Phone' },
  { key: 'teamLead.email', label: 'Team Lead Email' },
  { key: 'tester.designation', label: 'Tester Designation' },
  { key: 'tester.phone', label: 'Tester Phone' },
  { key: 'tester.email', label: 'Tester Email' },
];

/**
 * Splits a project's inclusive duration (End - Start + 1 days) across the
 * four audit phases: Reporting is always 1 day; the rest is split
 * Planning : Information Gathering : Scanning & Exploitation = 1 : 2 : 4 in
 * 0.5-day steps. Planning and Information Gathering round to the nearest
 * half day; Scanning takes the remainder, so the total is always exact.
 * 15 days -> 2, 4, 8, 1. Returns [] when dates are missing/invalid.
 */
export function splitAuditDays(startDate: any, endDate: any): string[] {
  const s = startDate ? new Date(startDate).getTime() : NaN;
  const e = endDate ? new Date(endDate).getTime() : NaN;
  if (isNaN(s) || isNaN(e) || e < s) return [];
  const total = Math.round((e - s) / 86400000) + 1;
  const reporting = Math.min(1, total);
  const units = (total - reporting) * 2; // half-days to share across the other three
  const planning = Math.round(units / 7);
  const gathering = Math.round((units * 2) / 7);
  const scanning = units - planning - gathering;
  return [planning / 2, gathering / 2, scanning / 2, reporting].map(String);
}

export const CANONICAL_PARAMETER_KEYS = new Set(CANONICAL_TEMPLATE_PARAMETERS.map((p) => p.key));

export const PLATFORM_TYPE_LABELS: Record<string, string> = {
  WEB: 'Web Application',
  API: 'API',
  MOBILE: 'Mobile Application',
  THICK_CLIENT: 'Thick Client',
  NETWORK: 'Network',
  APPLICATION: 'Application',
  SCR: 'Secure Code Review',
};

/**
 * Resolves a canonical parameter key to its actual value for a given project.
 * `version` is this report generation's progressive version (e.g. "1.2",
 * from Project.reportVersionCounter) — Document Version tracks it rather
 * than a static field, so it auto-increments across generations the same
 * way the report's own version number does.
 * `reportName` is the final generated report filename (after all parameter
 * substitutions and filename normalization) — only known once
 * buildReportFileName() has run, so it's undefined while resolving the
 * filename pattern itself.
 */
export function resolveTemplateParameter(key: string, project: any, formatDate: (d: any) => string, version?: string, reportDate?: string, reportName?: string): string {
  const tl = project.tl;
  const tester = project.tester;
  const manager = project.tl?.manager;
  const appLabel = project.subType === 'API' ? 'API' : 'Application';
  const appNameVersion = [project.name, project.appVersion].filter(Boolean).join(' ');

  switch (key) {
    case 'project.startDate': return formatDate(project.startDate);
    case 'project.endDate': return formatDate(project.endDate);
    case 'project.startEndDateRange':
      return `Start Date ${formatDate(project.startDate)}, to End Date ${formatDate(project.endDate)}`;
    case 'project.qaReviewerName': return project.qaReviewerName || 'N/A';
    case 'project.teamLeadName': return tl?.fullName || tl?.username || '';
    case 'project.testerName': return tester?.fullName || tester?.username || '';
    case 'project.appNameVersion': return appNameVersion || `${appLabel} Name`;
    case 'project.applicationName': return project.name || '';
    case 'project.appVersion': return project.appVersion || '';
    case 'project.documentVersion': return version || project.documentVersion || '1.0';
    case 'manager.fullName': return manager?.fullName || manager?.username || 'N/A';
    case 'manager.designation': return manager?.designation || 'N/A';
    case 'manager.phone': return manager?.phone || 'N/A';
    case 'manager.email': return manager?.email || 'N/A';
    case 'teamLead.designation': return tl?.designation || 'N/A';
    case 'teamLead.phone': return tl?.phone || 'N/A';
    case 'teamLead.email': return tl?.email || 'N/A';
    case 'tester.designation': return tester?.designation || 'N/A';
    case 'tester.phone': return tester?.phone || 'N/A';
    case 'tester.email': return tester?.email || 'N/A';
    case 'project.clientNameLocation': return [project.clientName, project.location].filter(Boolean).join(', ');
    case 'project.clientName': return project.clientName || '';
    case 'project.clientSpocName': return project.clientSpocName || 'N/A';
    case 'project.clientSpocDesignation': return project.clientSpocDesignation || 'N/A';
    case 'project.clientSpocEmail': return project.clientSpocEmail || 'N/A';
    case 'report.generationDate': return formatDate(new Date());
    case 'project.toolsUsed': return project.toolsUsed || '';
    case 'project.detailsAndScope': return [project.applicationDetails, project.scope].filter(Boolean).join('\n');
    case 'project.scope': return project.scope || '';
    case 'project.testingEnvironment': return project.testingEnvironment || '';
    case 'project.testingType': return project.testingType || '';
    case 'project.loginSystemTypes': return project.loginSystemTypes || '';
    case 'project.applicationNature': return project.applicationNature || '';
    case 'project.testingLimitation': return project.testingLimitation || 'N/A';
    case 'project.applicationDetails': return project.applicationDetails || '';
    case 'project.mobilePlatform': return project.mobilePlatform || '';
    case 'project.sha1': return project.sha1 || '';
    case 'project.externalInternal': return project.externalInternal || '';
    case 'project.networkActivityType': return project.networkActivityType || '';
    case 'project.totalScopeCount': return project.totalScopeCount != null ? String(project.totalScopeCount) : '';
    case 'project.quarter': return project.quarter || '';
    case 'report.generationDateIso': return reportDate ?? new Date().toISOString().slice(0, 10);
    case 'report.name': return reportName || '';
    case 'project.platformType': return PLATFORM_TYPE_LABELS[project.subType] || project.subType || '';
    default: return '';
  }
}
