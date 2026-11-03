/**
 * Does a fly learn how widely to search, carry that somewhere new, and do better
 * for it? A crossover, as study.ts: the same seed lives where food comes back
 * close by, or where it comes back far away, and is then tested in unseen yards
 * of both kinds, with what it learned kept and with it erased. Then the question
 * that matters most: research flies on the real map, with no one feeding them by
 * a rule, as the organism and with the learner.
 *
 * Every subject is built from a seed for the study. None is the deployed fly, a
 * copy of it, or a continuation of it, and nothing here reads or writes a store.
 */
import type { Navigator } from "../../fly/navigation.js";
import type { ReducedOrderController } from "../../fly/controller.js";
import { OrganismLife } from "../organism.js";
import {
  ceilingLayout,
  FixedSearchAdapter,
  FOOD_WORLDS,
  SEARCH_ARMS,
  foodAround,
  type FoodBand,
  type FoodWorld,
} from "./ceiling.js";
import { CITY_CONFIG, livePeriods, type CityPeriod } from "./cityStudy.js";
import {
  noRangingMemory,
  RANGING_VERSION,
  RangingAdapter,
  RangingLife,
  type RangingMemory,
} from "./ranging.js";
import { interval } from "./study.js";
import { guardWalls, type WallGuard } from "./wallGuard.js";
import { sunFrom, YardSubject, type YardLayout } from "./yard.js";

export type TrainWorld = FoodWorld | "mixed";
export const TRAIN_WORLDS: readonly TrainWorld[] = ["near", "far", "mixed"];
const TEST_WORLDS: readonly FoodWorld[] = ["near", "far"];
export type MemoryArm = "learned" | "erased";

export interface RangingDesign {
  trainH: number;
  moveS: number;
  stayH: number;
  stayReserve: number;
  split: "dev" | "heldout";
}

export const RANGING_DESIGN: RangingDesign = {
  trainH: 48,
  moveS: 1800,
  stayH: 8,
  stayReserve: 0.5,
  split: "dev",
};

/** Where training food comes back, by split. */
const TRAIN_BANDS: Record<RangingDesign["split"], Record<FoodWorld, FoodBand>> = {
  dev: FOOD_WORLDS,
  heldout: {
    near: { minM: 35, maxM: 70, patches: 4 },
    far: { minM: 130, maxM: 260, patches: 16 },
  },
};
/** And in the unseen yards: other bands, overlapping the training ones only in part. */
const TEST_BANDS: Record<RangingDesign["split"], Record<FoodWorld, FoodBand>> = {
  dev: {
    near: { minM: 20, maxM: 45, patches: 3 },
    far: { minM: 200, maxM: 350, patches: 18 },
  },
  heldout: {
    near: { minM: 25, maxM: 55, patches: 3 },
    far: { minM: 220, maxM: 380, patches: 18 },
  },
};

export function rangingTrainLayout(
  seed: number,
  split: RangingDesign["split"],
): YardLayout {
  return split === "dev"
    ? ceilingLayout(seed)
    : {
        seed: 8000 + seed * 5,
        half: 1000,
        cell: 170,
        canopyY: 10,
        sun: sunFrom(3.9, 1.0),
        shaded: 0.4,
      };
}

export function rangingTestLayout(
  seed: number,
  k: number,
  split: RangingDesign["split"],
): YardLayout {
  return split === "dev"
    ? {
        seed: 7500 + seed * 3 + k,
        half: 800 + 50 * (k % 3),
        cell: 100 + 20 * (k % 3),
        canopyY: 7 + (k % 3),
        sun: sunFrom(2.5 + k, 1.15),
        shaded: 0.5,
      }
    : {
        seed: 8500 + seed * 7 + k,
        half: 850 + 70 * (k % 3),
        cell: 80 + 70 * (k % 2),
        canopyY: 5.5 + 0.5 * (k % 2),
        sun: sunFrom(1.1 + 1.3 * k, 1.0),
        shaded: 0.35 + 0.25 * (k % 2),
      };
}

export interface StayRecord {
  world: FoodWorld;
  memory: MemoryArm;
  way: number;
  meals: number;
  fedJ: number;
  spentJ: number;
  flownM: number;
  flying: number;
}

