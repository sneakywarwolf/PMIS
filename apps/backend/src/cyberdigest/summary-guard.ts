import { trimTrailingPunctuation } from '../common/linear-regex.util';
/**
 * Post-generation check for any summary before it is stored or shown. Whatever produced the summary (today: a trim of
 * the publisher's own text; tomorrow possibly something else), it may only contain security-critical facts that appear
 * in the retrieved evidence. Deterministic and independent of the producer: a summary that fails is dropped, never
 * "fixed up".
 */
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** Claim phrases that carry meaning on their own. If the summary asserts one, the evidence must assert it too. */
const CLAIMS: [string, RegExp][] = [
  ['zero-day claim', /zero[\s-]?day|\b0[\s-]?day\b/i],
  ['exploitation claim', /actively exploited|exploited in the wild|in the wild|under (active )?(attack|exploitation)|being exploited/i],
  ['patch claim', /\bpatch(ed|es)?\b|\bfix(ed|es)?\b|security update/i],
  ['CVSS claim', /\bcvss\b/i],
  ['severity claim', /\b(critical|high|medium|low)[\s-]severity\b|\bseverity\b/i],
  ['attribution claim', /\bAPT\d*\b|nation-state|state-sponsored/i],
];

export interface GuardResult {
  ok: boolean;
  unsupported: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

export function validateSummary(summary: string, evidence: string): GuardResult {
  const ev = norm(evidence);
  const unsupported: string[] = [];
  const tokens = new Set<string>();
  for (const m of summary.matchAll(/CVE-\d{4}-\d{4,19}/gi)) tokens.add(m[0]);
  const withoutCves = summary.replace(/CVE-\d{4}-\d{4,19}/gi, ' '); // CVE ids are checked whole above, not as number fragments
  for (const m of withoutCves.matchAll(/\d[\d.,:/-]*\d|\d/g)) tokens.add(trimTrailingPunctuation(m[0])); // scores, versions, years, counts, ISO dates
  for (const m of summary.matchAll(new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?`, 'gi'))) tokens.add(m[0]);
  for (const t of tokens) if (t && !ev.includes(norm(t))) unsupported.push(t);
  for (const [label, re] of CLAIMS) if (re.test(summary) && !re.test(evidence)) unsupported.push(label);
  return { ok: unsupported.length === 0, unsupported };
}
