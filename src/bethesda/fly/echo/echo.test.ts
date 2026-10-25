import { describe, expect, it } from "vitest";
import { canonicalHash } from "../../../game/pilot/hash.js";
import { DigitalFly } from "../fly.js";
import { arenaWorld } from "../arena.js";
import { ReducedOrderController } from "../controller.js";
import { EchoController } from "./controller.js";
import {
  EchoModel,
  ECHO_LIMITS,
  type MotionObservation,
  type MotorCopy,
} from "./model.js";
import { checkedPerturbation, NO_PERTURBATION } from "./apparatus.js";
import { HeadlessBethesdaLife } from "../../life/headless.js";
import { PROFILES } from "../../simulation.js";

const action = (speed = 1): MotorCopy => ({
  mode: "walk",
  walkSpeedCmS: speed,
  yawRate: 0.4,
  dt: 0.05,
  stepS: 0.005,
  walkTauS: 0.05,
});
const observation = (k: number, forwardM: number): MotionObservation => ({
  tick: k * 10,
  t: k * 0.05,
  dt: 0.05,
  forwardM,
  lateralM: 0,
  verticalM: 0,
  turnRad: 0.02,
  reserve: 0.7,
  mode: "walk",
  clear: true,
});
function train(m: EchoModel, count = 200, offset = 0): void {
  for (let k = offset; k < count + offset; k++) {
    m.predict(action(Math.floor(k / 8) % 2 ? 2 : 0.5));
    const p = m.inspect().pending!;
    m.observe(observation(k + 1, (p.nominalCmS * 0.6 * 0.05) / 100));
  }
}

