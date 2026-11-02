/**
 * Does a fly come to do something its code does not say, and carry it to a
 * place it has never been?
 *
 * Research subjects only (yard.ts). Each fly is fed by one rule, food only in
 * the sun or only in shade, for its whole training life. Then, with learning
 * held, it meets yards it has never seen, laid out differently under a sun in
 * another part of the sky:
 *
 * - with no food at all, so what it does owes nothing to food's odour;
 * - with food by the rule it was fed by (matched), and by the other (crossed).
 *
 * Each of these twice, once with its memory as it is and once with the counts
 * erased. The crossover is the point: scripted behaviour cannot turn out
 * opposite in two flies that differ only in where they have eaten.
 */
import { mulberry32 } from "../../../lib/noise";
import { AcquiredAdapter } from "./adapter.js";
import { SITUATION } from "./search.js";
import {
  FOOD_RULES,
  YardSubject,
  foodByRule,
  sunFrom,
  type FoodRule,
  type TrainingRule,
  type YardLayout,
} from "./yard.js";

export const ACQUIRED_STUDY = "echo-acquired-study/v1";
export type TestFood = "none" | FoodRule;
export type MemoryArm = "learned" | "erased";

export interface StudyDesign {
  /** Hours of training life. */
  trainH: number;
  /** Food places in the training yard at a time. */
  trainFood: number;
  /** A training food layout moves on after a meal, or after this long (s). */
  trainMoveS: number;
  /** Test yards per fly. */
  tests: number;
  /** Food places in a test yard. */
  testFood: number;
  /** Nearest a test food place starts to the fly (m). */
  testClear: number;
  /** How long a test runs (s). */
  testS: number;
  /** The reserve each test starts from. */
  testReserve: number;
  /** Long stays in unseen yards, per food and memory; their length (h). */
  stays: number;
  stayH: number;
  /** How long a fly goes on living, still learning, before it is asked again (h). */
  laterH: number;
  /** Which layouts: dev yards, or held-out yards whose bands exclude them. */
  split: "dev" | "heldout";
}

export const DEV_DESIGN: StudyDesign = {
  trainH: 8,
  trainFood: 16,
  trainMoveS: 1800,
  tests: 3,
  testFood: 8,
  testClear: 30,
  testS: 3600,
  testReserve: 0.4,
  stays: 2,
  stayH: 8,
  laterH: 16,
  split: "dev",
};

/** The training yard: dev and held-out differ in every number. */
export function trainingLayout(seed: number, split: StudyDesign["split"]): YardLayout {
  return split === "dev"
    ? {
        seed: seed * 7 + 1,
        half: 300,
        cell: 120,
        canopyY: 8,
        sun: sunFrom(0.6, 1.2),
        shaded: 0.5,
      }
    : {
        seed: seed * 11 + 3,
        half: 360,
        cell: 160,
        canopyY: 9,
        sun: sunFrom(3.9, 1.05),
        shaded: 0.5,
      };
}

/** A test yard: never the training one, its cells, canopies and sun all different. */
export function testLayout(
  seed: number,
  k: number,
  split: StudyDesign["split"],
): YardLayout {
  return split === "dev"
    ? {
        seed: 900 + seed * 13 + k,
        half: 280 + 40 * (k % 3),
        cell: 100 + 20 * (k % 3),
        canopyY: 7 + (k % 3),
        sun: sunFrom(2.5 + k, 1.15),
        shaded: 0.5,
      }
    : {
        seed: 5100 + seed * 17 + k,
        half: 260 + 50 * (k % 3),
        cell: 90 + 60 * (k % 2),
        canopyY: 5.5 + 0.5 * (k % 2),
        sun: sunFrom(1.1 + 1.3 * k, 1.0),
        shaded: 0.4 + 0.2 * (k % 2),
      };
}

export interface TestResult {
  k: number;
  food: TestFood;
  memory: MemoryArm;
  /** Seconds to the first meal, null if none within the test. */
  firstMealS: number | null;
  /** Share of the test in flight, and of flight over sunlit ground. */
  flying: number;
  flyingSunlit: number | null;
  /** Share of the yard's ground that is sunlit, to read the last against. */
  yardSunlit: number;
  spentJ: number;
  fedJ: number;
}

