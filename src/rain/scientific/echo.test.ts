import { describe, expect, it } from "vitest";
import { compileFlyExperiment } from "./fly.js";
import { flyExample } from "./flyExample.js";
import { FLY_SOURCE } from "./flySource.js";
import { temporaryObstacleWorld } from "./echoRig.js";
import { arenaWorld } from "../../bethesda/fly/arena.js";
import { runEchoTrial, runEchoBlock } from "./echoRig.js";

describe("ECHO native scientific boundary", () => {
  it("compiles protocols and ablations with fixed acceptance criteria and host-owned seeds", () => {
    for (const kind of ["echo_impairment", "echo_causation", "echo_memory"] as const) {
      const full = compileFlyExperiment(flyExample(kind));
      expect(full.ok).toBe(true);
      if (!full.ok) throw new Error(full.errors.join(";"));
      expect(full.value.criteria.guards.find((g) => g.id === "G5")?.value).toBe(0);
      expect(full.value.experiment.arms[0]?.echo_variant).toBe(
        kind === "echo_memory" ? "reset_memory" : "disabled",
      );
      for (const variant of ["no_learning", "no_memory", "no_uncertainty"] as const) {
        const plan = compileFlyExperiment(
          flyExample(kind, { treatment: { kind, variant } }),
        );
        expect(plan.ok).toBe(true);
        if (plan.ok) expect(plan.value.criteria).toEqual(full.value.criteria);
      }
      const bad = flyExample(kind) as unknown as { parameters: Record<string, unknown> };
      bad.parameters.seeds = [1, 2, 3];
      expect(compileFlyExperiment(bad).ok).toBe(false);
    }
  });
  it("fingerprints the model, sensor seam, controller, checkpoint validator and apparatus", () => {
    for (const path of [
      "src/bethesda/fly/echo/model.ts",
      "src/bethesda/fly/echo/controller.ts",
      "src/bethesda/fly/echo/checkpoint.ts",
      "src/bethesda/fly/echo/apparatus.ts",
      "src/rain/scientific/echoRig.ts",
      "src/bethesda/fly/fly.ts",
    ])
      expect(FLY_SOURCE.files[path]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("a temporary obstacle changes actual sensing and solidity, then disappears", () => {
    const open = arenaWorld({ size: [4, 2, 4], ambient: 0.6 });
    const blocked = arenaWorld({
      size: [4, 2, 4],
      ambient: 0.6,
      platforms: [{ center: [0.1, 0.1, 0], half: [0.02, 0.1, 0.1] }],
    });
    let active = false;
    const world = temporaryObstacleWorld(open, blocked, () => active);
    expect(world.solid([0.1, 0.05, 0])).toBe(false);
    active = true;
    expect(world.solid([0.1, 0.05, 0])).toBe(true);
    expect(world.raycast([0, 0.05, 0], [1, 0, 0], 0.2)?.kind).toBe("table");
    active = false;
    expect(world.raycast([0, 0.05, 0], [1, 0, 0], 0.2)).toBeNull();
  });
  it("averages false self-attribution over eligible causation trials only", () => {
    const plan = compileFlyExperiment(flyExample("echo_causation"));
    if (!plan.ok) throw new Error(plan.errors.join(";"));
    const run = runEchoBlock(
      plan.value.experiment.blocks[0]!,
      plan.value.experiment.arms[0]!,
      2832889622,
    );
    const trials = Array.from({ length: 6 }, (_, trial) =>
      runEchoTrial("echo_causation", 2832889622, trial, "disabled"),
    );
    expect(trials.map((t) => t.falseSelfAttribution === null)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    const eligible = trials.flatMap((t) =>
      t.falseSelfAttribution === null ? [] : [t.falseSelfAttribution],
    );
    expect(eligible).toHaveLength(4);
    expect(run.metrics.echo_causation_false_self_attribution).toBeCloseTo(
      eligible.reduce((a, b) => a + b, 0) / 4,
      12,
    );
    expect(run.metrics.echo_causation_false_self_attribution).toBeCloseTo(
      0.6142857142857143,
      12,
    );
  });
  it.each(["echo_impairment", "echo_memory"] as const)(
    "reports unmeasured false self-attribution as null for %s",
    (kind) => {
      const plan = compileFlyExperiment(flyExample(kind));
      if (!plan.ok) throw new Error(plan.errors.join(";"));
      const run = runEchoBlock(
        plan.value.experiment.blocks[0]!,
        plan.value.experiment.arms[0]!,
        9173,
      );
      expect(
        runEchoTrial(kind, 9173, 0, plan.value.experiment.arms[0]!.echo_variant!)
          .falseSelfAttribution,
      ).toBeNull();
      expect(run.metrics[`${kind}_false_self_attribution`]).toBeNull();
    },
  );
  it("development trials use the actual body, compensate, replay and keep gate refusals at zero", () => {
    const a = runEchoTrial("echo_impairment", 9173, 0, "full", "development");
    const baseline = runEchoTrial("echo_impairment", 9173, 0, "disabled", "development");
    expect(a.hashes).toEqual(
      runEchoTrial("echo_impairment", 9173, 0, "full", "development").hashes,
    );
    expect(a.trackingErrorCmS).toBeLessThan(baseline.trackingErrorCmS);
    expect(a.attributionAccuracy).toBeGreaterThan(0.8);
    expect(a.detectionLatencyS).not.toBeNull();
    expect(a.gateRefusals).toBe(0);
    expect(a.checkpointVerified).toBe(true);
  });
});