describe("Project ECHO sensorimotor self-model", () => {
  it("learns an action response without access to simulator state or causal labels", () => {
    const m = new EchoModel();
    train(m);
    expect(m.inspect().gain).toBeCloseTo(0.6, 3);
    expect(m.inspect().attribution).toBe("action response changed");
    expect(m.regulate(1, 0.4, 4).speed).toBeGreaterThan(1.5);
    const poisoned = {
      ...observation(201, 0),
      position: [900, 900, 900],
      movementGain: 0.01,
      cause: "wind",
    };
    m.observe(poisoned);
    expect(Object.keys(m.inspect().history.at(-1)!)).not.toContain("cause");
    expect(Object.keys(m.inspect().history.at(-1)!)).not.toContain("position");
  });
  it("does not infer a cause without motor excitation", () => {
    const m = new EchoModel();
    for (let k = 0; k < 200; k++) {
      m.predict(action());
      const p = m.inspect().pending!;
      m.observe(observation(k + 1, (p.nominalCmS * 0.7 * 0.05) / 100));
    }
    expect(m.inspect().attribution).toBe("insufficient excitation");
  });
  it("predicts before observing, measures interval coverage, and makes uncertainty change actions", () => {
    const m = new EchoModel();
    m.predict(action());
    const before = m.inspect().pending!;
    m.observe(observation(1, before.forwardM + 0.002));
    expect(m.inspect().predictions).toBe(1);
    expect(m.inspect().covered).toBe(0);
    expect(m.inspect().sigmaCmS).toBeGreaterThan(0.8);
    expect(m.regulate(1, 0, 4).speed).toBeLessThan(0.8);
    const ablated = new EchoModel("no_uncertainty");
    ablated.predict(action());
    ablated.observe(observation(1, before.forwardM + 0.002));
    expect(ablated.regulate(1, 0, 4).speed).toBe(1);
  });
  it("bounds all memories and restores the same future predictions and learning", () => {
    const a = new EchoModel("full", { seed: 77, simulator: "test-version" });
    train(a, 150);
    a.predict(action(1.4));
    const b = EchoModel.restore(a.checkpoint());
    const next = observation(151, a.inspect().pending!.forwardM);
    a.observe(next);
    b.observe(next);
    train(a, 200, 151);
    train(b, 200, 151);
    expect(a.checkpoint()).toBe(b.checkpoint());
    const state = a.inspect();
    expect(state.history.length).toBeLessThanOrEqual(ECHO_LIMITS.history);
    expect(state.window.length).toBeLessThanOrEqual(ECHO_LIMITS.window);
    expect(state.episodes.length).toBeLessThanOrEqual(ECHO_LIMITS.episodes);
    expect(state.episodes[0]).toMatchObject({ seed: 77, simulator: "test-version" });
    const inspection = a.inspect();
    inspection.gain = 0.3;
    expect(a.inspect().gain).not.toBe(0.3);
  });
  it("rejects corruption, mismatched versions and oversized checkpoints", () => {
    const raw = JSON.parse(new EchoModel().checkpoint());
    raw.state.gain = 10;
    expect(() => EchoModel.restore(JSON.stringify(raw))).toThrow();
    raw.schema = "future";
    const { hash: _, ...body } = raw;
    raw.hash = canonicalHash(body);
    expect(() => EchoModel.restore(JSON.stringify(raw))).toThrow();
    expect(() => EchoModel.restore(" ".repeat(150001))).toThrow();
    expect(() =>
      checkedPerturbation({ ...NO_PERTURBATION, movementGain: NaN }),
    ).toThrow();
  });
  it("runs the actual fly deterministically across differently grouped clocks", () => {
    const make = () =>
      new DigitalFly({
        seed: 71,
        world: arenaWorld({ size: [4, 2, 4], ambient: 0.6 }),
        start: { p: [0, 0.1, 0], yaw: 0.7 },
        adapter: () =>
          new EchoController({
            descriptor: new ReducedOrderController(() => 0.5).descriptor,
            decide: () => ({ mode: "walk", walkSpeed: 1, reason: "test excitation" }),
          }),
      });
    const a = make(),
      b = make();
    a.advance(3);
    for (let k = 0; k < 600; k++) b.advance(0.005);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.state.counts.rejected).toBe(0);
  });
  it("uses the body's rounded integration clock for predictions", () => {
    const echo = new EchoController({
      descriptor: new ReducedOrderController(() => 0.5).descriptor,
      decide: () => ({ mode: "walk", walkSpeed: 1, reason: "rounded timing" }),
    });
    const fly = new DigitalFly({
      seed: 1,
      world: arenaWorld({ size: [4, 2, 4], ambient: 0.6 }),
      start: { p: [0, 0.1, 0], yaw: 0 },
      config: { decisionPeriodMs: 13, physicsStepMs: 5 },
      adapter: () => echo,
    });
    fly.advance(0.5);
    expect(echo.model.inspect().pending?.dt).toBe(0.015);
    expect(echo.model.inspect().predictions).toBeGreaterThan(10);
  });
  it("never learns a refused command and preserves native reflex arbitration", () => {
    const echo = new EchoController({
      descriptor: new ReducedOrderController(() => 0.5).descriptor,
      decide: () => ({ mode: "walk", walkSpeed: Infinity, reason: "invalid adapter" }),
    });
    const fly = new DigitalFly({
      seed: 1,
      world: arenaWorld({ size: [4, 2, 4], ambient: 0.6 }),
      start: { p: [0, 0.1, 0], yaw: 0 },
      adapter: () => echo,
    });
    // Infinity must reach the gate unchanged, rather than becoming a legal action.
    fly.advance(0.1);
    expect(fly.state.counts.rejected).toBeGreaterThan(0);
    expect(echo.model.inspect().pending).toBeNull();
  });
  it("the disabled self-model preserves native body behavior", () => {
    const config = { ...PROFILES[0]!, pedestrians: 3, vehicles: 1 };
    const a = new HeadlessBethesdaLife(config),
      b = new HeadlessBethesdaLife(config, { echo: "disabled" });
    a.advanceTicks(60);
    b.advanceTicks(60);
    expect(a.cityFly.fly.state).toEqual(b.cityFly.fly.state);
  });
  it("enables ECHO headlessly while preserving city isolation and read-only inspection", () => {
    const config = { ...PROFILES[0]!, pedestrians: 3, vehicles: 1 };
    const baseline = new HeadlessBethesdaLife(config),
      echo = new HeadlessBethesdaLife(config, { echo: "full" });
    baseline.advanceTicks(10);
    echo.advanceTicks(10);
    expect(baseline.city.stateHash()).toBe(echo.city.stateHash());
    const hash = echo.cityFly.stateHash();
    const controller = echo.cityFly.fly.adapter as EchoController;
    controller.model.inspect();
    controller.model.inspect();
    expect(echo.cityFly.stateHash()).toBe(hash);
  });
});