export interface RangingResult {
  study: typeof RANGING_VERSION;
  seed: number;
  trained: TrainWorld;
  design: RangingDesign;
  training: {
    meals: number;
    fedJ: number;
    spentJ: number;
    flownM: number;
    blocks: number[];
    averages: (number | null)[];
    clearance: number;
    settledOn: number;
  };
  stays: StayRecord[];
  wallS: number;
}

interface NavLike {
  goal: unknown;
  search: unknown;
  places: unknown[];
}

export function runRanging(
  seed: number,
  trained: TrainWorld,
  design: RangingDesign = RANGING_DESIGN,
): RangingResult {
  const started = Date.now();
  const sub = new YardSubject({
    seed,
    layout: rangingTrainLayout(seed, design.split),
    adapter: (rng, streams, s) => new RangingAdapter(rng, streams, s),
  });
  const fly = sub.fly;
  const adapter = sub.organism as RangingAdapter;
  const learner = adapter.ranging;
  const inner = (
    adapter as unknown as {
      inner: { state: ReducedOrderController["state"]; nav: Navigator };
    }
  ).inner;
  const nav = inner.state.nav as unknown as NavLike;
  let placed = 0;

  /** Live here for a while, food coming back by the band after each meal. */
  const live = (band: (n: number) => FoodBand, hours: number) => {
    const place = () => {
      const n = ++placed;
      sub.yard.setFood(
        foodAround(
          sub.yard.layout,
          [fly.state.p[0], fly.state.p[2]],
          band(n),
          (seed * 131 + n) >>> 0,
        ),
      );
    };
    place();
    let seen = fly.state.counts.meals,
      lastMove = 0,
      flying = 0;
    const seconds = Math.round(hours * 3600);
    for (let t = 0; t < seconds; t++) {
      sub.step(10);
      if (fly.state.mode === "flight") flying++;
      const meals = fly.state.counts.meals;
      if ((meals > seen && fly.state.mode !== "feed") || t - lastMove >= design.moveS) {
        seen = meals;
        lastMove = t;
        place();
      }
    }
    return flying / Math.max(1, seconds);
  };

  const trainBands = TRAIN_BANDS[design.split];
  live(
    (n) =>
      trained === "mixed" ? trainBands[n % 2 ? "near" : "far"] : trainBands[trained],
    design.trainH,
  );
  const c = fly.state.counts;
  const memory = learner.memory();
  const training = {
    meals: c.meals,
    fedJ: c.fedJ,
    spentJ: c.spentJ,
    flownM: c.flownM,
    blocks: [...memory.blocks],
    averages: memory.blocks.map((_, i) => learner.average(i)),
    clearance: learner.clearance(),
    settledOn: learner.best(),
  };

  const stays: StayRecord[] = [];
  const stay = (k: number, world: FoodWorld, arm: MemoryArm, kept: RangingMemory) => {
    sub.untilPerched();
    const here: [number, number] = [fly.state.p[0], fly.state.p[2]];
    sub.yard.enter({ ...rangingTestLayout(seed, k, design.split), origin: here }, []);
    learner.hold(arm === "learned" ? kept : noRangingMemory());
    fly.state.reserve = design.stayReserve * fly.params.reserveJ;
    nav.goal = null;
    nav.search = null;
    nav.places.length = 0;
    const before = { ...fly.state.counts };
    const flying = live(() => TEST_BANDS[design.split][world], design.stayH);
    const after = fly.state.counts;
    stays.push({
      world,
      memory: arm,
      way: learner.state.way,
      meals: after.meals - before.meals,
      fedJ: after.fedJ - before.fedJ,
      spentJ: after.spentJ - before.spentJ,
      flownM: after.flownM - before.flownM,
      flying,
    });
  };

  let k = 0;
  for (const world of TEST_WORLDS) {
    const arms: MemoryArm[] =
      (seed + k) % 2 ? ["learned", "erased"] : ["erased", "learned"];
    for (const arm of arms) stay(k, world, arm, memory);
    k++;
  }
  return {
    study: RANGING_VERSION,
    seed,
    trained,
    design,
    training,
    stays,
    wallS: (Date.now() - started) / 1000,
  };
}

