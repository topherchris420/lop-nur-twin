import { describe, expect, it } from "vitest";
import { arenaWorld } from "../../fly/arena";
import { DigitalFly } from "../../fly/fly";
import type { DecisionInput, FlyNeuralAdapter, MotorCommand } from "../../fly/neural";
import type { V3 } from "../../fly/units";
import { PlasticityOrganismAdapter } from "../../life/plasticOrganism";
import { ECHO, EVA } from "../originals";
import type { SurfaceChemistry } from "../socialSensing";
import {
  Commons,
  COMMONS_MOVER_ID,
  ENCOUNTER_GAP_M,
  FLY_BODY_RADIUS_M,
  verifyCommonsRecord,
  type SocialPort,
  type TouchSample,
} from "./commons";
import { gardenCommonsWorld } from "./garden";
import { FlyOccupant } from "./occupants";

const ARENA = {
  size: [0.4, 0.3, 0.4] as V3,
  ambient: 1,
  lights: [{ at: [0, 0.3, 0] as V3, intensity: 1 }],
};
const CHEM: SurfaceChemistry = [0.6, 0.2, 0.5, 0.1];

/** A test fixture, not a subject: walks straight ahead at a fixed speed, forever. */
class Walker implements FlyNeuralAdapter {
  readonly descriptor = {
    id: "test-walker",
    label: "test walker",
    fidelity: "fixture",
    simulatesNeurons: false,
    regions: [],
  };
  constructor(private readonly speedCmS: number) {}
  decide(_input: DecisionInput): MotorCommand {
    return { mode: "walk", walkSpeed: this.speedCmS, yawRate: 0, reason: "fixture" };
  }
}

class Recorder implements SocialPort {
  readonly samples: TouchSample[] = [];
  releases = 0;
  touch(s: TouchSample): void {
    this.samples.push(s);
  }
  release(): void {
    this.releases++;
  }
}

function organism(
  seed: number,
  world: DigitalFly["world"],
  start: { p: V3; yaw: number },
) {
  return new DigitalFly({
    seed,
    world,
    start,
    config: { startReserve: 0.6 },
    adapter: (rng, streams) =>
      new PlasticityOrganismAdapter(rng, streams, seed, "active"),
  });
}

function trace(fly: DigitalFly) {
  const s = fly.state;
  return { t: s.t, p: [...s.p], yaw: s.yaw, mode: s.mode, reserve: s.reserve };
}

