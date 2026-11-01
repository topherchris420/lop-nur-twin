import { describe, expect, it } from "vitest";
import seal from "../../../../docs/benchmarks/fly-calibration/holdout-2026-11.json" with { type: "json" };
import { HOLDOUT_EXCLUDED, HOLDOUT_OBSERVATIONS, HOLDOUT_PARADIGMS } from "./holdout";
import { freezeExitShare, yawSaccades } from "./holdoutMeasure";
import { CRUZ_SESSION_S, STUPSKI_START_RESERVE } from "./holdoutParadigms";
import { sealEntries } from "./holdoutSeal";
import type { Frame } from "./paradigms";

describe("the 2026-11 held-out set", () => {
  it("is registered, held out and sourced in a paradigm of its own", () => {
    expect(HOLDOUT_OBSERVATIONS.length).toBeGreaterThan(0);
    for (const o of HOLDOUT_OBSERVATIONS) {
      expect(o.registered).toBe("holdout-2026-11");
      expect(o.role).toBe("held-out");
      expect(Object.keys(HOLDOUT_PARADIGMS)).toContain(o.paradigm);
      expect("quote" in o.source && o.source.citation).toBe(
        HOLDOUT_PARADIGMS[o.paradigm as keyof typeof HOLDOUT_PARADIGMS].source,
      );
    }
    expect(HOLDOUT_EXCLUDED.every((x) => x.reason.length > 0)).toBe(true);
  });

  it("is the set the seal records, unchanged", () => {
    const now = sealEntries();
    expect(now.observations).toEqual(seal.observations);
    expect(now.paradigms).toEqual(seal.paradigms);
    expect(now.excluded).toEqual(seal.excluded);
  });

  it("derives its session settings from the quoted numbers and the model's own", () => {
    expect(CRUZ_SESSION_S).toBe(582);
    expect(STUPSKI_START_RESERVE).toBeGreaterThan(0.5);
    expect(STUPSKI_START_RESERVE).toBeLessThan(0.6);
  });
});

describe("its measurements", () => {
  it("counts a freezing exit only after a freezing entry, and only before the next loom", () => {
    const F = true,
      M = false;
    // Loom 1: entry at bin 1, exit at bin 3. Loom 2: entry at bin 6, still through bin 8.
    // Loom 3: no entry (moving in bin 10).
    const train = {
      freezing: [M, F, F, M, M, M, F, F, F, M, M, F],
      looms: [
        { after: 1, next: 5 },
        { after: 6, next: 9 },
        { after: 10, next: 12 },
      ],
    };
    expect(freezeExitShare(train)).toBe(0.5);
    expect(
      freezeExitShare({ freezing: [M, M], looms: [{ after: 0, next: 2 }] }),
    ).toBeNull();
  });

  it("finds a yaw saccade's amplitude, quarter-peak duration and peak", () => {
    const hz = 160;
    // A 40-sample flight turning at 0, then a triangular pulse of yaw rate peaking at 1200°/s.
    const rates = [0, 0, 0, 200, 600, 1200, 600, 200, 0, 0];
    let yaw = 0;
    const frames: Frame[] = [];
    const push = () =>
      frames.push({
        t: frames.length / hz,
        p: [0, 0.5, 0],
        mode: "flight",
        perch: null,
        legs: 0,
        target: null,
        speed: 0.2,
        yaw,
      });
    push();
    for (const r of rates) {
      yaw += (r * Math.PI) / 180 / hz;
      push();
    }
    const s = yawSaccades(frames, hz);
    expect(s).toHaveLength(1);
    expect(s[0]!.peakDegS).toBeCloseTo(1200, 6);
    // Above a quarter of the peak (300°/s): 600, 1200, 600.
    expect(s[0]!.durationMs).toBeCloseTo((3 / hz) * 1000, 6);
    expect(s[0]!.amplitudeDeg).toBeCloseTo(2400 / hz, 6);
  });
});