const mean = (v: readonly number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;

/** Report the crossover: gain is learned less erased, by seed. */
export function analyseRanging(rows: readonly RangingResult[]) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const net = (s: StayRecord) => s.fedJ - s.spentJ;
  const cell = (r: RangingResult, world: FoodWorld, memory: MemoryArm) =>
    r.stays.find((s) => s.world === world && s.memory === memory)!;
  const gain = (r: RangingResult, world: FoodWorld, f: (s: StayRecord) => number) =>
    f(cell(r, world, "learned")) - f(cell(r, world, "erased"));
  const fly = (seed: number, trained: TrainWorld) =>
    rows.find((r) => r.seed === seed && r.trained === trained);
  const pairs = seeds.flatMap((seed) => {
    const near = fly(seed, "near"),
      far = fly(seed, "far");
    return near && far ? [{ seed, near, far }] : [];
  });
  const meals = (s: StayRecord) => s.meals;
  const flown = (s: StayRecord) => s.flownM;
  const trio = (f: (s: StayRecord) => number) => ({
    /** Each trained fly, in the world it trained for. */
    farInFar: interval(pairs.map((p) => gain(p.far, "far", f))),
    nearInNear: interval(pairs.map((p) => gain(p.near, "near", f))),
    farInNear: interval(pairs.map((p) => gain(p.far, "near", f))),
    nearInFar: interval(pairs.map((p) => gain(p.near, "far", f))),
    matched: interval(
      pairs.map((p) => (gain(p.far, "far", f) + gain(p.near, "near", f)) / 2),
    ),
    crossed: interval(
      pairs.map((p) => (gain(p.far, "near", f) + gain(p.near, "far", f)) / 2),
    ),
    specific: interval(
      pairs.map(
        (p) =>
          (gain(p.far, "far", f) + gain(p.near, "near", f)) / 2 -
          (gain(p.far, "near", f) + gain(p.near, "far", f)) / 2,
      ),
    ),
  });
  const settled = (trained: TrainWorld) => {
    const here = rows.filter((r) => r.trained === trained);
    return {
      flies: here.length,
      settledWide: here.filter((r) => r.training.settledOn === 1).length,
      clearance: mean(here.map((r) => r.training.clearance)),
      meals: mean(here.map((r) => r.training.meals)),
      wideBlocks: mean(here.map((r) => r.training.blocks[1]!)),
    };
  };
  /** The sign of the shift: flying more for having trained far, less for near. */
  const preference = interval(
    pairs.map(
      (p) =>
        (gain(p.far, "far", flown) + gain(p.far, "near", flown)) / 2 -
        (gain(p.near, "far", flown) + gain(p.near, "near", flown)) / 2,
    ),
  );
  const baseline = (world: FoodWorld, f: (s: StayRecord) => number) =>
    mean(
      pairs.flatMap((p) => [
        f(cell(p.far, world, "erased")),
        f(cell(p.near, world, "erased")),
      ]),
    );
  return {
    study: RANGING_VERSION,
    seeds: pairs.map((p) => p.seed),
    settled: Object.fromEntries(TRAIN_WORLDS.map((t) => [t, settled(t)])),
    preference,
    meals: trio(meals),
    netJ: trio(net),
    flownM: trio(flown),
    baseline: {
      near: { meals: baseline("near", meals), netJ: baseline("near", net) },
      far: { meals: baseline("far", meals), netJ: baseline("far", net) },
    },
  };
}

export type RangingCityArm = "organism" | "learner" | "roam";

export interface RangingCityResult {
  seed: number;
  arm: RangingCityArm;
  periods: CityPeriod[];
  blocks?: number[];
  averages?: (number | null)[];
  clearance?: number;
  settledOn?: number;
  /** With the wall guard on: what it had to refuse. */
  guard?: WallGuard;
  /** Where the fly was at the end of each period, and whether inside a solid. */
  track?: { h: number; at: [number, number]; inside: boolean }[];
  wallS: number;
}

