export type Counts = { critical: number; high: number; medium: number; low: number; info: number };
export const SEVERITY_KEYS = ['critical', 'high', 'medium', 'low', 'info'] as const;

export const zeroCounts = (): Counts => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });

/** Saturating 0–100 score: weighted by severity, flattens out so one bad engagement doesn't peg the scale. */
export function riskScore(c: Counts): number {
  const weighted = c.critical * 10 + c.high * 5 + c.medium * 2 + c.low * 0.5;
  return Math.round(100 * (1 - Math.exp(-weighted / 40)));
}

/** Label + text color class (same hues as the severity mapping; color is never the only signal). */
export function riskLevel(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: 'Critical', cls: 'text-red-400' };
  if (score >= 45) return { label: 'High', cls: 'text-orange-400' };
  if (score >= 20) return { label: 'Medium', cls: 'text-amber-400' };
  if (score > 0) return { label: 'Low', cls: 'text-blue-400' };
  return { label: 'None', cls: 'text-gray-500' };
}
