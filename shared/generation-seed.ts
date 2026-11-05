import { z } from 'zod';

/** Keep seeds exact across JavaScript, JSON, project archives and Comfy. */
export const MAX_GENERATION_SEED = Number.MAX_SAFE_INTEGER;
export const generationSeedSchema = z.number().int().nonnegative().max(MAX_GENERATION_SEED);

/** Undefined means Random; zero is a valid fixed seed. */
export function chooseGenerationSeed(seed?: number): number {
  if (seed !== undefined) return generationSeedSchema.parse(seed);
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0x1fffff) * 2 ** 32 + words[1];
}
