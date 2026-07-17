import { createNoise2D, type NoiseFunction2D } from "simplex-noise";

/**
 * Deterministic seeded PRNG (mulberry32) so the whole site is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SITE_SEED = 0x10c4;

export function seededNoise2D(seed: number): NoiseFunction2D {
  return createNoise2D(mulberry32(seed));
}
