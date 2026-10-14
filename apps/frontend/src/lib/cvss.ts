/** Drops the version prefix (CVSS:3.0/, CVSS:3.1/, CVSS:2.0/ ...) so only the vector itself is shown. Display only: stored values are not changed. */
export const stripCvssPrefix = (vector: string | null | undefined): string => (vector ?? '').trim().replace(/^CVSS:\d+(?:\.\d+)?\//i, '');
