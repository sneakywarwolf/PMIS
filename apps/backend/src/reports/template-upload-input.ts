import { BadRequestException } from '@nestjs/common';
import { ReportFormat, TemplateCategory, TemplateSubType } from '@prisma/client';

/**
 * The upload form fields arrive as plain strings. They name the stored object (templates/<category>/<subType>/...) and are written
 * to enum columns, so each one must be a real value before the file is parsed or stored: otherwise a bad value fails halfway
 * (an unhandled 500 after the file already reached storage) or, for the report format, is silently treated as Word.
 */
export function assertTemplateUploadInput(i: {
  name: unknown; category: unknown; subType: unknown; reportFormat: unknown; effectiveFrom: unknown; effectiveTo: unknown;
}): void {
  const bad = (m: string): never => { throw new BadRequestException(m); };
  if (typeof i.name !== 'string' || !i.name.trim() || i.name.length > 255) bad('Template name is required (at most 255 characters)');
  if (!(Object.values(TemplateCategory) as unknown[]).includes(i.category)) bad(`Unknown category. Use one of: ${Object.values(TemplateCategory).join(', ')}`);
  if (!(Object.values(TemplateSubType) as unknown[]).includes(i.subType)) bad(`Unknown activity type. Use one of: ${Object.values(TemplateSubType).join(', ')}`);
  if (!(Object.values(ReportFormat) as unknown[]).includes(i.reportFormat)) bad(`Unknown report format. Use one of: ${Object.values(ReportFormat).join(', ')}`);
  const invalid = (d: unknown) => !(d instanceof Date) || Number.isNaN(d.getTime());
  if (invalid(i.effectiveFrom)) bad('Effective from must be a valid date');
  if (i.effectiveTo !== null && invalid(i.effectiveTo)) bad('Effective to must be a valid date');
}
