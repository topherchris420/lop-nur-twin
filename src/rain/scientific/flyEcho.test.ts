import { describe, expect, it } from "vitest";
import { canonicalJson } from "../sha256.js";
import { mulberry32 } from "../../lib/noise.js";
import { ECHO_VARIANTS } from "../../bethesda/fly/echo/selfModel.js";
import {
  compileFlyExperiment,
  FLY_APPARATUS,
  FLY_PILOT_SEEDS,
  runFlyArm,
} from "./fly.js";
import { flyExample } from "./flyExample.js";
import {
  drawEchoSchedule,
  ECHO_DEVELOPMENT_CONDITIONS,
  ECHO_EVALUATION_CONDITIONS,
  ObstacleWorld,
  pathWindows,
  runEchoTrial,
  scoreChanges,
  type EchoApparatus,
  type EchoTruth,
} from "./flyEcho.js";
import { FLY_ECHO_VARIANTS, FLY_METRICS, type FlyBlockSpec } from "./contracts.js";
import type { EchoEvent } from "../../bethesda/fly/echo/selfModel.js";

const DEV = ECHO_DEVELOPMENT_CONDITIONS;
/** The development apparatus: what tests may run without touching the held-out conditions. */
function developmentBlock(id: "impairment" | "attribution" | "retention"): FlyBlockSpec {
  const block = structuredClone(FLY_APPARATUS[id]);
  block.arena = { size: [4, 2.5, 4], ambient: 0.6, pillars: [] };
  block.echo = {
    ...block.echo!,
    conditions: "development",
    condition_set:
      id === "attribution"
        ? [DEV.speed_gain, DEV.turn_bias, DEV.push, DEV.spin, DEV.sensor_noise]
        : [DEV.speed_gain, DEV.turn_gain, DEV.turn_bias],
  };
  return block;
}

describe("ECHO conditions: development and evaluation never mixed", () => {
  it("draws every evaluation strength from bands that exclude the development value", () => {
    for (const [id, dev] of Object.entries(DEV)) {
      const held =
        ECHO_EVALUATION_CONDITIONS[id as keyof typeof ECHO_EVALUATION_CONDITIONS];
      for (const fx of dev.effects) {
        const devValue = fx.bands[0]![0];
        const same = held.effects.find((e) => e.field === fx.field)!;
        for (const [lo, hi] of same.bands)
          expect(devValue < lo || devValue > hi, `${id} ${fx.field}`).toBe(true);
      }
    }
    // Combinations, an obstacle and a misleading sense exist only for evaluation.
    for (const id of [
      "speed_and_turn_gain",
      "speed_gain_and_push",
      "obstacle",
      "misleading_sense",
    ])
      expect(Object.keys(DEV)).not.toContain(id);
  });

  it("registers only the held-out conditions, in the held-out arena", () => {
    for (const id of ["impairment", "attribution", "retention"] as const) {
      const b = FLY_APPARATUS[id];
      expect(b.echo!.conditions).toBe("evaluation");
      expect(b.arena.size).not.toEqual([4, 2.5, 4]);
      for (const c of b.echo!.condition_set)
        expect(c).toEqual(
          ECHO_EVALUATION_CONDITIONS[c.id as keyof typeof ECHO_EVALUATION_CONDITIONS],
        );
    }
  });

  it("draws one schedule per seed, the same in both arms", () => {
    const a = drawEchoSchedule(FLY_APPARATUS.attribution.echo!, 160, mulberry32(7));
    const b = drawEchoSchedule(FLY_APPARATUS.attribution.echo!, 160, mulberry32(7));
    expect(b).toEqual(a);
    expect(a).toHaveLength(4);
    // A shorter run sees the start of the same schedule.
    const short = drawEchoSchedule(FLY_APPARATUS.attribution.echo!, 60, mulberry32(7));
    expect(short.map((t) => t.condition)).toEqual(
      a.filter((t) => t.from < 60).map((t) => t.condition),
    );
    const retention = drawEchoSchedule(FLY_APPARATUS.retention.echo!, 245, mulberry32(3));
    expect(retention[2]!.condition).toBe(retention[0]!.condition);
    expect(retention[1]!.condition).not.toBe(retention[0]!.condition);
  });
});

