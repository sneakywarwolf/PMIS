export type PocReadiness = 'ready' | 'steps_missing' | 'poc_missing' | 'both_missing';

interface PocStepLike {
  description?: string | null;
  imagePath?: string | null;
}

/**
 * At least one step must exist, and every step must carry real,
 * non-whitespace text — one filled step does not excuse another blank one.
 */
function hasValidSteps(pocSteps: PocStepLike[]): boolean {
  return pocSteps.length > 0 && pocSteps.every((s) => !!s.description && s.description.trim().length > 0);
}

/**
 * A step counts as having PoC evidence only if it carries a persisted attachment
 * path. This trusts the DB record rather than probing object storage per
 * finding on every list load.
 * ponytail: doesn't verify the file still exists in MinIO, upgrade to a
 * storage.statObject() check if orphaned references become a real problem.
 */
function hasValidPoc(pocSteps: PocStepLike[]): boolean {
  return pocSteps.some((s) => !!s.imagePath && s.imagePath.trim().length > 0);
}

/**
 * Single source of truth for finding readiness — reused by the finding
 * indicator, report preflight, and report generation gate so they can never
 * disagree.
 */
export function getPocReadiness(pocSteps: PocStepLike[]): PocReadiness {
  const stepsOk = hasValidSteps(pocSteps);
  const pocOk = hasValidPoc(pocSteps);
  if (stepsOk && pocOk) return 'ready';
  if (!stepsOk && !pocOk) return 'both_missing';
  return stepsOk ? 'poc_missing' : 'steps_missing';
}

export function isFindingReportReady(pocSteps: PocStepLike[]): boolean {
  return getPocReadiness(pocSteps) === 'ready';
}
