import { describe, expect, it } from "vitest";
import { CitySimulation } from "../simulation";
import { buildings } from "../model";
import { groundAt } from "../terrain";
import { arenaWorld, type ArenaSpec } from "./arena";
import { BethesdaFlyWorld } from "./bethesdaWorld";
import type { ReducedOrderController } from "./controller";
import { DigitalFly } from "./fly";
import type { FlyNeuralAdapter, MotorCommand } from "./neural";
import { forward, left, type V3 } from "./units";
import {
  heightShare,
  shelterShare,
  stormShare,
  WEATHER_MODEL,
  WIND_REGIMES,
  windAt,
  type StormWindow,
} from "./weather";
import type { FlyWorld } from "./world";

const SEED = 393977;
const config = {
  seed: SEED,
  pedestrians: 30,
  vehicles: 10,
  buses: 2,
  statisticalPopulation: 120,
};
const ROOM: ArenaSpec = {
  size: [40, 6, 40],
  ambient: 0.8,
  lights: [{ at: [0, 5.5, 0], intensity: 2 }],
};
/** A decision maker that asks for the same flight every time. */
const holding = (command: Omit<MotorCommand, "mode" | "reason">): FlyNeuralAdapter => ({
  descriptor: {
    id: "hold",
    label: "hold",
    fidelity: "test",
    simulatesNeurons: false,
    regions: [],
  },
  decide: () => ({ mode: "flight", ...command, reason: "holding" }),
});
/** An arena with a steady wind blowing toward `toward` (world x, z) at `speed` m/s. */
function windy(speed: number, toward: [number, number] = [0, 1]): FlyWorld {
  const n = Math.hypot(...toward);
  const v: V3 = [(toward[0] / n) * speed, 0, (toward[1] / n) * speed];
  return Object.assign(arenaWorld(ROOM, "windy"), { wind: () => v });
}

