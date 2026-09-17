import { BadRequestException } from '@nestjs/common';
import { validateCsvHeaders } from './csv-validation.util';

describe('validateCsvHeaders', () => {
  const expected = ['Name', 'Severity', 'CVSS'];

  it('accepts headers in the exact expected order', () => {
    expect(() => validateCsvHeaders(['Name', 'Severity', 'CVSS'], expected)).not.toThrow();
  });

  it('accepts headers reordered, since data is looked up by name not position', () => {
    expect(() => validateCsvHeaders(['CVSS', 'Name', 'Severity'], expected)).not.toThrow();
  });

  it('accepts case/spacing/punctuation differences', () => {
    expect(() => validateCsvHeaders(['name', 'SEVERITY', 'cvss'], expected)).not.toThrow();
  });

  it('rejects a missing header', () => {
    expect(() => validateCsvHeaders(['Name', 'Severity'], expected)).toThrow(BadRequestException);
  });

  it('rejects a renamed header', () => {
    expect(() => validateCsvHeaders(['Name', 'Severity', 'CVSS Score'], expected)).toThrow(BadRequestException);
  });

  it('names the missing header in the error message', () => {
    expect(() => validateCsvHeaders(['Name', 'Severity'], expected)).toThrow(/CVSS/);
  });
});