describe("the ECHO protocols compile through the backend", () => {
  it("compiles the three demonstrations, binds the arms, and refuses an unknown variant", () => {
    for (const p of ["echo_impairment", "echo_attribution", "echo_retention"] as const) {
      const c = compileFlyExperiment(flyExample(p));
      expect(c.ok, p).toBe(true);
      if (!c.ok) continue;
      expect(c.value.experiment.arms[0]!.echo).toEqual({
        variant: "full",
        reset_s: null,
      });
      expect(c.value.ir.limitations.join(" ")).toMatch(/not evidence of awareness/);
      expect(c.value.ir.limitations.join(" ")).toMatch(/never given their labels/);
    }
    const reset = compileFlyExperiment(flyExample("echo_retention"));
    expect(reset.ok && reset.value.experiment.arms[1]!.echo).toEqual({
      variant: "full",
      reset_s: 145,
    });
    const bad = flyExample("echo_impairment", {
      treatment: { kind: "echo_impairment", variant: "telepathy" as never },
    });
    expect(compileFlyExperiment(bad).ok).toBe(false);
    expect([...FLY_ECHO_VARIANTS]).toEqual([...ECHO_VARIANTS]);
    // Every ECHO metric belongs to an ECHO block.
    for (const m of FLY_METRICS)
      if (["impairment", "attribution", "retention"].includes(m.block))
        expect(FLY_APPARATUS[m.block as "impairment"].echo).toBeDefined();
  });

  it("runs an ECHO block deterministically, with every command through the gate", () => {
    const block = developmentBlock("impairment");
    const seeds = FLY_PILOT_SEEDS.slice(0, 2);
    const arm = (variant: "full" | "reactive") => ({
      id: "control" as const,
      config: {},
      noise: 0,
      light_intensity: 0,
      l_over_v_ms: 40,
      isi_s: 90,
      echo: { variant, reset_s: null },
    });
    const a = runFlyArm([block], arm("full"), seeds);
    const b = runFlyArm([structuredClone(block)], arm("full"), [...seeds]);
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    for (const r of a) {
      expect(r.gate_refusals).toBe(0);
      expect(Object.keys(r.metrics).sort()).toEqual(
        FLY_METRICS.filter((m) => m.block === "impairment")
          .map((m) => m.id)
          .sort(),
      );
    }
    const reactive = runFlyArm([block], arm("reactive"), seeds);
    for (const r of reactive) {
      expect(r.metrics.detection_latency_s).toBeNull();
      expect(r.metrics.identification_error).toBeNull();
    }
  });
});

describe("the host's measurements", () => {
  const apparatus: EchoApparatus = developmentBlock("impairment").echo!;
  it("finds no path error where an unimpaired body follows its intentions", () => {
    const trial = runEchoTrial({
      arena: { size: [4, 2.5, 4], ambient: 0.6, pillars: [] },
      arenaId: "t",
      startHalfWidth: 0.3,
      config: { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 },
      durationS: 60,
      truth: [],
      arm: { variant: "reactive", reset_s: null },
      seed: 31,
      geometry: mulberry32(31),
    });
    const P = trial.fly.params;
    const ws = pathWindows(
      trial.decisions,
      apparatus.window_s,
      P.physicsStepMs / 1000,
      P.walkSpeedTauS,
    );
    expect(ws.length).toBeGreaterThan(10);
    // Only the legs' lag after a change of intended speed within a window remains.
    expect(ws.reduce((s, w) => s + w.error, 0) / ws.length).toBeLessThan(0.005);
  });

  it("scores each change by the fly's own conclusion, and an obstacle by not blaming itself", () => {
    const truth: EchoTruth[] = [
      {
        condition: "speed_gain",
        cause: "self",
        from: 10,
        until: 30,
        values: { speedGain: 0.5 },
      },
      {
        condition: "push",
        cause: "external",
        from: 50,
        until: null,
        values: { drift: [0.01, 0] },
      },
      {
        condition: "obstacle",
        cause: "environment",
        from: 70,
        until: 80,
        values: { obstacle: 1 },
      },
    ];
    const events: EchoEvent[] = [
      { t: 10.5, kind: "noticed", since: 10 },
      {
        t: 11,
        kind: "concluded",
        explanation: "self",
        candidate: "self:speed",
        probability: 0.95,
        resolved: true,
      },
      { t: 30.4, kind: "noticed", since: 30 },
      {
        t: 31,
        kind: "concluded",
        explanation: "self",
        candidate: "nominal",
        probability: 0.9,
        resolved: true,
      },
      { t: 51, kind: "noticed", since: 50 },
      {
        t: 52,
        kind: "concluded",
        explanation: "self",
        candidate: "self:speed",
        probability: 0.8,
        resolved: true,
      },
    ];
    const s = scoreChanges(truth, events);
    expect(s.map((x) => [x.condition, x.edge, x.answered, x.correct])).toEqual([
      ["speed_gain", "onset", "self", true],
      ["speed_gain", "offset", "self", true],
      ["push", "onset", "self", false],
      ["obstacle", "onset", "missed", true],
    ]);
  });

  it("places a temporary obstacle in the fly's path and removes it", () => {
    const w = new ObstacleWorld({ size: [4, 2.5, 4], ambient: 0.6 }, "o");
    expect(w.solid([0.1, 0.01, 0])).toBe(false);
    w.place(0.1, 0, [0.03, 0.025, 0.015]);
    expect(w.obstructed).toBe(true);
    expect(w.solid([0.1, 0.01, 0])).toBe(true);
    w.clear();
    expect(w.solid([0.1, 0.01, 0])).toBe(false);
  });

  it("resets the self-model where the arm says, on record", () => {
    const trial = runEchoTrial({
      arena: { size: [4, 2.5, 4], ambient: 0.6, pillars: [] },
      arenaId: "t",
      startHalfWidth: 0.3,
      config: { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 },
      durationS: 20,
      truth: [],
      arm: { variant: "full", reset_s: 10 },
      seed: 32,
      geometry: mulberry32(32),
    });
    expect(trial.adapter.state.replaced.map((r) => r.how)).toEqual(["reset"]);
  });
});
