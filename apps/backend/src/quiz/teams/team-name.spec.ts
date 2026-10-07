import { cleanTeamName } from './team-name';

describe('cleanTeamName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanTeamName('  Red   Team ')).toEqual({ name: 'Red Team' });
  });

  it('treats empty/null as a reset to the default name', () => {
    expect(cleanTeamName('   ')).toEqual({ name: null });
    expect(cleanTeamName(null)).toEqual({ name: null });
  });

  it('rejects too short, too long, markup and non-text', () => {
    expect(cleanTeamName('a')).toHaveProperty('error');
    expect(cleanTeamName('x'.repeat(31))).toHaveProperty('error');
    expect(cleanTeamName('<b>hi</b>')).toHaveProperty('error');
    expect(cleanTeamName(42)).toHaveProperty('error');
  });
});
