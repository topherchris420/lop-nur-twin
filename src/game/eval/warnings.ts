import type { Axis } from "../pilot/contract.js";
import type { MetricDefinition } from "./metricRegistry.js";
import { offeredSlots, slotOf, type DecisionRecord } from "./records.js";
import { mean, pairedDifference } from "./stats.js";

/**
 * Benchmark warnings: patterns that have fooled this project before, or could.
 *
 * Each detector looks for a signature — a still seat that wins everything, a
 * brain that always picks the first option shown, a controller that does as
 * well with random choices as with the model's — and, when it finds one, says
 * what it saw, the numbers, the causes it is compatible with, and the run that
 * would tell them apart. They are warnings, not verdicts: a model may really
 * prefer the nearest cover. The marksman finding started as exactly this kind
 * of suspicion, and a script settled it.
 *
 * Thresholds are stated in each message so a reader can disagree with them.
 */

export interface BenchmarkWarning {
  id: string;
  severity: "warning" | "info";
  arm: string | null;
  message: string;
  evidence: Record<string, number | string | null>;
  possibleCauses: string[];
  suggestedRun: string | null;
}

export interface ArmView {
  id: string;
  brain: string;
  control: string;
  navigation: string;
  motor: string;
  policy: string | null;
  /**
   * Every other arm-defining parameter (staleness, latency, cadence, seat,
   * orders, origin, build, query, test double), canonicalised. A baseline is
   * matched only when this is equal too.
   */
  setting: string;
  seeds: number[];
  simSeconds: number;
  kills: number;
  deaths: number;
  distanceM: number;
  exposureFraction: number | null;
  opponentRoundsInSight: number | null;
  opponentHitsOnSeat: number | null;
  laggedEpisodes: number;
  decisions: readonly DecisionRecord[];
  /** Primary metric per seed. */
  primary: ReadonlyMap<number, number | null>;
  /** True when the arm calls a paid model and some call's cost is unknown. */
  costUnknown: boolean;
}

const MIN_DECISIONS = 50;

function better(def: MetricDefinition, a: number, b: number): boolean {
  return def.direction === "higher" ? a > b : def.direction === "lower" ? a < b : false;
}

