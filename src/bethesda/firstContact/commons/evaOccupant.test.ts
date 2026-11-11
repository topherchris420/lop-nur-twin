import { describe, expect, it } from "vitest";
import { DigitalFly } from "../../fly/fly";
import type { DecisionInput, FlyNeuralAdapter, MotorCommand } from "../../fly/neural";
import type { V3 } from "../../fly/units";
import { birth } from "../eva/garden";
import { ECHO, EVA } from "../originals";
import { Commons, FLY_BODY_RADIUS_M, type BodyPose, type Occupant } from "./commons";
import { EVA_PERCEPTION_M, EvaOccupant, localOffset, PERCEIVED_KEY } from "./evaOccupant";
import { gardenCommonsWorld } from "./garden";
import { FlyOccupant } from "./occupants";

const BORN = Date.UTC(2026, 10, 11, 15, 0, 0) / 1000;

/** A test fixture, not a subject: hovers where it was placed. */
class Hover implements FlyNeuralAdapter {
  readonly descriptor = {
    id: "test-hover",
    label: "hover",
    fidelity: "fixture",
    simulatesNeurons: false,
    regions: [],
  };
  decide(_i: DecisionInput): MotorCommand {
    return { mode: "flight", velocity: [0, 0, 0], hover: true, reason: "fixture" };
  }
}

/** A test fixture, not a subject: a body on a fixed horizontal circle (w rad/s). */
class Orbit implements Occupant {
  readonly id = "research-orbit-fixture";
  readonly chemistry = null;
  private t = 0;
  private readonly c: V3;
  private readonly r: number;
  private readonly w: number;
  constructor(c: V3, r: number, w: number) {
    this.c = c;
    this.r = r;
    this.w = w;
  }
  pose(): BodyPose {
    const a = this.w * this.t;
    return {
      center: [
        this.c[0] + this.r * Math.cos(a),
        this.c[1],
        this.c[2] + this.r * Math.sin(a),
      ],
      yaw: a + Math.PI / 2,
      radius: FLY_BODY_RADIUS_M,
      speed: this.r * Math.abs(this.w),
    };
  }
  step(dt: number): void {
    this.t += dt;
  }
}

function alone(seed: string, seconds: number) {
  const commons = new Commons(gardenCommonsWorld());
  const eva = new EvaOccupant({
    lifeId: `research-eva-test-${seed}`,
    seed,
    bornAt: BORN,
    plasticity: "active",
    chemistry: null,
    commons,
    index: 0,
  });
  commons.join(0, eva);
  const path: { t: number; c: V3; flying: boolean }[] = [];
  for (let k = 0; k < Math.round(seconds / commons.stepS); k++) {
    commons.step();
    if (k % 20 === 0)
      path.push({
        t: commons.t,
        c: eva.pose().center,
        flying: eva.garden.state().activity === "flying",
      });
  }
  return { commons, eva, path };
}

