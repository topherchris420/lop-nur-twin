/**
 * The homeostasis study (R.A.I.N. Genesis Stage B): do a mortal research
 * fly's feedback policies keep it alive in a hot, dry yard, and can that be
 * attributed to the feedback itself?
 *
 * Environments are generated from a frozen protocol's seed: a yard with fruit
 * trees (some with canopies), flowers, rocks and one spring under a canopy,
 * in a dry climate with no rain. Each lives on its own for `spin_up_s` before
 * any fly is placed; every arm of a trial is then placed in an exact copy of
 * that world (`cloneEcosystem`), at the same spot, with the same seed. The
 * arms differ only in the body and its policies:
 *
 * - `deployed`: the deployed configuration, its artificial maintenance on
 *   (it cannot die; a non-biological reference, never a comparator);
 * - `no-feedback`: a mortal body with no policies;
 * - `full`: thirst and heat policies;
 * - `no-thirst`, `no-heat`: one policy removed;
 * - `shuffled-humidity`: both policies, the thirst policy reading humidity at
 *   a fixed displaced point (activity kept, its link to the fly's place broken).
 *
 * A seeded study on research subjects, not a registered R.A.I.N. experiment.
 */
import { mulberry32 } from "../../lib/noise.js";
import type { EcosystemSpec, Placed, Rock, Tree } from "./ecosystem.js";
import { cloneEcosystem, EcologicalLife, spinUp, type BodyOptions } from "./life.js";
import type { Ecosystem } from "./ecosystem.js";

export const STUDY_SCHEMA = "homeostasis-protocol/v1";
export const ARMS = [
  "deployed",
  "no-feedback",
  "full",
  "no-thirst",
  "no-heat",
  "shuffled-humidity",
] as const;
export type Arm = (typeof ARMS)[number];

export interface StudySplit {
  generator_seed: number;
  environments: number;
  fly_seeds: number[];
}

export interface StudyProtocol {
  schema: string;
  id: string;
  climate: NonNullable<EcosystemSpec["climate"]>;
  spin_up_s: number;
  horizon_s: number;
  start_hour: number;
  spring_inflow_mm_s: number;
  /** How many springs, each under one of the first trees' canopies (at most four). */
  springs: number;
  min_start_from_spring_m: number;
  splits: Record<string, StudySplit>;
  [k: string]: unknown;
}

