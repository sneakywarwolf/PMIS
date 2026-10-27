import { ReportsService } from './reports.service';

// toFindingData is the single place report rows get their severity text from (Word, Excel and Issue Log).
const svc: any = Object.create(ReportsService.prototype);
const finding = { vulnerability: { severity: 'Critical', name: 'v' }, vulnerabilityId: 'v', cvssScoreOverride: null, pocSteps: [] } as any;

describe('report severity labels (Settings > Workflow)', () => {
  it('carries the Admin label next to the stored severity', () => {
    const d = svc.toFindingData(finding, 1, [], { Critical: 'Severe', High: 'High' });
    expect(d.severity).toBe('Critical');
    expect(d.severityLabel).toBe('Severe');
  });

  it('has no label when none is configured', () => {
    expect(svc.toFindingData(finding, 1, []).severityLabel).toBeUndefined();
  });
});
