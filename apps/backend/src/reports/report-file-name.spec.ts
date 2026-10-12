import { ReportsService } from './reports.service';

describe('report file name', () => {
  // buildReportFileName only needs the parameter rules, so a bare instance is enough.
  const svc = new (ReportsService as any)({}, {}, {}, {}, {}, {}, {}, {}) as any;
  const name = (project: any, original = '{External&Internal}_VAPT_{Client-Name}_{Document Version}_{Quarter}_{Report Date}_Non-Compliant.docx') =>
    svc.buildReportFileName(project, '1.2', { originalFileName: original, subType: 'NETWORK', fields: [] }, '12-10-2026');
  const project = { clientName: 'Testing New Project', externalInternal: 'External', startDate: new Date(), endDate: new Date() };

  it('does not leave a double underscore when a value (here the quarter) is empty', () => {
    expect(name({ ...project, quarter: '' })).toBe('External_VAPT_Testing-New-Project_1.2_12-10-2026_Non-Compliant.docx');
  });

  it('keeps the quarter when it is set', () => {
    expect(name({ ...project, quarter: 'Q3' })).toBe('External_VAPT_Testing-New-Project_1.2_Q3_12-10-2026_Non-Compliant.docx');
  });

  it('also tidies an empty value at the start or end', () => {
    expect(name({ ...project, externalInternal: '' })).toBe('VAPT_Testing-New-Project_1.2_12-10-2026_Non-Compliant.docx');
  });
});
