import { splitAuditDays } from './template-parameters';

describe('splitAuditDays', () => {
  const days = (n: number) => splitAuditDays('2026-10-01', new Date(Date.UTC(2026, 9, n)).toISOString());
  it('15 days -> 2, 4, 8, 1', () => expect(days(15)).toEqual(['2', '4', '8', '1']));
  it('9 days -> 1, 2.5, 4.5, 1', () => expect(days(9)).toEqual(['1', '2.5', '4.5', '1']));
  it('always sums to the inclusive duration, in 0.5 steps, reporting = 1', () => {
    for (let n = 1; n <= 31; n++) {
      const v = days(n).map(Number);
      expect(v.reduce((a, b) => a + b, 0)).toBe(n);
      expect(v.every((x) => x * 2 === Math.round(x * 2))).toBe(true);
      expect(v[3]).toBe(1);
    }
  });
  it('missing/invalid dates -> []', () => {
    expect(splitAuditDays(null, '2026-10-02')).toEqual([]);
    expect(splitAuditDays('2026-10-05', '2026-10-01')).toEqual([]);
  });
});
