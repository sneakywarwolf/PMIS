/**
 * Overall Risk Severity matrix (rows: Impact, columns: Likelihood) and the default Likelihood / Impact pair
 * used for Fortify findings in SCR projects. Fortify measures neither value, so the pair is a matrix-derived
 * default: one valid combination that yields the finding's severity, not an independent assessment.
 */
export type Level = 'Low' | 'Medium' | 'High';
export type RiskSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Note';

const MATRIX: Record<Level, Record<Level, RiskSeverity>> = {
  High: { Low: 'Medium', Medium: 'High', High: 'Critical' },
  Medium: { Low: 'Low', Medium: 'Medium', High: 'High' },
  Low: { Low: 'Note', Medium: 'Low', High: 'Medium' },
};

/** Overall Risk Severity for a Likelihood / Impact pair. */
export const overallRisk = (likelihood: Level, impact: Level): RiskSeverity => MATRIX[impact][likelihood];

const DEFAULT_PAIR: Record<RiskSeverity, { likelihood: Level; impact: Level }> = {
  Critical: { likelihood: 'High', impact: 'High' },
  High: { likelihood: 'Medium', impact: 'High' },
  Medium: { likelihood: 'Medium', impact: 'Medium' },
  Low: { likelihood: 'Low', impact: 'Medium' },
  Note: { likelihood: 'Low', impact: 'Low' },
};

/** PMIS stores the lowest category as "Info"; the matrix calls it "Note". */
const CATEGORY: Record<string, RiskSeverity> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', note: 'Note', info: 'Note', informational: 'Note',
};

/** The matrix category of a severity, or null when it is missing or not one of the supported ones. */
export const riskCategory = (severity: string | null | undefined): RiskSeverity | null => CATEGORY[(severity ?? '').trim().toLowerCase()] ?? null;

/** Default pair for a severity; null (nothing is invented) when the severity is missing or unsupported. */
export function defaultRiskPair(severity: string | null | undefined): { likelihood: Level; impact: Level } | null {
  const category = riskCategory(severity);
  return category ? { ...DEFAULT_PAIR[category] } : null;
}
