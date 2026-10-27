import { DEFAULT_SETTINGS } from './settings.defaults';

export const SETTINGS_ID = 'singleton';

export function isPlainObject(v: any) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Drops any key from `data` that no longer exists in `base`, recursively.
 * Prevents settings retired from a past schema version (e.g. an old
 * workflow/system field) from resurfacing via the DB and then being
 * rejected as "unknown" when the client saves them straight back.
 */
export function pruneUnknown(base: any, data: any): any {
  if (!isPlainObject(data)) return data;
  const result: any = {};
  for (const key of Object.keys(data)) {
    if (!(key in base)) continue;
    result[key] = isPlainObject(base[key]) ? pruneUnknown(base[key], data[key]) : data[key];
  }
  return result;
}

export function deepMerge(base: any, patch: any): any {
  if (!isPlainObject(patch)) return base;
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (isPlainObject(patch[key]) && isPlainObject(base[key])) {
      result[key] = deepMerge(base[key], patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}

/** The effective settings: the saved ones laid over the defaults. Needs only the database, so any service can call it. */
export async function readEffectiveSettings(prisma: { appSettings: { findUnique: (a: any) => Promise<any> } }) {
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  const stored = row ? (row.data as any) : {};
  return {
    settings: deepMerge(DEFAULT_SETTINGS, pruneUnknown(DEFAULT_SETTINGS, stored)) as typeof DEFAULT_SETTINGS,
    updatedAt: row?.updatedAt ?? null,
    updatedById: row?.updatedById ?? null,
  };
}
