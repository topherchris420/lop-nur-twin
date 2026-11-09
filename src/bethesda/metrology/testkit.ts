/**
 * Synthetic records for the bench's own tests: the statistics, the decision
 * rules, the archive and the verifier, exercised on outcomes chosen in advance
 * (an improvement, a regression, nothing, noise, a broken design) without
 * simulating a fly.
 *
 * Test fixtures only. Nothing here is a measurement: every subject is named
 * `research-synthetic-…`, every record's compute is zero, and the scope test
 * refuses any importer that is not a test.
 */
import { mulberry32 } from "../../lib/noise.js";
import { sha256 } from "../../rain/sha256.js";
import {
  BEHAVIOUR_METRICS,
  controllersIn,
  protocolDigest,
  seedsOf,
  type BehaviourMetric,
  type Protocol,
  type Split,
  type Unit,
} from "./protocol.js";
import { RECORD_SCHEMA, type RunRecord } from "./runner.js";

/** The value every controller of a unit would show with no effect: shared, so pairing is exact. */
function baseValue(seed: number, condition: string, metric: BehaviourMetric): number {
  const rng = mulberry32(parseInt(sha256(`${seed}:${condition}:${metric}`).slice(0, 8), 16));
  const noise = rng() - 0.5;
  const impaired = condition === "unimpaired" ? 0 : 1;
  switch (metric) {
    case "meals":
      return 10 + Math.round(noise * 4) - impaired;
    case "fedJ":
      return 1.3 + noise * 0.08 - 0.1 * impaired;
    case "collisions":
    case "walkingBlocks":
    case "rejected":
    case "placementsMissed":
      return Math.max(0, Math.round(2 + noise * 4));
    default:
      return 5 + noise;
  }
}

export type Shift = (u: Unit, metric: BehaviourMetric, base: number) => number;
export const noEffect: Shift = (_u, _m, base) => base;

/** One synthetic record per unit of the split, each shifted from the shared base by `shift`. */
export function syntheticRecords(p: Protocol, split: Split, shift: Shift = noEffect): RunRecord[] {
  const digest = protocolDigest(p);
  const out: RunRecord[] = [];
  for (const seed of seedsOf(p, split))
    for (const c of p.conditions)
      for (const controller of controllersIn(p, c)) {
        const u: Unit = { seed, condition: c.id, controller };
        const behaviour = Object.fromEntries(
          BEHAVIOUR_METRICS.map((m) => [m, shift(u, m, baseValue(seed, c.id, m))]),
        ) as Record<BehaviourMetric, number>;
        const sameBody =
          controller === p.baseline || p.validity.identicalToBaseline.includes(controller);
        const learns = controller.startsWith("plasticity-");
        out.push({
          schema: RECORD_SCHEMA,
          protocol: p.id,
          protocolDigest: digest,
          split,
          seed,
          condition: c.id,
          controller,
          subject: `research-synthetic-${seed}-${c.id}-${controller}`,
          status: "complete",
          error: null,
          ticks: p.durationS * 10,
          behaviour,
          selfModel: null,
          plasticity: learns
            ? {
                mode: controller.slice("plasticity-".length),
                samples: 100,
                discarded: 0,
                adaptations: controller === "plasticity-active" ? 50 : 0,
                shadowWouldAdapt: 0,
                cautiousBeforeOnset: false,
                detectionS: c.episodes.length ? 300 : null,
                releaseS: null,
                failureNormal: 0.6,
                failureLow: 0.5,
                nNormal: 80,
                nLow: 0,
              }
            : null,
          blocks: [p.durationS / 2, p.durationS].map((t, i) => ({
            t,
            meals: behaviour.meals * (i + 1) / 2,
            fedJ: behaviour.fedJ * (i + 1) / 2,
            spentJ: 1,
            walkedM: 10,
            flownM: 0,
            collisions: 0,
            adaptations: 0,
            cautious: learns ? false : null,
            belief: null,
            truth: 1,
            foodDistanceM: 3,
          })),
          environmentDigest: sha256(`env:${seed}:${c.id}`),
          bodyHash: sha256(`body:${seed}:${c.id}:${sameBody ? p.baseline : controller}`),
          compute: { wallS: 0, cpuS: 0, ticksPerWallS: null },
        });
      }
  return out;
}

/** A shift that moves one controller's metric by `by`, plus optional per-seed noise of half-width `jitter`. */
export function moved(controller: string, metric: BehaviourMetric, by: number, jitter = 0): Shift {
  return (u, m, base) => {
    if (u.controller !== controller || m !== metric) return base;
    const rng = mulberry32(parseInt(sha256(`jitter:${u.seed}:${u.condition}`).slice(0, 8), 16));
    return base + by + (rng() - 0.5) * 2 * jitter;
  };
}

/** Several shifts applied in turn. */
export const both =
  (...shifts: Shift[]): Shift =>
  (u, m, base) =>
    shifts.reduce((v, s) => s(u, m, v), base);
