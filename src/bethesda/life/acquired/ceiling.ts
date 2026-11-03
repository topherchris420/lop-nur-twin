/**
 * Could searching differently pay at all? Asked before anything is built to
 * learn it. Research flies are handed a fixed way of searching, how far a long
 * flight goes and how often a takeoff starts one, and live with it in yards and
 * on the real map. No learning happens here.
 *
 * A setting that beats the default nowhere leaves a learner nothing to find. One
 * that wins everywhere needs no learner, only a different number. Learning can
 * pay only if the best setting depends on the world the fly is in.
 *
 * Research lives with no store: this reaches no individual and no archive.
 */
import { mulberry32 } from "../../../lib/noise.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../../fly/neural.js";
import type { FoodPatch } from "../../fly/world.js";
import { OrganismAdapter, OrganismLife } from "../organism.js";
import { CITY_CONFIG, livePeriods, type CityPeriod } from "./cityStudy.js";
import { interval } from "./study.js";
import { sunFrom, YardSubject, type YardLayout } from "./yard.js";

export interface SearchSetting {
  /** Mean distance of a long flight (m). */
  exploreDistanceM: number;
  /** Share of spontaneous takeoffs that start one. */
  exploreShare: number;
}

export const SEARCH_ARMS = {
  default: { exploreDistanceM: 60, exploreShare: 0.3 },
  short: { exploreDistanceM: 15, exploreShare: 0.3 },
  long: { exploreDistanceM: 240, exploreShare: 0.3 },
  roam: { exploreDistanceM: 240, exploreShare: 0.8 },
} as const satisfies Record<string, SearchSetting>;
export type SearchArm = keyof typeof SEARCH_ARMS;
export const SEARCH_ARM_NAMES = Object.keys(SEARCH_ARMS) as SearchArm[];

/** The organism, searching by a fixed setting. Everything else is unchanged. */
export class FixedSearchAdapter extends OrganismAdapter {
  private readonly setting: SearchSetting;
  constructor(
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
    setting: SearchSetting,
  ) {
    super(rng, streams, seed);
    this.setting = setting;
  }
  override decide(input: DecisionInput): MotorCommand {
    return super.decide({ ...input, params: { ...input.params, ...this.setting } });
  }
}

/** How far from the fly a yard's food comes back after a meal, and how much of it. */
export interface FoodBand {
  minM: number;
  maxM: number;
  patches: number;
}

export const FOOD_WORLDS = {
  near: { minM: 30, maxM: 60, patches: 4 },
  far: { minM: 150, maxM: 300, patches: 16 },
} as const satisfies Record<string, FoodBand>;
export type FoodWorld = keyof typeof FOOD_WORLDS;
export const FOOD_WORLD_NAMES = Object.keys(FOOD_WORLDS) as FoodWorld[];

/** Food at this distance from a point, inside the yard, and apart from each other. */
export function foodAround(
  layout: YardLayout,
  at: readonly [number, number],
  band: FoodBand,
  seed: number,
  kind = "food",
): FoodPatch[] {
  const { minM, maxM, patches } = band;
  const r = mulberry32(seed >>> 0);
  const out: FoodPatch[] = [];
  const h = layout.half - 2;
  const [ox, oz] = layout.origin ?? [0, 0];
  for (let tries = 0; tries < 20000 && out.length < patches; tries++) {
    const a = r() * 2 * Math.PI;
    const d = minM + r() * (maxM - minM);
    const x = at[0] + Math.cos(a) * d;
    const z = at[1] + Math.sin(a) * d;
    if (Math.abs(x - ox) > h || Math.abs(z - oz) > h) continue;
    if (out.some((f) => Math.hypot(f.center[0] - x, f.center[2] - z) < 25)) continue;
    out.push({
      id: `food ${seed} ${out.length}`,
      kind,
      center: [x, 0, z],
      surface: "ground",
      radius: 0.25,
    });
  }
  return out;
}

/** A yard large enough that a long flight does not simply meet its edge. */
export const ceilingLayout = (seed: number): YardLayout => ({
  seed: 7000 + seed,
  half: 900,
  cell: 120,
  canopyY: 8,
  sun: sunFrom(0.6, 1.2),
  shaded: 0.5,
});

export interface YardCeilingResult {
  seed: number;
  arm: SearchArm;
  world: FoodWorld;
  hours: number;
  meals: number;
  fedJ: number;
  spentJ: number;
  flownM: number;
  flying: number;
  wallS: number;
}

