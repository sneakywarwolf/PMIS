import { CANONICAL_TEMPLATE_PARAMETERS, resolveTemplateParameter } from './template-parameters';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ReportsService } from './reports.service';

const scr = { subType: 'SCR', codeLocation: 'git@host:repo.git', systemUsername: 'scanuser', systemHostname: 'SCAN-01' };
const other = { subType: 'WEB', codeLocation: 'other', systemUsername: 'otheruser', systemHostname: 'OTHER-02' };

describe('SCR project fields in reports', () => {
  it('are registered in the Application Parameter Registry', () => {
    const keys = CANONICAL_TEMPLATE_PARAMETERS.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['project.codeLocation', 'project.systemUsername', 'project.systemHostname']));
  });
  it('resolve from the project that is being reported, and are blank when empty', () => {
    expect(resolveTemplateParameter('project.codeLocation', scr, String)).toBe('git@host:repo.git');
    expect(resolveTemplateParameter('project.systemUsername', scr, String)).toBe('scanuser');
    expect(resolveTemplateParameter('project.systemHostname', scr, String)).toBe('SCAN-01');
    expect(resolveTemplateParameter('project.systemHostname', other, String)).toBe('OTHER-02'); // each project has its own
    expect(resolveTemplateParameter('project.codeLocation', {}, String)).toBe('');
  });
  it('fill {Code Location}, {system username} and {system hostname} in a report, ahead of {Location}', () => {
    const svc = Object.create(ReportsService.prototype) as any;
    svc.formatReportDate = () => '';
    svc.formatEndDate = () => '';
    const rules = svc.buildFieldRules({ ...scr, location: 'Pune' });
    const lookup = new DocxManipulatorService().buildResolver(rules);
    expect(lookup('code_location')).toBe('git@host:repo.git');
    expect(lookup('system_username')).toBe('scanuser');
    expect(lookup('system_hostname')).toBe('SCAN-01');
    expect(lookup('location')).toBe('Pune'); // the existing {Location} is unchanged
  });
});
