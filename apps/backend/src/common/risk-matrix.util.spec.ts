import { defaultRiskPair, overallRisk, riskCategory } from './risk-matrix.util';

describe('risk matrix', () => {
  it('is the supplied Overall Risk Severity matrix', () => {
    const expected = {
      High: { Low: 'Medium', Medium: 'High', High: 'Critical' },
      Medium: { Low: 'Low', Medium: 'Medium', High: 'High' },
      Low: { Low: 'Note', Medium: 'Low', High: 'Medium' },
    } as const;
    for (const impact of ['High', 'Medium', 'Low'] as const) {
      for (const likelihood of ['Low', 'Medium', 'High'] as const) expect(overallRisk(likelihood, impact)).toBe(expected[impact][likelihood]);
    }
  });

  it.each([
    ['Critical', 'High', 'High'],
    ['High', 'Medium', 'High'],
    ['Medium', 'Medium', 'Medium'],
    ['Low', 'Low', 'Medium'],
    ['Info', 'Low', 'Low'],
    ['Note', 'Low', 'Low'],
    ['informational', 'Low', 'Low'],
  ])('%s gets Likelihood %s / Impact %s, and that pair gives the same severity back', (severity, likelihood, impact) => {
    const pair = defaultRiskPair(severity)!;
    expect(pair).toEqual({ likelihood, impact });
    const back = overallRisk(pair.likelihood, pair.impact);
    expect(back).toBe(riskCategory(severity));
  });

  it('invents nothing for a missing or unsupported severity', () => {
    for (const s of [undefined, null, '', 'Unknown', 'Severe', '7']) expect(defaultRiskPair(s as any)).toBeNull();
  });
});
