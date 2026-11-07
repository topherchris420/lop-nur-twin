import { describe, expect, it } from "vitest";
import { arenaWorld } from "../arena.js";
import { DigitalFly } from "../fly.js";
import type { DecisionInput, MotorCommand } from "../neural.js";
import { PERTURBATION_SCHEMA } from "../perturbation.js";
import type { SelfMotionSample } from "../selfMotion.js";
import {
  ADAPTIVE_BRAIN_VERSION,
  EmbodiedPlasticity,
  PLASTICITY_PARAMS,
  wilsonLower,
  type PlasticityMode,
} from "./adaptiveBrain.js";
import { OrganismAdapter } from "../../life/organism.js";
import { PlasticityOrganismAdapter } from "../../life/plasticOrganism.js";

const walking: MotorCommand = {
  mode: "walk",
  walkSpeed: 3,
  yawRate: 0,
  reason: "walk toward food",
};

/** A decision input with only what the plasticity reads. */
function input(
  t: number,
  o: {
    mode?: string;
    modeT?: number;
    walkSpeed?: number;
    reserve?: number;
    edge?: boolean;
    self?: SelfMotionSample | null;
  } = {},
): DecisionInput {
  return {
    body: {
      t,
      mode: o.mode ?? "walk",
      modeT: o.modeT ?? 10,
      walkSpeed: o.walkSpeed ?? 3,
      reserve: o.reserve ?? 0.8,
      edge: o.edge ?? false,
    },
    dt: 0.05,
    self: o.self,
  } as unknown as DecisionInput;
}

const sample = (t: number, forward: number, touched = false): SelfMotionSample => ({
  t,
  dt: 0.05,
  forward,
  lateral: 0,
  vertical: 0,
  turn: 0,
  touched,
});

/** One full decision period: a walk issued at t, answered at t + 0.05 by what the body did. */
function period(
  brain: EmbodiedPlasticity,
  t: number,
  forward: number,
  o: Parameters<typeof input>[1] = {},
): MotorCommand {
  const at = input(t, o);
  const shaped = brain.shape(at, walking);
  brain.issued(shaped, at.body);
  brain.observe(
    input(t + 0.05, { ...o, self: sample(t + 0.05, forward, o.self?.touched) }),
  );
  return shaped;
}

