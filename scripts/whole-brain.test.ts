import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/lib/canonicalJson";
import { EchoAdapter } from "../src/bethesda/fly/echo/adapter";
import { DigitalFly, type FlyStart } from "../src/bethesda/fly/fly";
import type { SenseFrame } from "../src/bethesda/fly/senses";
import { wrapAngle } from "../src/bethesda/fly/units";
import { runSession, type SessionSpec } from "../src/bethesda/firstContact/session";
import type { SubjectSpec } from "../src/bethesda/firstContact/subjects";
import {
  researchWorld,
  SAME_OBJECT_RAD,
  ShadowTap,
  SmallObjectEye,
  type Readouts,
  type Scenario,
  type SensableObservation,
} from "./echo-neural-shadow";
import { SyncBrain } from "./fly-neural-sync";

const off = { predicted: false, mean_rate_hz: 0, spikes: 0 };
const on = (hz = 100) => ({ predicted: true, mean_rate_hz: hz, spikes: 10 });
const readouts = (over: Partial<Readouts> = {}): Readouts => ({
  feed: off,
  escape: off,
  walk: off,
  backward: off,
  groom: off,
  land: off,
  turn: { left_hz: 0, right_hz: 0, predicted: false, direction: null },
  descending: { active: 0, of: 1303 },
  window_ms: 100,
  ...over,
});

function wholeBrainFly(
  scenario: Scenario,
  brain: (t: number, obs: SensableObservation) => Readouts,
  start?: FlyStart,
) {
  const { world, start: s0, config } = researchWorld(scenario);
  const taps: ShadowTap[] = [];
  const fly = new DigitalFly({
    seed: 5,
    world,
    start: start ?? s0,
    config,
    adapter: ShadowTap.factory("neural-experimental", 5, 200_000, taps, {
      mapping: "whole-brain/v2",
      brain,
    }),
  });
  return { fly, tap: taps[0]! };
}

const frame = (t: number, looming: { sizeDeg: number; bearing: number } | null) =>
  ({
    t,
    looming: looming
      ? {
          id: "x",
          kind: "object",
          distance: 0.02,
          expansionDegS: 0,
          elevation: 0,
          drive: 0,
          ...looming,
        }
      : null,
  }) as unknown as SenseFrame;

describe("whole-brain/v2: the other fly on the eye", () => {
  it("reads angular speed from the bearing alone, and a jump as another object", () => {
    const eye = new SmallObjectEye();
    expect(eye.see(frame(0, { sizeDeg: 6, bearing: 0.1 }))).toEqual({
      sizeDeg: 6,
      speedDegS: 0,
      bearing: 0.1,
    });
    const moved = eye.see(frame(0.01, { sizeDeg: 6, bearing: 0.11 }))!;
    expect(moved.speedDegS).toBeCloseTo((0.01 * 180) / Math.PI / 0.01, 6);
    // The same sample seen again (decide and interrupt) keeps its speed.
    expect(eye.see(frame(0.01, { sizeDeg: 6, bearing: 0.11 }))!.speedDegS).toBe(
      moved.speedDegS,
    );
    expect(
      eye.see(frame(0.02, { sizeDeg: 6, bearing: 0.11 + SAME_OBJECT_RAD + 0.1 }))!
        .speedDegS,
    ).toBe(0);
    expect(eye.see(frame(0.03, null))).toBeNull();
    expect(eye.see(frame(0.04, { sizeDeg: 6, bearing: 0.2 }))!.speedDegS).toBe(0);
  });

  it("gives the brain only size, angular speed and bearing, once per new sample", () => {
    const asked: number[] = [];
    const { fly, tap } = wholeBrainFly("looms", (t) => {
      asked.push(t);
      return readouts();
    });
    for (let k = 0; k < 1500; k++) fly.advance(0.01);
    expect(asked.length).toBeGreaterThan(1000);
    for (let i = 1; i < asked.length; i++)
      expect(asked[i]!).toBeGreaterThan(asked[i - 1]!);
    const seen = tap.records.filter((r) => r.obs.smallObject);
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen)
      expect(Object.keys(r.obs.smallObject!).sort()).toEqual([
        "bearing",
        "sizeDeg",
        "speedDegS",
      ]);
    expect(seen.some((r) => r.obs.smallObject!.speedDegS !== 0)).toBe(true);
    expect(tap.descriptor.id).toContain("whole-brain/v2");
    expect(tap.descriptor.simulatesNeurons).toBe(true);
  }, 120_000);

  it("runs only for a neural-experimental subject", () => {
    const inner = () =>
      new EchoAdapter(() => 0.5, { navigation: () => 0.5 }, { variant: "full", seed: 1 });
    expect(
      () => new ShadowTap(inner(), "baseline", 10, { mapping: "whole-brain/v2" }),
    ).toThrow(/neural-experimental/);
    expect(
      () => new ShadowTap(inner(), "neural-shadow", 10, { brain: () => readouts() }),
    ).toThrow(/brain/);
  });
});

