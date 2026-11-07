/**
 * The connectome-hybrid study (R.A.I.N. Genesis Stage C): who should decide
 * when a mortal research fly feeds, its controller or a circuit cut from the
 * FlyWire whole brain? The yards are the homeostasis study's generator
 * (`environments` in ../study.ts) under this protocol's own seeds.
 *
 * Arms, each the same fly (seed, start) in the same spun-up yard:
 *
 * - `controller`: the deployed controller decides feeding, as it does now;
 * - `connectome`: the reduced FAFB v783 circuit's MN9 readout decides it;
 * - `shuffled`: the same circuit with its weights shuffled across its pairs;
 * - `threshold`: a plain threshold on hunger while on food, at the hunger
 *   where the intact circuit's readout crosses its threshold.
 *
 * Every body is mortal with the thirst policy (heat policy off: Stage B found
 * it raised heat exposure), so food and water both bind.
 */
import { mulberry32 } from "../../../lib/noise.js";
import type { Ecosystem } from "../ecosystem.js";
import { cloneEcosystem, EcologicalLife, TICK_S } from "../life.js";
import { type Environment, type StudyProtocol } from "../study.js";
import type { FeedingBrain } from "./feeding.js";
import type { CircuitFile } from "./lif.js";

export const FEEDING_STUDY_SCHEMA = "connectome-feeding-protocol/v1";
export const FEEDING_ARMS = [
  "controller",
  "connectome",
  "shuffled",
  "threshold",
] as const;
export type FeedingArm = (typeof FEEDING_ARMS)[number];

export interface FeedingProtocol extends StudyProtocol {
  start_reserve: number;
  circuit: { id: string; sha256: string; neurons: number };
  feeding: {
    max_rate_hz: number;
    window_ms: number;
    threshold_hz: number;
    hunger_at: number;
  };
  bootstrap: { resamples: number; seed: number };
  noninferiority_margin: number;
  /** Most wall time the circuit may take per simulated second it is driven (s/s). */
  max_circuit_s_per_driven_s: number;
  criteria: { id: string; primary?: boolean; rule: string }[];
}

export interface FeedingResult {
  environment: number;
  seed: number;
  arm: FeedingArm;
  alive: boolean;
  cause: string | null;
  survived_h: number;
  fed_j: number;
  feed_s: number;
  /** Feeding bouts: entries into feeding, counted on the body. */
  bouts: number;
  /** Time-weighted mean reserve while alive (a share of a full reserve). */
  mean_reserve: number;
  min_reserve: number;
  hydrated_share: number | null;
  /** The hybrid's own counts (null for the controller arm). */
  hybrid: {
    meals: number;
    on_food_on: number;
    on_food_off: number;
    vetoed: number;
    driven_s: number;
  } | null;
  replay_hash: string;
  fly_hash: string;
}

const r6 = (x: number) => Number(x.toPrecision(6));

export function brainOf(
  arm: FeedingArm,
  p: FeedingProtocol,
  circuit: CircuitFile,
): FeedingBrain {
  const f = p.feeding;
  switch (arm) {
    case "controller":
      return { kind: "controller" };
    case "threshold":
      return { kind: "threshold", hungerAt: f.hunger_at };
    case "connectome":
    case "shuffled":
      return {
        kind: "connectome",
        circuit,
        wiring: arm === "shuffled" ? "shuffled" : "intact",
        maxRateHz: f.max_rate_hz,
        windowMs: f.window_ms,
        thresholdHz: f.threshold_hz,
      };
  }
}

