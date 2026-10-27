import { CanActivate, ExecutionContext, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { StorageEngine } from 'multer';
import { NessusFinding, scanStreamFor } from './nessus-parser.util';
import { attachmentLimits, tooLargeMessage } from './attachment-formats';

/**
 * Largest scan file accepted: the limit Admins set for Nessus files (Settings > Attachments), 500 MB unless
 * changed. Nothing of the file is kept, so this only bounds how long one request may run.
 */
/** The default (and highest allowed) limit; the limit in force is `nessusMaxBytes()`. */
export const NESSUS_MAX_BYTES = 500 * 1024 * 1024;
export const nessusMaxBytes = () => attachmentLimits.largestBytes('nessus');
/** Room for the other form fields (project id, the list of selected plugin ids) and the multipart framing. */
const FORM_OVERHEAD_BYTES = 4 * 1024 * 1024;

/**
 * Refuses a declared upload size over the limit before any of the body is read. Without it a request cut short
 * on the way in (the web server's proxy copies only so much of a body) leaves the API waiting for bytes that
 * never arrive, and the upload hangs until the request times out instead of being rejected.
 */
@Injectable()
export class NessusUploadSizeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const declared = Number(context.switchToHttp().getRequest().headers['content-length']);
    if (Number.isFinite(declared) && declared > nessusMaxBytes() + FORM_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException(tooLargeMessage(undefined, nessusMaxBytes()));
    }
    return true;
  }
}

/** The uploaded file as the controller sees it: the findings read from it in `scan`, and no file content at all. */
export type ScanUpload = Express.Multer.File & { scan?: NessusFinding[] };

/**
 * Multer storage for scan uploads (.nessus or .csv). The file is read while it streams in and is never kept,
 * neither on disk nor in memory: only the findings extracted from it survive the request. A file type that is
 * not supported is refused before any of it is read.
 */
export const nessusScanStorage: StorageEngine = {
  _handleFile(_req, file, cb) {
    const stream = file.stream;
    let failed = false;
    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      stream.resume(); // let the rest of the upload drain instead of stalling the connection
      cb(err as Error);
    };

    let reader: ReturnType<typeof scanStreamFor>;
    try {
      reader = scanStreamFor(file.originalname);
    } catch (err) {
      return fail(err);
    }

    // The limit of this file's own format (.nessus or .csv), checked as it streams in.
    const limit = attachmentLimits.maxBytes('nessus', file.originalname);
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) return fail(new PayloadTooLargeException(tooLargeMessage(file.originalname, limit)));
      try {
        reader.write(chunk);
      } catch (err) {
        fail(err);
      }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (failed) return;
      try {
        cb(null, { size, scan: reader.end() } as Partial<Express.Multer.File>);
      } catch (err) {
        fail(err);
      }
    });
  },
  _removeFile(_req, _file, cb) {
    cb(null); // nothing was written anywhere
  },
};

// Multer fixes this when the route is set up: the highest value the Admin can set. The limit in force is checked
// by the guard above and, per format, while the file streams in (see _handleFile).
export const NESSUS_UPLOAD = { storage: nessusScanStorage, limits: { fileSize: NESSUS_MAX_BYTES, files: 1 } };
