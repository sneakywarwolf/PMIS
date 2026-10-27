import { BadRequestException } from '@nestjs/common';
import { assertPocKeys } from './upload-security.util';

/** Most PoC images one testing step may carry. */
export const MAX_POC_IMAGES_PER_STEP = 20;

interface StepImages {
  imagePath?: string | null;
  extraImagePaths?: string[] | null;
}

/** A step's PoC images in order: the first one, then the rest in upload order. */
export function pocStepImagePaths(step: StepImages): string[] {
  return [step.imagePath, ...(step.extraImagePaths ?? [])].filter((p): p is string => !!p && p.trim().length > 0);
}

/** Validates an ordered image list from the client and splits it into the two stored columns. */
export function splitPocImagePaths(raw: unknown): { imagePath: string | null; extraImagePaths: string[] } {
  const paths = assertPocKeys(raw);
  if (paths.length > MAX_POC_IMAGES_PER_STEP) {
    throw new BadRequestException(`A step can have at most ${MAX_POC_IMAGES_PER_STEP} PoC images.`);
  }
  if (new Set(paths).size !== paths.length) {
    throw new BadRequestException('The same PoC image is listed twice in a step.');
  }
  return { imagePath: paths[0] ?? null, extraImagePaths: paths.slice(1) };
}
