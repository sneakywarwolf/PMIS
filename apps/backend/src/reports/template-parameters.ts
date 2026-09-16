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
  { key: 'report.generationDate', label: 'Report Generation Date' },
  { key: 'project.toolsUsed', label: 'Tools Used' },
  { key: 'project.detailsAndScope', label: 'Application Details & Scope (combined)' },
  { key: 'project.scope', label: 'Scope' },
  { key: 'project.testingEnvironment', label: 'Testing Environment' },
  { key: 'project.testingType', label: 'Testing Type (Black/Grey Box)' },
  { key: 'project.loginSystemTypes', label: 'Login/Role Types' },
  { key: 'project.applicationNature', label: 'Nature/Purpose of Application' },
  { key: 'project.testingLimitation', label: 'Testing Limitation' },
  { key: 'project.applicationDetails', label: 'Build Details' },
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

export const CANONICAL_PARAMETER_KEYS = new Set(CANONICAL_TEMPLATE_PARAMETERS.map((p) => p.key));

/** Resolves a canonical parameter key to its actual value for a given project. */
export function resolveTemplateParameter(key: string, project: any, formatDate: (d: any) => string): string {
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
    case 'project.documentVersion': return project.documentVersion || '1.0';
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
    default: return '';
  }
}
