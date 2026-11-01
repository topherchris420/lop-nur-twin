/**
 * circuit-informed/v2's fits: how its seven `fitted` values are set
 * (`../circuits/v2/params.ts`). Each is a deterministic search against named
 * development observations, on the report's own flies (the same seeds as
 * `report.ts`), so the report reproduces what the fit reached. Those
 * observations are fit targets of v2, never tests of it.
 *
 * The order follows the dependencies, and each fit keeps the values the
 * earlier ones reached:
 *
 * 1. Flight: the spontaneous saccade rate, by bisection, to the saccade rate
 *    of flies in Censi et al.'s arena (the paradigm's own detector).
 * 2. Exploration: for each τ on a grid, A by bisection to minute 1's share
 *    of time moving; τ is the grid value whose (τ, A) gives the least summed
 *    squared error over minutes 1–3 (Liu, Davis & Roman 2007).
 * 3. Walking speed: the gamma's mean, by bisection, to the mean of the three
 *    minutes' walking speeds.
 * 4. Centrophobia, by bisection, to the share of time in the outer third.
 * 5. Freezing and jumping (Zacarias et al. 2018), by bisection, in two rounds:
 *    pFreeze to the share of flies freezing at the end of the looms, then
 *    qJump to the share of looms followed by a jump.
 *
 * Bisection runs on a seeded but not strictly monotone function (a changed
 * value changes later draws), so it keeps the evaluated point nearest its
 * target. Every step is recorded in fit.json.
 */
import { V2_FIT_TARGETS, V2_PARAMS, type V2Config } from "../circuits/v2/params.js";
import { observation } from "./observations.js";
import {
  censiRate,
  measureLiu,
  measureZacarias,
  SIZES,
  type Measured,
} from "./report.js";
import { v2Subject } from "./subjects.js";

type Log = (line: string) => void;

