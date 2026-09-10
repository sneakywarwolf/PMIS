/**
 * Single source of truth for "is this finding's PoC complete" across the
 * finding indicator, report preflight, and report generation gate.
 * Rule: at least one step, and at least one step with a screenshot/attachment.
 */
export function isFindingReportReady(pocSteps: { imagePath?: string | null }[]): boolean {
  return pocSteps.length > 0 && pocSteps.some((s) => !!s.imagePath);
}
