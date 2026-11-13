import { IMPORT_ROW_LIMITS } from './settings.defaults';

/**
 * Maximum data rows per Import Project Findings file, from the effective settings. A missing, malformed or out-of-range stored
 * value falls back to the default, so the limit can never be switched off. Read once when an import starts: a later change
 * applies to the next import, never to one in progress.
 */
export function resolveImportRowLimit(settings: { imports?: { maxRowsPerFile?: unknown } } | null | undefined): number {
  const v = settings?.imports?.maxRowsPerFile;
  const { min, max, fallback } = IMPORT_ROW_LIMITS;
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}
