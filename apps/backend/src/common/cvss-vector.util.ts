/**
 * Resolves a CVSS vector for scan-imported (VA) findings.
 *
 * A base score does not identify a vector: many metric combinations give the same score, so any
 * vector derived from a score is a *candidate*, never a confirmed fact. Rules:
 *  1. A vector that came with the scan is kept untouched ('nessus').
 *  2. Otherwise every combination of the score's CVSS version is scored with the same formulas the
 *     app's CVSS calculator uses, and only combinations that reproduce the imported score exactly
 *     are eligible.
 *  3. The project's External/Internal exposure restricts Attack Vector (EXPOSURE_AV below).
 *  4. If several combinations remain, the first in the fixed preference order below wins
 *     ('calculated', to be reviewed by a person).
 *  5. No exposure, no score, or no matching combination: nothing is guessed ('unresolved').
 */

export type CvssVersion = '3' | '2';
export type CvssVectorSource = 'nessus' | 'calculated' | 'unresolved';
export interface ResolvedVector { vector: string | null; source: CvssVectorSource }

/** Attack Vector letters allowed per exposure, in order of preference (same letters in v3 and v2). */
const EXPOSURE_AV: Record<string, string[]> = {
  External: ['N'],
  Internal: ['A', 'N'],
};

/** Preference order per metric; the first matching combination, nesting left to right, is chosen. */
const V3_ORDER = { AC: ['L', 'H'], PR: ['N', 'L', 'H'], UI: ['N', 'R'], S: ['U', 'C'], CIA: ['H', 'L', 'N'] };
const V2_ORDER = { AC: ['L', 'M', 'H'], Au: ['N', 'S', 'M'], CIA: ['C', 'P', 'N'] };

const V3_W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 } as Record<string, number>,
  AC: { L: 0.77, H: 0.44 } as Record<string, number>,
  PR_U: { N: 0.85, L: 0.62, H: 0.27 } as Record<string, number>,
  PR_C: { N: 0.85, L: 0.68, H: 0.5 } as Record<string, number>,
  UI: { N: 0.85, R: 0.62 } as Record<string, number>,
  CIA: { H: 0.56, L: 0.22, N: 0 } as Record<string, number>,
};
const V2_W = {
  AV: { L: 0.395, A: 0.646, N: 1.0 } as Record<string, number>,
  AC: { H: 0.35, M: 0.61, L: 0.71 } as Record<string, number>,
  Au: { M: 0.45, S: 0.56, N: 0.704 } as Record<string, number>,
  CIA: { N: 0, P: 0.275, C: 0.66 } as Record<string, number>,
};

function roundup(x: number): number {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

/** CVSS v3.1 base score; identical formula to the calculator in the project page. */
export function computeCvss31(m: Record<string, string>): number {
  const iss = 1 - (1 - V3_W.CIA[m.C]) * (1 - V3_W.CIA[m.I]) * (1 - V3_W.CIA[m.A]);
  const impact = m.S === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const pr = V3_W[m.S === 'U' ? 'PR_U' : 'PR_C'][m.PR];
  const expl = 8.22 * V3_W.AV[m.AV] * V3_W.AC[m.AC] * pr * V3_W.UI[m.UI];
  if (impact <= 0) return 0;
  return m.S === 'U' ? roundup(Math.min(impact + expl, 10)) : roundup(Math.min(1.08 * (impact + expl), 10));
}

/** CVSS v2 base score. */
export function computeCvss2(m: Record<string, string>): number {
  const impact = 10.41 * (1 - (1 - V2_W.CIA[m.C]) * (1 - V2_W.CIA[m.I]) * (1 - V2_W.CIA[m.A]));
  const expl = 20 * V2_W.AV[m.AV] * V2_W.AC[m.AC] * V2_W.Au[m.Au];
  const f = impact === 0 ? 0 : 1.176;
  return Math.round(((0.6 * impact + 0.4 * expl - 1.5) * f) * 10) / 10;
}

const tenth = (n: number) => Math.round(n * 10);

function findV3(score: number, avs: string[]): string | null {
  for (const AV of avs)
    for (const AC of V3_ORDER.AC)
      for (const PR of V3_ORDER.PR)
        for (const UI of V3_ORDER.UI)
          for (const S of V3_ORDER.S)
            for (const C of V3_ORDER.CIA)
              for (const I of V3_ORDER.CIA)
                for (const A of V3_ORDER.CIA) {
                  const m = { AV, AC, PR, UI, S, C, I, A };
                  if (tenth(computeCvss31(m)) === tenth(score)) return `CVSS:3.1/AV:${AV}/AC:${AC}/PR:${PR}/UI:${UI}/S:${S}/C:${C}/I:${I}/A:${A}`;
                }
  return null;
}

function findV2(score: number, avs: string[]): string | null {
  for (const AV of avs)
    for (const AC of V2_ORDER.AC)
      for (const Au of V2_ORDER.Au)
        for (const C of V2_ORDER.CIA)
          for (const I of V2_ORDER.CIA)
            for (const A of V2_ORDER.CIA) {
              const m = { AV, AC, Au, C, I, A };
              if (tenth(computeCvss2(m)) === tenth(score)) return `AV:${AV}/AC:${AC}/Au:${Au}/C:${C}/I:${I}/A:${A}`;
            }
  return null;
}

export function resolveCvssVector(input: {
  score: number | null;
  version: CvssVersion | null;
  existingVector: string | null;
  exposure: string | null | undefined;
}): ResolvedVector {
  if (input.existingVector) return { vector: input.existingVector, source: 'nessus' };
  const avs = EXPOSURE_AV[input.exposure ?? ''];
  if (input.score === null || !input.version || !avs) return { vector: null, source: 'unresolved' };
  const vector = input.version === '3' ? findV3(input.score, avs) : findV2(input.score, avs);
  return vector ? { vector, source: 'calculated' } : { vector: null, source: 'unresolved' };
}
