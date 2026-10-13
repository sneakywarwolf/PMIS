import { parseCsv, MAX_CSV_COLUMNS, MAX_CSV_ROWS } from './csv-validation.util';

describe('parseCsv limits', () => {
  it('parses normal input', () => expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]));
  it('rejects too many columns', () => {
    expect(() => parseCsv(Array(MAX_CSV_COLUMNS + 1).fill('x').join(','))).toThrow(/exceeds/);
  });
  it('rejects too many rows', () => {
    expect(() => parseCsv('x\n'.repeat(MAX_CSV_ROWS + 1))).toThrow(/exceeds/);
  });
});
