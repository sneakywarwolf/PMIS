'use client';

import { useBranding } from '@/contexts/branding-context';

export const DEFAULT_SEVERITY_COLORS: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#3b82f6', Info: '#6b7280',
};

/**
 * The severity names and colours the Admin set in Settings > Workflow. The stored value of a severity never
 * changes (it is the key); `label` is what people see, `color` and `badgeStyle` what it is drawn with.
 */
export function useSeverity() {
  const { settings } = useBranding();
  const colors: Record<string, string> = { ...DEFAULT_SEVERITY_COLORS, ...(settings?.workflow?.severityColors ?? {}) };
  const labels: Record<string, string> = settings?.workflow?.severityLabels ?? {};
  const color = (severity: string) => colors[severity] || colors.Info || DEFAULT_SEVERITY_COLORS.Info;
  return {
    label: (severity: string) => labels[severity] || severity,
    color,
    badgeStyle: (severity: string) => ({ backgroundColor: `${color(severity)}1a`, color: color(severity), borderColor: `${color(severity)}33` }),
  };
}
