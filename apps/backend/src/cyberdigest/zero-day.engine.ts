/**
 * Zero-day classification rules. Pure functions: no database, no network, no model. Everything is decided from
 * evidence rows that carry a URL, a source and a source-stated date.
 *
 * Definition used: CONFIRMED needs credible PRIMARY evidence that exploitation was observed on a stated date, and
 * PRIMARY evidence that no fix existed at that time (either a patch released AFTER the exploitation date, or a
 * statement that no patch was available on a date on/after the exploitation date). Anything weaker stays below
 * CONFIRMED. The engine can say a case is ELIGIBLE; becoming CONFIRMED additionally needs a human approval.
 */
export type ZeroDayState = 'CONFIRMED' | 'REPORTED_UNVERIFIED' | 'KNOWN_EXPLOITED_UNCONFIRMED' | 'NOT_SUBSTANTIATED' | 'UNKNOWN';

export const EVIDENCE_KINDS = ['EXPLOITATION_OBSERVED', 'PATCH_RELEASED', 'NO_PATCH_AVAILABLE', 'VENDOR_AWARENESS', 'DISCLOSURE', 'POC_PUBLIC', 'ZERO_DAY_CLAIM', 'CONTRADICTS_EXPLOITATION', 'CONTRADICTS_ZERO_DAY'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Sources whose own statement can establish a fact. News, social posts and anything else are secondary: they only report. */
export const PRIMARY_SOURCE_TYPES = ['VENDOR', 'RESEARCHER', 'GOVERNMENT', 'INCIDENT_REPORT', 'TECHNICAL_INVESTIGATION'] as const;
export const SECONDARY_SOURCE_TYPES = ['NEWS', 'SOCIAL', 'OTHER'] as const;
export const SOURCE_TYPES = [...PRIMARY_SOURCE_TYPES, ...SECONDARY_SOURCE_TYPES] as const;

export interface EvidenceItem {
  id: string;
  kind: string;
  sourceType: string;
  sourceName: string;
  url: string;
  eventDate: Date | null;
  retracted: boolean;
}

export interface Evaluation {
  /** Primary evidence says exploitation happened (a date is not needed for this fact alone). */
  exploitationEstablished: boolean;
  /** Evidence rules for CONFIRMED are met. Still requires analyst approval. */
  eligible: boolean;
  /** The state the rules support when no analyst has chosen one. Never CONFIRMED. */
  suggested: Exclude<ZeroDayState, 'CONFIRMED'>;
  /** What is still needed for CONFIRMED. */
  missing: string[];
  /** Places where the evidence disagrees. A conflict blocks confirmation. */
  conflicts: string[];
  /** Human-readable explanation of the suggested state. */
  reasons: string[];
  /** Ids of the evidence rows the decision rests on (for the audit trail). */
  basis: string[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const isPrimary = (e: EvidenceItem) => (PRIMARY_SOURCE_TYPES as readonly string[]).includes(e.sourceType);

export function evaluate(all: EvidenceItem[], ctx: { cvePublished: boolean }): Evaluation {
  const active = all.filter((e) => !e.retracted);
  const primary = active.filter(isPrimary);
  const of = (kind: EvidenceKind, list = primary) => list.filter((e) => e.kind === kind);

  const expl = of('EXPLOITATION_OBSERVED');
  const datedExpl = expl.filter((e) => e.eventDate);
  const patches = of('PATCH_RELEASED').filter((e) => e.eventDate);
  const noPatch = of('NO_PATCH_AVAILABLE').filter((e) => e.eventDate);
  const contradictsExpl = of('CONTRADICTS_EXPLOITATION');
  const contradictsZd = of('CONTRADICTS_ZERO_DAY');
  const hasClaim = active.some((e) => e.kind === 'ZERO_DAY_CLAIM'); // a claim may come from anyone, including news
  const exploitationEstablished = expl.length > 0;

  const missing: string[] = [];
  const conflicts: string[] = [];
  const reasons: string[] = [];
  const basis: string[] = [];

  if (!ctx.cvePublished) missing.push('a published CVE record verified against CVE.org');

  // Exploitation reported by primary sources AND denied by primary sources: do not pick a side.
  if (expl.length && contradictsExpl.length) conflicts.push('Primary sources disagree on whether exploitation occurred');

  let timelineContradicts = false;
  if (!datedExpl.length) {
    missing.push('primary evidence of exploitation with the date the source gives for it');
  } else {
    const firstExploit = new Date(Math.min(...datedExpl.map((e) => e.eventDate!.getTime())));
    const lastExploit = new Date(Math.max(...datedExpl.map((e) => e.eventDate!.getTime())));
    basis.push(...datedExpl.map((e) => e.id));
    if (patches.length) {
      const firstPatch = new Date(Math.min(...patches.map((e) => e.eventDate!.getTime())));
      basis.push(...patches.map((e) => e.id));
      if (firstExploit.getTime() < firstPatch.getTime()) {
        // Sources differ about dates and the difference decides the outcome: needs a human to resolve it.
        const sources = new Set(datedExpl.map((e) => e.sourceName));
        if (sources.size > 1 && lastExploit.getTime() >= firstPatch.getTime()) conflicts.push(`Sources disagree on whether exploitation (${day(firstExploit)} to ${day(lastExploit)}) began before the patch (${day(firstPatch)})`);
      } else {
        timelineContradicts = true;
        reasons.push(`Exploitation is first dated ${day(firstExploit)}, on or after the patch released ${day(firstPatch)}, so it does not support a zero-day`);
        missing.push('primary evidence that exploitation began before a fix existed');
      }
    } else if (noPatch.some((e) => e.eventDate!.getTime() >= firstExploit.getTime())) {
      basis.push(...noPatch.map((e) => e.id));
    } else {
      missing.push('primary evidence that no patch was available when exploitation was observed');
    }
  }

  const blockedByContradiction = contradictsZd.length > 0;
  if (blockedByContradiction) {
    reasons.push('A primary source contradicts the zero-day claim');
    missing.push('resolution of the primary evidence that contradicts the zero-day claim');
  }
  if (contradictsExpl.length && !expl.length) reasons.push('A primary source contradicts the exploitation claim');
  conflicts.forEach((c) => reasons.push(c));

  const eligible = ctx.cvePublished && missing.length === 0 && conflicts.length === 0 && !blockedByContradiction && !timelineContradicts;

  let suggested: Evaluation['suggested'];
  if (conflicts.length) suggested = 'UNKNOWN';
  else if (exploitationEstablished && (timelineContradicts || blockedByContradiction)) suggested = 'KNOWN_EXPLOITED_UNCONFIRMED'; // keep the supported fact, drop the label
  else if (blockedByContradiction || (contradictsExpl.length && !expl.length)) suggested = 'NOT_SUBSTANTIATED';
  else if (exploitationEstablished) suggested = 'KNOWN_EXPLOITED_UNCONFIRMED';
  else if (hasClaim) suggested = 'REPORTED_UNVERIFIED';
  else suggested = 'UNKNOWN';

  if (!reasons.length) {
    if (suggested === 'KNOWN_EXPLOITED_UNCONFIRMED') reasons.push('Exploitation is established by primary evidence, but the evidence does not establish that it began before a fix existed');
    else if (suggested === 'REPORTED_UNVERIFIED') reasons.push('A zero-day is reported, but no qualifying primary evidence has been recorded');
    else if (suggested === 'UNKNOWN') reasons.push('There is no evidence from which to determine the status');
  }
  if (eligible) reasons.push('Evidence rules for a confirmed zero-day are met; analyst approval is still required');
  basis.push(...contradictsZd.map((e) => e.id), ...contradictsExpl.map((e) => e.id), ...expl.map((e) => e.id));

  return { exploitationEstablished, eligible, suggested, missing, conflicts, reasons, basis: [...new Set(basis)] };
}

/** Which states an analyst may move a case to directly. CONFIRMED is deliberately absent: only approve() reaches it. */
export const MANUAL_TARGETS: ZeroDayState[] = ['REPORTED_UNVERIFIED', 'KNOWN_EXPLOITED_UNCONFIRMED', 'NOT_SUBSTANTIATED', 'UNKNOWN'];
