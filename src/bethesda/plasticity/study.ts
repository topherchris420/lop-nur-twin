/**
 * A seeded study of ECHO's embodied plasticity (fly/echo/adaptiveBrain.ts) on
 * disposable research flies: never the deployed individual, a copy of it or a
 * continuation of it, and nothing here opens a store.
 *
 * Every fly is the deployed configuration (`OrganismAdapter`: ECHO v3, mushroom
 * body, olfaction, physiology) in the individuality yard, stepped as the
 * organism's own life steps it, with one arm's code:
 *
 * - `original`   the organism, unchanged;
 * - `shadow`     the organism plus plasticity in shadow mode (must equal original);
 * - `active`     the organism plus plasticity in active mode;
 * - `fixed-slow` ablation: every intended walk slowed by the same 0.7, with no
 *                learning, to separate "slower" from "learned when to be slower".
 *
 * in one of these conditions, each a schedule fixed by the plan:
 *
 * - `steady`      food at one site all run;
 * - `food-moves`  food moves to the next site every 20 simulated minutes;
 * - `weak-legs`   food moves, and from minute 10 the legs carry the body 35% as
 *                 far as they step (perturbation.ts `speedGain`);
 * - `noisy-sense` food moves, and from minute 10 the self-motion sense is four
 *                 times as noisy (`flowNoise`): its readings, not the body;
 * - `push`        food moves, and from minute 10 the ground carries the fly at
 *                 1 cm/s eastward (`drift`), an altered environment.
 *
 * and a restart scenario: `food-moves` checkpointed at minute 60 and restored, which
 * must continue exactly as the uninterrupted run.
 *
 * PLAN holds the seeds, durations, metrics, primary question and decision rule.
 * It was written before any held-out run; the dev seeds were looked at while the
 * code was written (docs/benchmarks/echo-plasticity/README.md says what was seen).
 */
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { DigitalFly } from "../fly/fly.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../fly/neural.js";
import { PERTURBATION_SCHEMA, type Perturbation } from "../fly/perturbation.js";
import { PrimitiveWorld } from "../fly/world.js";
import { DT } from "../simulation.js";
import {
  birth,
  checkpointLife,
  divergence,
  restoreLife,
  type LifeKind,
} from "../life/continuity.js";
import {
  FoodYard,
  SITE_NAMES,
  SITES,
  TICK_S,
  type SiteName,
} from "../life/individuality.js";
import { ORGANISM_LIFE, OrganismAdapter } from "../life/organism.js";
import { PlasticityOrganismAdapter } from "../life/plasticOrganism.js";
import {
  ADAPTIVE_BRAIN_VERSION,
  PLASTICITY_PARAMS,
  type AdaptiveBrainStatus,
} from "../fly/echo/adaptiveBrain.js";
import { mulberry32 } from "../../lib/noise.js";

export const PLASTICITY_STUDY = "echo-plasticity-study/v1" as const;

export const ARMS = ["original", "shadow", "active", "fixed-slow"] as const;
export type Arm = (typeof ARMS)[number];
export const CONDITIONS = [
  "steady",
  "food-moves",
  "weak-legs",
  "noisy-sense",
  "push",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const PLAN = Object.freeze({
  study: PLASTICITY_STUDY,
  brain: ADAPTIVE_BRAIN_VERSION,
  params: PLASTICITY_PARAMS,
  arms: ARMS,
  conditions: CONDITIONS,
  /** Simulated time per run. */
  hours: 2,
  /** When a perturbation begins (simulated s). */
  perturbFromS: 600,
  /** How often the food moves in the moving conditions (simulated s). */
  foodMoveS: 1200,
  /** The restart scenario's checkpoint (simulated s) and its condition. */
  restartAtS: 3600,
  restartCondition: "food-moves",
  startReserve: 0.5,
  seeds: {
    /** Looked at while the code was written. */
    dev: [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008],
    /** Fixed here before any run; run once. */
    heldout: Array.from({ length: 24 }, (_, i) => 9101 + i),
  },
  primary: {
    question:
      "In weak-legs, does active plasticity change meals relative to the original organism?",
    metric: "meals",
    condition: "weak-legs",
    contrast: ["active", "original"] as const,
    rule: "Claim a benefit only if the 95% bootstrap interval of the paired mean difference (active minus original) lies above zero; a harm only if it lies below; otherwise no difference is established. Every other contrast is secondary and reported the same way, without a claim.",
  },
  /** Shadow mode is a hard check, not a statistic: every metric and the body's final hash must equal the original's. */
  shadowCheck: "identical",
  bootstrap: { resamples: 10000, seed: 20261108 },
});

/** What every research fly is built from: plain data. */
export interface StudyGenesis {
  seed: number;
  arm: Arm;
  condition: Condition;
}

/** The ablation: every intended walk slowed by the active policy's factor, never learned. */
export class FixedSlowAdapter extends OrganismAdapter {
  protected override shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    const speed = intention.walkSpeed;
    if (intention.mode !== "walk" || input.body.edge || speed === undefined || speed <= 0)
      return intention;
    return { ...intention, walkSpeed: speed * PLASTICITY_PARAMS.cautiousScale };
  }
}

