export const TOOLTIP_STYLE = { backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' };

export const STATUS_ORDER = ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'COMPLETED'] as const;
// Keyed by status so charts match the .status-* badges (not by array order).
export const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: '#6b7280',
  IN_PROGRESS: '#3b82f6',
  AWAITING_REVIEW: '#f59e0b',
  COMPLETED: '#10b981',
};
/** "Awaiting Review" / "AWAITING REVIEW" / "AWAITING_REVIEW" → "AWAITING_REVIEW" */
export const statusKey = (name: string) => name.toUpperCase().replace(/\s+/g, '_');
export const statusColor = (name: string) => STATUS_COLORS[statusKey(name)] ?? '#6b7280';

export const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#f59e0b',
  Low: '#3b82f6',
  Info: '#6b7280',
};
