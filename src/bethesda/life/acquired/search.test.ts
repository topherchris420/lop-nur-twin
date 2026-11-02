import { describe, expect, it } from "vitest";
import { ACQUIRED_PARAMS, AcquiredSearch, SITUATION } from "./search.js";
import { analyse, interval, type SubjectResult } from "./study.js";

const SUNLIT = SITUATION.indexOf("sunlit");

function search(
  fill: Partial<Record<"timeIn" | "timeOut" | "mealsIn" | "mealsOut", number>>,
) {
  const s = new AcquiredSearch(1);
  s.state.timeIn[SUNLIT] = fill.timeIn ?? 0;
  s.state.timeOut[SUNLIT] = fill.timeOut ?? 0;
  s.state.mealsIn[SUNLIT] = fill.mealsIn ?? 0;
  s.state.mealsOut[SUNLIT] = fill.mealsOut ?? 0;
  return s;
}

describe("what a fly's counts say about a situation", () => {
  it("has no opinion before any experience", () => {
    expect(new AcquiredSearch(1).lifts().every((v) => v === 0)).toBe(true);
  });

  it("has no opinion on a situation it has never been in or never left", () => {
    expect(search({ timeOut: 9000, mealsOut: 5 }).lift(SUNLIT)).toBe(0);
    expect(search({ timeIn: 9000, mealsIn: 5 }).lift(SUNLIT)).toBe(0);
  });

  it("has an opinion that follows where the meals came from, per hour there", () => {
    const sun = search({ timeIn: 3000, timeOut: 3000, mealsIn: 6, mealsOut: 1 });
    const shade = search({ timeIn: 3000, timeOut: 3000, mealsIn: 1, mealsOut: 6 });
    expect(sun.lift(SUNLIT)).toBeGreaterThan(0);
    expect(shade.lift(SUNLIT)).toBeCloseTo(-sun.lift(SUNLIT), 10);
  });

  it("is not fooled by more meals where the fly simply spends more time", () => {
    const even = search({ timeIn: 9000, timeOut: 1000, mealsIn: 9, mealsOut: 1 });
    expect(Math.abs(even.lift(SUNLIT))).toBeLessThan(ACQUIRED_PARAMS.distinct);
  });

  it("gives no authority until it has eaten enough, and takes it back when meals stop", () => {
    const s = new AcquiredSearch(1);
    s.state.lastReward = 100;
    s.state.meals = 2;
    expect(s.authority(100)).toBe(0);
    s.state.meals = 3;
    expect(s.authority(100)).toBe(1);
    expect(s.authority(1900)).toBeCloseTo(0.5, 10);
    s.state.acting = false;
    expect(s.authority(100)).toBe(0);
  });
});

describe("how a study is judged", () => {
  it("gives an interval around the mean, from the same seed the same interval", () => {
    const v = [1, 2, 3, 4, 5, 6];
    const a = interval(v);
    expect(a.mean).toBe(3.5);
    expect(a.low).toBeLessThan(3.5);
    expect(a.high).toBeGreaterThan(3.5);
    expect(interval(v)).toEqual(a);
  });

  it("pairs flies by seed, and reads the crossover and specificity with the right signs", () => {
    const fly = (seed: number, rule: "sun" | "shade"): SubjectResult => {
      const sign = rule === "sun" ? 1 : -1;
      const test = (memory: "learned" | "erased", food: "none" | "sun" | "shade") => ({
        k: 0,
        food,
        memory,
        firstMealS:
          food === "none" ? null : memory === "learned" && food === rule ? 100 : 200,
        flying: 0.3,
        flyingSunlit: memory === "learned" ? 0.5 + 0.2 * sign : 0.5,
        yardSunlit: 0.5,
        spentJ: 1,
        fedJ: 0,
      });
      return {
        seed,
        rule,
        tests: (["learned", "erased"] as const).flatMap((m) =>
          (["none", "sun", "shade"] as const).map((f) => test(m, f)),
        ),
        stays: [],
        training: { counted: 5, sunlitLift: sign } as SubjectResult["training"],
      } as unknown as SubjectResult;
    };
    const r = analyse(
      [fly(1, "sun"), fly(1, "shade"), fly(2, "sun"), fly(2, "shade"), fly(3, "sun")],
      300,
    );
    expect(r.seeds).toEqual([1, 2]);
    expect(r.preference.mean).toBeCloseTo(0.4, 10);
    expect(r.usefulMatched.mean).toBe(100);
    expect(r.usefulCrossed.mean).toBe(0);
    expect(r.specific.mean).toBe(100);
  });
});
