/**
 * Draws the circuit models need, from a seeded uniform stream (`mulberry32`),
 * so a seed replays exactly: standard normal by Box–Muller, gamma by Marsaglia
 * and Tsang's method.
 */

/** A standard normal draw (Box–Muller, one of the pair). */
export function normal(rng: () => number): number {
  const u = 1 - rng(); // (0, 1]
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A gamma draw of `shape` and `scale` (Marsaglia & Tsang 2000; shape below 1 by the usual boost). */
export function gamma(rng: () => number, shape: number, scale: number): number {
  if (!(shape > 0) || !(scale > 0))
    throw new Error("gamma needs a positive shape and scale");
  if (shape < 1) return gamma(rng, shape + 1, scale) * Math.pow(1 - rng(), 1 / shape);
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  // Each try is accepted with probability above 0.95, so the bound is never reached.
  for (let i = 0; i < 1000; i++) {
    const x = normal(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v * scale;
  }
  throw new Error("gamma draw did not converge");
}
