/**
 * Checks what an article CLAIMS about affected vendor/product/version against the authoritative CVE data. Fail-closed:
 * a claim is "supported" only on a positive match; no data means UNKNOWN, never a guess. Version ranges are not
 * evaluated here, so a version is LISTED only when it appears exactly.
 */
export type Match = 'MATCH' | 'MISMATCH' | 'UNKNOWN';
export type VersionMatch = 'LISTED' | 'NOT_LISTED' | 'UNKNOWN';

export interface AffectedClaim {
  vendor?: string;
  product?: string;
  version?: string;
}

interface Pair {
  vendor: string;
  product: string;
  versions: string[];
  hasRange: boolean;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isReal = (s: string) => s !== '' && s !== 'n a' && s !== 'unspecified' && s !== 'unknown';

function pairsFrom(cnaAffected: any[] | null | undefined, nvdAffected: { criteria: string; versionStartIncluding?: string; versionStartExcluding?: string; versionEndIncluding?: string; versionEndExcluding?: string }[] | null | undefined): Pair[] {
  const out: Pair[] = [];
  for (const a of cnaAffected ?? []) {
    const versions: string[] = [];
    let hasRange = false;
    for (const v of a?.versions ?? []) {
      if (v?.status && v.status !== 'affected') continue;
      if (v?.lessThan || v?.lessThanOrEqual) hasRange = true;
      else if (v?.version && norm(v.version) !== 'unspecified') versions.push(String(v.version));
    }
    out.push({ vendor: norm(a?.vendor), product: norm(a?.product), versions, hasRange });
  }
  for (const n of nvdAffected ?? []) {
    const p = n.criteria.split(':'); // cpe:2.3:part:vendor:product:version:...
    const ver = p[5] && p[5] !== '*' && p[5] !== '-' ? [p[5]] : [];
    out.push({ vendor: norm(p[3]?.replace(/_/g, ' ')), product: norm(p[4]?.replace(/_/g, ' ')), versions: ver, hasRange: !!(n.versionStartIncluding || n.versionStartExcluding || n.versionEndIncluding || n.versionEndExcluding) });
  }
  return out;
}

const same = (claim: string, have: string) => claim === have || (claim.length >= 3 && (have.includes(claim) || claim.includes(have)));

export function checkAffectedClaim(cve: { affected?: any[] | null; nvdAffected?: any[] | null }, claim: AffectedClaim): { vendor: Match; product: Match; version: VersionMatch } {
  const pairs = pairsFrom(cve.affected, cve.nvdAffected);
  const known = (key: 'vendor' | 'product') => pairs.map((p) => p[key]).filter(isReal);
  const matchOn = (key: 'vendor' | 'product', value?: string): Match => {
    if (!value) return 'UNKNOWN';
    const have = known(key);
    if (!have.length) return 'UNKNOWN';
    return have.some((h) => same(norm(value), h)) ? 'MATCH' : 'MISMATCH';
  };
  const vendor = matchOn('vendor', claim.vendor);
  const product = matchOn('product', claim.product);

  let version: VersionMatch = 'UNKNOWN';
  if (claim.version) {
    // Only consider entries for the claimed product when a product was claimed and is known.
    const scoped = claim.product && product === 'MATCH' ? pairs.filter((p) => same(norm(claim.product), p.product)) : pairs;
    const listed = scoped.flatMap((p) => p.versions.map(norm));
    const anyRange = scoped.some((p) => p.hasRange);
    if (listed.includes(norm(claim.version))) version = 'LISTED';
    else if (listed.length && !anyRange) version = 'NOT_LISTED';
  }
  return { vendor, product, version };
}
