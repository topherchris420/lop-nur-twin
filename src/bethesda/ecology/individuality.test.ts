/** The individuality measures on tables whose answer is known. */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import { permutationTest, repeatability, signature } from "./individuality";

describe("individuality measures", () => {
  it("give repeatability near 1 for stable individuals, near 0 for noise, and test it against shuffles", () => {
    const rng = mulberry32(4);
    const stable = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 6 }, () => i + 0.05 * (rng() - 0.5)),
    );
    const noise = Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => rng()));
    expect(repeatability(stable)).toBeGreaterThan(0.99);
    expect(Math.abs(repeatability(noise))).toBeLessThan(0.3);
    const t = permutationTest(stable, repeatability, 499, 1);
    expect(t.p).toBeLessThan(0.01);
    expect(permutationTest(noise, repeatability, 499, 1).p).toBeGreaterThan(0.01);
  });

  it("give a signature near 1 for flies that repeat their profiles, near 0 when they do not", () => {
    const rng = mulberry32(9);
    const own = Array.from({ length: 6 }, () => [rng(), rng(), rng(), rng()]);
    const repeat = own.map((p) =>
      Array.from({ length: 5 }, () => p.map((v) => v + 0.01 * rng())),
    );
    const random = Array.from({ length: 6 }, () =>
      Array.from({ length: 5 }, () => [rng(), rng(), rng(), rng()]),
    );
    expect(signature(repeat)).toBeGreaterThan(0.9);
    expect(Math.abs(signature(random))).toBeLessThan(0.2);
    expect(permutationTest(repeat, signature, 199, 2).p).toBeLessThan(0.01);
  });

  it("keeps a shared day effect out of individuality", () => {
    // Every fly the same on a day, days very different: no individuality.
    const days = [0, 5, 1, 9, 3];
    const shared = Array.from({ length: 6 }, () => days.slice());
    expect(repeatability(shared)).toBeLessThanOrEqual(0);
    expect(permutationTest(shared, repeatability, 199, 3).p).toBeGreaterThan(0.05);
  });
});
