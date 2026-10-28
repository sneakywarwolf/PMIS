import { DocxManipulatorService } from './docx-manipulator.service';

const finding: any = { no: 1, title: 'SQLi', severity: 'High', cvssScore: 7.5, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', cveId: null, cweId: null };

describe('SCR reports leave CVSS blank', () => {
  const svc = Object.create(DocxManipulatorService.prototype) as DocxManipulatorService;
  const keys = ['cvss_score', 'score_value', 'cvss_vector', 'cvss'];

  it('prints empty CVSS values when hideCvss is set', () => {
    for (const k of keys) expect(svc.resolveFindingParameter(k, { ...finding, hideCvss: true })).toBe('');
  });
  it('is unchanged for other projects', () => {
    expect(svc.resolveFindingParameter('cvss_score', finding)).toBe('7.5');
    expect(svc.resolveFindingParameter('cvss_vector', finding)).toContain('AV:N');
  });
});