function adapterFor(arm: Arm) {
  return (rng: () => number, streams: AdapterStreams, seed: number): OrganismAdapter => {
    switch (arm) {
      case "original":
        return new OrganismAdapter(rng, streams, seed);
      case "shadow":
        return new PlasticityOrganismAdapter(rng, streams, seed, "shadow");
      case "active":
        return new PlasticityOrganismAdapter(rng, streams, seed, "active");
      case "fixed-slow":
        return new FixedSlowAdapter(rng, streams, seed);
    }
  };
}

export function perturbationFor(condition: Condition): Perturbation | undefined {
  const from = PLAN.perturbFromS;
  switch (condition) {
    case "weak-legs":
      return {
        schema: PERTURBATION_SCHEMA,
        episodes: [
          { id: "weak legs", cause: "self", from, until: null, speedGain: 0.35 },
        ],
      };
    case "noisy-sense":
      return {
        schema: PERTURBATION_SCHEMA,
        episodes: [
          { id: "noisy sense", cause: "sensor", from, until: null, flowNoise: 4 },
        ],
      };
    case "push":
      return {
        schema: PERTURBATION_SCHEMA,
        episodes: [
          { id: "push", cause: "external", from, until: null, drift: [0.01, 0] },
        ],
      };
    default:
      return undefined;
  }
}

/** The site food is at, at a tick: a fixed rotation starting from the seed's site. */
export function siteAt(g: StudyGenesis, tick: number): SiteName {
  const first = g.seed % SITE_NAMES.length;
  const moves =
    g.condition === "steady" ? 0 : Math.floor((tick * TICK_S) / PLAN.foodMoveS);
  return SITE_NAMES[(first + moves) % SITE_NAMES.length]!;
}

/** The life's tallies the body does not keep. Plain data, part of the graph. */
interface Tally {
  foodSite: SiteName;
  movedAtTick: number;
  mealsAtMove: number;
  /** Ticks from each food placement to the first meal there (censored placements are left out and counted). */
  latencies: number[];
  censored: number;
  walkingBlocks: number;
  wasBlocked: boolean;
  modeChanges: number;
  lastMode: string;
  walkingTicks: number;
}

export class StudyLife {
  readonly world: FoodYard;
  readonly fly: DigitalFly;
  readonly tally: Tally;
  readonly genesis: StudyGenesis;
  tick = 0;
  constructor(genesis: StudyGenesis) {
    this.genesis = genesis;
    this.world = new FoodYard();
    const random = mulberry32(genesis.seed ^ 0x5eed);
    const perturbation = perturbationFor(genesis.condition);
    this.fly = new DigitalFly({
      seed: genesis.seed,
      world: this.world,
      start: { p: [0, 0.0011, 0], yaw: random() * 2 * Math.PI },
      config: { startReserve: PLAN.startReserve },
      adapter: (rng, streams) => adapterFor(genesis.arm)(rng, streams, genesis.seed),
      ...(perturbation ? { perturbation } : {}),
    });
    const site = siteAt(genesis, 0);
    this.world.place({ site, at: [SITES[site][0], SITES[site][1]] });
    this.tally = {
      foodSite: site,
      movedAtTick: 0,
      mealsAtMove: 0,
      latencies: [],
      censored: 0,
      walkingBlocks: 0,
      wasBlocked: false,
      modeChanges: 0,
      lastMode: this.fly.state.mode,
      walkingTicks: 0,
    };
  }