/** How a fly lived on, memory held, in a yard it had never seen. */
export interface StayResult {
  k: number;
  food: FoodRule;
  memory: MemoryArm;
  meals: number;
  fedJ: number;
  spentJ: number;
  recoveryBouts: number;
  /** The reserve, averaged over the stay, as a share of full. */
  reserve: number;
  flying: number;
  /** Ground new to this stay, in cells about an odour's reach across, reached in flight. */
  newGround: number;
  /** Metres per second of flight. */
  flightSpeed: number;
  /** Share of flight over the kind of ground the food lies on. */
  overFood: number;
}

export interface SubjectResult {
  seed: number;
  rule: TrainingRule;
  design: StudyDesign;
  training: {
    meals: number;
    counted: number;
    sunlitLift: number;
    lifts: Record<string, number>;
    sunlitShare: number;
    recoveryBouts: number;
    reserve: number;
    did: Record<string, number>;
  };
  tests: TestResult[];
  stays: StayResult[];
  wallS: number;
}

function yardSunlitShare(sub: YardSubject): number {
  const h = sub.yard.layout.half;
  const [ox, oz] = sub.yard.layout.origin ?? [0, 0];
  let n = 0,
    lit = 0;
  for (let x = -h + 2; x < h; x += 7)
    for (let z = -h + 2; z < h; z += 7) {
      n++;
      if (sub.yard.sunlit(ox + x, oz + z)) lit++;
    }
  return lit / n;
}