export interface Environment {
  index: number;
  spec: EcosystemSpec;
  /** Where each fly seed starts (x, z) and faces, and its displaced hygro point. */
  starts: {
    seed: number;
    at: [number, number];
    yaw: number;
    hygroOffset: [number, number];
  }[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The split's environments, drawn from its generator seed. */
export function environments(p: StudyProtocol, split: StudySplit): Environment[] {
  const rng = mulberry32(split.generator_seed >>> 0);
  const at = (lo = -8.5, hi = 8.5) => r3(lo + (hi - lo) * rng());
  const out: Environment[] = [];
  for (let e = 0; e < split.environments; e++) {
    const rocks: Rock[] = [0, 1].map((k) => ({
      id: `rock-${k}`,
      x: at(),
      z: at(),
      half: r3(0.4 + 0.5 * rng()),
      height: 0.4,
    }));
    const clear = (x: number, z: number, m: number) =>
      rocks.every(
        (r) => Math.abs(x - r.x) > r.half + m || Math.abs(z - r.z) > r.half + m,
      );
    const place = (n: number, m: number): [number, number][] => {
      const pts: [number, number][] = [];
      while (pts.length < n) {
        const x = at(),
          z = at();
        if (clear(x, z, m) && pts.every(([a, b]) => Math.hypot(a - x, b - z) > 2))
          pts.push([x, z]);
      }
      return pts;
    };
    const treePts = place(5, 0.8);
    const trees: Tree[] = treePts.map(([x, z], k) => ({
      id: `tree-${k}`,
      x,
      z,
      ...(k < 4 ? { canopyM: 2.5 } : {}),
    }));
    const flowers: Placed[] = place(6, 0.6).map(([x, z], k) => ({
      id: `flower-${k}`,
      x,
      z,
    }));
    // Springs seep out under the first three trees' canopies, a little off each trunk.
    const springs = trees.slice(0, p.springs).map((t, k) => {
      const a = 2 * Math.PI * rng();
      return {
        id: `spring-${k}`,
        x: r3(t.x + 0.8 * Math.cos(a)),
        z: r3(t.z + 0.8 * Math.sin(a)),
        inflowMmPerS: p.spring_inflow_mm_s,
      };
    });
    const spec: EcosystemSpec = {
      seed: Math.floor(rng() * 0x7fffffff),
      startHour: p.start_hour - ((p.spin_up_s / 3600) % 24),
      windHeading: r3(2 * Math.PI * rng()),
      half: 10,
      climate: p.climate,
      trees,
      flowers,
      rocks,
      springs,
    };
    const starts = split.fly_seeds.map((seed) => {
      let x = 0,
        z = 0;
      do {
        x = at();
        z = at();
      } while (
        !clear(x, z, 0.3) ||
        springs.some((sp) => Math.hypot(x - sp.x, z - sp.z) < p.min_start_from_spring_m)
      );
      const d = 2 * Math.PI * rng();
      return {
        seed,
        at: [x, z] as [number, number],
        yaw: r3(2 * Math.PI * rng()),
        hygroOffset: [r3(7 * Math.cos(d)), r3(7 * Math.sin(d))] as [number, number],
      };
    });
    out.push({ index: e, spec, starts });
  }
  return out;
}

export function bodyOf(arm: Arm, hygroOffset: [number, number]): BodyOptions {
  switch (arm) {
    case "deployed":
      return { kind: "deployed" };
    case "no-feedback":
      return { kind: "mortal", thirst: false, thermal: false };
    case "full":
      return { kind: "mortal", thirst: true, thermal: true };
    case "no-thirst":
      return { kind: "mortal", thirst: false, thermal: true };
    case "no-heat":
      return { kind: "mortal", thirst: true, thermal: false };
    case "shuffled-humidity":
      return { kind: "mortal", thirst: true, thermal: true, hygroOffset };
  }
}

export interface TrialResult {
  environment: number;
  seed: number;
  arm: Arm;
  alive: boolean;
  cause: string | null;
  died_h: number | null;
  survived_h: number;
  min_water: number | null;
  max_temp_c: number | null;
  /** Share of the time alive with body water at or above 0.7. */
  hydrated_share: number | null;
  hot_h: number | null;
  drank_ul: number | null;
  juice_ul: number | null;
  fed_j: number;
  maintenance_j: number;
  overrides: Record<string, number> | null;
  interactions: number;
  replay_hash: string;
}

const r6 = (x: number) => Number(x.toPrecision(6));

/** One arm of one trial, from the environment's spun-up world. */
export function runArm(
  p: StudyProtocol,
  env: Environment,
  start: Environment["starts"][number],
  arm: Arm,
  world: Ecosystem,
  split: string,
): TrialResult {
  const life = new EcologicalLife(
    env.spec,
    {
      subject: `research-homeostasis-${split}-${env.index}-${start.seed}-${arm}`,
      seed: start.seed,
      start: start.at,
      yaw: start.yaw,
      startReserve: 1,
    },
    bodyOf(arm, start.hygroOffset),
    cloneEcosystem(world),
  );
  const ticks = Math.round(p.horizon_s / 0.1);
  // Step in hours, and stop early once the fly is dead: the world would go on, but nothing more is asked of it.
  for (let done = 0; done < ticks && life.alive;) {
    const n = Math.min(36_000, ticks - done);
    life.step(n);
    done += n;
  }
  const h = life.homeostasis?.state ?? null;
  const fly = life.fly!;
  const survived = h && !h.alive ? h.diedAtS! : p.horizon_s;
  return {
    environment: env.index,
    seed: start.seed,
    arm,
    alive: life.alive,
    cause: h?.cause ?? null,
    died_h: h && !h.alive ? r6(h.diedAtS! / 3600) : null,
    survived_h: r6(survived / 3600),
    min_water: h ? r6(h.minWater) : null,
    max_temp_c: h ? r6(h.maxTempC) : null,
    hydrated_share: h ? r6(1 - h.dryS / survived) : null,
    hot_h: h ? r6(h.hotS / 3600) : null,
    drank_ul: h ? r6(h.drankUl) : null,
    juice_ul: h ? r6(h.juiceUl) : null,
    fed_j: r6(fly.state.counts.fedJ),
    maintenance_j: r6(life.maintenanceJ),
    overrides: life.policies ? { ...life.policies.state.overrides } : null,
    interactions: life.eco.interactions.length,
    replay_hash: life.eco.stateHash(),
  };
}

/** Every arm of every trial of the environments `which` (indexes), in order. */
export function runEnvironments(
  p: StudyProtocol,
  split: string,
  which: readonly number[],
  progress: (msg: string) => void = () => {},
): TrialResult[] {
  const envs = environments(p, p.splits[split]!);
  const out: TrialResult[] = [];
  for (const i of which) {
    const env = envs[i]!;
    const world = spinUp(env.spec, p.spin_up_s);
    for (const start of env.starts)
      for (const arm of ARMS) {
        out.push(runArm(p, env, start, arm, world, split));
        progress(`${split} env ${i} seed ${start.seed} ${arm}`);
      }
  }
  return out;
}

/**
 * A paired percentile bootstrap over environments of the difference of a
 * statistic between two arms (every trial of a drawn environment kept).
 */
export function pairedBootstrap(
  results: readonly TrialResult[],
  a: Arm,
  b: Arm,
  stat: (rs: TrialResult[]) => number,
  resamples: number,
  seed: number,
): { estimate: number; lo: number; hi: number } {
  const envs = [...new Set(results.map((r) => r.environment))].sort((x, y) => x - y);
  const by = (arm: Arm, es: number[]) =>
    es.flatMap((e) => results.filter((r) => r.environment === e && r.arm === arm));
  const est = stat(by(a, envs)) - stat(by(b, envs));
  const rng = mulberry32(seed >>> 0);
  const vals: number[] = [];
  for (let k = 0; k < resamples; k++) {
    const draw = envs.map(() => envs[Math.floor(rng() * envs.length)]!);
    vals.push(stat(by(a, draw)) - stat(by(b, draw)));
  }
  vals.sort((x, y) => x - y);
  const q = (u: number) => vals[Math.min(vals.length - 1, Math.floor(u * vals.length))]!;
  return { estimate: r6(est), lo: r6(q(0.025)), hi: r6(q(0.975)) };
}

export const survival = (rs: TrialResult[]) =>
  rs.filter((r) => r.alive).length / Math.max(1, rs.length);
export const meanOf =
  (k: "survived_h" | "hydrated_share" | "hot_h" | "max_temp_c") => (rs: TrialResult[]) =>
    rs.reduce((s, r) => s + (r[k] ?? 0), 0) / Math.max(1, rs.length);
