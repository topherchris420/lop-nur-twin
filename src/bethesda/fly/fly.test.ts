import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import manifest from "./data/flybody.source.json" with { type: "json" };
import lod1 from "./data/flybody-lod1.json" with { type: "json" };
import { ARENA_INPUTS, arenaWorld, type ArenaSpec } from "./arena";
import { DigitalFly } from "./fly";
import { coordination, dutyFactor, stanceCount, stepPeriodS, legPhases } from "./gait";
import { forwardKinematics, restAngles } from "./kinematics";
import { decodePart, encodePart, type EncodedPart } from "./meshCodec";
import {
  COMMANDABLE,
  GROOM_ROUTINES,
  LIMITS,
  validateCommand,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "./neural";
import {
  PARAMS,
  resolveParams,
  type ControllerConfig,
  type Param,
  type ParamName,
} from "./params";
import { clawPoints, PoseSolver, type PoseInput } from "./pose";
import { EYES, inVisualField, UNSUPPORTED_SENSES } from "./senses";
import { SKELETON } from "./skeleton";
import { bodyToWorld, forward, left, type V3, wrapAngle, yawOf } from "./units";
import {
  LANDING_SITE_FLATNESS_M,
  PrimitiveWorld,
  rayGround,
  type FlyWorld,
  type LandingSite,
  type Mover,
} from "./world";
import { prototypeStroke } from "./wing";

const P = resolveParams();
const gait = {
  stanceLegsAt1: P.stanceLegsAt1,
  stanceLegsAt4: P.stanceLegsAt4,
  swingMs: P.swingMs,
  stepPeriodFloorMs: P.stepPeriodFloorMs,
  walkSpeedMinCmS: P.walkSpeedMinCmS,
  walkSpeedMaxCmS: P.walkSpeedMaxCmS,
};
const ROOM: ArenaSpec = {
  size: [4, 2.5, 4],
  ambient: 0.3,
  pillars: [{ x: 0.8, z: -0.6, r: 0.12 }],
  platforms: [{ center: [-1, 0.4, 1], half: [0.3, 0.4, 0.2] }],
  lights: [{ at: [1.5, 2.3, 1.5], intensity: 2 }],
};
const run = (fly: DigitalFly, seconds: number, each?: (f: DigitalFly) => void) => {
  for (let k = 0; k < Math.round(seconds * 10); k++) {
    fly.advance(0.1);
    each?.(fly);
  }
};
/** Step one physics step (5 ms) at a time, with the state before and after each. */
const stepwise = (
  fly: DigitalFly,
  seconds: number,
  each: (
    before: { p: V3; v: V3; mode: string; landings: number; collisions: number },
    f: DigitalFly,
  ) => void,
) => {
  for (let k = 0; k < Math.round(seconds * 200); k++) {
    const s = fly.state;
    const before = {
      p: [...s.p] as V3,
      v: [...s.v] as V3,
      mode: s.mode,
      landings: s.counts.landings,
      collisions: s.counts.collisions,
    };
    fly.advance(0.005);
    each(before, fly);
  }
};
/** A decision maker for tests: `decide` gets the same frozen input the built-in one does. */
const adapter = (
  id: string,
  decide: (input: DecisionInput) => unknown,
): FlyNeuralAdapter => ({
  descriptor: { id, label: id, fidelity: "test", simulatesNeurons: false, regions: [] },
  decide: (input) => decide(input) as MotorCommand,
});
/** The approach the built-in controller flies: the thorax to the standing height above the target. */
const approach = (body: BodySnapshot): MotorCommand => {
  const t = body.target!;
  const d: V3 = [
    t.point[0] - body.p[0],
    t.point[1] + body.standingHeight - body.p[1],
    t.point[2] - body.p[2],
  ];
  const dist = Math.hypot(...d);
  const k = dist > 0 ? Math.min(0.3, dist / 0.25) / dist : 0;
  return { mode: "land", velocity: [d[0] * k, d[1] * k, d[2] * k], reason: "approach" };
};
/** `base` with some of its answers replaced. */
const wrapWorld = (base: FlyWorld, over: Partial<FlyWorld>): FlyWorld => ({
  id: base.id,
  home: base.home,
  inputs: base.inputs,
  perchAt: over.perchAt ?? ((x, z, y) => base.perchAt(x, z, y)),
  raycast: over.raycast ?? ((o, d, t, v) => base.raycast(o, d, t, v)),
  solid: over.solid ?? ((p) => base.solid(p)),
  movers: over.movers ?? ((n, r, out, t) => base.movers(n, r, out, t)),
  light: over.light ?? ((p) => base.light(p)),
  landingSites: over.landingSites ?? ((n, r, out) => base.landingSites(n, r, out)),
});
/** A controller that never leaves rest on its own, so only a stimulus can start a takeoff. */
const STILL: ControllerConfig = { takeoffHz: 0, walkStartHz: 0, groomHz: 0 };

describe("units and frames", () => {
  it("maps FlyBody's x-forward, y-left, z-up centimetres onto the city's metres", () => {
    const f = bodyToWorld([1, 0, 0], 0);
    expect(f[0]).toBeCloseTo(0.01, 12);
    expect(bodyToWorld([0, 1, 0], 0)).toEqual([0, 0, -0.01]); // left of an east-facing fly is north
    expect(bodyToWorld([0, 0, 1], 0)[1]).toBeCloseTo(0.01, 12);
    const north = bodyToWorld([1, 0, 0], Math.PI / 2);
    expect(north[0]).toBeCloseTo(0, 12);
    expect(north[2]).toBeCloseTo(-0.01, 12);
    expect(forward(Math.PI / 2)[2]).toBeCloseTo(-1, 12);
    expect(left(0)).toEqual([-0, 0, -1]);
    expect(yawOf(0, -1)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
  it("pitches the nose up and rolls the right wing down for positive angles", () => {
    expect(bodyToWorld([1, 0, 0], 0, 0.5)[1]).toBeGreaterThan(0);
    expect(bodyToWorld([0, -1, 0], 0, 0, 0.5)[1]).toBeLessThan(0);
  });
});

describe("FlyBody anatomy as imported", () => {
  it("keeps FlyBody's 67 bodies and 102 hinge joints, each resting inside its range", () => {
    expect(SKELETON.bodies).toHaveLength(67);
    const hinges = SKELETON.bodies.flatMap((b) => b.joints);
    expect(hinges).toHaveLength(102);
    for (const b of SKELETON.bodies)
      restAngles(b).forEach((a, i) => {
        const j = b.joints[i]!;
        expect(a).toBeGreaterThanOrEqual(j.range[0]);
        expect(a).toBeLessThanOrEqual(j.range[1]);
      });
    for (const name of [
      "head",
      "thorax",
      "abdomen",
      "wing_left",
      "wing_right",
      "haltere_left",
      "haltere_right",
      "antenna_left",
      "antenna_right",
    ])
      expect(SKELETON.bodies.some((b) => b.name === name)).toBe(true);
    expect(SKELETON.bodies.filter((b) => b.name.startsWith("claw_"))).toHaveLength(6);
  });
  it("is true adult scale: the mesh measures the paper's 0.297 cm body length", () => {
    expect(SKELETON.measures.bodyLengthCm).toBeGreaterThan(0.297 * 0.98);
    expect(SKELETON.measures.bodyLengthCm).toBeLessThan(0.297 * 1.02);
    expect(SKELETON.measures.wingLengthCm).toBeGreaterThan(0.2);
    expect(SKELETON.measures.wingLengthCm).toBeLessThan(0.3);
  });
  it("keeps FlyBody's natural colours, including the translucent wing membrane", () => {
    const m = new Map(SKELETON.materials.map((x) => [x.name, x.rgba]));
    expect(m.get("body")).toEqual([0.674, 0.35, 0.143, 1]);
    expect(m.get("red")).toEqual([0.8, 0.0279, 0.00154, 1]);
    expect(m.get("membrane")![3]).toBe(0.4);
  });
  it("places the hover thrust axis at FlyBody's 47.5° body pitch", () => {
    const site = SKELETON.sites.find((s) => s.name === "hover_up_dir")!;
    const angle = 2 * Math.acos(site.quat[0]);
    expect((angle * 180) / Math.PI).toBeCloseTo(PARAMS.bodyPitchHoverDeg.value, 0);
  });
  it("assembles at the rest pose with every child near its parent", () => {
    const frames = forwardKinematics(SKELETON.bodies, restAngles);
    for (const b of SKELETON.bodies) {
      if (!b.parent) continue;
      const a = frames.get(b.name)!.p,
        p = frames.get(b.parent)!.p;
      expect(Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2])).toBeLessThan(0.1);
    }
  });
});

describe("mesh derivatives", () => {
  it("round-trips the codec exactly at the quantum", () => {
    const pos = [0, 0, 0, 0.001, 0, 0, 0, 0.002, -0.0005, 0.003, 0.001, 0.0001];
    const tri = [0, 1, 2, 2, 1, 3];
    const enc = encodePart("thorax", "body", pos, tri, 2.5e-5);
    const dec = decodePart(enc, 2.5e-5);
    expect([...dec.indices]).toEqual(tri);
    dec.positions.forEach((v, i) => expect(v).toBeCloseTo(pos[i]!, 5));
  });
  it("refuses a malformed part instead of drawing it", () => {
    const bad: EncodedPart = {
      body: "x",
      material: "body",
      vertices: 3,
      p: [0, 0, 0, 1, 1, 1, 2, 2, 2],
      i: [0, 0, 5],
    };
    expect(() => decodePart(bad, 1)).toThrow();
  });
  it("matches its manifest: triangle counts, hashes and bodies", () => {
    const text = readFileSync(
      new URL("./data/flybody-lod1.json", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      manifest.outputs["flybody-lod1.json"],
    );
    const bodies = new Set(SKELETON.bodies.map((b) => b.name));
    let triangles = 0;
    for (const part of lod1.parts as EncodedPart[]) {
      expect(bodies.has(part.body)).toBe(true);
      const d = decodePart(part, lod1.quantumCm);
      triangles += d.indices.length / 3;
      for (const v of d.positions) expect(Math.abs(v)).toBeLessThan(0.5);
    }
    expect(triangles).toBe(lod1.triangles);
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.sourceTriangles).toBeGreaterThan(lod1.triangles);
  });
});

describe("gait", () => {
  it("follows FlyBody's stance counts and the reported step-period floor", () => {
    expect(dutyFactor(1, gait) * 6).toBeCloseTo(3.9, 6);
    expect(dutyFactor(4, gait) * 6).toBeCloseTo(3.1, 6);
    expect(stepPeriodS(4, gait)).toBeGreaterThanOrEqual(0.06);
    expect(stepPeriodS(1, gait)).toBeGreaterThan(stepPeriodS(4, gait));
  });
  it("averages the duty factor's legs in stance over a cycle", () => {
    for (const v of [1, 2.5, 4]) {
      let sum = 0;
      for (let k = 0; k < 600; k++) sum += stanceCount(k / 600, v, gait);
      expect(sum / 600).toBeCloseTo(6 * dutyFactor(v, gait), 1);
    }
  });
  it("uses alternating tripods more at speed and diagonal tetrapod pairs when slow", () => {
    const share = (v: number) => {
      let n = 0;
      for (let k = 0; k < 600; k++) if (coordination(k / 600, v, gait) === "tripod") n++;
      return n / 600;
    };
    expect(share(4)).toBeGreaterThan(share(1));
    const slow = legPhases(0, 1 / 3);
    expect(slow[0]).toBeCloseTo(slow[5]!, 9); // L1 with R3
    const fast = legPhases(0, 1 / 2);
    expect(fast[0]).toBeCloseTo(fast[2]!, 9); // L1, L3 and R2 move together
    expect(fast[0]).toBeCloseTo(fast[4]!, 9);
  });
  it("draws FlyBody's prototype wingbeat as a closed cycle in yaw and pitch", () => {
    const a = prototypeStroke(0),
      b = prototypeStroke(2 * Math.PI);
    expect(a.yaw).toBeCloseTo(b.yaw, 9);
    expect(a.pitch).toBeCloseTo(b.pitch, 9);
  });
});

describe("sensing limits", () => {
  it("uses FlyBody's two eye cameras: a wide field with a blind sector behind", () => {
    expect(EYES).toHaveLength(2);
    expect(inVisualField(0, 0)).toBe(true);
    expect(inVisualField(Math.PI / 2, 0)).toBe(true);
    expect(inVisualField(Math.PI, 0)).toBe(false);
  });
  it("names the senses it does not have", () => {
    expect(UNSUPPORTED_SENSES).toContain("olfaction (odour)");
    expect(UNSUPPORTED_SENSES).toContain("temperature");
  });
});

describe("the world's queries", () => {
  it("answers non-finite queries with nothing, and every ground march ends", () => {
    const world = arenaWorld(ROOM);
    expect(world.raycast([0, 1, 0], [0, -1, 0], Number.NaN)).toBeNull();
    expect(world.raycast([0, 1, 0], [0, -1, 0], Infinity)).toBeNull();
    expect(world.raycast([Number.NaN, 1, 0], [0, -1, 0], 2)).toBeNull();
    expect(world.raycast([0, 1, 0], [0, Number.NaN, 0], 2)).toBeNull();
    expect(world.raycast([0, 1, 0], [0, 0, 0], 2)).toBeNull();
    expect(world.raycast([0, 1, 0], [0, -1, 0], 2)?.t).toBeCloseTo(1, 6);
    expect(world.solid([Number.NaN, 1, 0])).toBe(true);
    expect(world.perchAt(Number.NaN, 0, 1)).toBeNull();
    expect(world.perchAt(0, 0, Number.NaN)).toBeNull();
    // A ground that is never a number, and a reach of a billion metres: both end.
    expect(rayGround([0, 1, 0], [0, -1, 0], 10, () => Number.NaN)).toBeNull();
    expect(rayGround([0, 1, 0], [1, 0, 0], 1e9, () => 0)).toBeNull();
    expect(rayGround([0, 1, 0], [0, -1, 0], 2, () => 0)).toBeCloseTo(1, 6);
  });
  it("offers a crown as a landing site only where it is flat to 2 mm", () => {
    const world = new PrimitiveWorld({
      id: "crown",
      home: { center: [0, 0, 0], radius: 6, ceiling: 8 },
      inputs: ARENA_INPUTS,
      ground: () => 0,
      spheres: [{ kind: "obstacle", id: "crown", center: [0, 3, 0], r: 2.4 }],
    });
    const sites: LandingSite[] = [];
    world.landingSites([0, 6, 0], 5, sites);
    const [site] = sites;
    expect(site?.id).toBe("crown");
    for (const [u, w] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const top = world.perchAt(u * site!.half[0], w * site!.half[1], 10)!;
      expect(top.id).toBe("crown");
      expect(site!.center[1] - top.y).toBeLessThanOrEqual(LANDING_SITE_FLATNESS_M + 1e-9);
    }
  });
});

describe("parameters keep their provenance", () => {
  it("only lets experiments change model parameters", () => {
    expect(() => resolveParams({ wingbeatHz: 300 })).toThrow(/flybody/);
    expect(() => resolveParams({ legExtensionDeg: 10 })).toThrow(/published/);
    expect(() => resolveParams({ avoidTtcS: Number.NaN })).toThrow();
    expect(() => resolveParams({ nonsense: 1 } as never)).toThrow(/unknown/);
    expect(resolveParams({ avoidTtcS: 0.2 }).avoidTtcS).toBe(0.2);
  });
  it("refuses values outside each parameter's range, and freezes what it returns", () => {
    expect(() => resolveParams({ velocityTauS: -0.1 })).toThrow(
      "velocityTauS must be within [0, 2] s; got -0.1",
    );
    for (const name of [
      "maxAccelG",
      "approachTauS",
      "landTimeoutS",
      "touchdownSpeedMS",
      "physicsStepMs",
    ] as const)
      expect(() => resolveParams({ [name]: 0 }), name).toThrow(`${name} must be within`);
    expect(() => resolveParams({ homeRadiusM: 30 })).toThrow(
      "homeRadiusM is fixed at 18 m",
    );
    expect(() => resolveParams({ cruiseAltMinM: 3, cruiseAltMaxM: 2 })).toThrow(
      /must not exceed/,
    );
    for (const [name, p] of Object.entries(PARAMS) as [ParamName, Param][]) {
      expect(p.min, name).toBeLessThanOrEqual(p.value);
      expect(p.max, name).toBeGreaterThanOrEqual(p.value);
      if (p.kind !== "model") expect([p.min, p.max], name).toEqual([p.value, p.value]);
    }
    const resolved = resolveParams({ avoidTtcS: 0.2 });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(() => {
      (resolved as Record<ParamName, number>).avoidTtcS = 9;
    }).toThrow(TypeError);
    expect(resolved.avoidTtcS).toBe(0.2);
  });
  it("runs at both ends of every model parameter's range", () => {
    const world = arenaWorld(ROOM);
    for (const [name, p] of Object.entries(PARAMS) as [ParamName, Param][]) {
      if (p.kind !== "model" || p.min === p.max) continue;
      for (const value of [p.min, p.max]) {
        const config: ControllerConfig = { [name]: value };
        // The cruise band's ends stay ordered.
        if (name === "cruiseAltMinM")
          config.cruiseAltMaxM = Math.max(value, P.cruiseAltMaxM);
        if (name === "cruiseAltMaxM")
          config.cruiseAltMinM = Math.min(value, P.cruiseAltMinM);
        const label = `${name} = ${value}`;
        const fly = new DigitalFly({
          seed: 21,
          world,
          start: { p: [0, 1.2, 0], yaw: 0.4, mode: "flight", v: [0.2, 0, 0] },
          config,
        });
        run(fly, 15, (f) => {
          const s = f.state;
          expect(s.p.every(Number.isFinite) && s.v.every(Number.isFinite), label).toBe(
            true,
          );
          expect(world.solid(s.p), label).toBe(false);
          expect(Math.hypot(...s.v), label).toBeLessThanOrEqual(
            LIMITS.flightSpeed + 1e-9,
          );
        });
        expect(fly.state.counts.rejected, label).toBe(0);
      }
    }
  }, 120_000);
  it("uses the 150° eye field FlyBody's walker gives its cameras", () => {
    expect(PARAMS.eyeFovDeg.value).toBe(150);
    for (const e of EYES) expect(e.halfFov).toBeCloseTo((75 * Math.PI) / 180, 12);
  });
  it("cites a DOI, or FlyBody's code at the pinned commit, for every sourced value", () => {
    const pinned = `https://github.com/TuragaLab/flybody/blob/${manifest.commit}/`;
    for (const [name, p] of Object.entries(PARAMS)) {
      if (p.kind !== "model") expect(p.source, name).toBeDefined();
      if (!p.source) continue;
      if (p.source.doi) expect(p.source.doi, name).toMatch(/^10\.\d{4,}\//);
      else expect(p.source.url?.startsWith(pinned), name).toBe(true);
    }
  });
});

describe("the command gate", () => {
  const body: BodySnapshot = {
    t: 0,
    mode: "rest",
    sub: "",
    modeT: 0,
    p: [0, 0, 0],
    v: [0, 0, 0],
    yaw: 0,
    altitude: 0,
    walkSpeed: 0,
    flightT: 0,
    flightBout: 0,
    responsiveness: 1,
    groom: null,
    edge: false,
    target: null,
    standingHeight: 0.001,
    home: { center: [0, 0, 0], radius: 1, ceiling: 2 },
  };
  it("refuses impossible transitions, out-of-range values and missing reasons", () => {
    expect(validateCommand({ mode: "flight", reason: "x" }, body, P).ok).toBe(false);
    expect(
      validateCommand({ mode: "walk", walkSpeed: 99, reason: "x" }, body, P).ok,
    ).toBe(false);
    expect(validateCommand({ mode: "takeoff", reason: "x" }, body, P).ok).toBe(false);
    expect(validateCommand({ mode: "walk", walkSpeed: 2, reason: "" }, body, P).ok).toBe(
      false,
    );
    const flying = { ...body, mode: "flight" as const };
    expect(
      validateCommand(
        { mode: "flight", velocity: [LIMITS.flightSpeed * 2, 0, 0], reason: "x" },
        flying,
        P,
      ).ok,
    ).toBe(false);
    expect(
      validateCommand(
        { mode: "flight", velocity: [Number.NaN, 0, 0], reason: "x" },
        flying,
        P,
      ).ok,
    ).toBe(false);
    expect(validateCommand({ mode: "land", reason: "x" }, flying, P).ok).toBe(false);
    expect(validateCommand({ mode: "rest", reason: "x" }, flying, P).ok).toBe(false);
    expect(
      validateCommand({ mode: "takeoff", heading: 0, prepare: 0.2, reason: "x" }, body, P)
        .ok,
    ).toBe(true);
    expect(COMMANDABLE.land).not.toContain("rest");
  });
  it("never throws: anything malformed is refused", () => {
    const flying: BodySnapshot = { ...body, mode: "flight" };
    const throwing = Object.defineProperty({ reason: "x" }, "mode", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      "flight",
      [],
      [1, 2, 3],
      () => 1,
      { mode: "land", reason: "x", land: { point: "abc" } },
      { mode: "land", reason: "x", land: { id: "x" } },
      { mode: "land", reason: "x", land: { id: "x", point: [0, 0] } },
      { mode: "land", reason: "x", land: null },
      { mode: "flight", reason: "x", velocity: "fast" },
      { mode: "flight", reason: "x", velocity: [0, 0, 0, 0] },
      { mode: "flight", reason: "x", hover: "yes" },
      { mode: "flight", reason: 7 },
      { mode: "flight", reason: "x".repeat(LIMITS.reasonChars + 1) },
      { mode: "flight", reason: "x", extra: 1 },
      { mode: { toString: () => "flight" }, reason: "x" },
      throwing,
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("boom");
          },
        },
      ),
    ];
    hostile.forEach((cmd, i) => {
      let ok: boolean | undefined;
      expect(() => (ok = validateCommand(cmd, flying, P).ok), `#${i}`).not.toThrow();
      expect(ok, `#${i}`).toBe(false);
    });
  });
  it("accepts only the grooming routines it knows", () => {
    for (const groom of GROOM_ROUTINES)
      expect(validateCommand({ mode: "groom", groom, reason: "x" }, body, P).ok).toBe(
        true,
      );
    expect(
      validateCommand({ mode: "groom", groom: "legs", reason: "x" }, body, P).ok,
    ).toBe(false);
  });
  it("lands only on an offered site, at a point on its top", () => {
    const world = arenaWorld(ROOM);
    const sites: LandingSite[] = [];
    world.landingSites([-1, 1.2, 1], 2, sites);
    const top = sites.find((s) => s.id === "platform-0")!;
    const ctx = {
      sites,
      surface: (x: number, z: number, y: number) => world.perchAt(x, z, y),
    };
    const flying: BodySnapshot = { ...body, mode: "flight", p: [-1, 1.2, 1] };
    const land = (id: string, point: V3) =>
      validateCommand({ mode: "land", land: { id, point }, reason: "x" }, flying, P, ctx)
        .ok;
    const [x, y, z] = top.center;
    expect(land(top.id, [x, y, z])).toBe(true);
    expect(land(top.id, [x + top.half[0] * 0.9, y, z - top.half[1] * 0.9])).toBe(true);
    expect(land("platform-9", [x, y, z])).toBe(false);
    expect(land(top.id, [x, y + 0.05, z])).toBe(false);
    expect(land(top.id, [x, y - 0.05, z])).toBe(false);
    expect(land(top.id, [x + top.half[0] + 0.05, y, z])).toBe(false);
    const cmd = { mode: "land", land: { id: top.id, point: [x, y, z] }, reason: "x" };
    // No sites offered, or not in flight: no landing.
    expect(validateCommand(cmd, flying, P).ok).toBe(false);
    expect(validateCommand(cmd, body, P, ctx).ok).toBe(false);
  });
  it("gives decision makers frozen copies, so none can widen the gate", () => {
    let calls = 0;
    let seen = null as DecisionInput["params"] | null;
    const widen = adapter("widen", ({ params, body, sites }) => {
      calls++;
      seen = params;
      try {
        (params as Record<ParamName, number>).walkSpeedMaxCmS = 1e9;
      } catch {
        // frozen
      }
      try {
        (body.p as number[])[0] = 99;
      } catch {
        // frozen
      }
      try {
        (sites as LandingSite[]).length = 0;
      } catch {
        // frozen
      }
      // Every other call does not even catch the failure.
      if (calls % 2 === 0) (params as Record<ParamName, number>).walkSpeedMaxCmS = 1e9;
      return {
        mode: "walk",
        walkSpeed: 1e6,
        reason: "faster than the limit, if it moved",
      };
    });
    const fly = new DigitalFly({
      seed: 4,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => widen,
    });
    const start = [...fly.state.p];
    run(fly, 3);
    expect(calls).toBeGreaterThan(30);
    expect(seen).not.toBe(fly.params);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(Object.isFrozen(fly.params)).toBe(true);
    expect(seen!.walkSpeedMaxCmS).toBe(PARAMS.walkSpeedMaxCmS.value);
    expect(fly.params.walkSpeedMaxCmS).toBe(PARAMS.walkSpeedMaxCmS.value);
    expect(fly.state.mode).toBe("rest");
    expect(fly.state.p).toEqual(start);
    expect(fly.state.counts.rejected).toBe(calls);
    expect(fly.log.some((r) => r.reason.startsWith("the decision maker failed"))).toBe(
      true,
    );
    expect(
      fly.log.some((r) => r.reason === "command refused: walking speed out of bounds"),
    ).toBe(true);
  });
  it("holds safely when a decision maker that took off starts misbehaving", () => {
    let calls = 0;
    const garbage: unknown[] = [
      { mode: "flight", velocity: [9, 9, 9], reason: "too fast" },
      { mode: "flight", velocity: [0, 0], reason: "two numbers" },
      { mode: "land", land: { id: "nowhere", point: [0, 0, 0] }, reason: "not offered" },
      { mode: "land", land: { point: "abc" }, reason: "malformed" },
      { mode: "rest", reason: "no such transition" },
      null,
    ];
    const rogue = adapter("rogue", ({ body }) => {
      calls++;
      if (body.mode === "rest")
        return { mode: "takeoff", heading: 0, prepare: 0.2, reason: "go" };
      if (calls % 5 === 0) throw new Error("crashed");
      return garbage[calls % garbage.length];
    });
    const world = arenaWorld(ROOM);
    const fly = new DigitalFly({
      seed: 5,
      world,
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => rogue,
    });
    expect(() =>
      run(fly, 10, (f) => expect(world.solid(f.state.p)).toBe(false)),
    ).not.toThrow();
    expect(fly.state.counts.takeoffs).toBe(1);
    // It hovers where the jump left it, instead of flying the jump on.
    expect(fly.state.mode).toBe("flight");
    expect(fly.state.sub).toBe("hover");
    expect(Math.hypot(...fly.state.v)).toBeLessThan(1e-3);
    expect(fly.state.counts.collisions).toBe(0);
    expect(fly.lastCommand?.reason).toBe("go");
    expect(fly.state.counts.rejected).toBeGreaterThan(150);
    expect(fly.log.some((r) => r.reason === "the decision maker failed: crashed")).toBe(
      true,
    );
    // A walker that starts misbehaving stops where it is.
    let walked = false;
    const walker = adapter("walker", ({ body }) => {
      if (body.mode === "rest" && !walked) {
        walked = true;
        return { mode: "walk", walkSpeed: 3, reason: "go" };
      }
      return { mode: "walk", walkSpeed: Number.NaN, reason: "no speed" };
    });
    const w = new DigitalFly({
      seed: 6,
      world,
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => walker,
    });
    run(w, 2);
    const at = [...w.state.p];
    run(w, 1);
    expect(w.state.mode).toBe("walk");
    expect(w.state.walkSpeed).toBeLessThan(1e-3);
    expect(Math.hypot(w.state.p[0] - at[0]!, w.state.p[2] - at[2]!)).toBeLessThan(1e-4);
  });
  it("follows a decision maker that changes its landing target", () => {
    let switched = false;
    const fickle = adapter("fickle", ({ body, sites }) => {
      if (body.mode === "flight") {
        const platform = sites.find((s) => s.id === "platform-0");
        return platform
          ? {
              mode: "land",
              land: { id: platform.id, point: [...platform.center] },
              reason: "the platform",
            }
          : { mode: "flight", hover: true, velocity: [0, 0, 0], reason: "looking" };
      }
      if (body.mode === "land" && !switched && body.modeT > 0.3) {
        const below = sites.find((s) => s.below)!;
        switched = true;
        return {
          ...approach(body),
          land: { id: below.id, point: [...below.center] },
          reason: "the floor below instead",
        };
      }
      return body.mode === "land"
        ? approach(body)
        : { mode: body.mode, reason: "resting" };
    });
    const fly = new DigitalFly({
      seed: 7,
      world: arenaWorld(ROOM),
      start: { p: [0.5, 1.2, -0.3], yaw: 0, mode: "flight" },
      adapter: () => fickle,
    });
    run(fly, 20);
    expect(switched).toBe(true);
    expect(
      fly.log.some((r) => r.reason === "new landing target: the floor below instead"),
    ).toBe(true);
    expect(fly.state.mode).toBe("rest");
    expect(fly.state.perch?.id).toBe("ground");
    expect(fly.state.counts.rejected).toBe(0);
  });
  it("lets no decision maker move the fly past the gate", () => {
    const rogue: FlyNeuralAdapter = {
      descriptor: {
        id: "rogue",
        label: "rogue",
        fidelity: "test",
        simulatesNeurons: false,
        regions: [],
      },
      decide: () => ({ mode: "flight", velocity: [9, 9, 9], reason: "teleport" }),
    };
    const fly = new DigitalFly({
      seed: 3,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => rogue,
    });
    const start = [...fly.state.p];
    run(fly, 5);
    expect(fly.state.mode).toBe("rest");
    expect(fly.state.p).toEqual(start);
    expect(fly.state.counts.rejected).toBeGreaterThan(50);
    expect(fly.log.at(-1)!.kind).toBe("refused");
  });
});

