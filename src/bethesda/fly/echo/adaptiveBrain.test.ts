import { describe, expect, it } from "vitest";
import { arenaWorld } from "../arena.js";
import { DigitalFly } from "../fly.js";
import type { MotorCommand } from "../neural.js";
import type { SelfMotionSample } from "../selfMotion.js";
import { EchoAdapter } from "./adapter.js";
import {
  ADAPTIVE_BRAIN_VERSION,
  AdaptiveEchoBrain,
  EmbodiedPlasticity,
} from "./adaptiveBrain.js";

const walking: MotorCommand = {
  mode: "walk",
  walkSpeed: 3,
  yawRate: 0,
  reason: "walk toward food",
};

function sample(touched: boolean, forward: number): SelfMotionSample {
  return {
    t: 0.05,
    dt: 0.05,
    forward,
    lateral: 0,
    vertical: 0,
    turn: 0,
    touched,
  };
}

describe("ECHO embodied plasticity (research only)", () => {
  it("learns from its own actions and cautiously scales ineffective walking", () => {
    const brain = new EmbodiedPlasticity();
    for (let i = 0; i < 9; i++) {
      expect(brain.advise(walking, 0.8, false, false)).toBe(walking);
      brain.observe(sample(true, 0));
    }
    expect(brain.state.samples).toBe(9);
    expect(brain.state.contexts.normal.failed).toBe(9);
    const altered = brain.advise(walking, 0.8, false, true);
    expect(altered.mode).toBe("walk");
    expect(altered.walkSpeed).toBeCloseTo(2.1);
    expect(altered.yawRate).toBe(walking.yawRate);
    expect(altered.reason).toContain("cautious");
    expect(brain.state.adaptations).toBe(1);
    // It does not generalize failure in the fed context to hunger without evidence.
    expect(brain.advise(walking, 0.15, false, true)).toBe(walking);
  });

  it("refuses to alter an edge, reflex mode or a cancelled trial", () => {
    const brain = new EmbodiedPlasticity();
    brain.advise(walking, 0.8, true, true);
    brain.observe(sample(true, 0));
    expect(brain.state.samples).toBe(0);
    brain.advise(walking, 0.8, false, false);
    brain.interrupted();
    brain.observe(sample(true, 0));
    expect(brain.state.samples).toBe(0);
    const reflex: MotorCommand = { mode: "escape", heading: 0, reason: "loom" };
    expect(brain.advise(reflex, 0.8, false, true)).toBe(reflex);
  });

  it("bounds memory, persists the acquired brain, and replays deterministically", () => {
    const brain = new EmbodiedPlasticity();
    for (let i = 0; i < 1100; i++) {
      brain.advise(walking, 0.8, false, false);
      brain.observe(sample(i % 3 === 0, 0.002));
    }
    expect(brain.state.recent).toHaveLength(48);
    const counts = brain.state.contexts.normal;
    expect(counts.succeeded + counts.failed).toBeLessThan(1024);
    const restored = new EmbodiedPlasticity(
      JSON.parse(JSON.stringify(brain.state)) as typeof brain.state,
    );
    expect(restored.state).toEqual(brain.state);
    const a = brain.advise(walking, 0.8, false, true);
    const b = restored.advise(walking, 0.8, false, true);
    expect(a).toEqual(b);
    brain.observe(sample(false, 0.002));
    restored.observe(sample(false, 0.002));
    expect(restored.state).toEqual(brain.state);
    expect(() =>
      new EmbodiedPlasticity({
        ...brain.state,
        schema: "unknown" as typeof ADAPTIVE_BRAIN_VERSION,
      }),
    ).toThrow(/version/);
  });

  it("keeps actual movement identical to original ECHO when in shadow mode", () => {
    const options = {
      seed: 41,
      world: arenaWorld({ size: [4, 2.5, 4], ambient: 0.6 }),
      start: { p: [0, 0.5, 0] as [number, number, number], yaw: 0.3 },
      config: { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 },
    };
    const original = new DigitalFly({
      ...options,
      adapter: EchoAdapter.factory({ seed: 41 }),
    });
    const experiment = new DigitalFly({
      ...options,
      adapter: AdaptiveEchoBrain.factory({ seed: 41, active: false }),
    });
    for (let i = 0; i < 40; i++) {
      original.advance(0.05);
      experiment.advance(0.05);
    }
    expect(experiment.state.p).toEqual(original.state.p);
    expect(experiment.state.yaw).toBe(original.state.yaw);
    expect(experiment.state.mode).toBe(original.state.mode);
    expect(experiment.state.reserve).toBe(original.state.reserve);
    const adapter = experiment.adapter as AdaptiveEchoBrain;
    expect(adapter.state.version).toBe(ADAPTIVE_BRAIN_VERSION);
  });
});