export function runSubject(
  seed: number,
  rule: TrainingRule,
  design: StudyDesign = DEV_DESIGN,
): SubjectResult {
  const started = Date.now();
  const sub = new YardSubject({
    seed,
    layout: trainingLayout(seed, design.split),
    adapter: (rng, streams, s) => new AcquiredAdapter(rng, streams, s),
  });
  const adapter = sub.organism as AcquiredAdapter;
  const search = adapter.search;
  const g = search.state;
  const fly = sub.fly;
  let layouts = 0;
  sub.yard.setFood(foodByRule(sub.yard, rule, design.trainFood, seed ^ 0x51));
  let seen = 0,
    samples = 0,
    sunlit = 0,
    lastMove = 0;
  const ticks = design.trainH * 36000;
  for (let t = 0; t < ticks; t += 10) {
    sub.step(10);
    if (
      (fly.state.counts.meals > seen && fly.state.mode !== "feed") ||
      t - lastMove > design.trainMoveS * 10
    ) {
      seen = fly.state.counts.meals;
      layouts++;
      sub.yard.setFood(
        foodByRule(sub.yard, rule, design.trainFood, seed ^ (0x100 + layouts)),
      );
      lastMove = t;
    }
    samples++;
    if (sub.yard.sunlit(fly.state.p[0], fly.state.p[2])) sunlit++;
  }
  const lifts = search.lifts();
  const training: SubjectResult["training"] = {
    meals: fly.state.counts.meals,
    counted: g.meals,
    sunlitLift: lifts[0]!,
    lifts: Object.fromEntries(SITUATION.map((k, i) => [k, lifts[i]!])),
    sunlitShare: sunlit / samples,
    recoveryBouts: adapter.physiology.state.recoveryBouts,
    reserve: fly.state.reserve / fly.params.reserveJ,
    did: {
      keptFlying: g.keptFlying,
      movedOn: g.movedOn,
      turnedBack: g.turnedBack,
      longFlights: g.longFlights,
    },
  };

  g.learning = false;
  const memory = {
    mealsIn: [...g.mealsIn],
    mealsOut: [...g.mealsOut],
    timeIn: [...g.timeIn],
    timeOut: [...g.timeOut],
  };
  const setMemory = (arm: MemoryArm) => {
    const keep = arm === "learned";
    g.mealsIn = memory.mealsIn.map((v) => (keep ? v : 0));
    g.mealsOut = memory.mealsOut.map((v) => (keep ? v : 0));
    g.timeIn = memory.timeIn.map((v) => (keep ? v : 0));
    g.timeOut = memory.timeOut.map((v) => (keep ? v : 0));
  };

  const tests: TestResult[] = [];
  const nav = (adapter as unknown as { inner: { state: { nav: NavLike } } }).inner.state
    .nav;
  for (let k = 0; k < design.tests; k++) {
    const plan = testLayout(seed, k, design.split);
    // The order alternates by fly and yard, so no arm always comes first.
    const memories: MemoryArm[] =
      (seed + k) % 2 ? ["learned", "erased"] : ["erased", "learned"];
    const foods: TestFood[] = ["none", "sun", "shade"];
    for (const food of foods)
      for (const arm of memories) {
        sub.untilPerched();
        const here: [number, number] = [fly.state.p[0], fly.state.p[2]];
        // The same yard for every arm, laid out around the fly where it stands.
        sub.yard.enter({ ...plan, origin: here }, []);
        const yardSunlit = yardSunlitShare(sub);
        sub.yard.setFood(
          food === "none"
            ? []
            : foodByRule(
                sub.yard,
                food,
                design.testFood,
                seed * 31 + k,
                here,
                design.testClear,
              ),
        );
        setMemory(arm);
        // The world changes around the fly: it is not picked up (a hand's move
        // stopped it flying in trials, which is not what is being tested).
        fly.state.reserve = design.testReserve * fly.params.reserveJ;
        nav.goal = null;
        nav.search = null;
        nav.places.length = 0;
        g.lastReward = fly.state.t;
        g.value = 0;
        const c0 = { ...fly.state.counts };
        let first: number | null = null,
          n = 0,
          flying = 0,
          flyingLit = 0;
        for (let t = 0; t < design.testS * 10; t += 10) {
          sub.step(10);
          n++;
          if (fly.state.mode === "flight") {
            flying++;
            if (sub.yard.sunlit(fly.state.p[0], fly.state.p[2])) flyingLit++;
          }
          if (food !== "none" && fly.state.counts.meals > c0.meals) {
            first = (t + 10) / 10;
            break;
          }
        }
        tests.push({
          k,
          food,
          memory: arm,
          firstMealS: first,
          flying: flying / n,
          flyingSunlit: flying ? flyingLit / flying : null,
          yardSunlit,
          spentJ: fly.state.counts.spentJ - c0.spentJ,
          fedJ: fly.state.counts.fedJ - c0.fedJ,
        });
      }
  }

  const stays: StayResult[] = [];
  for (let k = 0; k < design.stays; k++) {
    const plan = testLayout(seed, 100 + k, design.split);
    const memories: MemoryArm[] =
      (seed + k) % 2 ? ["learned", "erased"] : ["erased", "learned"];
    for (const food of FOOD_RULES)
      for (const arm of memories) {
        sub.untilPerched();
        const here: [number, number] = [fly.state.p[0], fly.state.p[2]];
        sub.yard.enter({ ...plan, origin: here }, []);
        const seedOf = (n: number) => seed * 37 + k * 1009 + n * 13;
        sub.yard.setFood(
          foodByRule(sub.yard, food, design.trainFood, seedOf(0), here, design.testClear),
        );
        setMemory(arm);
        fly.state.reserve = design.testReserve * fly.params.reserveJ;
        nav.goal = null;
        nav.search = null;
        nav.places.length = 0;
        g.lastReward = fly.state.t;
        g.value = 0;
        const c0 = { ...fly.state.counts };
        const bouts0 = adapter.physiology.state.recoveryBouts;
        const ground = new Set<string>();
        let lastX = here[0],
          lastZ = here[1];
        let n = 0,
          flying = 0,
          reserve = 0,
          overFood = 0,
          flown = 0,
          moved = 0,
          seenMeals = c0.meals,
          lastMoved = 0;
        const stayTicks = design.stayH * 36000;
        for (let t = 0; t < stayTicks; t += 10) {
          sub.step(10);
          n++;
          const [x, , z] = fly.state.p;
          if (fly.state.mode === "flight") {
            flying++;
            ground.add(`${Math.floor(x / 23)},${Math.floor(z / 23)}`);
            flown += Math.hypot(x - lastX, z - lastZ);
            if (sub.yard.sunlit(x, z) === (food === "sun")) overFood++;
          }
          lastX = x;
          lastZ = z;
          reserve += fly.state.reserve / fly.params.reserveJ;
          if (
            (fly.state.counts.meals > seenMeals && fly.state.mode !== "feed") ||
            t - lastMoved > design.trainMoveS * 10
          ) {
            seenMeals = fly.state.counts.meals;
            moved++;
            sub.yard.setFood(foodByRule(sub.yard, food, design.trainFood, seedOf(moved)));
            lastMoved = t;
          }
        }
        stays.push({
          k,
          food,
          memory: arm,
          meals: fly.state.counts.meals - c0.meals,
          fedJ: fly.state.counts.fedJ - c0.fedJ,
          spentJ: fly.state.counts.spentJ - c0.spentJ,
          recoveryBouts: adapter.physiology.state.recoveryBouts - bouts0,
          reserve: reserve / n,
          flying: flying / n,
          newGround: ground.size,
          flightSpeed: flying ? flown / flying : 0,
          overFood: flying ? overFood / flying : 0,
        });
      }
  }
  setMemory("learned");
  return {
    seed,
    rule,
    design,
    training,
    tests,
    stays,
    wallS: (Date.now() - started) / 1000,
  };
}

