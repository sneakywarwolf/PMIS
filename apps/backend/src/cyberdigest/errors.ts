import { SafeFetchError } from './safe-fetch';
import { UpstreamFormatError } from './cve-clients';

/** Text that is stored and shown in dashboards. Only our own network/format errors are described; anything else (database, runtime) stays out of the UI. */
export const publicError = (e: unknown): string =>
  (e instanceof SafeFetchError ? `${e.kind}: ${e.message}` : e instanceof UpstreamFormatError ? `format: ${e.message}` : 'internal error').slice(0, 300);
