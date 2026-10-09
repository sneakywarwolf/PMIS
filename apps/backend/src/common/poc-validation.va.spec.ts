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