describe("the commons", () => {
  it("steps a lone occupant exactly as its bare world would, physiology included", () => {
    const start = { p: [0.2, 0.3, 0.9] as V3, yaw: 1.1 };
    const bare = new FlyOccupant({
      id: "research-bare",
      fly: organism(31, gardenCommonsWorld(), start),
      chemistry: CHEM,
    });
    const commons = new Commons(gardenCommonsWorld());
    const alone = new FlyOccupant({
      id: "research-alone",
      fly: organism(31, commons.view(0), start),
      chemistry: CHEM,
    });
    commons.join(0, alone);
    for (let k = 0; k < 6000; k++) {
      bare.step(commons.stepS);
      commons.step();
      if (k % 500 === 499) expect(trace(alone.fly)).toEqual(trace(bare.fly));
    }
    expect(alone.maintenanceJ).toBe(bare.maintenanceJ);
    expect(alone.fly.log).toEqual(bare.fly.log);
  }, 60_000);

  it("never lets two bodies overlap or pass through each other, and delivers touch to both", () => {
    const commons = new Commons(arenaWorld(ARENA));
    const ports = [new Recorder(), new Recorder()];
    const starts = [
      { p: [-0.01, 0.01, 0] as V3, yaw: 0 },
      { p: [0.01, 0.01, 0] as V3, yaw: Math.PI },
    ];
    const flies = [0, 1].map((i) => {
      const fly = new DigitalFly({
        seed: 5 + i,
        world: commons.view(i as 0 | 1),
        start: starts[i]!,
        adapter: () => new Walker(1.5),
      });
      commons.join(
        i as 0 | 1,
        new FlyOccupant({
          id: `research-walker-${i}`,
          fly,
          chemistry: CHEM,
          port: ports[i]!,
        }),
      );
      return fly;
    });
    let min = Infinity;
    for (let k = 0; k < 800; k++) {
      commons.step();
      const a = flies[0]!.state.p,
        b = flies[1]!.state.p;
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      expect(a[0]).toBeLessThan(b[0]);
    }
    expect(min).toBeGreaterThanOrEqual(2 * FLY_BODY_RADIUS_M - 1e-6);
    expect(min).toBeLessThan(2 * FLY_BODY_RADIUS_M + ENCOUNTER_GAP_M);
    for (const [i, port] of ports.entries()) {
      expect(port.samples.length).toBeGreaterThan(0);
      expect(port.samples[0]!.onset).toBe(true);
      // Each was touched on its front: the other walked into its face.
      expect(Math.abs(port.samples.at(-1)!.bearing)).toBeLessThan(0.3);
      expect(port.samples[0]!.chemistry).toEqual(CHEM);
      expect(Object.keys(port.samples[0]!).sort()).toEqual([
        "bearing",
        "chemistry",
        "dt",
        "onset",
        "t",
      ]);
      expect(i === 0 ? flies[0]!.state.p[0] : flies[1]!.state.p[0]).toBeDefined();
    }
    expect(commons.openBout).not.toBeNull();
  });

  it("shows the eyes the other at its own size and keeps it out of eye rays", () => {
    const commons = new Commons(arenaWorld(ARENA));
    const flies = [0, 1].map((i) => {
      const fly = new DigitalFly({
        seed: 9 + i,
        world: commons.view(i as 0 | 1),
        start: { p: [i === 0 ? -0.02 : 0.02, 0.01, 0] as V3, yaw: i === 0 ? 0 : Math.PI },
      });
      commons.join(
        i as 0 | 1,
        new FlyOccupant({ id: `research-eye-${i}`, fly, chemistry: null }),
      );
      return fly;
    });
    const view = commons.view(0);
    const p = flies[0]!.state.p,
      q = flies[1]!.state.p;
    const movers: Parameters<typeof view.movers>[2] = [];
    view.movers(p, 1, movers, 0);
    const other = movers.filter((m) => m.id === COMMONS_MOVER_ID);
    expect(other).toHaveLength(1);
    expect(other[0]!.kind).toBe("stimulus");
    expect(other[0]!.radius).toBeCloseTo(FLY_BODY_RADIUS_M, 12);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const dir: V3 = [(q[0] - p[0]) / d, (q[1] - p[1]) / d, (q[2] - p[2]) / d];
    const eye = view.raycast(p, dir, d, true);
    expect(eye === null || eye.t >= d).toBe(true);
    const body = view.raycast(p, dir, d, false);
    expect(body).not.toBeNull();
    expect(body!.t).toBeCloseTo(d - 2 * FLY_BODY_RADIUS_M, 9);
    expect(view.solid(q)).toBe(true);
    expect(view.solid(p)).toBe(false);
    // The bare world knows nothing of either.
    expect(commons.world.solid(q)).toBe(false);
  });

  it("is deterministic, and its record is hash-chained", () => {
    const run = () => {
      const commons = new Commons(gardenCommonsWorld());
      const flies = [0, 1].map((i) => {
        const fly = organism(70 + i, commons.view(i as 0 | 1), {
          p: [0.6 + 0.01 * i, 0.3, 0.2] as V3,
          yaw: i,
        });
        commons.join(
          i as 0 | 1,
          new FlyOccupant({ id: `research-det-${i}`, fly, chemistry: CHEM }),
        );
        return fly;
      });
      commons.run(30);
      return { record: commons.record, flies: flies.map(trace) };
    };
    const a = run(),
      b = run();
    expect(a).toEqual(b);
    expect(verifyCommonsRecord(a.record)).toBeNull();
    const tampered = a.record.map((e) => ({ ...e }));
    tampered[0] = { ...tampered[0]!, t: 1 };
    expect(verifyCommonsRecord(tampered)).toBe(0);
  }, 60_000);

  it("admits research subjects only, never an original", () => {
    const commons = new Commons(arenaWorld(ARENA));
    const fly = new DigitalFly({
      seed: 1,
      world: commons.view(0),
      start: { p: [0, 0.01, 0], yaw: 0 },
    });
    for (const id of [EVA.id, ECHO.id, `research-${ECHO.id.slice(0, 8)}`, "subject-1"])
      expect(() =>
        commons.join(0, new FlyOccupant({ id, fly, chemistry: null })),
      ).toThrow();
    commons.join(0, new FlyOccupant({ id: "research-ok", fly, chemistry: null }));
    expect(() =>
      commons.join(0, new FlyOccupant({ id: "research-ok-2", fly, chemistry: null })),
    ).toThrow(/taken/);
  });
});
