import { PayloadTooLargeException } from '@nestjs/common';
import { AttachmentSizeGuard } from './attachment-upload';
import { attachmentLimits } from './attachment-formats';

const MB = 1024 * 1024;
const run = (files: number, declared: number) => {
  const Guard = AttachmentSizeGuard('findingsImport', files);
  const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'content-length': String(declared) } }) }) };
  return () => new Guard().canActivate(ctx);
};

describe('AttachmentSizeGuard with several files', () => {
  const one = attachmentLimits.largestBytes('findingsImport');

  it('shares a fixed 200 MB budget instead of one file limit per file', () => {
    expect(run(10, 150 * MB)).not.toThrow();
    expect(run(10, 210 * MB)).toThrow(PayloadTooLargeException);
    expect(run(10, 1000 * MB)).toThrow(PayloadTooLargeException);
  });

  it('a single file keeps its own limit', () => {
    expect(run(1, one)).not.toThrow();
    expect(run(1, one + 10 * MB)).toThrow(PayloadTooLargeException);
  });
});
