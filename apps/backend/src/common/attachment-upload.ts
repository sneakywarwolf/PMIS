import { CanActivate, ExecutionContext, Injectable, PayloadTooLargeException, Type, mixin } from '@nestjs/common';
import { ATTACHMENT_FORMATS, attachmentLimits, tooLargeMessage } from './attachment-formats';

/** Room for the other form fields and the multipart framing around the file. */
const FORM_OVERHEAD_BYTES = 4 * 1024 * 1024;

/**
 * Multer limits for an upload purpose. Multer fixes its size limit when the route is set up, so this is the
 * highest value an Admin can ever set for the purpose, which keeps every Settings change effective without a
 * restart. The limit actually in force is checked by `AttachmentSizeGuard` (declared size, before the body is
 * read) and `assertAttachmentSize` (the file, by its own format).
 */
export const attachmentMulterLimits = (purpose: string) => ({
  limits: {
    fileSize: Math.max(...ATTACHMENT_FORMATS.filter((f) => f.purpose === purpose).map((f) => f.maxMb), 1) * 1024 * 1024,
    files: 1,
  },
});

/**
 * Refuses a request whose declared size is above the largest limit of the purpose, before any of the body is
 * read, so an oversized upload is not buffered first.
 */
export function AttachmentSizeGuard(purpose: string): Type<CanActivate> {
  @Injectable()
  class Guard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const declared = Number(context.switchToHttp().getRequest().headers['content-length']);
      const largest = attachmentLimits.largestBytes(purpose);
      if (Number.isFinite(declared) && declared > largest + FORM_OVERHEAD_BYTES) {
        throw new PayloadTooLargeException(tooLargeMessage(undefined, largest));
      }
      return true;
    }
  }
  return mixin(Guard);
}

/** The file against the limit of its own format (by name), for an upload that has been received. */
export function assertAttachmentSize(purpose: string, file: { originalname?: string; size?: number; buffer?: Buffer } | undefined, fileName?: string) {
  if (!file) return;
  const name = fileName ?? file.originalname;
  const limit = attachmentLimits.maxBytes(purpose, name);
  const size = file.size ?? file.buffer?.length ?? 0;
  if (size > limit) throw new PayloadTooLargeException(tooLargeMessage(name, limit));
}
