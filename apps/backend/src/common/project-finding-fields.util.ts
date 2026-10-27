import { computeCvss31 } from './cvss-vector.util';

/**
 * Validation for a vulnerability entered by hand or imported from a file into ONE project. The fields are the
 * Vulnerability DB's own (same names, same CSV headers), so a record written here can be used by reports
 * exactly like a database entry. Everything is checked on the server; nothing from the client is trusted.
 */
export interface ProjectFindingFields {
  name: string;
  severity: string;
  cvssScore: number | null;
  cvssVector: string | null;
  description: string;
  impact: string;
  remediation: string;
  references: string;
  cveId: string | null;
  cweId: string | null;
}

export const FIELD_LIMITS = { name: 300, text: 20_000, references: 5_000, id: 200, vector: 200 } as const;

const V3_VECTOR = /^CVSS:3\.[01]\/AV:[NALP]\/AC:[LH]\/PR:[NLH]\/UI:[NR]\/S:[UC]\/C:[NLH]\/I:[NLH]\/A:[NLH]$/;
const V2_VECTOR = /^(?:CVSS:2\.0\/)?AV:[LAN]\/AC:[HML]\/Au:[MSN]\/C:[NPC]\/I:[NPC]\/A:[NPC]$/;
const CVE = /^CVE-\d{4}-\d{4,}$/i;
const CWE = /^CWE-\d+$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

const asText = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));

/** Each entry must look like `prefix-number`; a list may be separated by commas, semicolons or spaces. */
function checkIds(label: string, raw: string, re: RegExp, errors: string[]): string | null {
  if (!raw) return null;
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const bad = parts.filter((p) => !re.test(p));
  if (bad.length > 0) {
    errors.push(`${label} "${bad[0]}" is not valid (expected e.g. ${label === 'CVE ID' ? 'CVE-2024-12345' : 'CWE-79'}).`);
    return null;
  }
  return parts.map((p) => p.toUpperCase()).join(', ');
}

export function validateProjectFindingFields(
  raw: Record<string, unknown>,
  allowedSeverities: string[],
): { value?: ProjectFindingFields; errors: string[] } {
  const errors: string[] = [];
  const text = (key: string) => asText(raw[key]).replace(/\r\n/g, '\n').trim();

  const required: [keyof typeof raw & string, string, number][] = [
    ['name', 'Vulnerability Name', FIELD_LIMITS.name],
    ['severity', 'Severity', 40],
    ['description', 'Description', FIELD_LIMITS.text],
    ['impact', 'Impact', FIELD_LIMITS.text],
    ['remediation', 'Remediation', FIELD_LIMITS.text],
    ['references', 'Reference', FIELD_LIMITS.references],
  ];
  const v: Record<string, string> = {};
  for (const [key, label, max] of required) {
    v[key] = text(key);
    if (!v[key]) errors.push(`${label} is required.`);
    else if (v[key].length > max) errors.push(`${label} is too long (maximum ${max} characters).`);
  }
  for (const key of ['name', 'severity', 'description', 'impact', 'remediation', 'references', 'cvssVector', 'cveId', 'cweId']) {
    if (CONTROL_CHARS.test(text(key))) errors.push(`${key} contains control characters.`);
  }

  // Severity must be one of the labels the platform is configured with (matched case-insensitively).
  let severity = v.severity;
  if (severity) {
    const match = allowedSeverities.find((s) => s.toLowerCase() === severity.toLowerCase());
    if (match) severity = match;
    else errors.push(`Severity "${v.severity}" is not supported. Use one of: ${allowedSeverities.join(', ')}.`);
  }

  // CVSS score: 0.0-10.0
  let cvssScore: number | null = null;
  const scoreRaw = text('cvssScore');
  if (scoreRaw) {
    const n = Number(scoreRaw);
    if (!/^\d{1,2}(\.\d)?$/.test(scoreRaw) || !Number.isFinite(n) || n < 0 || n > 10) {
      errors.push(`CVSS Score "${scoreRaw}" is not valid (a number from 0.0 to 10.0).`);
    } else cvssScore = n;
  }

  // CVSS vector: v3.x with its prefix, or v2.
  let cvssVector: string | null = null;
  const vectorRaw = text('cvssVector');
  if (vectorRaw) {
    if (vectorRaw.length > FIELD_LIMITS.vector || !(V3_VECTOR.test(vectorRaw) || V2_VECTOR.test(vectorRaw))) {
      errors.push(`CVSS Vector "${vectorRaw.slice(0, 60)}" is not valid (e.g. CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N).`);
    } else {
      cvssVector = vectorRaw;
      // Same formula as the CVSS calculator: with a v3 vector and no score, the score follows from the vector.
      if (cvssScore === null && V3_VECTOR.test(vectorRaw)) {
        const metrics = Object.fromEntries(vectorRaw.split('/').slice(1).map((p) => p.split(':') as [string, string]));
        cvssScore = computeCvss31(metrics);
      }
    }
  }

  const cveId = checkIds('CVE ID', text('cveId'), CVE, errors);
  const cweId = checkIds('CWE ID', text('cweId').replace(/^(\d+)$/, 'CWE-$1'), CWE, errors);

  if (errors.length > 0) return { errors };
  return {
    errors,
    value: {
      name: v.name.replace(/\s+/g, ' '),
      severity,
      cvssScore,
      cvssVector,
      description: v.description,
      impact: v.impact,
      remediation: v.remediation,
      references: v.references,
      cveId,
      cweId,
    },
  };
}
