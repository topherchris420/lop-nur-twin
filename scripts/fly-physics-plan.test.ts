import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCommand, type BodySnapshot } from "../src/bethesda/fly/neural.js";
import { resolveParams } from "../src/bethesda/fly/params.js";
import { SKELETON } from "../src/bethesda/fly/skeleton.js";
import {
  CONTROL_DT_S,
  LEG_ACTUATORS,
  PHYSICS_SCENARIOS,
  PlanAdapter,
  planTrace,
  traceText,
} from "./fly-physics-plan.js";

const scenario = (id: string) => PHYSICS_SCENARIOS.find((s) => s.id === id)!;
const ENGINE = { runtime: "test", version: "0" };

describe("the physics backend's walking plans", () => {
  it("writes the same bytes every time", () => {
    const s = scenario("walk-and-turn");
    expect(traceText(planTrace(s, ENGINE))).toBe(traceText(planTrace(s, ENGINE)));
  });

  it("moves the fly through its gate only", () => {
    const source = readFileSync(
      new URL("./fly-physics-plan.ts", import.meta.url),
      "utf8",
    );
    // No assignment to the fly's state, its counts or its command from here.
    expect(source).not.toMatch(/\.state(\.[A-Za-z]+)*\s*=[^=]/);
    expect(source).not.toMatch(/\.(counts|command)\s*=[^=]/);
    const params = resolveParams();
    for (const s of PHYSICS_SCENARIOS) {
      const adapter = new PlanAdapter(s);
      for (const mode of ["rest", "walk"] as const) {
        const body = { mode } as BodySnapshot;
        const cmd = adapter.decide({ body, frame: null!, sites: [], params, dt: 0.05 });
        expect(validateCommand(cmd, body, params).ok).toBe(true);
      }
      expect(planTrace(s, ENGINE).fly.gate_refusals).toBe(0);
    }
  });

  it("samples the plan on FlyBody's 2 ms control clock within FlyBody's joint ranges", () => {
    const tr = planTrace(scenario("walk-3cms"), ENGINE);
    const ranges = new Map(
      SKELETON.bodies.flatMap((b) => b.joints.map((j) => [j.name, j.range] as const)),
    );
    expect(tr.sampling.count).toBe(1001);
    expect(tr.samples.t[1]).toBeCloseTo(CONTROL_DT_S, 12);
    expect(tr.actuators).toEqual(LEG_ACTUATORS);
    for (const row of tr.samples.targets)
      row.forEach((value, i) => {
        const range = ranges.get(LEG_ACTUATORS[i]!);
        if (range) {
          expect(value).toBeGreaterThanOrEqual(range[0] - 1e-6);
          expect(value).toBeLessThanOrEqual(range[1] + 1e-6);
        }
      });
  });

  it("plants the stance feet on one plane and lifts the swing feet", () => {
    const tr = planTrace(scenario("walk-2cms"), ENGINE);
    const stance: number[] = [],
      swing: number[] = [];
    tr.samples.claws.forEach((flat, k) =>
      tr.samples.stance[k]!.forEach((down, leg) =>
        (down ? stance : swing).push(flat[leg * 3 + 2]!),
      ),
    );
    // Within 5 µm: the pose solver stops within 0.1 µm of its target, a little
    // more in the first steps while it warm-starts.
    const plane = stance[0]!;
    for (const z of stance) expect(Math.abs(z - plane)).toBeLessThan(5e-4);
    expect(Math.max(...swing)).toBeGreaterThan(plane + 0.01);
    // While walking at 2 cm/s, three to five feet are down.
    const down = tr.samples.stance.slice(500).map((s) => s.reduce((a, b) => a + b, 0));
    expect(Math.min(...down)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...down)).toBeLessThanOrEqual(5);
  });

  it("goes where the commands say", () => {
    const walk = planTrace(scenario("walk-2cms"), ENGINE).samples.thorax;
    const [x, y, z, heading] = walk[walk.length - 1]!;
    // Two seconds at 2 cm/s, less the speed's 0.1 s ramp from rest.
    expect(x).toBeCloseTo(3.8, 1);
    expect(y).toBe(0);
    expect(heading).toBe(0);
    expect(z).toBeCloseTo(walk[0]![2]!, 9);
    const turn = planTrace(scenario("turn-on-the-spot"), ENGINE).samples.thorax;
    const end = turn[turn.length - 1]!;
    expect(Math.hypot(end[0]!, end[1]!)).toBeLessThan(1e-9);
    expect(end[3]).toBeCloseTo(4, 3);
  });
});