describe("the digital fly in an arena", () => {
  it("is deterministic under a seed and independent of the stepping", () => {
    const a = new DigitalFly({
      seed: 7,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
    });
    const b = new DigitalFly({
      seed: 7,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
    });
    const c = new DigitalFly({
      seed: 8,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
    });
    run(a, 120);
    for (let k = 0; k < 120 * 200; k++) b.advance(0.005);
    run(c, 120);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(c.stateHash()).not.toBe(a.stateHash());
  }, 60_000);
  it("stays bounded, out of solids and inside the arena, and alternates its states", () => {
    const world = arenaWorld(ROOM);
    const fly = new DigitalFly({ seed: 1, world, start: { p: [0, 0.5, 0], yaw: 0 } });
    const modes = new Set<string>();
    run(fly, 400, (f) => {
      const s = f.state;
      modes.add(s.mode);
      expect(s.p.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...s.v)).toBeLessThanOrEqual(LIMITS.flightSpeed);
      expect(world.solid(s.p)).toBe(false);
      expect(Math.abs(s.p[0])).toBeLessThan(2);
      expect(Math.abs(s.p[2])).toBeLessThan(2);
      expect(s.wingHz).toBeGreaterThanOrEqual(PARAMS.wingbeatHz.value * 0.95 - 1e-9);
      expect(s.wingHz).toBeLessThanOrEqual(PARAMS.wingbeatHz.value * 1.05 + 1e-9);
    });
    for (const m of ["rest", "groom", "walk", "flight", "land"])
      expect(modes).toContain(m);
    const c = fly.state.counts;
    expect(c.takeoffs).toBeGreaterThan(0);
    expect(c.landings).toBeGreaterThan(0);
    expect(c.rejected).toBe(0);
  }, 60_000);
  it("lands on a surface and stands on it at the simulator's crouch of FlyBody's height", () => {
    const world = arenaWorld(ROOM);
    const fly = new DigitalFly({ seed: 1, world, start: { p: [0, 0.5, 0], yaw: 0 } });
    let landed = false;
    run(fly, 400, (f) => {
      if (f.state.mode === "rest" && f.state.counts.landings > 0 && !landed) {
        landed = true;
        const perch = world.perchAt(f.state.p[0], f.state.p[2], f.state.p[1])!;
        expect(f.state.p[1] - perch.y).toBeCloseTo(f.standingHeight, 9);
        expect(f.standingHeight).toBeLessThan(0.002);
      }
    });
    expect(landed).toBe(true);
    expect(fly.log.some((r) => r.reason.includes("legs extend"))).toBe(true);
  }, 60_000);
  it("escapes a looming object, away from it, and is less responsive after it", () => {
    const spec: ArenaSpec = {
      ...ROOM,
      looms: [
        {
          start: 3,
          period: 0,
          count: 1,
          from: [0, 0.05, -1.5],
          to: [0, 0.05, -0.02],
          speedMS: 1.2,
          radiusM: 0.04,
        },
      ],
    };
    // A controller that never leaves rest on its own, so only the stimulus can start a takeoff.
    const config = { takeoffHz: 0, walkStartHz: 0, groomHz: 0 };
    const fly = new DigitalFly({
      seed: 2,
      world: arenaWorld(spec),
      start: { p: [0, 0.5, 0], yaw: 0 },
      config,
    });
    let heading: number | null = null;
    run(fly, 6, (f) => {
      if (f.state.takeoff && heading === null) heading = f.state.takeoff.heading;
    });
    expect(fly.state.counts.escapes).toBe(1);
    const escape = fly.log.find((r) => r.to.startsWith("escape"))!;
    expect(escape.reason).toMatch(/giant-fiber proxy/);
    // The stimulus came from the north (−z); the jump is planned southward, away from it.
    expect(forward(heading!)[2]).toBeGreaterThan(0.7);
    expect(fly.state.responsiveness).toBeLessThan(1);
  });
  it("never stays stuck on a landing among obstacles", () => {
    const pillars = [];
    for (const x of [-1.2, -0.4, 0.4, 1.2])
      for (const z of [-1.2, -0.4, 0.4, 1.2]) pillars.push({ x, z, r: 0.05 });
    for (const seed of [11, 12, 13]) {
      const fly = new DigitalFly({
        seed,
        world: arenaWorld({ size: [4, 2.5, 4], ambient: 0.3, pillars }),
        start: { p: [0, 0.5, 0], yaw: 0 },
        config: { takeoffHz: 0.5, avoidTtcS: 0 },
        logSize: 100_000,
      });
      let bout = 0;
      run(fly, 60, (f) => {
        bout = f.state.mode === "land" ? bout + 0.1 : 0;
        expect(bout).toBeLessThanOrEqual(P.landTimeoutS + 0.2);
      });
      expect(fly.state.counts.landings).toBeGreaterThan(0);
      // A contact during an approach ends it at once.
      fly.log.forEach((r, i) => {
        if (r.reason.startsWith("collision") && r.to.startsWith("land"))
          expect(fly.log[i + 1]?.reason).toMatch(/^landing aborted/);
      });
    }
  }, 60_000);
  it("does not see glass and so can hit it", () => {
    const world = arenaWorld({ ...ROOM, glass: [{ a: [-1, 0.5], b: [1, 0.5] }] });
    expect(world.raycast([0, 1, 0], [0, 0, 1], 2, true)?.kind).not.toBe("glass");
    expect(world.raycast([0, 1, 0], [0, 0, 1], 2, false)?.kind).toBe("glass");
  });
  it("can be placed in flight, with a velocity, and refuses impossible starts", () => {
    const world = arenaWorld(ROOM);
    const fly = new DigitalFly({
      seed: 9,
      world,
      start: { p: [0, 1.2, 0], yaw: 0.5, mode: "flight", v: [0.2, 0, 0.1] },
    });
    const s = fly.state;
    expect([s.mode, s.sub]).toEqual(["flight", "cruise"]);
    expect(s.p).toEqual([0, 1.2, 0]);
    expect(s.v).toEqual([0.2, 0, 0.1]);
    expect([s.wingsOpen, s.legs]).toEqual([1, 0]);
    expect(s.flightBout).toBeGreaterThanOrEqual(1.5);
    run(fly, 60, (f) => expect(world.solid(f.state.p)).toBe(false));
    expect(fly.state.counts.landings).toBeGreaterThan(0);
    expect(fly.state.counts.rejected).toBe(0);
    const bad = (start: ConstructorParameters<typeof DigitalFly>[0]["start"]) => () =>
      new DigitalFly({ seed: 1, world, start });
    expect(bad({ p: [0, 0.5, 0], yaw: 0, v: [0.1, 0, 0] })).toThrow(
      /at rest starts still/,
    );
    expect(bad({ p: [0, 1, 0], yaw: 0, mode: "flight", v: [5, 0, 0] })).toThrow(
      /flight limit/,
    );
    expect(bad({ p: [0.8, 1, -0.6], yaw: 0, mode: "flight" })).toThrow(/inside a solid/);
    expect(bad({ p: [0, Number.NaN, 0], yaw: 0, mode: "flight" })).toThrow(/finite/);
    expect(bad({ p: [0, 1, 0], yaw: 0, mode: "walk" as never })).toThrow(
      /rest or in flight/,
    );
  }, 60_000);
  it("follows the commanded velocity at any time constant, within the acceleration limit", () => {
    const amax = P.maxAccelG * 9.81;
    for (const velocityTauS of [0, P.velocityTauS, 2]) {
      const fly = new DigitalFly({
        seed: 10,
        world: arenaWorld(ROOM),
        start: { p: [0, 1, 0], yaw: 0, mode: "flight" },
        config: { velocityTauS },
      });
      stepwise(fly, 20, (before, f) => {
        const s = f.state;
        expect(s.v.every(Number.isFinite)).toBe(true);
        // Mode changes and contacts are the body's own events, not the tracker.
        if (before.mode !== s.mode || s.mode !== "flight") return;
        if (s.contact || s.counts.collisions !== before.collisions) return;
        const dv = Math.hypot(
          s.v[0] - before.v[0],
          s.v[1] - before.v[1],
          s.v[2] - before.v[2],
        );
        expect(dv).toBeLessThanOrEqual(amax * 0.005 + 1e-9);
      });
      expect(fly.state.counts.flownM).toBeGreaterThan(1);
    }
  }, 60_000);
});

