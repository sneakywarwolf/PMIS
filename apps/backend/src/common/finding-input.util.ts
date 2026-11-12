import { BadRequestException } from '@nestjs/common';

const TEXT_MAX = 200_000; // generous: PoC and notes can be long, but not unbounded
const LIST_MAX = 20_000;
const ITEM_MAX = 5_000;

/**
 * The findings routes take inline-typed bodies, which the global validation pipe does not check. Without this, a wrong type
 * reaches Prisma (an unhandled 500), and numbers outside the CVSS range or megabyte-long values are stored and printed in reports.
 * Only the fields present in `data` are checked, so partial updates behave as before.
 */
export function assertFindingInput(data: any): void {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('Invalid request body');
  const bad = (field: string, why: string): never => { throw new BadRequestException(`${field} ${why}`); };

  for (const f of ['testerNotes', 'authenticationType', 'proofOfConcept', 'vulnerabilityDependency', 'reportStatus', 'cvssVectorOverride']) {
    const v = data[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') bad(f, 'must be text');
    if (v.length > TEXT_MAX) bad(f, `is too long (at most ${TEXT_MAX} characters)`);
  }
  const instances = data.affectedInstances;
  if (instances !== undefined && instances !== null) {
    if (!Array.isArray(instances) || instances.length > LIST_MAX) bad('affectedInstances', `must be a list of at most ${LIST_MAX} items`);
    if (instances.some((i: unknown) => typeof i !== 'string' || i.length > ITEM_MAX)) bad('affectedInstances', 'must contain only text items');
  }
  const score = data.cvssScoreOverride;
  if (score !== undefined && score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10)) {
    bad('cvssScoreOverride', 'must be a number from 0 to 10');
  }
}
