import { describe, expect, it } from "vitest";
import { QualityLadder } from "./qualityLadder";
import type { QualityTier } from "./store";

/** Runs the ladder at a steady frame rate and returns the tier it ends on. */
function run(
  ladder: QualityLadder,
  tier: QualityTier,
  fps: number,
  seconds: number,
): QualityTier {
  let current = tier;
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    const step = ladder.sample(dt, current);
    if (step !== null) current = step;
  }
  return current;
}

/** Holds a frame rate until the ladder steps; returns where to and how long it took. */
function untilStep(
  ladder: QualityLadder,
  tier: QualityTier,
  fps: number,
): { to: QualityTier; seconds: number } {
  const dt = 1 / fps;
  for (let t = 0; t < 2000; t += dt) {
    const step = ladder.sample(dt, tier);
    if (step !== null) return { to: step, seconds: t };
  }
  throw new Error("the ladder never stepped");
}

describe("QualityLadder", () => {
  it("steps down after sustained low frame rates, and only one tier at a time", () => {
    const ladder = new QualityLadder();
    // 1.5 s of settling, then just over a second below 50 FPS.
    expect(run(ladder, 2, 30, 2.4)).toBe(2);
    expect(run(ladder, 2, 30, 0.3)).toBe(1);
  });

  it("does not step while the frame rate sits between the two thresholds", () => {
    const ladder = new QualityLadder();
    expect(run(ladder, 2, 52, 60)).toBe(2);
  });

  it("climbs when there is sustained headroom", () => {
    const ladder = new QualityLadder();
    expect(run(ladder, 1, 60, 4)).toBe(2);
  });

  it("does not take one long frame for a slow GPU", () => {
    const ladder = new QualityLadder();
    run(ladder, 2, 60, 1.6);
    // A shader link, a garbage collection, a tab coming back: any length of stall.
    expect(ladder.sample(3.2, 2)).toBeNull();
    expect(ladder.sample(3.2, 2)).toBeNull();
    expect(run(ladder, 2, 52, 5)).toBe(2);
    expect(ladder.fps).toBeGreaterThan(40);
  });

  it("still steps down on a GPU where every frame is a stall", () => {
    const ladder = new QualityLadder();
    let tier: QualityTier = 2;
    for (let i = 0; i < 12 && tier === 2; i++) {
      const step = ladder.sample(0.5, tier);
      if (step !== null) tier = step;
    }
    expect(tier).toBe(1);
    expect(ladder.fps).toBeLessThan(5);
  });

  it("ignores the first frames, which pay for uploads and first draws", () => {
    const ladder = new QualityLadder();
    expect(run(ladder, 2, 20, 1.4)).toBe(2);
  });

  it("does not retry a tier it just fell from, which would hunt forever", () => {
    const ladder = new QualityLadder();
    expect(run(ladder, 2, 30, 3)).toBe(1);
    // Plenty of headroom one tier down, but tier 2 failed moments ago.
    expect(run(ladder, 1, 60, 50)).toBe(1);
  });

  it("does retry later, and backs off further each time it fails", () => {
    const ladder = new QualityLadder();
    expect(untilStep(ladder, 2, 30).to).toBe(1);
    const firstRetry = untilStep(ladder, 1, 60);
    expect(firstRetry.to).toBe(2);
    expect(firstRetry.seconds).toBeGreaterThan(55);
    expect(firstRetry.seconds).toBeLessThan(65);

    // Fails again: this time the wait doubles.
    expect(untilStep(ladder, 2, 30).to).toBe(1);
    const secondRetry = untilStep(ladder, 1, 60);
    expect(secondRetry.to).toBe(2);
    expect(secondRetry.seconds).toBeGreaterThan(115);
    expect(secondRetry.seconds).toBeLessThan(125);
  });

  it("keeps the wait separate for each tier", () => {
    const ladder = new QualityLadder();
    // Tier 3 fails twice, so its own wait has doubled by the time tier 2 first fails.
    expect(untilStep(ladder, 3, 30).to).toBe(2);
    expect(untilStep(ladder, 2, 60).to).toBe(3);
    expect(untilStep(ladder, 3, 30).to).toBe(2);
    expect(untilStep(ladder, 2, 30).to).toBe(1);

    // Tier 2's first failure waits the first delay, whatever happened to tier 3.
    const retry = untilStep(ladder, 1, 60);
    expect(retry.to).toBe(2);
    expect(retry.seconds).toBeLessThan(65);
  });

  it("never steps outside the ladder", () => {
    expect(run(new QualityLadder(), 0, 20, 30)).toBe(0);
    expect(run(new QualityLadder(), 3, 60, 30)).toBe(3);
  });
});