describe("landing and contact", () => {
  it("counts a contact once, when it starts, and slides along the surface", () => {
    const world = arenaWorld(ROOM);
    // Flying at the east wall at an angle: the push into the wall is resisted
    // and the rest of the motion carries the fly north along it.
    const presser = adapter("presser", () => ({
      mode: "flight",
      velocity: [0.3, 0, 0],
      reason: "into the wall",
    }));
    const fly = new DigitalFly({
      seed: 9,
      world,
      start: { p: [1.6, 1, 0.5], yaw: 0.3, mode: "flight" },
      adapter: () => presser,
    });
    const zs: number[] = [];
    run(fly, 6, (f) => {
      expect(world.solid(f.state.p)).toBe(false);
      if (f.state.contact) zs.push(f.state.p[2]);
    });
    expect(fly.state.counts.collisions).toBe(1);
    expect(fly.log.filter((r) => r.reason.startsWith("collision")).length).toBe(1);
    expect(fly.state.contact?.id).toBe("wall-e");
    expect(fly.state.counts.contactS).toBeGreaterThan(3);
    expect(zs[0]! - zs.at(-1)!).toBeGreaterThan(0.25);
  });
  it("touches down on a crown without being moved more than 2 mm", () => {
    const world = new PrimitiveWorld({
      id: "crowns",
      home: { center: [0, 0, 0], radius: 6, ceiling: 8 },
      inputs: ARENA_INPUTS,
      ground: () => 0,
      groundMax: 0,
      ceiling: 8,
      ambient: 0.5,
      cylinders: [{ kind: "pole", id: "trunk", x: 0, z: 0, r: 0.2, y0: 0, y1: 1.5 }],
      spheres: [
        { kind: "obstacle", id: "crown", center: [0, 3, 0], r: 2.4 },
        { kind: "obstacle", id: "shrub", center: [3, 1.02, 2], r: 0.38 },
      ],
    });
    let onSpheres = 0;
    for (const seed of [31, 32, 33]) {
      const fly = new DigitalFly({
        seed,
        world,
        start: { p: [0.3, 5.8, 0.2], yaw: 0, mode: "flight" },
        config: { takeoffHz: 0.5 },
      });
      stepwise(fly, 60, (before, f) => {
        const s = f.state;
        if (s.counts.landings === before.landings) return;
        // The touchdown step moves the fly by its own motion and at most the 2 mm gap.
        const moved = Math.hypot(
          s.p[0] - before.p[0],
          s.p[1] - before.p[1],
          s.p[2] - before.p[2],
        );
        expect(moved).toBeLessThanOrEqual(P.touchdownSpeedMS * 0.005 + 0.002 + 1e-9);
        const perch = world.perchAt(s.p[0], s.p[2], s.p[1])!;
        expect(s.p[1] - perch.y).toBeCloseTo(f.standingHeight, 9);
        if (perch.id !== "ground") onSpheres++;
      });
      expect(fly.state.counts.rejected).toBe(0);
    }
    expect(onSpheres).toBeGreaterThan(0);
  }, 60_000);
  it("aborts a touchdown whose surface is not there, instead of snapping to one", () => {
    const base = arenaWorld(ROOM);
    let gone = false;
    const onPlatform = (x: number, z: number) =>
      Math.abs(x + 1) <= 0.3 && Math.abs(z - 1) <= 0.2;
    // The platform stops holding a fly; its top still stops rays.
    const world = wrapWorld(base, {
      perchAt: (x, z, y) =>
        gone && onPlatform(x, z) ? base.perchAt(x, z, 0) : base.perchAt(x, z, y),
    });
    const lander = adapter("lander", ({ body, sites }) => {
      if (body.mode === "flight") {
        const platform = sites.find((s) => s.id === "platform-0");
        return platform
          ? {
              mode: "land",
              land: { id: platform.id, point: [...platform.center] },
              reason: "the platform",
            }
          : { mode: "flight", hover: true, velocity: [0, 0, 0], reason: "looking" };
      }
      return body.mode === "land"
        ? approach(body)
        : { mode: body.mode, reason: "resting" };
    });
    const fly = new DigitalFly({
      seed: 8,
      world,
      start: { p: [-1, 1.3, 1], yaw: 0, mode: "flight" },
      adapter: () => lander,
    });
    let abort: string | undefined;
    stepwise(fly, 30, (before, f) => {
      const s = f.state;
      const moved = Math.hypot(
        s.p[0] - before.p[0],
        s.p[1] - before.p[1],
        s.p[2] - before.p[2],
      );
      expect(moved).toBeLessThan(0.004);
      if (abort === undefined) {
        expect(s.counts.landings).toBe(0);
        abort = f.log.find((r) => r.reason.includes("aborted"))?.reason;
        // The surface goes when the feet are 2 cm from it, and comes back after the abort.
        gone =
          abort === undefined &&
          s.mode === "land" &&
          s.p[1] - f.standingHeight - s.target!.point[1] < 0.02;
      }
    });
    expect(abort).toMatch(/aborted.*(mm above the floor|no surface)/);
    expect(fly.state.counts.landings).toBe(1);
    const perch = base.perchAt(fly.state.p[0], fly.state.p[2], fly.state.p[1])!;
    expect(perch.id).toBe("platform-0");
    expect(fly.state.p[1] - perch.y).toBeCloseTo(fly.standingHeight, 9);
  });
  it("habituates to repeated looms and recovers after a rest", () => {
    const SPEED = 1.2,
      FROM = 1.5,
      STOP = 0.1,
      R = 0.04;
    let shot: {
      n: number;
      t0: number;
      from: V3;
      dir: V3;
      escapes: number;
      seen: boolean;
    } | null = null;
    const base = arenaWorld({ size: [10, 3, 10], ambient: 0.3 });
    // A ball thrown at the fly wherever it rests, from ahead (or the side, if a
    // wall is ahead), stopping 10 cm short of it.
    const world = wrapWorld(base, {
      movers: (near, radius, out: Mover[], t) => {
        if (!shot || t < shot.t0) return;
        const travel = Math.min(FROM - STOP, (t - shot.t0) * SPEED);
        const c: V3 = [
          shot.from[0] + shot.dir[0] * travel,
          shot.from[1] + shot.dir[1] * travel,
          shot.from[2] + shot.dir[2] * travel,
        ];
        if (Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) <= radius + R)
          out.push({ id: `ball ${shot.n}`, kind: "stimulus", center: c, radius: R });
      },
    });
    const fly = new DigitalFly({
      seed: 2,
      world,
      start: { p: [0, 0.5, 0], yaw: 0 },
      config: {
        ...STILL,
        habituationRecoveryS: 120,
        flightBoutMeanS: 0.5,
        cruiseAltMinM: 0.3,
        cruiseAltMaxM: 0.4,
      },
    });
    const results: boolean[] = [];
    let presenting = true,
      nextAt = 0,
      escapes = 0,
      responsiveness = 1;
    const throwBall = (f: DigitalFly) => {
      const s = f.state;
      for (const turn of [0, Math.PI / 2, -Math.PI / 2]) {
        const dir = forward(s.yaw + turn);
        if (world.raycast(s.p, dir, FROM + 0.1)) continue;
        const from: V3 = [s.p[0] + dir[0] * FROM, s.p[1] + 0.03, s.p[2] + dir[2] * FROM];
        const d: V3 = [s.p[0] - from[0], s.p[1] - from[1], s.p[2] - from[2]];
        const n = Math.hypot(...d);
        shot = {
          n: results.length,
          t0: s.t,
          from,
          dir: [d[0] / n, d[1] / n, d[2] / n],
          escapes: s.counts.escapes,
          seen: false,
        };
        return;
      }
    };
    const watch = (f: DigitalFly) => {
      const s = f.state;
      if (s.counts.escapes > escapes) {
        // Each escape takes the same share of whatever responsiveness was left.
        expect(s.responsiveness).toBeCloseTo(responsiveness * (1 - P.habituationStep), 2);
        escapes = s.counts.escapes;
      }
      responsiveness = s.responsiveness;
      if (shot && f.lastFrame?.looming?.id === `ball ${shot.n}`) shot.seen = true;
      if (shot && s.t > shot.t0 + (FROM - STOP) / SPEED + 1) {
        // Every ball looms in front of the fly; whether it escapes is the question.
        expect(shot.seen).toBe(true);
        results.push(s.counts.escapes > shot.escapes);
        shot = null;
        nextAt = s.t + 2;
      }
      if (presenting && !shot && s.mode === "rest" && s.modeT >= 2 && s.t >= nextAt)
        throwBall(f);
    };
    for (let k = 0; k < 3000 && !results.includes(false); k++) {
      fly.advance(0.1);
      watch(fly);
    }
    // It escaped the first balls, then stopped escaping the same ball.
    expect(results[0]).toBe(true);
    expect(results.at(-1)).toBe(false);
    expect(results.length).toBeGreaterThan(1);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(fly.state.responsiveness).toBeLessThan(1 - P.habituationStep);
    // Five recovery time constants later it is fresh, and escapes the ball again.
    presenting = false;
    run(fly, 600, watch);
    expect(fly.state.responsiveness).toBeGreaterThan(0.99);
    presenting = true;
    const before = results.length;
    for (let k = 0; k < 600 && results.length === before; k++) {
      fly.advance(0.1);
      watch(fly);
    }
    expect(results.at(-1)).toBe(true);
  }, 60_000);
});

