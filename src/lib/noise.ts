import { createNoise2D, type NoiseFunction2D } from "simplex-noise";

/** Where a stream is, readable and settable only through `streamPosition`/`seekStream`. */
const POSITIONS = new WeakMap<() => number, { get(): number; set(a: number): void }>();

/**
 * Deterministic seeded PRNG (mulberry32) so the whole site is reproducible.
 *
 * Each stream's position is kept where a checkpoint can read it back
 * (`streamPosition`) and a restore can put it (`seekStream`); neither draws a
 * number, so a stream that is never checkpointed runs exactly as it always has.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  POSITIONS.set(next, {
    get: () => a,
    set: (v) => {
      a = v;
    },
  });
  return next;
}

/** A mulberry32 stream's position, or null for any other function. */
export function streamPosition(rng: () => number): number | null {
  return POSITIONS.get(rng)?.get() ?? null;
}

/**
 * Put a mulberry32 stream where `streamPosition` found one: its next draw is
 * the one that stream would have drawn next. Throws for any other function.
 */
export function seekStream(rng: () => number, position: number): void {
  const p = POSITIONS.get(rng);
  if (!p) throw new Error("not a mulberry32 stream");
  if (!Number.isInteger(position) || position < -0x80000000 || position > 0xffffffff)
    throw new Error("a stream position is a 32-bit integer");
  p.set(position);
}

export const SITE_SEED = 0x10c4;

export function seededNoise2D(seed: number): NoiseFunction2D {
  return createNoise2D(mulberry32(seed));
}
