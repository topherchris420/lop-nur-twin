/**
 * The bench's life is the plasticity study's life plus an instrument that only
 * reads: stepped side by side from the same genesis, the two must hold the same
 * body, controller (plasticity included) and food, byte for byte. If the
 * instrument ever drew a random number or wrote a field, this fails.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../rain/sha256.js";
import { OriginalRefused, ORIGINALS } from "../firstContact/originals.js";
import { SITES, SITE_NAMES } from "../life/individuality.js";
import { siteAt as studySiteAt, StudyLife, type Arm } from "../plasticity/study.js";
import type { ControllerId } from "./controllers.js";
import { foodAt, MetrologyLife, onsetOf, siteAt } from "./life.js";
import { conditionOf, parseProtocol } from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };

const protocol = parseProtocol(source);
const weakLegs = conditionOf(protocol, "weak-legs");
const unimpaired = conditionOf(protocol, "unimpaired");

function bench(seed: number, controller: ControllerId, condition = weakLegs, subject?: string) {
  return new MetrologyLife({
    seed,
    condition,
    controller,
    subject: subject ?? `research-eimb-test-${seed}-${controller}`,
    durationS: 7200,
    blockS: 600,
    sampleEveryTicks: 10,
    lateFromS: 3600,
  });
}

const PAIRS: [ControllerId, Arm][] = [
  ["organism", "original"],
  ["plasticity-active", "active"],
  ["fixed-slow", "fixed-slow"],
];

describe("the bench's life against the plasticity study's", () => {
  // 1200 simulated s: ten minutes of a sound body, then ten of weak legs, long
  // enough for the active plasticity to sample, judge and slow walks.
  const TICKS = 12_000;
  for (const [controller, arm] of PAIRS)
    it(`steps ${controller} exactly as the study steps ${arm}`, () => {
      const seed = 9203;
      const a = bench(seed, controller);
      const b = new StudyLife({ seed, arm, condition: "weak-legs" });
      a.step(TICKS);
      b.step(TICKS);
      expect(canonicalJson(a.fly.state)).toBe(canonicalJson(b.fly.state));
      expect(canonicalJson(a.organism.state)).toBe(canonicalJson(b.organism.state));
      expect(canonicalJson(a.world.food)).toBe(canonicalJson(b.world.food));
      expect(a.tally.latencies).toEqual(b.tally.latencies);
      expect(a.tally.walkingBlocks).toBe(b.tally.walkingBlocks);
      if (controller === "plasticity-active") expect(a.plasticity!.status().adaptations).toBeGreaterThan(0);
    }, 120_000);

  it("places food on the study's schedule at the compass sites", () => {
    for (const seed of [9201, 9202, 9203, 9204])
      for (const tick of [0, 11_999, 12_000, 36_000, 71_999])
        expect(siteAt(seed, weakLegs.food, tick)).toBe(
          studySiteAt({ seed, arm: "original", condition: "weak-legs" }, tick),
        );
    for (const s of SITE_NAMES) expect(foodAt(s, "compass")).toEqual(SITES[s]);
  });
});

describe("the instrument's conditions", () => {
  it("puts diagonal food 6.5 m out, between the compass sites", () => {
    for (const s of SITE_NAMES) {
      const [x, z] = foodAt(s, "diagonal");
      expect(Math.hypot(x, z)).toBeCloseTo(6.5, 9);
      for (const t of SITE_NAMES) {
        const [u, v] = SITES[t];
        expect(Math.hypot(x - u, z - v)).toBeGreaterThan(4);
      }
    }
  });

  it("knows when an impairment begins and ends", () => {
    expect(onsetOf(unimpaired)).toEqual({ onsetS: null, untilS: null });
    expect(onsetOf(weakLegs)).toEqual({ onsetS: 600, untilS: null });
    expect(onsetOf(conditionOf(protocol, "weak-legs-recovers"))).toEqual({ onsetS: 600, untilS: 3000 });
  });
});

describe("research subjects only", () => {
  it("refuses either original's id, and any id that is not a research subject's", () => {
    for (const o of ORIGINALS) {
      expect(() => bench(1, "organism", weakLegs, o.id)).toThrow(OriginalRefused);
      expect(() => bench(1, "organism", weakLegs, `research-eimb-${o.id}`)).toThrow(OriginalRefused);
    }
    expect(() => bench(1, "organism", weakLegs, "eimb-subject-1")).toThrow(/research-/);
  });
});
