import { BadRequestException } from '@nestjs/common';
import { TemplateCategory, TemplateSubType } from '@prisma/client';

/**
 * A template's Activity Types: its primary `subType` plus any `extraSubTypes`. Templates that predate
 * multi-select have no extras, so they cover exactly the one Activity Type they always had.
 */
export const coveredSubTypes = (t: { subType: TemplateSubType; extraSubTypes?: TemplateSubType[] | null }): TemplateSubType[] => [
  t.subType,
  ...(t.extraSubTypes ?? []),
];

/** Prisma filter: templates that cover this Activity Type (as primary or extra). */
export const coversSubType = (subType: TemplateSubType) => ({ OR: [{ subType }, { extraSubTypes: { has: subType } }] });

/** Prisma filter: templates that cover at least one of these Activity Types. */
export const coversAnySubType = (subTypes: TemplateSubType[]) => ({
  OR: subTypes.flatMap((subType) => [{ subType }, { extraSubTypes: { has: subType } }]),
});

/**
 * Prisma filter: templates eligible for a project of this category + Testing Type. For Cert-In, an `Application`
 * template is the umbrella for every non-Network Testing Type; elsewhere `Application` is not a wildcard.
 */
export const eligibleForProject = (category: TemplateCategory, subType: TemplateSubType) =>
  category === TemplateCategory.CERT_IN && subType !== TemplateSubType.NETWORK
    ? coversAnySubType([subType, TemplateSubType.APPLICATION])
    : coversSubType(subType);

/** PCI / VAPT templates are uploaded per concrete Activity Type; the `Application` umbrella is Cert-In only. */
const noApplicationCategories: TemplateCategory[] = [TemplateCategory.PCI, TemplateCategory.VAPT];

/** Cert-In templates are only offered for these Activity Types (the same two the upload form offers). */
const CERT_IN_SUB_TYPES: TemplateSubType[] = [TemplateSubType.APPLICATION, TemplateSubType.NETWORK];

/**
 * Validates the additional Activity Types sent with an upload: a JSON array or comma-separated list. Every value
 * must be a real Activity Type (and a Cert-In one for Cert-In templates); the primary and repeats are dropped.
 */
export function parseExtraSubTypes(raw: unknown, primary: TemplateSubType, category: TemplateCategory): TemplateSubType[] {
  if (noApplicationCategories.includes(category) && primary === TemplateSubType.APPLICATION) {
    throw new BadRequestException(`"Application" is not available for ${category} templates.`);
  }
  if (category === TemplateCategory.CERT_IN && !CERT_IN_SUB_TYPES.includes(primary)) {
    throw new BadRequestException(`"${primary}" is not available for Cert-In templates.`);
  }
  if (raw === undefined || raw === null || raw === '') return [];
  let values: unknown[];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try {
        values = JSON.parse(text);
      } catch {
        throw new BadRequestException('Activity Types must be a list of valid values.');
      }
    } else {
      values = text.split(',').map((v) => v.trim()).filter(Boolean);
    }
  } else {
    throw new BadRequestException('Activity Types must be a list of valid values.');
  }

  const valid = Object.values(TemplateSubType) as string[];
  const out: TemplateSubType[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || !valid.includes(v)) {
      throw new BadRequestException(`"${String(v)}" is not a valid Activity Type.`);
    }
    if (category === TemplateCategory.CERT_IN && !CERT_IN_SUB_TYPES.includes(v as TemplateSubType)) {
      throw new BadRequestException(`"${v}" is not available for Cert-In templates.`);
    }
    if (noApplicationCategories.includes(category) && v === TemplateSubType.APPLICATION) {
      throw new BadRequestException(`"Application" is not available for ${category} templates.`);
    }
    if (v !== primary && !out.includes(v as TemplateSubType)) out.push(v as TemplateSubType);
  }
  return out;
}