describe("ECHO embodied plasticity v2", () => {
  it("learns walking reliability from executed periods, separately per energy context", () => {
    const brain = new EmbodiedPlasticity("shadow");
    // 3 cm/s for 50 ms steps 1.5 mm; an effective period advances at least 40% of it.
    for (let i = 0; i < 10; i++) period(brain, i, 0.0014);
    for (let i = 10; i < 16; i++) period(brain, i, 0.0001);
    expect(brain.state.contexts.normal).toEqual({ succeeded: 10, failed: 6 });
    expect(brain.state.contexts.low).toEqual({ succeeded: 0, failed: 0 });
    expect(brain.state.samples).toBe(16);
    for (let i = 20; i < 25; i++) period(brain, i, 0, { reserve: 0.2 });
    expect(brain.state.contexts.low.failed).toBe(5);
    expect(brain.state.recent.at(-1)).toMatchObject({ context: "low", effective: false });
  });

  it("counts touch as failure even when the body advanced", () => {
    const brain = new EmbodiedPlasticity("shadow");
    const at = input(0);
    brain.issued(brain.shape(at, walking), at.body);
    brain.observe(input(0.05, { self: sample(0.05, 0.0015, true) }));
    expect(brain.state.contexts.normal.failed).toBe(1);
  });

  it("discards periods that teach nothing, and never counts them as failures", () => {
    const brain = new EmbodiedPlasticity("active");
    const issue = (t: number) => {
      const at = input(t);
      brain.issued(walking, at.body);
    };
    // The body did not walk all period (a refused command, a mode change).
    issue(0);
    brain.observe(input(0.05, { mode: "rest", self: sample(0.05, 0) }));
    issue(1);
    brain.observe(input(1.05, { modeT: 0.01, self: sample(1.05, 0) }));
    // A reflex in between.
    issue(2);
    brain.interrupted();
    brain.observe(input(2.05, { self: sample(2.05, 0) }));
    // Legs barely stepping.
    brain.issued(walking, input(3, { walkSpeed: 0 }).body);
    brain.observe(input(3.05, { walkSpeed: 0, self: sample(3.05, 0) }));
    // No sample at all.
    issue(4);
    brain.observe(input(4.05, { self: null }));
    expect(brain.state.samples).toBe(0);
    expect(brain.state.contexts.normal).toEqual({ succeeded: 0, failed: 0 });
    expect(brain.state.discarded).toBe(5);
    // Not a walk: nothing pending, nothing counted.
    const rest: MotorCommand = { mode: "rest", reason: "rest" };
    brain.issued(rest, input(5).body);
    brain.observe(input(5.05, { self: sample(5.05, 0) }));
    expect(brain.state.discarded).toBe(5);
  });

  it("credits a period at most once: a sample that does not move forward in time is refused", () => {
    const brain = new EmbodiedPlasticity("shadow");
    period(brain, 1, 0.0014);
    expect(brain.state.samples).toBe(1);
    // The same sample offered again (a duplicate call, or a restart that re-offers it).
    const at = input(1);
    brain.issued(walking, at.body);
    brain.observe(input(1.05, { self: sample(1.05, 0.0014) }));
    expect(brain.state.samples).toBe(1);
    expect(brain.state.discarded).toBe(1);
  });

  it("shadow mode changes no command, and counts what active mode would have changed", () => {
    const shadow = new EmbodiedPlasticity("shadow");
    const active = new EmbodiedPlasticity("active");
    const n = PLASTICITY_PARAMS.minEvidence;
    for (let i = 0; i < n; i++) {
      expect(period(shadow, i, 0)).toBe(walking);
      period(active, i, 0);
    }
    expect(shadow.verdict("normal").cautious).toBe(true);
    const unchanged = shadow.shape(input(100), walking);
    expect(unchanged).toBe(walking);
    expect(shadow.state.shadowWouldAdapt).toBe(1);
    expect(shadow.state.adaptations).toBe(0);
    const changed = active.shape(input(100), walking);
    expect(changed.mode).toBe("walk");
    expect(changed.walkSpeed).toBeCloseTo(
      walking.walkSpeed! * PLASTICITY_PARAMS.cautiousScale,
    );
    expect(changed.yawRate).toBe(walking.yawRate);
    expect(changed.reason).toContain("learned cautious gait");
    expect(active.state.adaptations).toBe(1);
    expect(active.state.lastAdaptation).toMatchObject({ context: "normal", fromCmS: 3 });
    // It does not carry failure in the fed context over to hunger.
    expect(active.shape(input(101, { reserve: 0.1 }), walking)).toBe(walking);
  });

  it("acts only with enough evidence and a confident failure rate", () => {
    const brain = new EmbodiedPlasticity("active");
    for (let i = 0; i < PLASTICITY_PARAMS.minEvidence - 1; i++) period(brain, i, 0);
    expect(brain.verdict("normal").cautious).toBe(false);
    expect(brain.shape(input(100), walking)).toBe(walking);
    // Mixed evidence near one half: the lower bound stays under it.
    const mixed = new EmbodiedPlasticity("active");
    for (let i = 0; i < 200; i++) period(mixed, i, i % 2 ? 0 : 0.0014);
    expect(mixed.verdict("normal").failureLower).toBeLessThan(0.5);
    expect(mixed.shape(input(1000), walking)).toBe(walking);
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(40, 40)).toBeGreaterThan(0.9);
  });

  it("never alters a non-walk, an edge, or a stopped walk", () => {
    const brain = new EmbodiedPlasticity("active");
    for (let i = 0; i < 60; i++) period(brain, i, 0);
    const reflex: MotorCommand = { mode: "escape", heading: 0, reason: "loom" };
    expect(brain.shape(input(100), reflex)).toBe(reflex);
    expect(brain.shape(input(100, { edge: true }), walking)).toBe(walking);
    const stop: MotorCommand = { ...walking, walkSpeed: 0 };
    expect(brain.shape(input(100), stop)).toBe(stop);
  });

  it("disabled neither learns nor acts, and keeps what was learned", () => {
    const brain = new EmbodiedPlasticity("active");
    for (let i = 0; i < 60; i++) period(brain, i, 0);
    const learned = structuredClone(brain.state.contexts);
    brain.state.mode = "disabled";
    expect(period(brain, 200, 0)).toBe(walking);
    expect(brain.state.contexts).toEqual(learned);
    expect(brain.state.pending).toBeNull();
  });

  it("bounds its memory and stays plain data that survives a JSON round trip", () => {
    const brain = new EmbodiedPlasticity("shadow");
    for (let i = 0; i < 1100; i++) period(brain, i, i % 3 === 0 ? 0 : 0.0014);
    expect(brain.state.recent).toHaveLength(PLASTICITY_PARAMS.recentKept);
    const c = brain.state.contexts.normal;
    expect(c.succeeded + c.failed).toBeLessThan(PLASTICITY_PARAMS.countCap);
    expect(JSON.parse(JSON.stringify(brain.state))).toEqual(brain.state);
    expect(brain.state.schema).toBe(ADAPTIVE_BRAIN_VERSION);
    expect(() => new EmbodiedPlasticity("on" as PlasticityMode)).toThrow(/mode/);
  });
});

