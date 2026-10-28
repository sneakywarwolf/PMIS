import { formatBytes, formatClock } from './upload-progress.ts';

export interface UploadFailure {
  /** Axios-style error: `response` is missing when no answer came back at all. */
  response?: { status?: number; data?: any };
  code?: string;
  message?: string;
}

export interface UploadContext {
  fileSize: number;
  /** Bytes the browser had sent when the request ended. */
  uploaded: number;
  /** Seconds the request ran. */
  elapsed: number;
}

/**
 * Says what went wrong with a file request in words that point at the cause. A message from PMIS itself is shown
 * as it is; for everything else the point where it stopped (during the upload, or after the whole file had arrived)
 * separates a dropped connection or a proxy limit from a server that stopped while working.
 */
export function describeUploadError(e: UploadFailure, ctx: UploadContext, fallback = 'The file could not be processed.'): string {
  const status = e.response?.status;
  const serverMessage = e.response?.data?.message;
  const text = Array.isArray(serverMessage) ? serverMessage.join(' ') : typeof serverMessage === 'string' ? serverMessage : '';
  if (text) return text;

  if (status === 413) {
    return 'The file is larger than a limit on the way to PMIS. Check the limit set by your Admin in Settings > Attachments and, if PMIS runs behind your own web server or proxy, its body-size limit (for nginx: client_max_body_size 512m).';
  }
  if (status === 401) return 'Your session has ended. Sign in again, then retry.';
  if (status === 403) return 'Your role is not allowed to do this. Ask an Admin if you need access.';
  if (status === 502 || status === 503 || status === 504) {
    return `The server, or a proxy in front of it, did not answer (HTTP ${status}) after ${formatClock(ctx.elapsed)}. It may be restarting or busy, or a time limit was reached while it processed ${formatBytes(ctx.fileSize)}. Try again in a minute; if it repeats, ask your Admin to check the backend and proxy time limits.`;
  }
  if (status && status >= 500) {
    return `The server hit an error while processing the file (HTTP ${status}). Nothing was imported. Try again; if it repeats, ask your Admin to check the backend log.`;
  }
  if (!e.response) {
    const complete = ctx.fileSize > 0 && ctx.uploaded >= ctx.fileSize * 0.999;
    if (complete) {
      return `The whole file (${formatBytes(ctx.fileSize)}) was uploaded, but the connection ended after ${formatClock(ctx.elapsed)} before the server answered. The server may have restarted or run out of memory, or a proxy timed out while it was processing. Try again; if it repeats, ask your Admin to check the backend log and the proxy's read timeout.`;
    }
    return `The connection ended while uploading, after ${formatBytes(ctx.uploaded)} of ${formatBytes(ctx.fileSize)} (${formatClock(ctx.elapsed)}). Common causes: an unstable network or VPN, or a proxy or firewall limit on upload size or time. Try again; if it stops at about the same point each time, ask your Admin to raise those limits.`;
  }
  return fallback;
}