/** A research life on the real map, as the organism or with the learner. */
export function runRangingCity(
  seed: number,
  arm: RangingCityArm,
  hours: number,
  everyH = 3,
  guarded = false,
): RangingCityResult {
  const started = Date.now();
  const config = { seed, ...CITY_CONFIG };
  const life =
    arm === "learner"
      ? new RangingLife(config)
      : arm === "roam"
        ? new OrganismLife(
            config,
            (rng, streams, s) =>
              new FixedSearchAdapter(rng, streams, s, SEARCH_ARMS.roam),
          )
        : new OrganismLife(config);
  const fly = life.cityFly.fly;
  const guard = guarded ? guardWalls(fly) : undefined;
  const track: NonNullable<RangingCityResult["track"]> = [];
  const periods = livePeriods(life, hours, everyH, (h) => {
    const p = fly.state.p;
    track.push({
      h,
      at: [Math.round(p[0] * 10) / 10, Math.round(p[2] * 10) / 10],
      inside: fly.world.solid(p),
    });
  });
  const out: RangingCityResult = {
    seed,
    arm,
    periods,
    track,
    ...(guard ? { guard } : {}),
    wallS: (Date.now() - started) / 1000,
  };
  if (life instanceof RangingLife) {
    const l = life.learner;
    out.blocks = [...l.state.blocks];
    out.averages = l.state.blocks.map((_, i) => l.average(i));
    out.clearance = l.clearance();
    out.settledOn = l.best();
  }
  return out;
}

/** Each arm less the organism, by seed, over the periods after `fromH`. */
export function analyseRangingCity(rows: readonly RangingCityResult[], fromH: number) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const row = (seed: number, arm: RangingCityArm) =>
    rows.find((r) => r.seed === seed && r.arm === arm);
  const total = (r: RangingCityResult, f: (p: CityPeriod) => number) =>
    r.periods.filter((p) => p.h > fromH).reduce((sum, p) => sum + f(p), 0);
  const meals = (p: CityPeriod) => p.meals;
  const compare = (arm: RangingCityArm, against: RangingCityArm) => {
    const pairs = seeds.flatMap((seed) => {
      const a = row(seed, arm),
        b = row(seed, against);
      return a && b ? [{ a, b }] : [];
    });
    const measure = (f: (p: CityPeriod) => number) => ({
      arm: mean(pairs.map((p) => total(p.a, f))),
      against: mean(pairs.map((p) => total(p.b, f))),
      gain: interval(pairs.map((p) => total(p.a, f) - total(p.b, f))),
    });
    return {
      seeds: pairs.length,
      meals: measure(meals),
      netJ: measure((p) => p.fedJ - p.spentJ),
      recoveryBouts: measure((p) => p.recoveryBouts),
      flownM: measure((p) => p.flownM),
    };
  };
  const starved = (arm: RangingCityArm) => {
    const here = rows.filter((r) => r.arm === arm);
    return {
      flies: here.length,
      underFiveMeals: here.filter((r) => total(r, meals) < 5).length,
    };
  };
  const learners = rows.filter((r) => r.arm === "learner");
  return {
    seeds,
    fromH,
    learnerVsOrganism: compare("learner", "organism"),
    roamVsOrganism: compare("roam", "organism"),
    learnerVsRoam: compare("learner", "roam"),
    starved: {
      organism: starved("organism"),
      learner: starved("learner"),
      roam: starved("roam"),
    },
    settledWide: learners.filter((r) => r.settledOn === 1).length,
    wideShare: mean(
      learners.map((r) => {
        const b = r.blocks!;
        return b[1]! / Math.max(1, b[0]! + b[1]!);
      }),
    ),
    clearance: mean(learners.map((r) => r.clearance!)),
    perSeedMeals: seeds.map((seed) => ({
      seed,
      organism: row(seed, "organism") ? total(row(seed, "organism")!, meals) : null,
      learner: row(seed, "learner") ? total(row(seed, "learner")!, meals) : null,
      roam: row(seed, "roam") ? total(row(seed, "roam")!, meals) : null,
      settledOn: row(seed, "learner")?.settledOn ?? null,
    })),
  };
}