describe("the plasticity on the organism's own adapter, in a body", () => {
  const options = (speedGain: number) => ({
    seed: 41,
    world: arenaWorld({ size: [6, 2.5, 6], ambient: 0.6 }),
    start: { p: [0, 0.5, 0] as [number, number, number], yaw: 0.3 },
    config: { takeoffHz: 0, groomHz: 0, walkStartHz: 2, walkStopHz: 0.05 },
    // Legs that carry the body only a fifth as far as they step, from the start.
    perturbation: {
      schema: PERTURBATION_SCHEMA,
      episodes: [
        { id: "weak legs", cause: "self" as const, from: 0, until: null, speedGain },
      ],
    },
  });
  const run = (mode: PlasticityMode | null, speedGain: number, seconds: number) => {
    const fly = new DigitalFly({
      ...options(speedGain),
      adapter: (rng, streams) =>
        mode === null
          ? new OrganismAdapter(rng, streams, 41)
          : new PlasticityOrganismAdapter(rng, streams, 41, mode),
    });
    for (let i = 0; i < seconds * 20; i++) fly.advance(0.05);
    return fly;
  };
  const withoutPlasticity = (fly: DigitalFly) => {
    const state = JSON.parse(
      JSON.stringify((fly.adapter as OrganismAdapter).state),
    ) as Record<string, unknown>;
    delete state.plasticity;
    return state;
  };

  it("in shadow mode, the body and the original organism move exactly as without it", () => {
    const original = run(null, 0.2, 40);
    const shadow = run("shadow", 0.2, 40);
    expect(shadow.state).toEqual(original.state);
    expect(withoutPlasticity(shadow)).toEqual(withoutPlasticity(original));
    expect(shadow.log).toEqual(original.log);
    const p = (shadow.adapter as PlasticityOrganismAdapter).plasticity.state;
    expect(p.samples).toBeGreaterThan(0);
    expect(p.adaptations).toBe(0);
  }, 60000);

  it("in active mode with weak legs, it learns failure and slows only the walk", () => {
    const active = run("active", 0.2, 40);
    const p = (active.adapter as PlasticityOrganismAdapter).plasticity.state;
    expect(p.contexts.normal.failed).toBeGreaterThan(p.contexts.normal.succeeded);
    expect(p.adaptations).toBeGreaterThan(0);
    // Every adapted command passed the body's gate: none was refused.
    expect(active.log.filter((d) => d.kind === "refused")).toEqual([]);
    expect(active.log.some((d) => d.reason.includes("learned cautious gait"))).toBe(true);
  }, 60000);

  it("with sound legs, it learns success and never adapts", () => {
    const active = run("active", 1, 40);
    const p = (active.adapter as PlasticityOrganismAdapter).plasticity.state;
    expect(p.samples).toBeGreaterThan(0);
    expect(p.contexts.normal.succeeded).toBeGreaterThan(p.contexts.normal.failed);
    expect(p.adaptations).toBe(0);
  }, 60000);
});
