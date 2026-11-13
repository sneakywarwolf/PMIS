import { BadRequestException } from '@nestjs/common';
import { assertTemplateUploadInput } from './template-upload-input';

describe('assertTemplateUploadInput', () => {
  const ok = { name: 'T', category: 'VAPT', subType: 'WEB', reportFormat: 'WORD', effectiveFrom: new Date('2026-01-01'), effectiveTo: null };
  it('accepts valid input, including an end date', () => {
    expect(() => assertTemplateUploadInput(ok)).not.toThrow();
    expect(() => assertTemplateUploadInput({ ...ok, reportFormat: 'EXCEL', effectiveTo: new Date('2027-01-01') })).not.toThrow();
  });
  it.each([
    [{ category: '../../evil' }], [{ category: 'vapt' }], [{ category: undefined }],
    [{ subType: 'x/y' }], [{ subType: 7 }],
    [{ reportFormat: 'PDF' }], [{ reportFormat: undefined }],
    [{ name: '' }], [{ name: 'x'.repeat(256) }], [{ name: { a: 1 } }],
    [{ effectiveFrom: new Date('nope') }], [{ effectiveFrom: '2026-01-01' }], [{ effectiveTo: new Date('nope') }],
  ])('rejects %j', (over) => {
    expect(() => assertTemplateUploadInput({ ...ok, ...over } as any)).toThrow(BadRequestException);
  });
});