  get organism(): OrganismAdapter {
    return this.fly.adapter as OrganismAdapter;
  }

  /** As `OrganismLife` steps the city's fly: maintenance into the reserve, then the body spends. */
  step(ticks: number): void {
    const a = this.organism,
      fly = this.fly,
      t = this.tally;
    for (let i = 0; i < ticks; i++) {
      const site = siteAt(this.genesis, this.tick);
      if (site !== t.foodSite) {
        if (fly.state.counts.meals === t.mealsAtMove) t.censored++;
        t.foodSite = site;
        t.movedAtTick = this.tick;
        t.mealsAtMove = fly.state.counts.meals;
        this.world.place({ site, at: [SITES[site][0], SITES[site][1]] });
      }
      const capacity = fly.params.reserveJ;
      const supplied = a.physiology.advance(DT, {
        mode: fly.state.mode,
        reserve: Math.min(fly.state.reserve, capacity),
        capacity,
      });
      if (supplied > 0)
        fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      const meals = fly.state.counts.meals;
      fly.advance(TICK_S);
      this.tick++;
      const s = fly.state;
      if (meals === t.mealsAtMove && s.counts.meals > meals)
        t.latencies.push(this.tick - t.movedAtTick);
      const blocked = s.mode === "walk" && s.edge;
      if (blocked && !t.wasBlocked) t.walkingBlocks++;
      t.wasBlocked = blocked;
      if (s.mode !== t.lastMode) {
        t.modeChanges++;
        t.lastMode = s.mode;
      }
      if (s.mode === "walk") t.walkingTicks++;
    }
  }
}

const ORGANISM_VERSIONS = Object.fromEntries(
  ["fly", "echo", "organism", "mushroomBody", "olfaction", "physiology"].map((k) => [
    k,
    ORGANISM_LIFE.versions[k]!,
  ]),
);

/** The research life as a `LifeKind`, so the restart scenario checkpoints and restores it as any life is. */
export const STUDY_KIND: LifeKind<StudyGenesis, StudyLife> = {
  id: "echo-plasticity-research-life",
  versions: {
    ...ORGANISM_VERSIONS,
    study: PLASTICITY_STUDY,
    plasticity: ADAPTIVE_BRAIN_VERSION,
  },
  build: (g) => new StudyLife(g),
  step: (life, ticks) => {
    for (let left = ticks; left > 0; left -= 10_000) life.step(Math.min(left, 10_000));
  },
  tick: (life) => life.tick,
  hash: (life) =>
    `${life.fly.stateHash()}|${canonicalJson(life.world.food)}|${canonicalJson(life.tally)}`,
  classes: [PrimitiveWorld],
};

export interface RunRecord {
  study: typeof PLASTICITY_STUDY;
  split: "dev" | "heldout";
  seed: number;
  arm: Arm;
  condition: Condition | "restart";
  ticks: number;
  meals: number;
  fedJ: number;
  spentJ: number;
  maintenanceJ: number;
  endReserve: number;
  collisions: number;
  walkingBlocks: number;
  rejected: number;
  walkedM: number;
  flownM: number;
  walkingShare: number;
  modeChangesPerHour: number;
  /** Mean ticks from a food placement to the first meal there, over placements reached; null if none. */
  meanLatencyS: number | null;
  placementsReached: number;
  placementsMissed: number;
  mushroomBodyTrials: number;
  plasticity: AdaptiveBrainStatus | null;
  /** The body and controller at the end, plasticity aside: equal for shadow and original exactly when shadow changed nothing. */
  bodyHash: string;
  /** Restart scenario only: whether the restored run ended exactly as the uninterrupted one. */
  restartIdentical?: boolean;
  restartLearningKept?: boolean;
}