export interface Step {
  x: number;
  y: number;
}
export interface BisectionFit {
  target: number;
  steps: Step[];
  value: number;
  reached: number;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Bisection of `f` (increasing if `rising`) toward `target` on [lo, hi],
 * `iterations` midpoints, values rounded to `digits`; keeps the evaluated
 * point nearest the target.
 */
function bisect(
  f: (x: number) => number,
  lo: number,
  hi: number,
  target: number,
  rising: boolean,
  iterations: number,
  digits: number,
): BisectionFit {
  const steps: Step[] = [];
  const at = (x: number) => {
    const y = f(x);
    steps.push({ x, y: round(y, 6) });
    return y;
  };
  at(lo);
  at(hi);
  for (let k = 0; k < iterations; k++) {
    const mid = round((lo + hi) / 2, digits);
    if (mid === lo || mid === hi) break;
    const y = at(mid);
    if (y < target === rising) lo = mid;
    else hi = mid;
  }
  let best = steps[0]!;
  for (const s of steps) if (Math.abs(s.y - target) < Math.abs(best.y - target)) best = s;
  return { target, steps, value: best.x, reached: best.y };
}

const valueOf = (m: Measured, id: string): number => {
  const v = m.get(id)?.value;
  if (v === null || v === undefined)
    throw new Error(`v2 fit: nothing measured for ${id}`);
  return v;
};
const target = (id: string) => observation(id).value!;

export interface V2Fit {
  method: string;
  flight: BisectionFit;
  explore: {
    grid: { exploreTauS: number; exploreGain: number; minutes: number[]; sse: number }[];
    exploreTauS: number;
    exploreGain: number;
  };
  speed: BisectionFit;
  wall: BisectionFit;
  defence: { round: number; freeze: BisectionFit; jump: BisectionFit }[];
  values: Required<
    Pick<
      V2Config,
      | "flightSaccadeHz"
      | "exploreGain"
      | "exploreTauS"
      | "walkSpeedMeanCmS"
      | "centrophobia"
      | "freezeMax"
      | "jumpShare"
    >
  >;
}

/** τ values (s) the exploration fit tries. */
export const EXPLORE_TAU_GRID = [30, 45, 60, 90, 120, 180, 240, 360, 600] as const;

/**
 * Where the fit starts: each fitted value before its own step. Fixed here, not
 * read from the table, so a refit never depends on the last fit's values.
 */
export const V2_FIT_START = {
  flightSaccadeHz: 1,
  exploreGain: 0,
  exploreTauS: 90,
  walkSpeedMeanCmS: 1.2,
  centrophobia: 0,
  freezeMax: 0.5,
  jumpShare: 0.1,
} as const satisfies V2Fit["values"];

export function fitV2(log: Log = () => {}): V2Fit {
  const v: V2Fit["values"] = { ...V2_FIT_START };
  const subject = () => v2Subject({ v2: { ...v } });
  const P = V2_PARAMS;

  // 1. Flight.
  const censi = target(V2_FIT_TARGETS.flight[0]);
  const flight = bisect(
    (x) => {
      v.flightSaccadeHz = x;
      const r = censiRate(subject(), SIZES.censiFlights) ?? 0;
      log(`flight: ${x}/s spontaneous → ${r.toFixed(4)} saccades/s detected`);
      return r;
    },
    P.flightSaccadeHz.min,
    P.flightSaccadeHz.max,
    censi,
    true,
    12,
    3,
  );
  v.flightSaccadeHz = flight.value;

  // 2. Exploration.
  const minutes = V2_FIT_TARGETS.explore.map(target);
  const moving = (A: number, tau: number) => {
    v.exploreGain = A;
    v.exploreTauS = tau;
    const m: Measured = new Map();
    measureLiu(subject(), m, SIZES.liuFlies, 3);
    return V2_FIT_TARGETS.explore.map((id) => valueOf(m, id));
  };
  const grid: V2Fit["explore"]["grid"] = [];
  for (const tau of EXPLORE_TAU_GRID) {
    const a = bisect(
      (A) => {
        const y = moving(A, tau)[0]!;
        log(`exploration: τ ${tau} s, A ${A} → minute 1 moving ${y.toFixed(4)}`);
        return y;
      },
      P.exploreGain.min,
      P.exploreGain.max,
      minutes[0]!,
      true,
      10,
      3,
    );
    const ys = moving(a.value, tau);
    const sse = ys.reduce((s, y, i) => s + (y - minutes[i]!) ** 2, 0);
    grid.push({
      exploreTauS: tau,
      exploreGain: a.value,
      minutes: ys.map((y) => round(y, 6)),
      sse: round(sse, 8),
    });
  }
  const bestTau = grid.reduce((b, g) => (g.sse < b.sse ? g : b));
  v.exploreTauS = bestTau.exploreTauS;
  v.exploreGain = bestTau.exploreGain;

  // 3. Walking speed.
  const speedTarget =
    V2_FIT_TARGETS.speed.map(target).reduce((a, b) => a + b, 0) /
    V2_FIT_TARGETS.speed.length;
  const speed = bisect(
    (x) => {
      v.walkSpeedMeanCmS = x;
      const m: Measured = new Map();
      measureLiu(subject(), m, SIZES.liuFlies, 3);
      const y =
        V2_FIT_TARGETS.speed.map((id) => valueOf(m, id)).reduce((a, b) => a + b, 0) /
        V2_FIT_TARGETS.speed.length;
      log(`speed: gamma mean ${x} cm/s → ${(y * 1000).toFixed(3)} mm/s walking`);
      return y;
    },
    P.walkSpeedMeanCmS.min,
    P.walkSpeedMeanCmS.max,
    speedTarget,
    true,
    10,
    3,
  );
  v.walkSpeedMeanCmS = speed.value;

  // 4. Centrophobia.
  const wall = bisect(
    (x) => {
      v.centrophobia = x;
      const m: Measured = new Map();
      measureLiu(subject(), m, SIZES.liuFlies);
      const y = valueOf(m, V2_FIT_TARGETS.wall[0]);
      log(`wall: centrophobia ${x} → ${y.toFixed(4)} of time in the outer third`);
      return y;
    },
    P.centrophobia.min,
    P.centrophobia.max,
    target(V2_FIT_TARGETS.wall[0]),
    true,
    10,
    3,
  );
  v.centrophobia = wall.value;

  // 5. Freezing and jumping, two rounds.
  const zacarias = () => {
    const m: Measured = new Map();
    measureZacarias(subject(), m, SIZES.zacariasFlies);
    return {
      freeze: valueOf(m, V2_FIT_TARGETS.freeze[0]),
      jump: valueOf(m, V2_FIT_TARGETS.jump[0]),
    };
  };
  const defence: V2Fit["defence"] = [];
  for (let r = 1; r <= 2; r++) {
    const freeze = bisect(
      (x) => {
        v.freezeMax = x;
        const z = zacarias();
        log(`defence ${r}: pFreeze ${x} → ${z.freeze.toFixed(4)} freezing at the end`);
        return z.freeze;
      },
      P.freezeMax.min,
      P.freezeMax.max,
      target(V2_FIT_TARGETS.freeze[0]),
      true,
      8,
      3,
    );
    v.freezeMax = freeze.value;
    const jump = bisect(
      (x) => {
        v.jumpShare = x;
        const z = zacarias();
        log(`defence ${r}: qJump ${x} → ${z.jump.toFixed(4)} of looms jumped`);
        return z.jump;
      },
      P.jumpShare.min,
      P.jumpShare.max,
      target(V2_FIT_TARGETS.jump[0]),
      true,
      8,
      3,
    );
    v.jumpShare = jump.value;
    defence.push({ round: r, freeze, jump });
  }

  return {
    method:
      "In order, each keeping the values before it: (1) the spontaneous flight saccade rate by bisection to Censi et al.'s detected rate; (2) for each τ on a grid, A by bisection to minute 1's share of time moving, then the τ with the least summed squared error over minutes 1–3; (3) the walking-speed gamma's mean by bisection to the mean of the three minutes' speeds; (4) centrophobia by bisection to the outer-third share; (5) two rounds of pFreeze by bisection to the share freezing at the end of the looms, then qJump to the share of looms jumped. All on the report's flies (its seeds), keeping the evaluated point nearest each target.",
    flight,
    explore: { grid, exploreTauS: v.exploreTauS, exploreGain: v.exploreGain },
    speed,
    wall,
    defence,
    values: {
      flightSaccadeHz: v.flightSaccadeHz,
      exploreGain: v.exploreGain,
      exploreTauS: v.exploreTauS,
      walkSpeedMeanCmS: v.walkSpeedMeanCmS,
      centrophobia: v.centrophobia,
      freezeMax: v.freezeMax,
      jumpShare: v.jumpShare,
    },
  };
}
