import { findingPocReadiness } from './poc-validation.util';

const pt = (over: any = {}) => ({ projectScoped: true, findingType: 'PT' as const, proofOfConcept: 'proof', pocSteps: [], ...over });

describe('report readiness of a PT finding with imported POC/Results', () => {
  it.each(['WEB', 'NETWORK', 'SCR', 'MOBILE'])('is ready without Steps/PoC in a %s project', (sub) => {
    expect(findingPocReadiness(pt(), sub)).toBe('ready');
  });

  it('nothing changes without POC/Results (empty, blank, missing) or for a Vulnerability-DB finding', () => {
    for (const proofOfConcept of ['', '  \n ', null, undefined]) expect(findingPocReadiness(pt({ proofOfConcept }), 'WEB')).toBe('both_missing');
    expect(findingPocReadiness(pt({ projectScoped: false }), 'WEB')).toBe('both_missing');
    expect(findingPocReadiness(pt({ proofOfConcept: null, pocSteps: [{ description: 'x' }] }), 'WEB')).toBe('poc_missing'); // still judged by its steps when it has no POC text
  });

  it('VA findings keep their own rule', () => {
    expect(findingPocReadiness(pt({ findingType: 'VA' }), 'WEB')).toBe('both_missing');
    expect(findingPocReadiness(pt({ findingType: 'VA' }), 'NETWORK')).toBe('ready');
  });
});
