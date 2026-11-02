/**
 * Does acquired search pay in the fly's own world? Research flies on the real
 * city map: nobody feeds them by a rule, and whatever they come to prefer they
 * learn from where food happens to lie. Each seed lives twice, as the organism
 * and with the layer; the two are the same fly until the layer's third meal.
 *
 * A fresh research life with no store: this reaches no individual and no
 * archive.
 */
import { OrganismLife } from "../organism.js";
import { AcquiredLife } from "./adapter.js";
import { SITUATION } from "./search.js";
import { interval } from "./study.js";

export type CityArm = "organism" | "layer";

export interface CityPeriod {
  /** Simulated hours at the end of this period. */
  h: number;
  meals: number;
  fedJ: number;
  spentJ: number;
  maintenanceJ: number;
  recoveryBouts: number;
  flownM: number;
  /** The reserve at the end, and averaged over the period, as shares of full. */
  reserve: number;
  meanReserve: number;
}

export interface CityResult {
  seed: number;
  arm: CityArm;
  periods: CityPeriod[];
  /** The layer's arm only: what it came to think, and what it did about it. */
  counted?: number;
  lifts?: Record<string, number>;
  did?: Record<string, number>;
  wallS: number;
}

/** The research city: the live population, not the small one the tests use. */
export const CITY_CONFIG = {
  pedestrians: 140,
  vehicles: 32,
  buses: 6,
  statisticalPopulation: 900,
} as const;

export function runCity(
  seed: number,
  arm: CityArm,
  hours: number,
  everyH = 3,
): CityResult {
  const started = Date.now();
  const config = { seed, ...CITY_CONFIG };
  const life = arm === "layer" ? new AcquiredLife(config) : new OrganismLife(config);
  const fly = life.cityFly.fly;
  const periods: CityPeriod[] = [];
  const stepTicks = 600;
  const last = { meals: 0, fedJ: 0, spentJ: 0, maintenanceJ: 0, bouts: 0, flownM: 0 };
  const steps = Math.round((everyH * 36000) / stepTicks);
  for (let h = everyH; h <= hours + 1e-9; h += everyH) {
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      life.advanceTicks(stepTicks);
      sum += fly.state.reserve / fly.params.reserveJ;
    }
    const c = fly.state.counts;
    const p = life.organismStatus().physiology;
    periods.push({
      h,
      meals: c.meals - last.meals,
      fedJ: c.fedJ - last.fedJ,
      spentJ: c.spentJ - last.spentJ,
      maintenanceJ: p.maintenanceJ - last.maintenanceJ,
      recoveryBouts: p.recoveryBouts - last.bouts,
      flownM: c.flownM - last.flownM,
      reserve: fly.state.reserve / fly.params.reserveJ,
      meanReserve: sum / steps,
    });
    last.meals = c.meals;
    last.fedJ = c.fedJ;
    last.spentJ = c.spentJ;
    last.maintenanceJ = p.maintenanceJ;
    last.bouts = p.recoveryBouts;
    last.flownM = c.flownM;
  }
  const out: CityResult = {
    seed,
    arm,
    periods,
    wallS: (Date.now() - started) / 1000,
  };
  if (life instanceof AcquiredLife) {
    const search = life.acquired.search;
    const g = search.state;
    out.counted = g.meals;
    out.lifts = Object.fromEntries(SITUATION.map((k, i) => [k, search.lift(i)]));
    out.did = {
      keptFlying: g.keptFlying,
      movedOn: g.movedOn,
      turnedBack: g.turnedBack,
      longFlights: g.longFlights,
    };
  }
  return out;
}

/** Layer less organism, by seed, over the periods after `fromH`. */
export function analyseCity(rows: readonly CityResult[], fromH: number) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const pairs = seeds.flatMap((seed) => {
    const layer = rows.find((r) => r.seed === seed && r.arm === "layer");
    const organism = rows.find((r) => r.seed === seed && r.arm === "organism");
    return layer && organism ? [{ seed, layer, organism }] : [];
  });
  const total = (r: CityResult, f: (p: CityPeriod) => number) =>
    r.periods.filter((p) => p.h > fromH).reduce((sum, p) => sum + f(p), 0);
  const gain = (f: (p: CityPeriod) => number) =>
    interval(pairs.map((p) => total(p.layer, f) - total(p.organism, f)));
  const baseline = (f: (p: CityPeriod) => number) =>
    pairs.reduce((sum, p) => sum + total(p.organism, f), 0) / pairs.length;
  const meanOf = (r: CityResult, f: (p: CityPeriod) => number) => {
    const ps = r.periods.filter((p) => p.h > fromH);
    return ps.reduce((sum, p) => sum + f(p), 0) / ps.length;
  };
  const net = (p: CityPeriod) => p.fedJ - p.spentJ;
  const meals = (p: CityPeriod) => p.meals;
  const bouts = (p: CityPeriod) => p.recoveryBouts;
  return {
    seeds: pairs.map((p) => p.seed),
    fromH,
    meals: { organism: baseline(meals), gain: gain(meals) },
    netJ: { organism: baseline(net), gain: gain(net) },
    recoveryBouts: { organism: baseline(bouts), gain: gain(bouts) },
    meanReserve: {
      organism:
        pairs.reduce((sum, p) => sum + meanOf(p.organism, (x) => x.meanReserve), 0) /
        pairs.length,
      gain: interval(
        pairs.map(
          (p) =>
            meanOf(p.layer, (x) => x.meanReserve) -
            meanOf(p.organism, (x) => x.meanReserve),
        ),
      ),
    },
  };
}
