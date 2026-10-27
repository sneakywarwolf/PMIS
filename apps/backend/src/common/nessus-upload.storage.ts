import { CanActivate, ExecutionContext, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { StorageEngine } from 'multer';
import { NessusFinding, scanStreamFor } from './nessus-parser.util';

/** Largest scan file accepted. Nothing of it is kept, so this only bounds how long one request may run. */
export const NESSUS_MAX_BYTES = 500 * 1024 * 1024;
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
    if (Number.isFinite(declared) && declared > NESSUS_MAX_BYTES + FORM_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException(`This file is larger than ${NESSUS_MAX_BYTES / (1024 * 1024)} MB, the upload limit.`);
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

    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
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

export const NESSUS_UPLOAD = { storage: nessusScanStorage, limits: { fileSize: NESSUS_MAX_BYTES, files: 1 } };
