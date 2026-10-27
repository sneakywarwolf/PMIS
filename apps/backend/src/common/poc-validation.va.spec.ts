import { findingPocReadiness } from './poc-validation.util';
import { withVulnerability } from './finding-vulnerability.util';

describe('findingPocReadiness — VA exemption', () => {
  const noSteps: any[] = [];

  it('exempts project-scoped (VA) findings in Network projects, with or without Steps/PoC', () => {
    expect(findingPocReadiness({ projectScoped: true, pocSteps: noSteps }, 'NETWORK')).toBe('ready');
    expect(findingPocReadiness({ projectScoped: true, pocSteps: [{ description: '', imagePath: null }] }, 'NETWORK')).toBe('ready');
  });

  it('keeps the full requirement for PT findings in Network projects', () => {
    expect(findingPocReadiness({ projectScoped: false, pocSteps: noSteps }, 'NETWORK')).toBe('both_missing');
    expect(findingPocReadiness({ projectScoped: false, pocSteps: [{ description: 'x', imagePath: null }] }, 'NETWORK')).toBe('poc_missing');
    expect(findingPocReadiness({ pocSteps: noSteps }, 'NETWORK')).toBe('both_missing');
  });

  it('does not exempt anything outside Network projects', () => {
    expect(findingPocReadiness({ projectScoped: true, pocSteps: noSteps }, 'WEB')).toBe('both_missing');
  });
});

describe('withVulnerability — findingType', () => {
  it('marks library findings PT and project-scoped findings VA', () => {
    const pt = withVulnerability({ vulnerability: { id: 'v' } as any, projectVulnerability: null });
    const va = withVulnerability({ vulnerability: null, projectVulnerability: { id: 'p', classification: 'VA Finding' } as any });
    expect(pt.findingType).toBe('PT');
    expect(va.findingType).toBe('VA');
  });
});

describe('project-only PT findings (manual entry / file import)', () => {
  const pv = (source: string) => ({ vulnerability: null, projectVulnerability: { id: 'p', source, classification: 'PT Finding' } as any });

  it('are PT findings with no classification badge, unlike scan imports', () => {
    for (const source of ['manual', 'import']) {
      const f = withVulnerability(pv(source));
      expect(f.findingType).toBe('PT');
      expect(f.classification).toBeNull();
      expect(f.projectScoped).toBe(true);
    }
    expect(withVulnerability(pv('nessus')).findingType).toBe('VA');
  });

  it('keep the full Steps/PoC requirement in Network projects', () => {
    const f = withVulnerability({ ...pv('manual'), pocSteps: [] } as any) as any;
    expect(findingPocReadiness(f, 'NETWORK')).toBe('both_missing');
    const va = withVulnerability({ ...pv('nessus'), pocSteps: [] } as any) as any;
    expect(findingPocReadiness(va, 'NETWORK')).toBe('ready');
  });
});