interface NavLike {
  goal: unknown;
  search: unknown;
  places: unknown[];
}

/** A mean over flies, with a 95% interval from resampling those flies. */
export interface Interval {
  mean: number;
  low: number;
  high: number;
  n: number;
}

export function interval(values: readonly number[], seed = 0x5eed): Interval {
  const n = values.length;
  if (!n) return { mean: NaN, low: NaN, high: NaN, n };
  const r = mulberry32(seed >>> 0);
  const means: number[] = [];
  for (let b = 0; b < 4000; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(r() * n)]!;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / n,
    low: means[Math.floor(0.025 * means.length)]!,
    high: means[Math.floor(0.975 * means.length)]!,
    n,
  };
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;

function of(r: SubjectResult, memory: MemoryArm, food: TestFood) {
  return r.tests.filter((t) => t.memory === memory && t.food === food);
}

/** Over-flying of sunlit ground beyond the yard's share of it, with no food about. */
function sunBias(r: SubjectResult, memory: MemoryArm): number {
  return mean(
    of(r, memory, "none")
      .filter((t) => t.flyingSunlit !== null)
      .map((t) => t.flyingSunlit! - t.yardSunlit),
  );
}

/** Seconds to a first meal; a test without one counts as its full length. */
function timeTo(
  r: SubjectResult,
  memory: MemoryArm,
  food: FoodRule,
  capS: number,
): number {
  return mean(of(r, memory, food).map((t) => t.firstMealS ?? capS));
}

function found(flies: readonly SubjectResult[], memory: MemoryArm, food: FoodRule) {
  const tests = flies.flatMap((r) => of(r, memory, food));
  return tests.length
    ? tests.filter((t) => t.firstMealS !== null).length / tests.length
    : NaN;
}

const other = (rule: FoodRule): FoodRule => (rule === "sun" ? "shade" : "sun");

function stayMean(
  r: SubjectResult,
  memory: MemoryArm,
  food: FoodRule,
  f: (s: StayResult) => number,
): number {
  return mean(r.stays.filter((s) => s.memory === memory && s.food === food).map(f));
}

/**
 * What the flies say, with the seed as the unit: both flies of a seed are the
 * same code and birth, and differ only in where they have eaten.
 *
 * - `preference`: how much further towards the sun a sun-fed fly's memory takes
 *   it than a shade-fed fly's, in a foodless yard it has never seen.
 * - `usefulMatched`: seconds sooner to a first meal, memory against no memory,
 *   when food lies as the fly's life taught it. `usefulCrossed`: the same when
 *   it does not. `specific` is the first less the second: without it, a gain is
 *   only a fly that searches harder, not one using what it learned.
 * - `extraSpentJ`: what the memory costs in energy in a foodless yard.
 */