/** The fly's body and controller state with any plasticity removed, hashed. */
export function bodyHash(life: StudyLife): string {
  const state = JSON.parse(JSON.stringify(life.organism.state)) as Record<
    string,
    unknown
  >;
  delete state.plasticity;
  return sha256(
    canonicalJson({
      body: life.fly.state,
      controller: state,
      tally: life.tally,
      food: life.world.food,
    }),
  );
}

function record(
  life: StudyLife,
  split: RunRecord["split"],
  condition: RunRecord["condition"],
): RunRecord {
  const s = life.fly.state,
    c = s.counts,
    t = life.tally,
    a = life.organism;
  const hours = (life.tick * TICK_S) / 3600;
  const plasticity =
    a instanceof PlasticityOrganismAdapter ? a.plasticity.status() : null;
  return {
    study: PLASTICITY_STUDY,
    split,
    seed: life.genesis.seed,
    arm: life.genesis.arm,
    condition,
    ticks: life.tick,
    meals: c.meals,
    fedJ: c.fedJ,
    spentJ: c.spentJ,
    maintenanceJ: a.physiology.state.maintenanceJ,
    endReserve: s.reserve / life.fly.params.reserveJ,
    collisions: c.collisions,
    walkingBlocks: t.walkingBlocks,
    rejected: c.rejected,
    walkedM: c.walkedM,
    flownM: c.flownM,
    walkingShare: t.walkingTicks / Math.max(1, life.tick),
    modeChangesPerHour: t.modeChanges / Math.max(1e-9, hours),
    meanLatencyS: t.latencies.length
      ? (t.latencies.reduce((x, y) => x + y, 0) / t.latencies.length) * TICK_S
      : null,
    placementsReached: t.latencies.length,
    placementsMissed: t.censored,
    mushroomBodyTrials: a.circuit.state.trials,
    plasticity,
    bodyHash: bodyHash(life),
  };
}

const TICKS = Math.round((PLAN.hours * 3600) / TICK_S);

/** One run, start to end. */
export function runOne(
  split: RunRecord["split"],
  seed: number,
  arm: Arm,
  condition: Condition,
): RunRecord {
  const life = STUDY_KIND.build({ seed, arm, condition });
  STUDY_KIND.step(life, TICKS);
  return record(life, split, condition);
}

/**
 * The restart scenario: checkpointed at `restartAtS` and restored from the
 * checkpoint alone, then run to the end beside the uninterrupted life.
 */
export function runRestart(split: RunRecord["split"], seed: number, arm: Arm): RunRecord {
  const g: StudyGenesis = { seed, arm, condition: PLAN.restartCondition };
  const life = STUDY_KIND.build(g);
  const at = Math.round(PLAN.restartAtS / TICK_S);
  STUDY_KIND.step(life, at);
  const checkpoint = checkpointLife(STUDY_KIND, life, {
    genesis: g,
    birth: birth(STUDY_KIND.id, g, (seed >>> 0).toString(16).padStart(32, "0")),
    previous: null,
  });
  const restored = restoreLife(STUDY_KIND, checkpoint);
  const learningKept =
    !(life.organism instanceof PlasticityOrganismAdapter) ||
    JSON.stringify((restored.organism as PlasticityOrganismAdapter).plasticity.state) ===
      JSON.stringify(life.organism.plasticity.state);
  const mismatch = divergence(STUDY_KIND, life, restored, [TICKS - at]);
  return {
    ...record(restored, split, "restart"),
    restartIdentical: mismatch === null,
    restartLearningKept: learningKept,
  };
}

/** Every run a split takes: arms × conditions × seeds, then the restart scenario per arm. */
export function runsOf(split: "dev" | "heldout") {
  const runs: { seed: number; arm: Arm; condition: Condition | "restart" }[] = [];
  for (const seed of PLAN.seeds[split])
    for (const condition of [...CONDITIONS, "restart" as const])
      for (const arm of ARMS) runs.push({ seed, arm, condition });
  return runs;
}

export function execute(
  split: "dev" | "heldout",
  run: { seed: number; arm: Arm; condition: Condition | "restart" },
): RunRecord {
  return run.condition === "restart"
    ? runRestart(split, run.seed, run.arm)
    : runOne(split, run.seed, run.arm, run.condition);
}
