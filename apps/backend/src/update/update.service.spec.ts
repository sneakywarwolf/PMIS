import { isNewer } from './update.service';

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true);
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0', '1.0.1')).toBe(false);
  });
});