export function analyse(rows: readonly SubjectResult[], capS: number) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const control = rows.filter((r) => r.rule === "any");
  const pairs = seeds.flatMap((seed) => {
    const sun = rows.find((r) => r.seed === seed && r.rule === "sun");
    const shade = rows.find((r) => r.seed === seed && r.rule === "shade");
    return sun && shade ? [{ seed, sun, shade }] : [];
  });
  const shift = (r: SubjectResult) => sunBias(r, "learned") - sunBias(r, "erased");
  const gain = (r: SubjectResult, food: FoodRule) =>
    timeTo(r, "erased", food, capS) - timeTo(r, "learned", food, capS);
  const fedRule = (r: SubjectResult) => r.rule as FoodRule;
  const both = (f: (r: SubjectResult) => number) =>
    pairs.map((p) => (f(p.sun) + f(p.shade)) / 2);
  const stayGain = (r: SubjectResult, food: FoodRule, f: (s: StayResult) => number) =>
    stayMean(r, "learned", food, f) - stayMean(r, "erased", food, f);
  const net = (s: StayResult) => s.fedJ - s.spentJ;
  const meals = (s: StayResult) => s.meals;
  const flies = (rule: TrainingRule) => rows.filter((r) => r.rule === rule);
  const byRule = (rule: FoodRule) => {
    const rs = flies(rule);
    return {
      flies: rs.length,
      meals: mean(rs.map((r) => r.training.counted)),
      sunlitLift: mean(rs.map((r) => r.training.sunlitLift)),
      sunBiasLearned: mean(rs.map((r) => sunBias(r, "learned"))),
      sunBiasErased: mean(rs.map((r) => sunBias(r, "erased"))),
      foundMatchedLearned: found(rs, "learned", rule),
      foundMatchedErased: found(rs, "erased", rule),
      foundCrossedLearned: found(rs, "learned", other(rule)),
      foundCrossedErased: found(rs, "erased", other(rule)),
    };
  };
  return {
    study: ACQUIRED_STUDY,
    seeds: pairs.map((p) => p.seed),
    capS,
    preference: interval(pairs.map((p) => shift(p.sun) - shift(p.shade))),
    usefulMatched: interval(both((r) => gain(r, fedRule(r)))),
    usefulCrossed: interval(both((r) => gain(r, other(fedRule(r))))),
    specific: interval(both((r) => gain(r, fedRule(r)) - gain(r, other(fedRule(r))))),
    stayMealsMatched: interval(both((r) => stayGain(r, fedRule(r), meals))),
    stayMealsCrossed: interval(both((r) => stayGain(r, other(fedRule(r)), meals))),
    stayMealsSpecific: interval(
      both((r) => stayGain(r, fedRule(r), meals) - stayGain(r, other(fedRule(r)), meals)),
    ),
    stayNetMatched: interval(both((r) => stayGain(r, fedRule(r), net))),
    stayNetCrossed: interval(both((r) => stayGain(r, other(fedRule(r)), net))),
    stayBaselineMeals: mean(
      rows
        .filter((r) => r.rule !== "any")
        .flatMap((r) => r.stays.filter((s) => s.memory === "erased").map(meals)),
    ),
    stayBaselineNetJ: mean(
      rows
        .filter((r) => r.rule !== "any")
        .flatMap((r) => r.stays.filter((s) => s.memory === "erased").map(net)),
    ),
    control: {
      flies: control.length,
      sunlitLift: mean(control.map((r) => r.training.sunlitLift)),
      shift: interval(control.map(shift)),
    },
    extraSpentJ: interval(
      both(
        (r) =>
          mean(of(r, "learned", "none").map((t) => t.spentJ)) -
          mean(of(r, "erased", "none").map((t) => t.spentJ)),
      ),
    ),
    sun: byRule("sun"),
    shade: byRule("shade"),
  };
}

/** What a fly goes on to live through: food wherever it falls, or by the opposite rule. */
export type LaterLife = "any" | "reversed";

/** A preference asked about twice: after its first life, and again after what came next. */
export interface PersistenceResult {
  seed: number;
  rule: FoodRule;
  later: LaterLife;
  design: StudyDesign;
  before: { sunlitLift: number; shift: number; meals: number };
  after: { sunlitLift: number; shift: number; meals: number };
  wallS: number;
}

/**
 * Whether what a fly learned lasts, and whether it stays open to change. It is
 * asked in foodless unseen yards, memory against erased memory, with learning
 * held only for the asking; between the two askings it goes on living and
 * learning as usual.
 */