describe("whole-brain/v2: more behaviour from the descending neurons", () => {
  it("starts antennal grooming at rest when aDN1/aDN2 fire", () => {
    const { fly, tap } = wholeBrainFly("looms", () => readouts({ groom: on() }));
    let groomed = 0;
    for (let k = 0; k < 1000; k++) {
      fly.advance(0.01);
      if (fly.state.mode === "groom") groomed++;
    }
    expect(tap.overrides.groom ?? 0).toBeGreaterThan(0);
    expect(groomed).toBeGreaterThan(100);
  }, 120_000);

  it("walks when DNp09 fires and steers toward the more active DNa02", () => {
    const turned = (direction: "left" | "right") => {
      const turn = {
        left_hz: direction === "left" ? 100 : 0,
        right_hz: direction === "right" ? 100 : 0,
        predicted: true,
        direction,
      };
      const { fly, tap } = wholeBrainFly("looms", () => readouts({ walk: on(), turn }));
      let yaw = fly.state.yaw,
        total = 0;
      for (let k = 0; k < 1000; k++) {
        fly.advance(0.01);
        total += wrapAngle(fly.state.yaw - yaw);
        yaw = fly.state.yaw;
      }
      return { total, walked: fly.state.counts.walkedM, walks: tap.overrides.walk ?? 0 };
    };
    const left = turned("left");
    const right = turned("right");
    const { fly: still } = wholeBrainFly("looms", () => readouts());
    for (let k = 0; k < 1000; k++) still.advance(0.01);
    expect(left.walks).toBeGreaterThan(0);
    expect(left.walked).toBeGreaterThan(still.state.counts.walkedM);
    expect(left.total).toBeGreaterThan(3);
    expect(right.total).toBeLessThan(-3);
  }, 120_000);

  it("stops a walk when MDN fires: the body has no backward gait", () => {
    let k = 0;
    const { fly, tap } = wholeBrainFly("looms", () =>
      readouts(k < 300 ? { walk: on() } : { backward: on() }),
    );
    let walkingLate = 0;
    for (; k < 800; k++) {
      fly.advance(0.01);
      if (k > 400 && fly.state.mode === "walk") walkingLate++;
    }
    expect(tap.overrides.walk ?? 0).toBeGreaterThan(0);
    expect(tap.overrides.rest ?? 0).toBeGreaterThan(0);
    expect(walkingLate).toBeLessThan(50);
  }, 120_000);

  it("commits a flight to landing below when DNp07/DNp10 fire", () => {
    const start: FlyStart = { p: [0, 0.4, 0], yaw: 0, mode: "flight", v: [0.2, 0, 0] };
    const { fly, tap } = wholeBrainFly("looms", () => readouts({ land: on() }), start);
    // ECHO did not pick this landing, so the approach is steered from the readouts until touchdown.
    for (let k = 0; k < 500 && fly.state.counts.landings === 0; k++) fly.advance(0.01);
    expect(tap.overrides.land ?? 0).toBeGreaterThan(0);
    expect(fly.state.counts.landings).toBeGreaterThan(0);
  }, 120_000);
});

