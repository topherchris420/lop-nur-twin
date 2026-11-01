import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../../lib/noise";
import {
  LIU_2007,
  LIU_2007_RADIUS,
  loomingTrial,
  repeatedLooms,
  session,
  trialSeed,
  vonReyn2014Loom,
} from "../../calibration/paradigms";
import { v2Subject } from "../../calibration/subjects";
import { gammaDraw, V2_DESCRIPTOR, V2_MECHANISMS, V2Controller } from "./controller";
import { resolveV2Params, V2_PARAMS } from "./params";

const outerThird = (subject: ReturnType<typeof v2Subject>, flies: number) => {
  let inside = 0,
    all = 0;
  for (let i = 0; i < flies; i++)
    for (const f of session(
      subject,
      { ...LIU_2007, durationS: 120 },
      trialSeed(0x7e57, i),
    )) {
      all++;
      if (Math.hypot(f.p[0], f.p[2]) >= LIU_2007_RADIUS * Math.sqrt(2 / 3)) inside++;
    }
  return inside / all;
};

describe("circuit-informed/v2", () => {
  it("simulates no neuron and names every mechanism it can switch off", () => {
    expect(V2_DESCRIPTOR.simulatesNeurons).toBe(false);
    expect(
      () => new V2Controller(mulberry32(1), { seed: 1, without: ["x" as never] }),
    ).toThrow(/unknown v2 mechanism/);
    const ids = V2_MECHANISMS.map((m) => v2Subject({ without: [m] }).id);
    expect(new Set(ids).size).toBe(V2_MECHANISMS.length);
    expect(ids.every((id) => id.startsWith(`${V2_DESCRIPTOR.id}-`))).toBe(true);
  });

  it("overrides only its model and fitted values, within their ranges", () => {
    expect(resolveV2Params().walkSaccadeMeanDeg).toBe(15);
    expect(() => resolveV2Params({ walkSaccadeMeanDeg: 20 })).toThrow(/published/);
    expect(() => resolveV2Params({ centrophobia: 2 })).toThrow(/within/);
    for (const p of Object.values(V2_PARAMS)) {
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
      if (p.kind === "published") expect(p.source?.doi).toMatch(/^10\./);
    }
  });

  it("draws gamma amplitudes with the mean asked for", () => {
    const rng = mulberry32(7);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += gammaDraw(rng, 2, 15);
    expect(s / 20000).toBeCloseTo(15, 0);
  });

  it("follows walls: more time in an open field's outer third than without the mechanism", () => {
    expect(outerThird(v2Subject(), 4)).toBeGreaterThan(
      outerThird(v2Subject({ without: ["wall"] }), 4) + 0.1,
    );
  });

  it("freezes under a lid when freezing is certain, and never jumps", () => {
    const r = repeatedLooms(v2Subject({ v2: { freezeMax: 1 } }), 11);
    expect(r.freezingAtEnd).toBe(true);
    expect(r.jumped.some(Boolean)).toBe(false);
  });

  it("neither freezes nor jumps under a lid when both are ruled out: it runs", () => {
    const r = repeatedLooms(v2Subject({ v2: { freezeMax: 0, jumpShare: 0 } }), 12);
    expect(r.jumped.some(Boolean)).toBe(false);
  });

  it("keeps v1's escape in the open, and its commands pass the fly's gate", () => {
    for (let i = 0; i < 4; i++) {
      const t = loomingTrial(v2Subject(), vonReyn2014Loom(40), trialSeed(0xe5c, i));
      expect(t.jumped).toBe(true);
      expect(t.refusals).toBe(0);
    }
  });
});