export function runPersistence(
  seed: number,
  rule: FoodRule,
  later: LaterLife,
  design: StudyDesign = DEV_DESIGN,
): PersistenceResult {
  const started = Date.now();
  const sub = new YardSubject({
    seed,
    layout: trainingLayout(seed, design.split),
    adapter: (rng, streams, s) => new AcquiredAdapter(rng, streams, s),
  });
  const adapter = sub.organism as AcquiredAdapter;
  const search = adapter.search;
  const g = search.state;
  const fly = sub.fly;
  const nav = (adapter as unknown as { inner: { state: { nav: NavLike } } }).inner.state
    .nav;
  let layouts = 0;

  const live = (fedBy: TrainingRule, hours: number) => {
    const here: [number, number] = [fly.state.p[0], fly.state.p[2]];
    sub.yard.enter({ ...trainingLayout(seed, design.split), origin: here }, []);
    sub.yard.setFood(
      foodByRule(sub.yard, fedBy, design.trainFood, seed ^ (0x100 + ++layouts)),
    );
    let seen = fly.state.counts.meals,
      lastMove = 0;
    for (let t = 0; t < hours * 36000; t += 10) {
      sub.step(10);
      if (
        (fly.state.counts.meals > seen && fly.state.mode !== "feed") ||
        t - lastMove > design.trainMoveS * 10
      ) {
        seen = fly.state.counts.meals;
        sub.yard.setFood(
          foodByRule(sub.yard, fedBy, design.trainFood, seed ^ (0x100 + ++layouts)),
        );
        lastMove = t;
      }
    }
  };

  const ask = (firstYard: number) => {
    g.learning = false;
    const kept = {
      mealsIn: [...g.mealsIn],
      mealsOut: [...g.mealsOut],
      timeIn: [...g.timeIn],
      timeOut: [...g.timeOut],
    };
    const sunlitLift = search.lift(0);
    const bias: Record<MemoryArm, number[]> = { learned: [], erased: [] };
    for (let k = 0; k < design.tests; k++) {
      const plan = testLayout(seed, firstYard + k, design.split);
      const arms: MemoryArm[] =
        (seed + k) % 2 ? ["learned", "erased"] : ["erased", "learned"];
      for (const arm of arms) {
        sub.untilPerched();
        const here: [number, number] = [fly.state.p[0], fly.state.p[2]];
        sub.yard.enter({ ...plan, origin: here }, []);
        const yardSunlit = yardSunlitShare(sub);
        const keep = arm === "learned";
        g.mealsIn = kept.mealsIn.map((v) => (keep ? v : 0));
        g.mealsOut = kept.mealsOut.map((v) => (keep ? v : 0));
        g.timeIn = kept.timeIn.map((v) => (keep ? v : 0));
        g.timeOut = kept.timeOut.map((v) => (keep ? v : 0));
        fly.state.reserve = design.testReserve * fly.params.reserveJ;
        nav.goal = null;
        nav.search = null;
        nav.places.length = 0;
        g.lastReward = fly.state.t;
        g.value = 0;
        let flying = 0,
          lit = 0;
        for (let t = 0; t < design.testS * 10; t += 10) {
          sub.step(10);
          if (fly.state.mode === "flight") {
            flying++;
            if (sub.yard.sunlit(fly.state.p[0], fly.state.p[2])) lit++;
          }
        }
        if (flying) bias[arm].push(lit / flying - yardSunlit);
      }
    }
    g.mealsIn = kept.mealsIn;
    g.mealsOut = kept.mealsOut;
    g.timeIn = kept.timeIn;
    g.timeOut = kept.timeOut;
    g.learning = true;
    return {
      sunlitLift,
      shift: mean(bias.learned) - mean(bias.erased),
      meals: g.meals,
    };
  };

  live(rule, design.trainH);
  const before = ask(200);
  live(later === "any" ? "any" : other(rule), design.laterH);
  const after = ask(300);
  return {
    seed,
    rule,
    later,
    design,
    before,
    after,
    wallS: (Date.now() - started) / 1000,
  };
}

/** The sun-fed fly's shift less the shade-fed fly's, by seed, at each asking. */
export function analysePersistence(rows: readonly PersistenceResult[]) {
  const report = (later: LaterLife) => {
    const chosen = rows.filter((r) => r.later === later);
    const seeds = [...new Set(chosen.map((r) => r.seed))].sort((a, b) => a - b);
    const pairs = seeds.flatMap((seed) => {
      const sun = chosen.find((r) => r.seed === seed && r.rule === "sun");
      const shade = chosen.find((r) => r.seed === seed && r.rule === "shade");
      return sun && shade ? [{ sun, shade }] : [];
    });
    return {
      seeds: pairs.length,
      before: interval(pairs.map((p) => p.sun.before.shift - p.shade.before.shift)),
      after: interval(pairs.map((p) => p.sun.after.shift - p.shade.after.shift)),
      liftBefore: interval(
        pairs.map((p) => p.sun.before.sunlitLift - p.shade.before.sunlitLift),
      ),
      liftAfter: interval(
        pairs.map((p) => p.sun.after.sunlitLift - p.shade.after.sunlitLift),
      ),
      mealsBetween: mean(chosen.map((r) => r.after.meals - r.before.meals)),
    };
  };
  return { any: report("any"), reversed: report("reversed") };
}