/** Among decisions where the axis offered a choice, the most chosen action's share. */
export function actionConcentration(
  decisions: readonly DecisionRecord[],
  axis: Axis,
): { action: string; share: number; n: number } | null {
  const counts = new Map<string, number>();
  let n = 0;
  for (const r of decisions) {
    if ((r.legal[axis] as readonly string[]).length < 2) continue;
    n += 1;
    counts.set(r.frame[axis], (counts.get(r.frame[axis]) ?? 0) + 1);
  }
  if (n === 0) return null;
  const [action, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { action, share: count / n, n };
}

/**
 * Among decisions that chose a slot while at least two were offered: how
 * often slot 0 was chosen, against the share a position-blind chooser would
 * produce (the mean of 1/k).
 */
export function slotPositionBias(
  decisions: readonly DecisionRecord[],
  axis: "target" | "go",
): { firstShare: number; expected: number; n: number } | null {
  let n = 0;
  let first = 0;
  let expected = 0;
  for (const r of decisions) {
    const slot = slotOf(r.frame[axis]);
    const k = offeredSlots(r.legal, axis);
    if (slot === null || k < 2) continue;
    n += 1;
    if (slot === 0) first += 1;
    expected += 1 / k;
  }
  return n === 0 ? null : { firstShare: first / n, expected: expected / n, n };
}

export function detectWarnings(
  arms: readonly ArmView[],
  primary: MetricDefinition,
  seedsDeclared: number,
): BenchmarkWarning[] {
  const out: BenchmarkWarning[] = [];

  if (seedsDeclared < 10) {
    out.push({
      id: "insufficient-seeds",
      severity: "info",
      arm: null,
      message: `${seedsDeclared} seeds per arm. Treat every difference as exploratory; use a 10-seed development set or a 30-seed evaluation set before claiming one.`,
      evidence: { seeds: seedsDeclared },
      possibleCauses: ["a quick check, by design"],
      suggestedRun: 'set "seeds": { "preset": "dev" } or { "preset": "eval" }',
    });
  }

  // A still seat that beats every other arm on the deciding metric.
  const scored = arms
    .map((arm) => ({
      arm,
      value: mean([...arm.primary.values()].filter((v): v is number => v !== null)),
    }))
    .filter((x): x is { arm: ArmView; value: number } => x.value !== null);
  if (scored.length >= 2 && primary.direction !== "none") {
    const best = scored.reduce((a, b) => (better(primary, b.value, a.value) ? b : a));
    const perEpisode =
      best.arm.seeds.length > 0 ? best.arm.distanceM / best.arm.seeds.length : 0;
    if (perEpisode < 10) {
      out.push({
        id: "stationary-dominance",
        severity: "warning",
        arm: best.arm.id,
        message: `${best.arm.id} leads every arm on ${primary.id} while moving ${perEpisode.toFixed(1)} m per episode (threshold: under 10 m).`,
        evidence: { [primary.id]: best.value, metresPerEpisode: perEpisode },
        possibleCauses: [
          "the environment rewards holding still (the marksman exploit)",
          "opponents cannot reach a still seat at range",
          "a genuine strategy — confirm by running the scripted marksman on the same seeds",
        ],
        suggestedRun: "node tools/experiment.mjs tools/experiments/exposure.json",
      });
    }
  }

  for (const arm of arms) {
    for (const axis of ["move", "weapon", "target", "go"] as const) {
      const c = actionConcentration(arm.decisions, axis);
      if (c && c.n >= MIN_DECISIONS && c.share >= 0.95) {
        out.push({
          id: "action-concentration",
          severity: "warning",
          arm: arm.id,
          message: `${arm.id} chose ${axis}=${c.action} in ${(c.share * 100).toFixed(1)}% of ${c.n} decisions where the ${axis} axis offered a choice (threshold 95%).`,
          evidence: { axis, action: c.action, share: c.share, n: c.n },
          possibleCauses: [
            "a policy that does one thing (true of scripted policies)",
            "the other options are never worth choosing in this environment",
            "the model ignores the axis",
          ],
          suggestedRun: null,
        });
      }
    }
    for (const axis of ["target", "go"] as const) {
      const b = slotPositionBias(arm.decisions, axis);
      if (b && b.n >= 30 && b.firstShare >= Math.max(0.8, 1.6 * b.expected)) {
        out.push({
          id: "option-position-bias",
          severity: "warning",
          arm: arm.id,
          message: `${arm.id} chose slot 0 of the ${axis} axis in ${(b.firstShare * 100).toFixed(1)}% of ${b.n} decisions with two or more slots offered; a position-blind chooser would pick it ${(b.expected * 100).toFixed(1)}% of the time.`,
          evidence: { axis, firstShare: b.firstShare, expectedShare: b.expected, n: b.n },
          possibleCauses: [
            "model preference for what slot 0 is (nearest cover, nearest enemy)",
            "option-order bias: preference for the first option shown",
            "an environment where the first-listed option really is best",
            "controller dominance: the choice matters little either way",
          ],
          suggestedRun: "npm run experiment:shuffle-options",
        });
      }
    }
    const totalS = arm.simSeconds;
    if (arm.deaths === 0 && totalS >= 300 && (arm.exposureFraction ?? 0) >= 0.2) {
      out.push({
        id: "impossible-survival",
        severity: "warning",
        arm: arm.id,
        message: `${arm.id} never died in ${Math.round(totalS)} s of match time while in some enemy's sight line ${((arm.exposureFraction ?? 0) * 100).toFixed(0)}% of the time.`,
        evidence: { simSeconds: totalS, exposureFraction: arm.exposureFraction },
        possibleCauses: [
          "opponents are too weak against the seat (seat mercy rules, aim cones tuned for short range)",
          "the seat kills first every time — itself a sign the contest is one-sided",
        ],
        suggestedRun: 'rerun the arm with "seat": "even"',
      });
    }
    if (
      arm.opponentRoundsInSight !== null &&
      arm.opponentHitsOnSeat !== null &&
      arm.opponentRoundsInSight >= 100 &&
      arm.opponentHitsOnSeat / arm.opponentRoundsInSight < 0.02
    ) {
      out.push({
        id: "low-opponent-hit-rate",
        severity: "warning",
        arm: arm.id,
        message: `Enemies fired ${arm.opponentRoundsInSight} rounds while holding a sight line to ${arm.id}'s seat and hit it ${arm.opponentHitsOnSeat} times (${((arm.opponentHitsOnSeat / arm.opponentRoundsInSight) * 100).toFixed(1)}%, threshold 2%).`,
        evidence: {
          roundsInSight: arm.opponentRoundsInSight,
          hitsOnSeat: arm.opponentHitsOnSeat,
        },
        possibleCauses: [
          "bot aim is tuned for another range than the seat fights at",
          "rounds counted were aimed at someone else in the same line (the proxy over-counts)",
        ],
        suggestedRun: 'rerun with "seat": "even" and compare',
      });
    }
    if (arm.laggedEpisodes > 0) {
      out.push({
        id: "lagged-episodes",
        severity: "warning",
        arm: arm.id,
        message: `${arm.laggedEpisodes} episode(s) of ${arm.id} ran slower than real time, which inflates decisions per simulated second.`,
        evidence: { lagged: arm.laggedEpisodes },
        possibleCauses: ["too many pages at once on one machine"],
        suggestedRun: "run arms one at a time (the default)",
      });
    }
    if (arm.costUnknown) {
      out.push({
        id: "cost-unknown",
        severity: "info",
        arm: arm.id,
        message: `${arm.id} calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.`,
        evidence: {},
        possibleCauses: ["config/pricing.json has no sourced price for this model"],
        suggestedRun:
          "fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)",
      });
    }
  }

  // The controller doing the work: a random brain through the same controller
  // and navigator reaching most of what a brain reaches.
  if (primary.direction !== "none") {
    for (const arm of arms) {
      if (arm.brain === "random") continue;
      const baseline = arms.find(
        (b) =>
          b.brain === "random" &&
          b.control === arm.control &&
          b.navigation === arm.navigation &&
          b.motor === arm.motor &&
          b.setting === arm.setting,
      );
      if (!baseline) continue;
      const a = mean([...arm.primary.values()].filter((v): v is number => v !== null));
      const r = mean(
        [...baseline.primary.values()].filter((v): v is number => v !== null),
      );
      if (a === null || r === null) continue;
      const diff = pairedDifference(baseline.primary, arm.primary);
      const indistinct =
        diff.ci95 !== null && diff.ci95.lo <= 0 && diff.ci95.hi >= 0 && diff.n >= 3;
      const close =
        primary.direction === "higher" ? a > 0 && r >= 0.8 * a : r > 0 && a >= 0.8 * r;
      if (indistinct || close) {
        out.push({
          id: indistinct ? "model-irrelevance" : "controller-dominance",
          severity: "warning",
          arm: arm.id,
          message: indistinct
            ? `On ${primary.id}, ${arm.id} is not distinguishable from ${baseline.id} (random choices through the same controllers): paired difference ${diff.meanDifference?.toFixed(3)} with a 95% interval [${diff.ci95!.lo.toFixed(3)}, ${diff.ci95!.hi.toFixed(3)}] over ${diff.n} seeds.`
            : `On ${primary.id}, ${baseline.id} (random choices through the same controllers) reaches ${((primary.direction === "higher" ? r / a : a / r) * 100).toFixed(0)}% of ${arm.id} (threshold 80%).`,
          evidence: { arm: a, randomBaseline: r, pairedSeeds: diff.n },
          possibleCauses: [
            "the deterministic controller solves most of the task",
            "the metric does not depend on the choices the brain makes",
            "too few seeds to separate them",
          ],
          suggestedRun:
            "node tools/experiment.mjs tools/experiments/controller-ablation.json",
        });
      }
    }
  }
  return out;
}