describe("an Eva-kind subject in the commons", () => {
  it("lives exactly as her bare garden does when alone, and every prediction is verified", () => {
    const { eva } = alone("solo-1", 1800);
    const bare = birth({
      lifeId: "research-eva-test-solo-1",
      seed: "solo-1",
      bornAt: BORN,
      plasticity: "active",
    });
    bare.advance(BORN + 1800);
    expect(eva.garden.state()).toEqual(bare.state());
    expect(eva.garden.plasticityMemory()).toEqual(bare.plasticityMemory());
    expect(eva.mismatches).toBe(0);
    expect(eva.stops).toBe(0);
    expect(eva.perceivedSteps).toBe(0);
  }, 120_000);

  it("is stopped by a body in her flight path, and her own physics and learner take it in", () => {
    const solo = alone("block-1", 1800);
    // Mid-flight, well away from where she starts (a body there would overlap her).
    const home = solo.path[0]!.c;
    const i = solo.path.findIndex(
      (p, j) =>
        j > 10 &&
        p.flying &&
        solo.path[j - 1]!.flying &&
        Math.hypot(p.c[0] - home[0], p.c[1] - home[1], p.c[2] - home[2]) > 0.1,
    );
    expect(i).toBeGreaterThan(0);
    const spot = solo.path[i]!;
    const commons = new Commons(gardenCommonsWorld());
    const eva = new EvaOccupant({
      lifeId: "research-eva-test-block-1",
      seed: "block-1",
      bornAt: BORN,
      plasticity: "active",
      chemistry: null,
      commons,
      index: 0,
    });
    commons.join(0, eva);
    const hover = new DigitalFly({
      seed: 3,
      world: commons.view(1),
      start: { p: spot.c, yaw: 0, mode: "flight", v: [0, 0, 0] },
      adapter: () => new Hover(),
    });
    commons.join(
      1,
      new FlyOccupant({ id: "research-hover-fixture", fly: hover, chemistry: null }),
    );
    let minD = Infinity;
    for (let k = 0; k < Math.round((spot.t + 60) / commons.stepS); k++) {
      commons.step();
      const a = eva.pose().center,
        b = hover.state.p;
      minD = Math.min(minD, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    expect(eva.stops).toBeGreaterThan(0);
    expect(minD).toBeGreaterThanOrEqual(2 * FLY_BODY_RADIUS_M - 1e-6);
    expect(eva.overlapSteps).toBe(0);
    // Her own record of that step shows the motion that failed: she did not reach where her copy went.
    const solo2 = alone("block-1", spot.t + 60).eva;
    expect(eva.garden.state().position).not.toEqual(solo2.garden.state().position);
  }, 240_000);

  it("lets her own tracker tell a still body from a moving one, whatever her animation does", () => {
    const verdict = (w: number) => {
      const commons = new Commons(gardenCommonsWorld());
      const eva = new EvaOccupant({
        lifeId: "research-eva-test-track-1",
        seed: "track-1",
        bornAt: BORN,
        plasticity: "active",
        chemistry: null,
        commons,
        index: 0,
      });
      commons.join(0, eva);
      const e = eva.pose().center;
      commons.join(1, new Orbit([e[0] + 0.012, e[1] + 0.006, e[2] + 0.004], 0.006, w));
      for (let k = 0; k < Math.round(90 / commons.stepS); k++) commons.step();
      expect(eva.garden.state().place).toBe("flowers"); // she stayed where both could be seen
      expect(eva.mismatches).toBe(0);
      const nearby = eva.garden
        .snapshot()
        .learning.nearby.find((n) => n.name === PERCEIVED_KEY);
      return { track: eva.garden.state().learning.objects[PERCEIVED_KEY]!, nearby };
    };
    // Still: her animated body sways while she feeds, but the body she sees does not move.
    const still = verdict(0);
    expect(still.track.samples).toBeGreaterThanOrEqual(10);
    expect(still.track.external_motion).toBe(0);
    expect(still.nearby?.independent).toBe(false);
    // Circling 6 mm around the same point at 1.5 rad/s: her own threshold calls it independent.
    const moving = verdict(1.5);
    expect(moving.track.samples).toBeGreaterThanOrEqual(10);
    expect(moving.track.external_motion).toBeGreaterThan(0.0003);
    expect(moving.nearby?.independent).toBe(true);
  }, 120_000);

  it("perceives the other only within one ommatidium's reach, under a key that names no one", () => {
    expect(EVA_PERCEPTION_M).toBeGreaterThan(0.03);
    expect(EVA_PERCEPTION_M).toBeLessThan(0.045);
    expect(PERCEIVED_KEY).not.toMatch(/eva|echo|fly-|research|04f8|5cf4/i);
    // At a place, a 3D offset along the place's own staging axes maps back exactly.
    const [du, dv] = localOffset("pear", [0, 0, 0]);
    expect(Math.hypot(du, dv)).toBeLessThan(1e-12);
  });

  it("refuses originals and non-research ids", () => {
    const commons = new Commons(gardenCommonsWorld());
    for (const lifeId of [EVA.id, ECHO.id, "eva-kind-1"])
      expect(
        () =>
          new EvaOccupant({
            lifeId,
            seed: "x",
            bornAt: BORN,
            chemistry: null,
            commons,
            index: 0,
          }),
      ).toThrow();
  });
});