describe("the city's wind", () => {
  it("is a function of the seed and the time alone", () => {
    const times = [0, 0.37, 61.5, 3599.99, 86_400 * 3 + 12.25];
    const forward = times.map((t) => windAt(SEED, t));
    const backward = [...times].reverse().map((t) => windAt(SEED, t));
    expect(backward.reverse()).toEqual(forward);
    expect(windAt(SEED + 1, 61.5)).not.toEqual(windAt(SEED, 61.5));
  });

  it("never jumps, never blows backward and stays a plausible wind", () => {
    const storms: StormWindow[] = [{ from: 2000, to: 2600 }];
    let jump = 0,
      turn = 0,
      top = 0;
    for (let t = 0; t < 6 * 3600; t += 0.73) {
      const a = windAt(SEED, t, storms),
        b = windAt(SEED, t + 1e-4, storms);
      expect(a.speedMS).toBeGreaterThanOrEqual(0);
      expect(Math.abs(a.from)).toBeLessThanOrEqual(Math.PI);
      jump = Math.max(jump, Math.abs(b.speedMS - a.speedMS));
      turn = Math.max(turn, Math.abs(Math.sin(b.from - a.from)));
      top = Math.max(top, a.speedMS);
    }
    // Over 0.1 ms the steepest gust moves the speed by a few mm/s; a jump would show.
    expect(jump).toBeLessThan(0.01);
    expect(turn).toBeLessThan(1e-4);
    expect(top).toBeLessThan(30);
  });

  it("draws each half hour's regime with its weight", () => {
    const n = 4000;
    const counts = { calm: 0, breezy: 0, windy: 0, storm: 0 };
    for (let b = 0; b < n; b++)
      counts[windAt(SEED, b * WEATHER_MODEL.blockS + 60).regime]++;
    expect(counts.storm).toBe(0);
    for (const r of ["calm", "breezy", "windy"] as const)
      expect(Math.abs(counts[r] / n - WEATHER_MODEL.regimeWeights[r])).toBeLessThan(0.03);
  });

  it("gusts at about the regimes' rates, each a rise and a fall", () => {
    const hours = 20;
    let onsets = 0,
      was = false,
      peak = 0;
    for (let t = 0; t < hours * 3600; t += 0.5) {
      const w = windAt(SEED, t);
      if (w.gusting && !was) onsets++;
      was = w.gusting;
      peak = Math.max(peak, w.speedMS);
    }
    const w = WEATHER_MODEL.regimeWeights;
    const perMin =
      w.calm * WIND_REGIMES.calm.gustsPerMin +
      w.breezy * WIND_REGIMES.breezy.gustsPerMin +
      w.windy * WIND_REGIMES.windy.gustsPerMin;
    // Gusts that overlap merge, so a few less than drawn.
    expect(onsets / (hours * 60)).toBeGreaterThan(perMin * 0.7);
    expect(onsets / (hours * 60)).toBeLessThan(perMin * 1.15);
    // The gustiest moment: windy, its fluctuations high, and the largest gust.
    expect(peak).toBeLessThan(
      WIND_REGIMES.windy.speedMS *
        (1 + WEATHER_MODEL.slowShare + WEATHER_MODEL.fastShare) *
        (1 + (WIND_REGIMES.windy.gustFactor - 1) * 1.4),
    );
  });

  it("rises to the storm regime while the city has a storm, and only then", () => {
    const storm: StormWindow = { from: 5000, to: 5900 };
    for (const t of [10, 4999, 5900, 5901, 9000])
      expect(windAt(SEED, t, [storm])).toEqual(windAt(SEED, t));
    expect(stormShare(5000 + WEATHER_MODEL.stormRampS / 2, [storm])).toBeCloseTo(0.5, 9);
    expect(stormShare(5450, [storm])).toBe(1);
    let sum = 0,
      n = 0;
    for (let t = 5100; t < 5800; t += 1) {
      const w = windAt(SEED, t, [storm]);
      expect(w.regime).toBe("storm");
      sum += w.speedMS;
      n++;
    }
    expect(sum / n).toBeGreaterThan(WIND_REGIMES.storm.speedMS * 0.8);
    expect(sum / n).toBeLessThan(WIND_REGIMES.storm.speedMS * 1.6);
  });

  it("is weaker near the ground and in the lee", () => {
    expect(heightShare(10)).toBe(1);
    expect(heightShare(0)).toBe(heightShare(WEATHER_MODEL.heightFloorM));
    expect(heightShare(1)).toBeLessThan(heightShare(2));
    expect(heightShare(40)).toBeGreaterThan(1);
    expect(shelterShare(0)).toBe(WEATHER_MODEL.shelterKeep);
    expect(shelterShare(WEATHER_MODEL.shelterM / 2)).toBeCloseTo(
      (1 + WEATHER_MODEL.shelterKeep) / 2,
      12,
    );
    expect(shelterShare(WEATHER_MODEL.shelterM)).toBe(1);
    expect(shelterShare(Infinity)).toBe(1);
  });
});

describe("the wind in the fly's Bethesda", () => {
  it("is the city's: the same at a city time whenever the fly was placed", () => {
    const sim = new CitySimulation(config);
    const early = new BethesdaFlyWorld(sim);
    for (let k = 0; k < 150; k++) sim.step();
    const late = new BethesdaFlyWorld(sim);
    // The late world's fly time 0 is the city's 15 s.
    expect(late.windNow(20)).toEqual(early.windNow(35));
    expect(early.windNow(35)).toEqual(windAt(SEED, 35));
  });

  it("blows downwind, weaker near the ground and in a building's lee", () => {
    const sim = new CitySimulation(config);
    const world = new BethesdaFlyWorld(sim);
    const t = 100;
    const now = world.windNow(t);
    expect(now.speedMS).toBeGreaterThan(0);
    const upwind: V3 = [Math.sin(now.from), 0, -Math.cos(now.from)];
    // A tall building whose centre is inside it.
    const b = [...buildings]
      .sort((x, y) => y.height - x.height)
      .find((c) => world.solid([c.center.x, groundAt(c.center) + 2, c.center.z]))!;
    // High above every roof nothing stands upwind: the 10 m wind by the height law.
    const sky: V3 = [b.center.x, groundAt(b.center) + 300, b.center.z];
    const high = world.wind(sky, t);
    expect(Math.hypot(...high)).toBeCloseTo(now.speedMS * heightShare(300), 9);
    expect(high[0] * upwind[0] + high[2] * upwind[2]).toBeLessThan(0);
    // Just downwind of the tallest building's wall, 2 m up: sheltered.
    let d = 0;
    const at = (m: number): V3 => {
      const x = b.center.x - upwind[0] * m,
        z = b.center.z - upwind[2] * m;
      return [x, groundAt({ x, z }) + 2, z];
    };
    while (world.solid(at(d))) d += 0.25;
    const lee = at(d + 1);
    const open = now.speedMS * heightShare(2);
    expect(Math.hypot(...world.wind(lee, t))).toBeLessThan(open * 0.5);
    // And just in front of its windward wall: slowed where the wind meets it.
    let e = 0;
    const front = (m: number): V3 => {
      const x = b.center.x + upwind[0] * m,
        z = b.center.z + upwind[2] * m;
      return [x, groundAt({ x, z }) + 2, z];
    };
    while (world.solid(front(e))) e += 0.25;
    expect(Math.hypot(...world.wind(front(e + 0.5), t))).toBeLessThan(open * 0.5);
  }, 60_000);
});