export function runYardCeiling(
  seed: number,
  arm: SearchArm,
  world: FoodWorld,
  hours = 8,
  moveS = 1800,
): YardCeilingResult {
  const started = Date.now();
  const layout = ceilingLayout(seed);
  const sub = new YardSubject({
    seed,
    layout,
    adapter: (rng, streams, s) =>
      new FixedSearchAdapter(rng, streams, s, SEARCH_ARMS[arm]),
  });
  const fly = sub.fly;
  let placed = 0;
  const place = () => {
    sub.yard.setFood(
      foodAround(
        layout,
        [fly.state.p[0], fly.state.p[2]],
        FOOD_WORLDS[world],
        seed ^ (0x4000 + ++placed),
        world,
      ),
    );
  };
  place();
  let seen = 0,
    lastMove = 0,
    flying = 0;
  const seconds = hours * 3600;
  for (let t = 0; t < seconds; t++) {
    sub.step(10);
    if (fly.state.mode === "flight") flying++;
    const c = fly.state.counts;
    if ((c.meals > seen && fly.state.mode !== "feed") || t - lastMove >= moveS) {
      seen = c.meals;
      lastMove = t;
      place();
    }
  }
  const c = fly.state.counts;
  return {
    seed,
    arm,
    world,
    hours,
    meals: c.meals,
    fedJ: c.fedJ,
    spentJ: c.spentJ,
    flownM: c.flownM,
    flying: flying / seconds,
    wallS: (Date.now() - started) / 1000,
  };
}

export interface CityCeilingResult {
  seed: number;
  arm: SearchArm;
  periods: CityPeriod[];
  wallS: number;
}

export function runCityCeiling(
  seed: number,
  arm: SearchArm,
  hours: number,
  everyH = 3,
): CityCeilingResult {
  const started = Date.now();
  const life = new OrganismLife(
    { seed, ...CITY_CONFIG },
    (rng, streams, s) => new FixedSearchAdapter(rng, streams, s, SEARCH_ARMS[arm]),
  );
  const periods = livePeriods(life, hours, everyH);
  return { seed, arm, periods, wallS: (Date.now() - started) / 1000 };
}

const mean = (v: readonly number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;

/** Each setting against the default by seed, in each kind of yard. */
export function analyseYardCeiling(rows: readonly YardCeilingResult[]) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const at = (seed: number, arm: SearchArm, world: FoodWorld) =>
    rows.find((r) => r.seed === seed && r.arm === arm && r.world === world);
  const net = (r: YardCeilingResult) => r.fedJ - r.spentJ;
  const worlds = Object.fromEntries(
    FOOD_WORLD_NAMES.map((world) => [
      world,
      Object.fromEntries(
        SEARCH_ARM_NAMES.map((arm) => {
          const here = seeds.flatMap((s) => {
            const a = at(s, arm, world),
              b = at(s, "default", world);
            return a && b ? [{ a, b }] : [];
          });
          return [
            arm,
            {
              seeds: here.length,
              meals: mean(here.map((p) => p.a.meals)),
              netJ: mean(here.map((p) => net(p.a))),
              flownM: mean(here.map((p) => p.a.flownM)),
              flying: mean(here.map((p) => p.a.flying)),
              mealsGain: interval(here.map((p) => p.a.meals - p.b.meals)),
              netGain: interval(here.map((p) => net(p.a) - net(p.b))),
            },
          ];
        }),
      ),
    ]),
  );
  /** Does long beat short by more where food is far: the room a learner would have. */
  const crossing = (f: (r: YardCeilingResult) => number, far: SearchArm) =>
    interval(
      seeds.flatMap((s) => {
        const a = at(s, far, "far"),
          b = at(s, "short", "far"),
          c = at(s, far, "near"),
          d = at(s, "short", "near");
        return a && b && c && d ? [f(a) - f(b) - (f(c) - f(d))] : [];
      }),
    );
  return {
    seeds,
    worlds,
    crossing: {
      longMeals: crossing((r) => r.meals, "long"),
      longNetJ: crossing(net, "long"),
      roamMeals: crossing((r) => r.meals, "roam"),
      roamNetJ: crossing(net, "roam"),
    },
  };
}

/** Each setting against the default by seed, over the periods after `fromH`. */
export function analyseCityCeiling(rows: readonly CityCeilingResult[], fromH: number) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const total = (r: CityCeilingResult, f: (p: CityPeriod) => number) =>
    r.periods.filter((p) => p.h > fromH).reduce((sum, p) => sum + f(p), 0);
  const net = (p: CityPeriod) => p.fedJ - p.spentJ;
  const arms = Object.fromEntries(
    SEARCH_ARM_NAMES.map((arm) => {
      const here = seeds.flatMap((s) => {
        const a = rows.find((r) => r.seed === s && r.arm === arm),
          b = rows.find((r) => r.seed === s && r.arm === "default");
        return a && b ? [{ a, b }] : [];
      });
      return [
        arm,
        {
          seeds: here.length,
          meals: mean(here.map((p) => total(p.a, (x) => x.meals))),
          netJ: mean(here.map((p) => total(p.a, net))),
          flownM: mean(here.map((p) => total(p.a, (x) => x.flownM))),
          recoveryBouts: mean(here.map((p) => total(p.a, (x) => x.recoveryBouts))),
          mealsGain: interval(
            here.map((p) => total(p.a, (x) => x.meals) - total(p.b, (x) => x.meals)),
          ),
          netGain: interval(here.map((p) => total(p.a, net) - total(p.b, net))),
          perSeedMeals: here.map((p) => total(p.a, (x) => x.meals)),
        },
      ];
    }),
  );
  return { seeds, fromH, arms };
}
