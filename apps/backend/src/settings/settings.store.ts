import { DEFAULT_SETTINGS } from './settings.defaults';

export const SETTINGS_ID = 'singleton';

/** Own property only: `key in obj` is also true for inherited names such as toString, constructor and __proto__. */
export const hasOwn = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

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
    if (!hasOwn(base, key)) continue;
    result[key] = isPlainObject(base[key]) ? pruneUnknown(base[key], data[key]) : data[key];
  }
  return result;
}

export function deepMerge(base: any, patch: any): any {
  if (!isPlainObject(patch)) return base;
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue; // never write these onto a merged object
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