/** One arm of one trial, from the yard's spun-up world. Returns the result and the circuit's wall time. */
export function runFeedingArm(
  p: FeedingProtocol,
  env: Environment,
  start: Environment["starts"][number],
  arm: FeedingArm,
  world: Ecosystem,
  split: string,
  circuit: CircuitFile,
): { result: FeedingResult; circuitWallMs: number } {
  const life = new EcologicalLife(
    env.spec,
    {
      subject: `research-feeding-${split}-${env.index}-${start.seed}-${arm}`,
      seed: start.seed,
      start: start.at,
      yaw: start.yaw,
      startReserve: p.start_reserve,
    },
    { kind: "mortal", thirst: true, thermal: false },
    cloneEcosystem(world),
    brainOf(arm, p, circuit),
  );
  const fly = life.fly!;
  const cap = fly.params.reserveJ;
  const ticks = Math.round(p.horizon_s / TICK_S);
  const every = 600; // one minute
  let sum = 0;
  let n = 0;
  let min = fly.state.reserve / cap;
  let bouts = 0;
  let wasFeeding = fly.state.mode === "feed";
  for (let done = 0; done < ticks && life.alive;) {
    const k = Math.min(every, ticks - done);
    // Bouts are counted per tick, on the body.
    for (let j = 0; j < k && life.alive; j++) {
      life.step(1);
      const feeding = fly.state.mode === "feed";
      if (feeding && !wasFeeding) bouts++;
      wasFeeding = feeding;
    }
    done += k;
    const r = fly.state.reserve / cap;
    sum += r;
    n++;
    min = Math.min(min, r);
  }
  const h = life.homeostasis!.state;
  const survived = h.alive ? p.horizon_s : h.diedAtS!;
  const f = life.feeding?.state ?? null;
  return {
    result: {
      environment: env.index,
      seed: start.seed,
      arm,
      alive: life.alive,
      cause: h.cause ?? null,
      survived_h: r6(survived / 3600),
      fed_j: r6(fly.state.counts.fedJ),
      feed_s: r6(fly.state.counts.feedS),
      bouts,
      mean_reserve: r6(n ? sum / n : fly.state.reserve / cap),
      min_reserve: r6(min),
      hydrated_share: r6(1 - h.dryS / survived),
      hybrid: f
        ? {
            meals: f.meals,
            on_food_on: f.onFoodOn,
            on_food_off: f.onFoodOff,
            vetoed: f.vetoed,
            driven_s: r6(f.drivenS),
          }
        : null,
      replay_hash: life.eco.stateHash(),
      fly_hash: fly.stateHash(),
    },
    circuitWallMs: life.feeding?.circuitWallMs ?? 0,
  };
}

/**
 * A paired percentile bootstrap over environments of any statistic of the
 * results: `stat` sees the resampled environments' results (every arm).
 */
export function bootstrap(
  results: readonly FeedingResult[],
  stat: (rs: FeedingResult[]) => number,
  resamples: number,
  seed: number,
): { estimate: number; lo: number; hi: number } {
  const envs = [...new Set(results.map((r) => r.environment))].sort((x, y) => x - y);
  const pick = (es: number[]) =>
    es.flatMap((e) => results.filter((r) => r.environment === e));
  const est = stat(pick(envs));
  const rng = mulberry32(seed >>> 0);
  const vals: number[] = [];
  for (let k = 0; k < resamples; k++)
    vals.push(stat(pick(envs.map(() => envs[Math.floor(rng() * envs.length)]!))));
  vals.sort((x, y) => x - y);
  const q = (u: number) => vals[Math.min(vals.length - 1, Math.floor(u * vals.length))]!;
  return { estimate: r6(est), lo: r6(q(0.025)), hi: r6(q(0.975)) };
}

export const armMean =
  (arm: FeedingArm, k: "fed_j" | "feed_s" | "mean_reserve" | "survived_h") =>
  (rs: FeedingResult[]) => {
    const xs = rs.filter((r) => r.arm === arm);
    return xs.reduce((s, r) => s + r[k], 0) / Math.max(1, xs.length);
  };

export const armSurvival = (arm: FeedingArm) => (rs: FeedingResult[]) => {
  const xs = rs.filter((r) => r.arm === arm);
  return xs.filter((r) => r.alive).length / Math.max(1, xs.length);
};

/** Mean feeding seconds per bout. */
export const armBout = (arm: FeedingArm) => (rs: FeedingResult[]) => {
  const xs = rs.filter((r) => r.arm === arm);
  const b = xs.reduce((s, r) => s + r.bouts, 0);
  return b ? xs.reduce((s, r) => s + r.feed_s, 0) / b : 0;
};