describe("the drawn pose", () => {
  const solver = new PoseSolver(gait);
  const rest: PoseInput = {
    mode: "rest",
    groom: null,
    legs: 1,
    wingsOpen: 0,
    walkSpeed: 0,
    gaitClock: 0,
    yawRate: 0,
    wingPhase: 0,
    ampL: 1,
    ampR: 1,
    time: 0,
  };
  it("stands all six feet on the surface at the simulator's crouch", () => {
    const feet = clawPoints(solver.solve(rest));
    for (const f of feet) expect(f[2]).toBeCloseTo(solver.footZ, 3);
    // The thorax stands at standingCrouch (0.8) of the height FlyBody's zero pose
    // gives it above the claw tips; the claw origins sit just above the tips.
    expect(-solver.footZ).toBeLessThan(SKELETON.measures.standingHeightCm * 0.8);
    expect(-solver.footZ).toBeGreaterThan(SKELETON.measures.standingHeightCm * 0.6);
  });
  it("keeps planted feet on the surface while walking and lifts the swinging ones", () => {
    let lifted = 0;
    for (let k = 0; k < 120; k++) {
      const feet = clawPoints(
        solver.solve({ ...rest, mode: "walk", walkSpeed: 3, gaitClock: (k / 40) % 1 }),
      );
      for (const f of feet) {
        expect(f[2]).toBeGreaterThan(solver.footZ - 0.003);
        if (f[2] > solver.footZ + 0.005) lifted++;
      }
    }
    expect(lifted).toBeGreaterThan(0);
  });
  it("folds the wings at rest and keeps every joint in FlyBody's range", () => {
    const angles = solver.solve({
      ...rest,
      mode: "flight",
      legs: 0,
      wingsOpen: 1,
      wingPhase: 2,
    });
    for (const b of SKELETON.bodies) {
      const a = angles.get(b.name);
      if (!a) continue;
      a.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(b.joints[i]!.range[0] - 1e-9);
        expect(v).toBeLessThanOrEqual(b.joints[i]!.range[1] + 1e-9);
      });
    }
    const folded = solver.solve(rest).get("wing_left")!;
    const springref = SKELETON.bodies
      .find((b) => b.name === "wing_left")!
      .joints.map((j) => j.rest);
    folded.forEach((v, i) => expect(v).toBeCloseTo(springref[i]!, 9));
  });
});
