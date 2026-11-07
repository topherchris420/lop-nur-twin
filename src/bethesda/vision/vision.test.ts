/**
 * The research compound eye on controlled image sequences, and its place
 * beside the deployed controller: geometry, optics, motion detection,
 * looming selectivity, invariances, determinism, the adapter's guarantees,
 * the battery's ground truth and the scoring rule.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import { OriginalRefused } from "../firstContact/originals";
import { DigitalFly } from "../fly/fly";
import type { DecisionInput, FlyNeuralAdapter, MotorCommand } from "../fly/neural";
import { OrganismAdapter } from "../life/organism";
import { indexGraph, restoreGraph, snapshotGraph } from "../life/snapshot";
import { EyeAdapter } from "./adapter";
import { generate, heldRun, liveRun, trial, type Protocol } from "./battery";
import { AXES, LATTICE, LOOMING_UNITS } from "./lattice";
import { MotionVision, shuffledWiring } from "./motion";
import { VISION_PARAMS } from "./params";
import { discCoverage, normalCdf, Renderer } from "./scene";
import {
  bootstrap,
  envelope,
  firstCrossing,
  metrics,
  scoreTrial,
  select,
  type TrialTruth,
} from "./score";
import {
  batteryArena,
  groundTruth,
  segments,
  StimulusWorld,
  type StimulusSpec,
} from "./stimuli";
import protocolJson from "./protocols/looming-v1.json";

const L = LATTICE;
const DEG = Math.PI / 180;
const DT = 0.01;

/** Angular distance between ommatidium i and a direction (azimuth, elevation). */
function angleTo(i: number, az: number, el: number): number {
  const c =
    L.dx[i]! * Math.cos(el) * Math.cos(az) +
    L.dy[i]! * Math.cos(el) * Math.sin(az) +
    L.dz[i]! * Math.sin(el);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

const SIGMA =
  (VISION_PARAMS.acceptanceDeg.value * DEG) / (2 * Math.sqrt(2 * Math.log(2)));

/** A textured background (fixed in the world) with a dark disc of angular radius rho at (az, el). */
function discImage(
  az: number,
  el: number,
  rho: number,
  bg = 1,
  contrast = -0.8,
): Float64Array {
  const img = new Float64Array(L.n);
  for (let i = 0; i < L.n; i++) {
    const tex =
      bg * (1 + 0.2 * Math.sin(L.azimuth[i]! * 7) * Math.cos(L.elevation[i]! * 5));
    const cov = discCoverage(angleTo(i, az, el), rho, SIGMA);
    img[i] = (1 - cov) * tex + cov * bg * (1 + contrast);
  }
  return img;
}

/** Runs a sequence of images through a fresh eye and returns its outputs. */
function run(frames: (k: number) => Float64Array, steps: number, shuffle?: Int32Array) {
  const eye = new MotionVision(LATTICE, LOOMING_UNITS, { shuffle: shuffle ?? null });
  const out = [];
  for (let k = 0; k < steps; k++) out.push(eye.step(frames(k), k * DT));
  return out;
}

const peak = (xs: { lplc2: number }[]) => Math.max(...xs.map((x) => x.lplc2));
const peakExp = (xs: { expansion: number }[]) => Math.max(...xs.map((x) => x.expansion));

describe("the ommatidial lattice", () => {
  it("covers each eye at the fly's inter-ommatidial spacing, about 830 per eye", () => {
    const right = L.eyeStart[1],
      left = L.n - L.eyeStart[1];
    expect(right).toBe(left);
    expect(right).toBeGreaterThan(780);
    expect(right).toBeLessThan(880);
    for (let i = 0; i < L.n; i++)
      expect(Math.hypot(L.dx[i]!, L.dy[i]!, L.dz[i]!)).toBeCloseTo(1, 12);
  });

  it("joins neighbours one spacing apart along the three lattice axes, within an eye", () => {
    const spacing = VISION_PARAMS.interommatidialDeg.value * DEG;
    let pairs = 0;
    for (let i = 0; i < L.n; i++)
      for (let k = 0; k < 3; k++) {
        const j = L.neighbour[3 * i + k]!;
        if (j < 0) continue;
        pairs++;
        expect(L.eye[j]).toBe(L.eye[i]);
        expect(L.x[j]! - L.x[i]!).toBeCloseTo(spacing * AXES[k]![0], 9);
        expect(L.y[j]! - L.y[i]!).toBeCloseTo(spacing * AXES[k]![1], 9);
        // On the sphere the neighbour is within the projection's distortion of one spacing.
        const c = L.dx[i]! * L.dx[j]! + L.dy[i]! * L.dy[j]! + L.dz[i]! * L.dz[j]!;
        const ang = Math.acos(Math.min(1, c));
        expect(ang).toBeGreaterThan(0.75 * spacing);
        expect(ang).toBeLessThan(1.3 * spacing);
      }
    expect(pairs).toBeGreaterThan(2.8 * L.n);
  });

  it("tiles both eyes with looming units whose four branches each hold a fair share", () => {
    const U = LOOMING_UNITS;
    expect(U.n).toBeGreaterThan(100);
    for (let u = 0; u < U.n; u++) {
      const sums = [0, 0, 0, 0];
      for (let q = U.start[u]!; q < U.start[u + 1]!; q++) {
        sums[U.branch[q]!]! += U.weight[q]!;
        expect(L.eye[U.member[q]!]).toBe(U.eye[u]);
      }
      expect(Math.min(...sums)).toBeGreaterThanOrEqual(0.1 * Math.max(...sums));
    }
  });
});

describe("optics: the share of an ommatidium's acceptance a disc covers", () => {
  it("is the Rayleigh CDF for a disc centred on the axis", () => {
    for (const b of [0.3, 1, 2, 3.5, 6]) {
      expect(discCoverage(0, b * SIGMA, SIGMA)).toBeCloseTo(
        1 - Math.exp(-(b * b) / 2),
        4,
      );
    }
  });

  it("approaches a straight edge for a large disc, and grows with the disc", () => {
    for (const off of [-1.5, -0.5, 0, 0.5, 1.5]) {
      const rho = 20 * SIGMA;
      expect(discCoverage(rho + off * SIGMA, rho, SIGMA)).toBeCloseTo(normalCdf(-off), 1);
    }
    let prev = 0;
    for (let b = 0.1; b < 30; b += 0.37) {
      const c = discCoverage(1.3 * SIGMA, b * SIGMA, SIGMA);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = c;
    }
    expect(discCoverage(50 * SIGMA, SIGMA, SIGMA)).toBe(0);
  });
});

describe("elementary motion detection", () => {
  /** A horizontal sinusoidal grating drifting in azimuth at `hz`, period `lambdaDeg`. */
  const grating = (hz: number, lambdaDeg: number, sign: 1 | -1) => (k: number) => {
    const img = new Float64Array(L.n);
    for (let i = 0; i < L.n; i++)
      img[i] =
        1 +
        0.5 *
          Math.sin(
            2 * Math.PI * (L.azimuth[i]! / (lambdaDeg * DEG) - sign * hz * k * DT),
          );
    return img;
  };

  it("is direction selective: the wide-field signal follows the drift and reverses with it", () => {
    const leftward = run(grating(2, 30, 1), 200).slice(100);
    const rightward = run(grating(2, 30, -1), 200).slice(100);
    const mean = (xs: { wideField: number }[]) =>
      xs.reduce((a, x) => a + x.wideField, 0) / xs.length;
    // Increasing azimuth is to the fly's left: a grating whose phase moves to higher azimuth moves left.
    expect(mean(leftward)).toBeGreaterThan(0);
    expect(mean(rightward)).toBeLessThan(0);
    expect(mean(leftward)).toBeCloseTo(-mean(rightward), 1);
  });

  it("prefers a low temporal frequency, near 1/(2πτ), as fly motion detectors do", () => {
    const response = (hz: number) => {
      const out = run(grating(hz, 30, 1), 300).slice(150);
      return out.reduce((a, x) => a + x.wideField, 0) / out.length;
    };
    const freqs = [0.25, 0.5, 1, 2, 4, 8, 16];
    const r = freqs.map(response);
    const best = freqs[r.indexOf(Math.max(...r))]!;
    const optimum = 1 / (2 * Math.PI * VISION_PARAMS.emdDelayS.value);
    expect(best).toBeGreaterThanOrEqual(optimum / 2);
    expect(best).toBeLessThanOrEqual(optimum * 2);
    expect(r[r.length - 1]!).toBeLessThan(0.5 * Math.max(...r));
  });

  it("does not drive the looming units with wide-field rotation", () => {
    const out = run(grating(2, 30, 1), 150);
    const loom = run(
      (k) => discImage(20 * DEG, 10 * DEG, Math.min(1.2, (2 + 0.6 * k) * DEG)),
      100,
    );
    expect(peak(out)).toBeLessThan(0.05 * peak(loom));
  });
});

describe("looming selectivity (radial motion opponency)", () => {
  const AZ = 40 * DEG,
    EL = 10 * DEG;
  // An object 5 cm in radius approaching at 1 m/s from 1 m, seen every 10 ms.
  const loomRho = (k: number) =>
    Math.asin(Math.min(1, 0.05 / Math.max(0.06, 1 - k * DT)));
  const looming = run((k) => discImage(AZ, EL, loomRho(k)), 95);

  it("responds strongly to an object expanding on a collision course", () => {
    expect(peak(looming)).toBeGreaterThan(1);
    // The most active unit lies toward the object.
    const best = looming.reduce((a, x) => (x.lplc2 > a.lplc2 ? x : a)).lplc2Best;
    const du = Math.acos(
      Math.cos(EL) *
        Math.cos(LOOMING_UNITS.elevation[best]!) *
        Math.cos(AZ - LOOMING_UNITS.azimuth[best]!) +
        Math.sin(EL) * Math.sin(LOOMING_UNITS.elevation[best]!),
    );
    expect(du).toBeLessThan(20 * DEG);
  });

  it("barely responds to the same object translating, receding or standing still", () => {
    const translating = run(
      (k) => discImage(AZ - 60 * DEG + k * DT * 1.2, EL, 6 * DEG),
      100,
    );
    // As in the battery, the eye has adapted to the scene before the object appears.
    const receding = run((k) => discImage(AZ, EL, k < 20 ? 0 : loomRho(114 - k)), 115);
    const still = run(() => discImage(AZ, EL, 10 * DEG), 60);
    expect(peak(translating)).toBeLessThan(0.1 * peak(looming));
    expect(peak(receding)).toBeLessThan(0.1 * peak(looming));
    expect(peak(still)).toBe(0);
    // Without opponency and the all-quadrant AND, translation drives the units far more.
    expect(peakExp(translating) / peakExp(looming)).toBeGreaterThan(
      5 * (peak(translating) / peak(looming)),
    );
  });

  it("responds to bright looming objects as to dark ones", () => {
    const bright = run((k) => discImage(AZ, EL, loomRho(k), 1, 0.8), 95);
    expect(peak(bright)).toBeGreaterThan(0.5 * peak(looming));
  });

  it("is invariant to the illumination level (Weber adaptation)", () => {
    const dim = run((k) => discImage(AZ, EL, loomRho(k), 0.1), 95);
    expect(peak(dim)).toBeCloseTo(peak(looming), 1);
  });

  /** An object 5 cm in radius approaching at 1 m/s whose centre passes `miss` beside the eye. */
  const nearMiss = (miss: number) => (k: number) => {
    const z = Math.max(0, 1 - k * DT);
    return discImage(
      AZ + Math.atan2(miss, z),
      EL,
      Math.asin(Math.min(1, 0.05 / Math.hypot(z, miss))),
    );
  };

  it("tells a collision course from a near miss at the object's own radius", () => {
    // Centre 3 cm from the eye: the 5 cm object strikes it. 8 or 15 cm: it passes.
    expect(peak(run(nearMiss(0.03), 110))).toBeGreaterThan(0.5 * peak(looming));
    expect(peak(run(nearMiss(0.08), 110))).toBeLessThan(0.02 * peak(looming));
    expect(peak(run(nearMiss(0.15), 110))).toBeLessThan(0.02 * peak(looming));
    // The expansion readout cannot: a passing object still expands.
    expect(peakExp(run(nearMiss(0.08), 110))).toBeGreaterThan(0.5 * peakExp(looming));
  });

  it("loses that discrimination when retinotopy is shuffled", () => {
    const perm = shuffledWiring(LATTICE, mulberry32(9));
    const seen = new Set<number>();
    for (let i = 0; i < L.n; i++) {
      seen.add(perm[i]!);
      expect(L.eye[perm[i]!]).toBe(L.eye[i]);
    }
    expect(seen.size).toBe(L.n);
    const loom = peak(run((k) => discImage(AZ, EL, loomRho(k)), 95, perm));
    const passing = peak(run(nearMiss(0.08), 110, perm));
    expect(passing).toBeGreaterThan(0.3 * loom);
  });

  it("starts new: a still scene gives no contrast, no motion and no looming", () => {
    const img = discImage(AZ, EL, 10 * DEG);
    const out = run(() => img, 50);
    for (const o of out) {
      expect(o.lplc2).toBe(0);
      expect(o.contrastEnergy).toBe(0);
    }
  });
});

// --- the eye in a world -------------------------------------------------------

const P: [number, number, number] = [0, 0.01, 0];
function stimulusWorld(spec: StimulusSpec, ambient = 0.7) {
  const segs = segments(spec, P, 0, 1);
  const truth = groundTruth(spec, segs, P);
  return {
    world: new StimulusWorld(batteryArena(ambient), { spec, segments: segs, truth }, 77),
    truth,
  };
}

describe("image formation in the arena", () => {
  it("is deterministic, and sees a sphere ahead as darker where it lies", () => {
    const { world } = stimulusWorld({
      kind: "stationary",
      radius: 0.1,
      contrast: -0.9,
      azimuth_deg: 30,
      elevation_deg: 20,
      distance: 0.5,
      duration_s: 1,
    });
    const r = new Renderer(world, LATTICE, 12);
    const a = new Float64Array(L.n),
      b = new Float64Array(L.n),
      none = new Float64Array(L.n);
    r.render(P, 0, 1.5, a, null);
    r.render(P, 0, 1.5, b, null);
    r.render(P, 0, 0.5, none, null); // before it appears
    expect(Array.from(a)).toEqual(Array.from(b));
    let near = 0,
      nearDark = 0;
    for (let i = 0; i < L.n; i++) {
      if (angleTo(i, 30 * DEG, 20 * DEG) < 8 * DEG) {
        near++;
        if (a[i]! < 0.5 * none[i]!) nearDark++;
      }
    }
    expect(near).toBeGreaterThan(5);
    expect(nearDark).toBe(near);
    // The last three images shared one pose: only the first cast the static scene.
    expect(r.rays).toBe(0);
  });

  it("reuses the static scene for a still eye, number for number", () => {
    const { world } = stimulusWorld(APPROACH);
    const cached = new Renderer(world, LATTICE, 12);
    const fresh = new Renderer(
      {
        world,
        textureSeed: world.textureSeed,
        staticGeometryChanges: true,
        moverReflectance: (m) => world.moverReflectance(m),
      },
      LATTICE,
      12,
    );
    const a = new Float64Array(L.n),
      b = new Float64Array(L.n);
    for (const t of [1.2, 1.6, 2.0]) {
      cached.render(P, 0.3, t, a, null);
      fresh.render(P, 0.3, t, b, null);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
    expect(cached.rays).toBe(0);
    expect(fresh.rays).toBe(L.n);
    cached.render([0.1, 0.01, 0], 0.3, 2.0, a, null);
    expect(cached.rays).toBe(L.n);
  });

  it("does not see a sphere behind a wall", () => {
    const { world } = stimulusWorld({
      kind: "stationary",
      radius: 0.3,
      contrast: -0.9,
      azimuth_deg: 0,
      elevation_deg: 0,
      distance: 4.6,
      duration_s: 1,
    });
    const r = new Renderer(world, LATTICE, 12);
    const a = new Float64Array(L.n),
      none = new Float64Array(L.n);
    r.render(P, 0, 1.5, a, null);
    r.render(P, 0, 0.5, none, null);
    expect(Array.from(a)).toEqual(Array.from(none));
  });
});

// --- the adapter --------------------------------------------------------------

/** Records commands and the looming each frame carried. */
class Spy implements FlyNeuralAdapter {
  readonly inner: FlyNeuralAdapter;
  readonly descriptor;
  commands: string[] = [];
  loomings: (number | null)[] = [];
  constructor(inner: FlyNeuralAdapter) {
    this.inner = inner;
    this.descriptor = inner.descriptor;
  }
  start(b: Parameters<NonNullable<FlyNeuralAdapter["start"]>>[0]) {
    this.inner.start?.(b);
  }
  decide(i: DecisionInput): MotorCommand {
    this.loomings.push(i.frame.looming?.drive ?? null);
    const c = this.inner.decide(i);
    this.commands.push(`${i.body.t}:${c.mode}`);
    return c;
  }
  interrupt(i: DecisionInput): MotorCommand | null {
    this.loomings.push(i.frame.looming?.drive ?? null);
    const c = this.inner.interrupt?.(i) ?? null;
    if (c) this.commands.push(`${i.body.t}:${c.mode}!`);
    return c;
  }
}

const APPROACH: StimulusSpec = {
  kind: "approach",
  radius: 0.05,
  contrast: -0.8,
  azimuth_deg: 30,
  elevation_deg: 15,
  speed: 1,
  distance: 1.2,
};

function fly(world: StimulusWorld, wrap: (o: OrganismAdapter) => FlyNeuralAdapter) {
  let spy: Spy | null = null;
  const f = new DigitalFly({
    seed: 5,
    world,
    start: { p: P, yaw: 0 },
    config: { takeoffHz: 0, walkStartHz: 0, groomHz: 0 },
    adapter: (rng, streams) =>
      (spy = new Spy(wrap(new OrganismAdapter(rng, streams, 5)))),
  });
  return { f, spy: () => spy! };
}

describe("the eye adapter", () => {
  it("refuses the originals and anything but a research subject", () => {
    const { world } = stimulusWorld(APPROACH);
    const make = (subject: string) => () =>
      fly(
        world,
        (o) =>
          new EyeAdapter(o, {
            subject,
            seed: 1,
            scene: world,
            mode: "observe",
            readout: "lplc2",
            gain: 1,
          }),
      );
    expect(make("04f8c797b697")).toThrow(OriginalRefused);
    expect(make("research-5cf42cd6-fd0a")).toThrow(OriginalRefused);
    expect(make("eva-copy")).toThrow(/research-/);
    expect(make("research-ok")).not.toThrow();
  });

  it("in observe mode changes nothing the fly does, step for step", () => {
    const { world, truth } = stimulusWorld(APPROACH);
    const bare = fly(world, (o) => o);
    const seen = fly(
      world,
      (o) =>
        new EyeAdapter(o, {
          subject: "research-observe",
          seed: 1,
          scene: world,
          mode: "observe",
          readout: "lplc2",
          gain: 1,
        }),
    );
    const end = truth.tCollision! + 0.3;
    while (bare.f.state.t < end) {
      bare.f.advance(0.05);
      seen.f.advance(0.05);
      expect(seen.f.stateHash()).toBe(bare.f.stateHash());
    }
    expect(seen.spy().commands).toEqual(bare.spy().commands);
    expect(bare.spy().commands.some((c) => c.includes("escape"))).toBe(true);
  });

  it("in drive mode hands the controller the eye's looming, and the fly escapes on it", () => {
    const { world, truth } = stimulusWorld(APPROACH);
    let eye: EyeAdapter | null = null;
    const seen = fly(
      world,
      (o) =>
        (eye = new EyeAdapter(o, {
          subject: "research-drive",
          seed: 1,
          scene: world,
          mode: "drive",
          readout: "lplc2",
          gain: 2,
        })),
    );
    while (seen.f.state.t < truth.tCollision!) seen.f.advance(0.01);
    const e = eye as unknown as EyeAdapter;
    expect(e.replaced).toBeGreaterThan(100);
    // Before the stimulus appears (plus the latency) the eye reports nothing looming.
    const loomings = seen.spy().loomings;
    expect(loomings.slice(0, 95).every((x) => x === null)).toBe(true);
    expect(loomings.some((x) => x !== null && x >= 1)).toBe(true);
    expect(seen.spy().commands.some((c) => c.includes("escape"))).toBe(true);
  });
});

// --- the battery and its scoring ---------------------------------------------

describe("the battery", () => {
  const protocol = protocolJson as unknown as Protocol;

  it("generates the same stimuli from a split's seed, every one a threat or harmless", () => {
    for (const split of ["dev", "heldout"]) {
      const a = generate(protocol.splits[split]!),
        b = generate(protocol.splits[split]!);
      expect(a).toEqual(b);
      for (const s of a) {
        const tr = trial(protocol, s);
        const shouldThreat = ["approach", "accelerating", "glancing"].includes(s.kind);
        expect(tr.truth.threat).toBe(shouldThreat);
      }
    }
  });

  it("refuses a stimulus in the excluded band between threat and harmless", () => {
    expect(() =>
      groundTruth(
        { ...APPROACH, kind: "near_miss", miss: 0.08 },
        segments({ ...APPROACH, kind: "near_miss", miss: 0.08 }, P, 0, 1),
        P,
      ),
    ).toThrow(/neither a threat nor harmless/);
  });

  it("predicts the live deployed fly's first escape from the held run exactly", () => {
    const s = generate(protocol.splits.dev!)[0]!;
    const tr = trial(protocol, s);
    const now = () => 0;
    const held = heldRun(protocol, "dev", tr, 7101, now);
    const live = liveRun(protocol, "dev", tr, 7101, null, now);
    expect(held.deployedEscape).not.toBeNull();
    expect(live.firstEscape).toBe(held.deployedEscape);
  });
});

describe("scoring", () => {
  const truths: TrialTruth[] = [
    { stimulus: 0, kind: "approach", threat: true, tOn: 1, tCollision: 2 },
    { stimulus: 1, kind: "lateral", threat: false, tOn: 1, tCollision: null },
    { stimulus: 2, kind: "approach", threat: true, tOn: 1, tCollision: 2 },
  ];

  it("finds the first crossing of any threshold from the running-maximum envelope", () => {
    const rng = mulberry32(3);
    const t = Array.from({ length: 200 }, (_, k) => k * 0.01);
    const v = t.map(() => rng());
    const e = envelope(t, v);
    for (const th of [0.1, 0.5, 0.9, 0.99, 1.5]) {
      const k = v.findIndex((x) => x >= th);
      expect(firstCrossing(e, th)).toBe(k < 0 ? null : t[k]);
    }
  });

  it("scores hits, misses, false alarms and early escapes", () => {
    expect(scoreTrial(truths[0]!, 1.9).outcome).toBe("hit");
    expect(scoreTrial(truths[0]!, 2.0).outcome).toBe("miss");
    expect(scoreTrial(truths[0]!, 0.5).outcome).toBe("early");
    expect(scoreTrial(truths[1]!, 1.5).outcome).toBe("false-alarm");
    const m = metrics(truths, [
      scoreTrial(truths[0]!, 1.9),
      scoreTrial(truths[1]!, 1.5),
      scoreTrial(truths[2]!, null),
    ]);
    expect(m.f1).toBeCloseTo(0.5, 9);
    expect(m.recall).toBe(0.5);
  });

  it("selects by the frozen rule and bootstraps deterministically", () => {
    const envs = [
      envelope([1.5, 1.9], [0.5, 2]),
      envelope([1.2], [1]),
      envelope([1.4, 1.95], [0.4, 3]),
    ];
    const sel = select(truths, envs, 0.8, 40);
    expect(sel.metrics.recall).toBe(1);
    expect(sel.metrics.falseAlarms).toBe(0);
    const scored = envs.map((e, k) =>
      scoreTrial(truths[k]!, firstCrossing(e, sel.threshold)),
    );
    const stat = (idx: readonly number[]) =>
      metrics(
        idx.map((k) => truths[k]!),
        idx.map((k) => scored[k]!),
      ).f1;
    expect(bootstrap(truths, stat, 200, 1)).toEqual(bootstrap(truths, stat, 200, 1));
  });
});

// --- continuity of the eye's state ----------------------------------------------

describe("a research fly's eye across a checkpoint", () => {
  it("restores to the same bytes and steps on exactly as the uninterrupted fly", () => {
    const { world, truth } = stimulusWorld(APPROACH);
    const build = () =>
      new DigitalFly({
        seed: 11,
        world,
        start: { p: P, yaw: 0 },
        config: { takeoffHz: 0, walkStartHz: 0, groomHz: 0 },
        adapter: (rng, streams) =>
          new EyeAdapter(new OrganismAdapter(rng, streams, 11), {
            subject: "research-eye-continuity",
            seed: 3,
            scene: world,
            mode: "drive",
            readout: "lplc2",
            gain: 2,
          }),
      });
    const live = build();
    // Into the approach: the eye's adaptation, delays and history all hold state now.
    while (live.state.t < truth.tOn + 0.6) live.advance(0.01);
    const snap = JSON.parse(JSON.stringify(snapshotGraph(live, indexGraph(build()))));
    const back = restoreGraph(snap, build());
    expect(JSON.stringify(snapshotGraph(back, indexGraph(build())))).toBe(
      JSON.stringify(snapshotGraph(live, indexGraph(build()))),
    );
    const eyeOf = (f: DigitalFly) =>
      (f as unknown as { adapter: EyeAdapter }).adapter.vision;
    while (live.state.t < truth.tCollision! + 0.2) {
      live.advance(0.01);
      back.advance(0.01);
      expect(back.stateHash()).toBe(live.stateHash());
    }
    expect(Array.from(eyeOf(back).adapted)).toEqual(Array.from(eyeOf(live).adapted));
    expect(live.log.some((r) => r.to.startsWith("escape"))).toBe(true);
  });
});
