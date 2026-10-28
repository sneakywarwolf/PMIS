import { CanActivate, ExecutionContext, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { FORTIFY_MAX_BYTES } from './fortify-parser.util';

const MB = 1024 * 1024;
const message = `This file is larger than the ${FORTIFY_MAX_BYTES / MB} MB limit for Fortify results.`;

/** Refuses a declared upload size over the limit before any of the body is read (same reason as NessusUploadSizeGuard). */
@Injectable()
export class FortifyUploadSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const declared = Number(context.switchToHttp().getRequest().headers['content-length']);
    if (Number.isFinite(declared) && declared > FORTIFY_MAX_BYTES + 4 * MB) throw new PayloadTooLargeException(message);
    return true;
  }
}

/** Held in memory only for the length of the request (a .fpr must be opened as a whole); never written anywhere. */
export const FORTIFY_UPLOAD = { storage: memoryStorage(), limits: { fileSize: FORTIFY_MAX_BYTES, files: 1 } };
