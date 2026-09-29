import { pairedDifference, type PairedDifference } from "./stats.js";

/**
 * Contribution analysis: matched ablations, reported as contrasts.
 *
 * An arm is a combination of factors — which brain chooses, which controller
 * aims, which navigator walks, which motor profile. When two arms differ in
 * exactly one factor and ran the same seeds, the paired difference between
 * them is that factor's effect *at the other factors' levels*. That is all this
 * module computes, and it prints the level of every other factor next to each
 * contrast.
 *
 * It deliberately does not produce "the model contributed 62%". Effects in this
 * game interact — the aiming controller is worth far more to a brain that
 * engages than to one that hides — so shares of a total do not add up, and a
 * decomposition would be a number the design cannot support. Where a full 2×2
 * exists the interaction is computed and printed, which is the evidence for
 * that sentence rather than an assumption of it.
 */

export const FACTORS = ["brain", "control", "navigation", "motor", "policy"] as const;
export type Factor = (typeof FACTORS)[number];

export interface FactorArm {
  id: string;
  levels: Record<Factor, string>;
  primary: ReadonlyMap<number, number | null>;
}

export interface Contrast {
  factor: Factor;
  from: { arm: string; level: string };
  to: { arm: string; level: string };
  /** The other factors' levels, which this contrast holds fixed. */
  heldFixed: Partial<Record<Factor, string>>;
  difference: PairedDifference;
}

export interface Interaction {
  factors: [Factor, Factor];
  /** (d · high_b) − (d · low_b): how much factor a's effect changes with factor b. */
  cells: Record<string, string>;
  differenceOfDifferences: number | null;
  seeds: number;
  note: string;
}

export interface ContributionReport {
  factors: Factor[];
  contrasts: Contrast[];
  interactions: Interaction[];
  statement: string;
}

const STATEMENT =
  "Each contrast is the paired, by-seed difference between two arms that differ in one factor only, at the other factors' stated levels. It is descriptive for this design and this environment. Effects interact, so they are not shares of a whole and do not sum to one.";

function differsOnlyIn(
  a: FactorArm,
  b: FactorArm,
  factors: readonly Factor[],
): Factor | null {
  const diff = factors.filter((f) => a.levels[f] !== b.levels[f]);
  const others = FACTORS.filter(
    (f) => !factors.includes(f) && a.levels[f] !== b.levels[f],
  );
  return diff.length === 1 && others.length === 0 ? diff[0]! : null;
}

export function contributions(
  arms: readonly FactorArm[],
  factors: readonly Factor[],
): ContributionReport {
  const contrasts: Contrast[] = [];
  for (let i = 0; i < arms.length; i += 1) {
    for (let j = 0; j < arms.length; j += 1) {
      if (i === j) continue;
      const a = arms[i]!;
      const b = arms[j]!;
      const factor = differsOnlyIn(a, b, factors);
      if (!factor) continue;
      // One direction per pair: from the level that sorts first. Random and
      // standard are the natural baselines, so they are preferred as "from".
      const baseline = (level: string): number =>
        level === "random" ||
        level === "standard" ||
        level === "direct" ||
        level === "steps"
          ? 0
          : 1;
      const order =
        baseline(a.levels[factor]) - baseline(b.levels[factor]) ||
        a.levels[factor].localeCompare(b.levels[factor]);
      if (order > 0) continue;
      const heldFixed: Partial<Record<Factor, string>> = {};
      for (const f of FACTORS) if (f !== factor) heldFixed[f] = a.levels[f];
      contrasts.push({
        factor,
        from: { arm: a.id, level: a.levels[factor] },
        to: { arm: b.id, level: b.levels[factor] },
        heldFixed,
        difference: pairedDifference(a.primary, b.primary),
      });
    }
  }

  const interactions: Interaction[] = [];
  for (let x = 0; x < factors.length; x += 1) {
    for (let y = x + 1; y < factors.length; y += 1) {
      const fa = factors[x]!;
      const fb = factors[y]!;
      const levelsA = [...new Set(arms.map((a) => a.levels[fa]))];
      const levelsB = [...new Set(arms.map((a) => a.levels[fb]))];
      if (levelsA.length !== 2 || levelsB.length !== 2) continue;
      const cell = (la: string, lb: string): FactorArm | undefined =>
        arms.find(
          (a) =>
            a.levels[fa] === la &&
            a.levels[fb] === lb &&
            FACTORS.every(
              (f) => f === fa || f === fb || a.levels[f] === arms[0]!.levels[f],
            ),
        );
      const [a0, a1] = levelsA.sort();
      const [b0, b1] = levelsB.sort();
      const c00 = cell(a0!, b0!);
      const c10 = cell(a1!, b0!);
      const c01 = cell(a0!, b1!);
      const c11 = cell(a1!, b1!);
      if (!c00 || !c10 || !c01 || !c11) continue;
      const low = pairedDifference(c00.primary, c10.primary);
      const high = pairedDifference(c01.primary, c11.primary);
      interactions.push({
        factors: [fa, fb],
        cells: {
          [`${fa}=${a0},${fb}=${b0}`]: c00.id,
          [`${fa}=${a1},${fb}=${b0}`]: c10.id,
          [`${fa}=${a0},${fb}=${b1}`]: c01.id,
          [`${fa}=${a1},${fb}=${b1}`]: c11.id,
        },
        differenceOfDifferences:
          low.meanDifference !== null && high.meanDifference !== null
            ? high.meanDifference - low.meanDifference
            : null,
        seeds: Math.min(low.n, high.n),
        note: `The effect of ${fa} (${a0} → ${a1}) at ${fb}=${b1}, minus the same effect at ${fb}=${b0}. Far from zero means the two factors do not contribute separately.`,
      });
    }
  }
  return { factors: [...factors], contrasts, interactions, statement: STATEMENT };
}
