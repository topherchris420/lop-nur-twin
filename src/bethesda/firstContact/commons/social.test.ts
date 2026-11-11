import { describe, expect, it } from "vitest";
import { arenaWorld } from "../../fly/arena";
import { DigitalFly } from "../../fly/fly";
import type { DecisionInput, MotorCommand } from "../../fly/neural";
import type { V3 } from "../../fly/units";
import type { SurfaceChemistry } from "../socialSensing";
import { Commons, type TouchSample } from "./commons";
import { FlyOccupant } from "./occupants";
import { SOCIAL_PARAMS, SocialBrain, SocialOrganismAdapter } from "./social";

const A: SurfaceChemistry = [0.8, 0.1, 0.1, 0.2];

/** A decision input with only what the social brain reads. */
function input(mode: string, t: number, yaw = 0): DecisionInput {
  return { body: { mode, t, yaw }, dt: 0.05 } as unknown as DecisionInput;
}
function sample(
  t: number,
  onset: boolean,
  chemistry: SurfaceChemistry | null,
  bearing = 0.5,
): TouchSample {
  return { t, dt: 0.005, onset, bearing, chemistry };
}
const REST: MotorCommand = { mode: "rest", reason: "controller" };
const GROOM: MotorCommand = { mode: "groom", reason: "controller" };

/** One contact bout of `seconds` and the decision that follows its onset. */
function contact(
  b: SocialBrain,
  t0: number,
  mode: string,
  chem: SurfaceChemistry | null,
  seconds = 0.2,
) {
  for (let k = 0; k * 0.005 < seconds; k++)
    b.touch(sample(t0 + k * 0.005, k === 0, chem));
  b.release();
  return b.shape(input(mode, t0 + 0.01), mode === "groom" ? GROOM : REST);
}

const rate = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;

describe("touch: walking away (Ramdya et al. 2015)", () => {
  it("makes a stationary fly walk off away from the side touched about 80% of the time", () => {
    const outs = Array.from({ length: 600 }, (_, s) =>
      contact(new SocialBrain(1000 + s), 0, "rest", A),
    );
    const walked = outs.map((c) => c.mode === "walk");
    expect(rate(walked)).toBeGreaterThan(0.75);
    expect(rate(walked)).toBeLessThan(0.85);
    const w = outs.find((c) => c.mode === "walk")!;
    // Touched on the left (bearing +0.5): the heading wanted is to the right and behind.
    expect(w.yawRate!).toBeLessThan(0);
    expect(w.walkSpeed).toBe(SOCIAL_PARAMS.touchWalkCmS.value);
  }, 60_000);

  it("needs no chemistry: a body that tastes of nothing elicits the same responses", () => {
    for (let s = 0; s < 200; s++) {
      const withChem = contact(new SocialBrain(2000 + s), 0, "rest", A).mode;
      const without = contact(new SocialBrain(2000 + s), 0, "rest", null).mode;
      expect(without).toBe(withChem);
    }
  }, 60_000);

  it("does not stop a walking fly or one in flight", () => {
    const b = new SocialBrain(3);
    b.touch(sample(0, true, A));
    const flight: MotorCommand = {
      mode: "flight",
      velocity: [0.3, 0, 0],
      reason: "controller",
    };
    expect(b.shape(input("flight", 0.01), flight)).toBe(flight);
    expect(b.onsets[0]!.touchResponse).toBe(false);
  });
});

describe("novel chemistry: alerting (Hattori et al. 2017)", () => {
  it("interrupts about half of grooming flies at a first contact, and fewer once it is familiar", () => {
    const first: boolean[] = [],
      later: boolean[] = [];
    for (let s = 0; s < 300; s++) {
      const b = new SocialBrain(5000 + s, { touch: false });
      first.push(contact(b, 0, "groom", A).mode === "rest");
      for (let k = 1; k <= 6; k++) contact(b, 30 * k, "groom", A, 1);
      later.push(contact(b, 30 * 7, "groom", A).mode === "rest");
    }
    expect(rate(first)).toBeGreaterThan(0.4);
    expect(rate(first)).toBeLessThan(0.6);
    expect(rate(later)).toBeGreaterThan(0.1);
    expect(rate(later)).toBeLessThan(0.28);
  }, 120_000);

  it("stays alert to a different chemistry after the first became familiar", () => {
    const B: SurfaceChemistry = [0.1, 0.8, 0.2, 0.1];
    const other: boolean[] = [];
    for (let s = 0; s < 300; s++) {
      const b = new SocialBrain(7000 + s, { touch: false });
      for (let k = 0; k < 7; k++) contact(b, 30 * k, "groom", A, 1);
      other.push(contact(b, 30 * 7, "groom", B).mode === "rest");
    }
    expect(rate(other)).toBeGreaterThan(0.38);
  }, 120_000);

  it("lesions without shifting the other pathway's draws", () => {
    for (let s = 0; s < 100; s++) {
      const intact = new SocialBrain(9000 + s);
      const noTouch = new SocialBrain(9000 + s, { touch: false });
      contact(intact, 0, "groom", A);
      contact(noTouch, 0, "groom", A);
      expect(noTouch.onsets[0]!.alerted).toBe(intact.onsets[0]!.alerted);
      expect(noTouch.onsets[0]!.touchResponse).toBe(false);
    }
    const noAlert = new SocialBrain(1, { alert: false });
    for (let k = 0; k < 20; k++) contact(noAlert, 30 * k, "groom", A);
    expect(noAlert.onsets.every((o) => !o.alerted)).toBe(true);
  });

  it("restores to the same memory and the same future", () => {
    const b = new SocialBrain(77);
    for (let k = 0; k < 3; k++) contact(b, 30 * k, "groom", A, 0.5);
    const r = SocialBrain.restore(structuredClone(b.snapshot()));
    for (let k = 3; k < 9; k++)
      expect(contact(r, 30 * k, "groom", A)).toEqual(contact(b, 30 * k, "groom", A));
    expect(r.snapshot()).toEqual(b.snapshot());
  });
});

describe("the social organism in the commons", () => {
  it("runs the deployed kind with the social brain at its hook, and both feel each other", () => {
    const commons = new Commons(
      arenaWorld({
        size: [0.4, 0.3, 0.4],
        ambient: 1,
        lights: [{ at: [0, 0.3, 0], intensity: 1 }],
      }),
    );
    const brains = [new SocialBrain(401), new SocialBrain(402)];
    const flies = [0, 1].map((i) => {
      const seed = 401 + i;
      const fly = new DigitalFly({
        seed,
        world: commons.view(i as 0 | 1),
        start: {
          p: [i === 0 ? -0.0016 : 0.0016, 0.01, 0] as V3,
          yaw: i === 0 ? 0 : Math.PI,
        },
        adapter: (rng, streams) =>
          new SocialOrganismAdapter(rng, streams, seed, "active", brains[i]!),
      });
      commons.join(
        i as 0 | 1,
        new FlyOccupant({
          id: `research-social-${i}`,
          fly,
          chemistry: A,
          port: brains[i]!,
        }),
      );
      return fly;
    });
    commons.run(5);
    for (const [i, b] of brains.entries()) {
      expect(b.onsets.length, `fly ${i}`).toBeGreaterThan(0);
      expect(b.onsets[0]!.novelty).toBeGreaterThan(0.9);
      expect(b.compartment.meanWeight).toBeLessThan(1);
    }
    // They started touching: whatever each did is in its own decision log.
    expect(flies.every((f) => f.log.length > 0)).toBe(true);
  }, 30_000);
});