describe("a whole-brain subject in a first-contact session", () => {
  const protocol = JSON.parse(
    readFileSync(
      join(__dirname, "..", "src/bethesda/firstContact/protocols/encounter-v1.json"),
      "utf8",
    ),
  ) as {
    starts: { A: SubjectSpec["start"]; B: SubjectSpec["start"] };
    arena: SessionSpec["arena"];
    bridge: SessionSpec["bridge"];
  };
  const spec = (ids: [string, string]): SessionSpec => ({
    id: "research-whole-brain-test",
    condition: "live",
    // Seeds whose flies come within the ~3 cm at which a fly-sized body spans one ommatidium.
    subjects: [
      { id: ids[0], seed: 102, controller: "echo", start: protocol.starts.A },
      { id: ids[1], seed: 202, controller: "echo", start: protocol.starts.B },
    ],
    preContactS: [1, 0.5],
    contactS: 30,
    arena: protocol.arena,
    ...(protocol.bridge ? { bridge: protocol.bridge } : {}),
    authorization: {
      by: "scripts/whole-brain.test.ts",
      purpose: "a whole-brain subject sees the other fly through the bridge",
      subjects: ids,
      scope: "research-subjects-only",
    },
  });

  it("sees the other fly as a small moving object, through the bridge only", () => {
    const ids: [string, string] = ["research-wb-test-A", "research-wb-test-B"];
    const taps: ShadowTap[] = [];
    const brain = () => readouts();
    const adapters = [102, 202].map((seed) =>
      ShadowTap.factory("neural-experimental", seed, 100_000, taps, {
        mapping: "whole-brain/v2",
        brain,
      }),
    ) as [ReturnType<typeof ShadowTap.factory>, ReturnType<typeof ShadowTap.factory>];
    const result = runSession(spec(ids), null, adapters);
    expect(result.synchronized).toBe(true);
    expect(result.subjects[0].controller).toContain("whole-brain/v2");
    const pre = [1, 0.5];
    let seen = 0;
    taps.forEach((tap, i) => {
      for (const r of tap.records.filter((r) => r.obs.smallObject)) {
        // The arenas hold nothing else that moves: whatever is on the eye came through the bridge.
        expect(r.t).toBeGreaterThanOrEqual(pre[i]!);
        seen++;
      }
    });
    expect(seen).toBeGreaterThan(0);
  }, 120_000);

  it("runs the frozen studies' sessions exactly as before when no adapter is given", () => {
    const ids: [string, string] = ["research-wb-test-C", "research-wb-test-D"];
    expect(canonicalJson(runSession(spec(ids)))).toBe(
      canonicalJson(runSession(spec(ids), null, [undefined, undefined])),
    );
  }, 120_000);
});

// A stand-in for `python -m fly_neural serve`: the same JSON-lines protocol, no model.
const FAKE_SERVE = `
const rl = require("node:readline").createInterface({ input: process.stdin });
let first = true;
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (first) { first = false; process.stdout.write(JSON.stringify({ ready: true, neurons: 3, subject: m.subject }) + "\\n"); return; }
  if (m.bye) process.exit(0);
  if (m.t === 99) process.exit(3);
  process.stdout.write(JSON.stringify({ t: m.t, readouts: { echo: m.obs }, compute_ms: 0.5 }) + "\\n");
});
`;

describe("SyncBrain", () => {
  it("answers synchronously, and fails loudly when the process dies", () => {
    const brain = new SyncBrain({
      command: process.execPath,
      args: ["-e", FAKE_SERVE],
      cwd: __dirname,
      header: { subject: "research-sync-test" },
      timeoutMs: 20_000,
    });
    expect(brain.ready).toMatchObject({
      ready: true,
      neurons: 3,
      subject: "research-sync-test",
    });
    for (let k = 1; k <= 3; k++) {
      const r = brain.ask<{ echo: unknown }>(k * 0.01, { k });
      expect(r.readouts.echo).toEqual({ k });
      expect(r.computeMs).toBe(0.5);
    }
    expect(() => brain.ask(99, {})).toThrow(/exited \(code 3\)/);
    brain.close();
    expect(() => brain.ask(1, {})).toThrow(/closed/);
  }, 60_000);
});