describe("the fly in wind", () => {
  it("feels the air at its antennae only where there is air to feel", () => {
    const still = new DigitalFly({
      seed: 3,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.01, 0], yaw: 0 },
    });
    still.advance(0.3);
    expect(still.lastFrame?.airflow).toBe(0);
    expect(still.lastFrame?.airflowFrom).toBeNull();
    // Facing east, a wind blowing south comes from its left.
    const fly = new DigitalFly({
      seed: 3,
      world: windy(2),
      start: { p: [0, 0.01, 0], yaw: 0 },
    });
    fly.advance(0.3);
    expect(fly.lastFrame?.airflow).toBeCloseTo(2, 9);
    expect(fly.lastFrame?.airflowFrom).toBeCloseTo(Math.PI / 2, 9);
  });

  it("holds its groundspeed along its body axis and drifts with a crosswind", () => {
    const fly = (world: FlyWorld) =>
      new DigitalFly({
        seed: 11,
        world,
        start: { p: [0, 2, 0], yaw: 0, mode: "flight", v: [0.3, 0, 0] },
      });
    const ground = (f: DigitalFly) => {
      f.advance(0.3);
      const s0 = f.state;
      const p0: V3 = [s0.p[0], s0.p[1], s0.p[2]],
        yaw = s0.yaw;
      f.advance(0.1);
      const s1 = f.state;
      expect(s1.mode).toBe("flight");
      expect(s1.saccade).toBeNull();
      const d: [number, number] = [s1.p[0] - p0[0], s1.p[2] - p0[2]];
      const fw = forward(yaw),
        lf = left(yaw);
      return {
        along: (d[0] * fw[0] + d[1] * fw[2]) / 0.1,
        side: (d[0] * lf[0] + d[1] * lf[2]) / 0.1,
      };
    };
    const calm = ground(fly(arenaWorld(ROOM)));
    const cross = ground(fly(windy(0.5, [0, 1])));
    // The wind blows south, to the fly's right: it is carried that way...
    expect(cross.side - calm.side).toBeCloseTo(-0.5, 1);
    // ...and holds its groundspeed along its axis.
    expect(cross.along).toBeCloseTo(calm.along, 1);
    // Into a headwind it still makes its groundspeed, with more air speed.
    const head = fly(windy(0.5, [-1, 0]));
    const into = ground(head);
    expect(into.along).toBeCloseTo(calm.along, 1);
    expect(Math.hypot(...head.state.v)).toBeGreaterThan(0.6);
  });

  it("knows where it is from its travel over the ground, the wind's part included", () => {
    const fly = new DigitalFly({
      seed: 11,
      world: windy(0.5, [0, 1]),
      start: { p: [0, 2, 0], yaw: 0, mode: "flight", v: [0.3, 0, 0] },
    });
    fly.advance(1);
    const [ex, ez] = (fly.adapter as ReducedOrderController).state.nav.est;
    const [x, , z] = fly.state.p;
    // Carried 0.5 m south in the second: the estimate went with it.
    expect(z).toBeGreaterThan(0.4);
    expect(Math.hypot(ex - x, ez - z)).toBeLessThan(0.1);
  });

  it("drops toward the surface below when the wind outruns its wings", () => {
    // Started low, a fly climbs toward its cruising height in still air; in a
    // wind twice as fast as its wings it keeps descending instead.
    const climb = (world: FlyWorld) => {
      const f = new DigitalFly({
        seed: 11,
        world,
        start: { p: [0, 0.5, 0], yaw: 0, mode: "flight", v: [0.3, 0, 0] },
      });
      f.advance(1);
      return f.state.p[1] - 0.5;
    };
    expect(climb(arenaWorld(ROOM))).toBeGreaterThan(0);
    expect(climb(windy(3))).toBeLessThan(-0.1);
  });

  it("takes off far less often in a wind it feels", () => {
    const takeoffs = (world: FlyWorld) => {
      let n = 0;
      for (const seed of [1, 2, 3]) {
        const f = new DigitalFly({ seed, world, start: { p: [0, 0.01, 0], yaw: 0 } });
        for (let k = 0; k < 6000; k++) f.advance(0.1);
        n += f.state.counts.takeoffs;
      }
      return n;
    };
    const calm = takeoffs(arenaWorld(ROOM));
    expect(calm).toBeGreaterThan(20);
    expect(takeoffs(windy(3))).toBeLessThan(calm * 0.25);
  });

  it("hovering, holds its station against the wind", () => {
    const fly = new DigitalFly({
      seed: 11,
      world: windy(0.5, [0, 1]),
      start: { p: [0, 2, 0], yaw: 0, mode: "flight", v: [0.3, 0, 0] },
      adapter: () => holding({ hover: true, velocity: [0, 0, 0] }),
    });
    fly.advance(2);
    const [x, , z] = fly.state.p;
    fly.advance(2);
    // A crosswind of 0.5 m/s would have carried it a metre.
    expect(Math.hypot(fly.state.p[0] - x, fly.state.p[2] - z)).toBeLessThan(0.02);
  });

  it("is held in a corner by the wind, touching both walls, not struck again and again", () => {
    // Flown into the room's south-east corner with the wind blowing into it.
    const fly = new DigitalFly({
      seed: 1,
      world: windy(1.2, [1, 1]),
      start: { p: [19, 2, 19], yaw: -Math.PI / 4, mode: "flight", v: [0.3, 0, 0.3] },
      adapter: () => holding({ velocity: [0.5, 0, 0.5] }),
    });
    fly.advance(4);
    expect(fly.state.contact).not.toBeNull();
    expect(fly.state.counts.collisions).toBe(1);
    // The walls stop it over the ground, not the air going by: it feels the wind.
    expect(fly.lastFrame?.airflow).toBeCloseTo(1.2, 1);
  });

  it("lands when the wind outpaces its wings", () => {
    // Into a wind that is 4 m/s at 10 m and weaker toward the floor.
    const fly = (world: FlyWorld) => {
      const f = new DigitalFly({
        seed: 1,
        world,
        start: { p: [0, 2, 0], yaw: Math.PI / 2, mode: "flight", v: [0, 0, -0.3] },
      });
      for (let k = 0; k < 200 && f.state.counts.landings === 0; k++) f.advance(0.1);
      return f;
    };
    const outpaced = (f: DigitalFly) =>
      f.log.find((r) => r.reason.startsWith("the wind outpaces its wings"));
    const gusty = fly(
      Object.assign(arenaWorld(ROOM, "windy"), {
        wind: (p: V3): V3 => [0, 0, 4 * heightShare(p[1])],
      }),
    );
    expect(outpaced(gusty)?.t).toBeLessThan(3);
    expect(gusty.state.counts.landings).toBe(1);
    expect(outpaced(fly(arenaWorld(ROOM)))).toBeUndefined();
  }, 120_000);
});
