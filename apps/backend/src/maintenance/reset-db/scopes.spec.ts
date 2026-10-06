import { parseScopeNames, parseSelection } from './scopes';

describe('parseSelection (interactive menu)', () => {
  it.each([
    ['1', ['users']],
    ['3', ['projects']],
    ['1,3', ['users', 'projects']],
    ['4 2 1', ['users', 'vulnerabilities', 'quiz']], // menu order, any input order
    ['1, 1', ['users']], // duplicates collapse
  ])('%s → %j', (input, scopes) => {
    expect(parseSelection(input)).toEqual({ scopes });
  });

  it('Reset Everything absorbs every other choice', () => {
    expect(parseSelection('1,5,3')).toEqual({ scopes: ['everything'] });
  });

  it('Cancel (6) wins over everything else', () => {
    expect(parseSelection('5,6')).toEqual({ cancel: true });
    expect(parseSelection('6')).toEqual({ cancel: true });
  });

  it.each(['', '   ', '0', '7', 'abc', '1,x', '1.5', '-1'])('rejects %j without guessing', (input) => {
    expect(parseSelection(input)).toHaveProperty('error');
  });
});

describe('parseScopeNames (--scopes)', () => {
  it('accepts names and aliases, returns canonical order', () => {
    expect(parseScopeNames('quiz,vulns,Users')).toEqual({ scopes: ['users', 'vulnerabilities', 'quiz'] });
  });
  it('everything / all absorb the rest', () => {
    expect(parseScopeNames('users,all')).toEqual({ scopes: ['everything'] });
  });
  it('rejects unknown names', () => {
    expect(parseScopeNames('users,database')).toHaveProperty('error');
    expect(parseScopeNames('')).toHaveProperty('error');
  });
});
