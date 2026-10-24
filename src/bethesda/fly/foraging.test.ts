import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import { circuitAdapter, type CircuitController } from "./circuits/controller";
import { DigitalFly } from "./fly";
import { initialNavigation, Navigator, PLACE_MISSES } from "./navigation";
import {
  COMMANDABLE,
  validateCommand,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "./neural";
import { resolveParams } from "./params";
import { Senses, type SenseFrame } from "./senses";
import { degToRad, wrapAngle, yawOf, type V3 } from "./units";
import {
  ODOUR_LENGTH_M,
  PrimitiveWorld,
  type Box,
  type PrimitiveWorldSpec,
} from "./world";

const P = resolveParams();

/** The wall that shades the yard's strip from z −5.8 to 0.2 under its sun. */
const SHADING: Box = {
  kind: "wall",
  id: "wall",
  center: [0, 3, -6],
  half: [10, 3, 0.2],
  angle: 0,
};
/** A screen between the fruit and the yard's east side. */
const SCREEN: Box = {
  kind: "wall",
  id: "screen",
  center: [5, 1, 0],
  half: [0.1, 1, 3],
  angle: 0,
};

/** A 20 m yard with one patch of fruit; with `sun`, a wall shades a strip of it. */
const yard = (o: { sun?: boolean; wall?: boolean } = {}): PrimitiveWorldSpec => ({
  id: "yard",
  home: {
    center: [0, 0, 0],
    radius: 10,
    ceiling: 6,
    bounds: { min: { x: -10, z: -10 }, max: { x: 10, z: 10 } },
  },
  inputs: { supported: ["food"], proxies: [], unsupported: [] },
  ground: () => 0,
  groundMax: 0,
  ambient: 1,
  food: [
    { id: "fruit", kind: "fruit", center: [3, 0, 0], surface: "ground", radius: 0.25 },
  ],
  boxes: [...(o.sun ? [SHADING] : []), ...(o.wall ? [SCREEN] : [])],
  // The sun stands 45° up toward −z: the wall shades the ground from z −5.8 to 0.2.
  ...(o.sun
    ? { sun: { toward: [0, Math.SQRT1_2, -Math.SQRT1_2], level: 1, shade: 0.35 } }
    : {}),
});

/** A decision maker for tests: `decide` gets the same frozen input the built-in one does. */
const adapter = (decide: (input: DecisionInput) => MotorCommand): FlyNeuralAdapter => ({
  descriptor: {
    id: "test",
    label: "test",
    fidelity: "test",
    simulatesNeurons: false,
    regions: [],
  },
  decide,
});

const run = (
  fly: DigitalFly,
  seconds: number,
  each?: (f: DigitalFly) => boolean | void,
) => {
  for (let k = 0; k < Math.round(seconds * 10); k++) {
    fly.advance(0.1);
    if (each?.(fly)) return;
  }
};

describe("food, odour and energy", () => {
  it("tastes food only on a patch, and smells it falling off with distance but not through a wall", () => {
    const world = new PrimitiveWorld(yard({ wall: true }));
    expect(world.foodAt([3.1, 0, 0.1])?.id).toBe("fruit");
    expect(world.foodAt([3.3, 0, 0])).toBeNull();
    expect(world.foodAt([3, 0.05, 0])).toBeNull();
    // In the open the odour is e^(−d/λ) from the patch.
    for (const p of [
      [0, 0.5, 0],
      [3, 1, 4],
      [-6, 2, 3],
    ] as const) {
      const d = Math.hypot(p[0] - 3, p[1], p[2]);
      expect(world.odour([...p])).toBeCloseTo(Math.exp(-d / ODOUR_LENGTH_M), 12);
    }
    // Behind the screen at x = 5 nothing arrives; round its end it does.
    expect(world.odour([7, 0.5, 0])).toBe(0);
    expect(world.odour([7, 0.5, 8])).toBeGreaterThan(0);
    expect(world.odour([3, 0.5, 40])).toBe(0);
  });
  it("lets a fly feed only with food under its feet, and only from standing", () => {
    const world = new PrimitiveWorld(yard());
    const body: BodySnapshot = {
      t: 0,
      mode: "rest",
      sub: "",
      modeT: 0,
      p: [3, 0.001, 0],
      v: [0, 0, 0],
      yaw: 0,
      altitude: 0.001,
      walkSpeed: 0,
      flightT: 0,
      flightBout: 0,
      responsiveness: 1,
      groom: null,
      edge: false,
      target: null,
      standingHeight: 0.001,
      reserve: 0.5,
      onFood: "fruit",
      home: world.home,
    };
    const ctx = {
      sites: [],
      surface: () => null,
      food: (p: V3) => world.foodAt(p),
    };
    const feed = { mode: "feed", reason: "x" };
    expect(validateCommand(feed, body, P, ctx).ok).toBe(true);
    expect(validateCommand(feed, { ...body, mode: "walk" }, P, ctx).ok).toBe(true);
    expect(validateCommand(feed, { ...body, p: [0, 0.001, 0] }, P, ctx)).toEqual({
      ok: false,
      reason: "no food under the fly",
    });
    // Without a world to taste, nothing is food.
    expect(validateCommand(feed, body, P, { sites: [], surface: () => null }).ok).toBe(
      false,
    );
    for (const mode of ["groom", "takeoff", "escape", "flight", "land"] as const)
      expect(COMMANDABLE[mode]).not.toContain("feed");
  });
  it("spends its reserve at its mode's power and refills it by feeding, never past full", () => {
    const world = new PrimitiveWorld(yard());
    const full = P.reserveJ;
    // Fed for 30 s on the patch, then rests for 100 s.
    const fly = new DigitalFly({
      seed: 1,
      world,
      start: { p: [3, 0.0011, 0], yaw: 0 },
      config: { startReserve: 0.5 },
      adapter: () =>
        adapter((input) =>
          input.body.t < 30
            ? { mode: "feed", reason: "feeding" }
            : { mode: "rest", reason: "resting" },
        ),
    });
    run(fly, 30);
    const fed = fly.state.reserve;
    expect(fed - 0.5 * full).toBeCloseTo(
      ((P.feedIntakeMw - P.restPowerMw) / 1000) * 30,
      4,
    );
    expect(fly.state.counts.meals).toBe(1);
    expect(fly.state.counts.feedS).toBeCloseTo(30, 1);
    run(fly, 100);
    expect(fed - fly.state.reserve).toBeCloseTo((P.restPowerMw / 1000) * 100, 4);
    // Nearly full, a meal tops the reserve up and no further.
    const topped = new DigitalFly({
      seed: 1,
      world,
      start: { p: [3, 0.0011, 0], yaw: 0 },
      config: { startReserve: 0.999 },
      adapter: () => adapter(() => ({ mode: "feed", reason: "feeding" })),
    });
    run(topped, 30);
    expect(topped.state.reserve).toBe(full);
    // Flight costs its own power.
    const flier = new DigitalFly({
      seed: 1,
      world,
      start: { p: [-5, 1.5, 0], yaw: 0, mode: "flight", v: [0.3, 0, 0] },
      adapter: () =>
        adapter(() => ({ mode: "flight", velocity: [0.3, 0, 0], reason: "cruise" })),
    });
    run(flier, 10);
    expect(full - flier.state.reserve).toBeCloseTo((P.flightPowerMw / 1000) * 10, 4);
    expect(flier.state.counts.spentJ).toBeCloseTo(full - flier.state.reserve, 12);
  });
  it("finds food by its odour when hungry, and leaves it alone when fed", () => {
    for (const seed of [1, 2, 3]) {
      const hungry = new DigitalFly({
        seed,
        world: new PrimitiveWorld(yard()),
        start: { p: [-3, 0.0011, 0], yaw: 0 },
        config: { startReserve: 0.5 },
      });
      run(hungry, 300, (f) => f.state.mode === "feed");
      expect(hungry.state.mode).toBe("feed");
      expect(hungry.state.counts.rejected).toBe(0);
      const fed = new DigitalFly({
        seed,
        world: new PrimitiveWorld(yard()),
        start: { p: [-3, 0.0011, 0], yaw: 0 },
      });
      run(fed, 600);
      expect(fed.state.counts.meals).toBe(0);
    }
  }, 60_000);
  it("stops feeding to groom when dust lands on it, under the circuit-informed controller", () => {
    const fly = new DigitalFly({
      seed: 2,
      world: new PrimitiveWorld(yard()),
      start: { p: [3, 0.0011, 0], yaw: 0 },
      config: { startReserve: 0.5 },
      adapter: circuitAdapter({ seed: 2 }),
    });
    run(fly, 30, (f) => f.state.mode === "feed");
    expect(fly.state.mode).toBe("feed");
    const circuit = fly.adapter as CircuitController;
    circuit.grooming.dust({ head: 4 * circuit.circuitParams.groomDriveDust });
    run(fly, 5, (f) => f.state.mode === "groom");
    expect(fly.state.mode).toBe("groom");
    expect(fly.state.counts.rejected).toBe(0);
  });
  it("sees shade on the ground in flight, under a sun", () => {
    const sunny = new PrimitiveWorld(yard({ sun: true }));
    const look = (world: PrimitiveWorld, yaw: number, flying = true) =>
      new Senses(world, P, 0, mulberry32(1)).sample({
        t: 0,
        p: [0, 1, 2.8],
        v: [0, 0, 0],
        yaw,
        flying,
      }).shadeBearing;
    // Facing −z the shade begins 2.6 m ahead: on the outer ring, straight ahead.
    expect(look(sunny, Math.PI / 2)).toBe(0);
    // Facing +x it is to the left: the outer ring's direction nearest ahead that holds shade.
    expect(look(sunny, 0)).toBeCloseTo(degToRad(45), 12);
    expect(look(sunny, Math.PI / 2, false)).toBeNull();
    expect(look(new PrimitiveWorld(yard()), Math.PI / 2)).toBeNull();
  });
  it("rests in shade when it is not hungry, far more than the shade's share of the ground", () => {
    let shade = 0,
      sun = 0;
    for (const seed of [1, 2, 3]) {
      const world = new PrimitiveWorld(yard({ sun: true }));
      const fly = new DigitalFly({
        seed,
        world,
        start: { p: [-3, 0.0011, 4], yaw: 0 },
        // Never hungry here, so it never forages instead.
        config: { hungerSeek: 0.95 },
      });
      run(fly, 1200, (f) => {
        const s = f.state;
        if (s.mode !== "rest" && s.mode !== "groom") return;
        if (world.light([s.p[0], s.p[1] - 0.001, s.p[2]]).sunlit) sun++;
        else shade++;
      });
      expect(fly.state.counts.rejected).toBe(0);
    }
    // The wall shades 30 % of the yard.
    expect(shade / (shade + sun)).toBeGreaterThan(0.6);
  }, 60_000);
});

describe("navigation and memory", () => {
  const frame = (o: Partial<SenseFrame> = {}): SenseFrame =>
    ({ sky: true, lightBearing: null, landmarks: [], odour: 0, ...o }) as SenseFrame;
  const walkEast = (nav: Navigator, seconds: number, f: SenseFrame, t0 = 0) => {
    for (let k = 0; k < seconds / 0.05; k++)
      nav.integrate([0.3, 0, 0], 0.05, f, P, t0 + k * 0.05, "walk");
  };
  it("integrates its path, its heading error held by the sky and wandering without it", () => {
    let withSky = 0,
      without = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const lit = new Navigator(initialNavigation(0, 0), mulberry32(seed));
      let worst = 0;
      for (let k = 0; k < 2000; k++) {
        lit.integrate([0.3, 0, 0], 0.05, frame(), P, k * 0.05, "walk");
        worst = Math.max(worst, Math.abs(lit.state.headingErr));
      }
      // With the compass the error never builds up: at most two noise spreads.
      expect(worst).toBeLessThanOrEqual(degToRad(P.compassNoiseDeg) + 1e-12);
      withSky += Math.abs(lit.state.headingErr);
      const dark = new Navigator(initialNavigation(0, 0), mulberry32(seed));
      walkEast(dark, 100, frame({ sky: false }));
      without += Math.abs(dark.state.headingErr);
      // 30 m east by the estimate, give or take its odometry error.
      expect(Math.hypot(...lit.state.est)).toBeGreaterThan(
        30 * (1 - 3 * P.odometryNoise),
      );
    }
    expect(without / 10).toBeGreaterThan(5 * (withSky / 10));
  });
  it("remembers where it fed, knows the place again by its landmarks, and forgets it", () => {
    const nav = new Navigator(initialNavigation(0, 0), mulberry32(1));
    const pole = { id: "pole-1", bearing: 0.5, distance: 3 };
    nav.rememberFood("fruit", frame({ landmarks: [pole] }), 0);
    expect(nav.state.places).toHaveLength(1);
    nav.state.est = [5, -4];
    // Another landmark says nothing; the remembered one puts the fly right.
    expect(
      nav.recognize(frame({ landmarks: [{ ...pole, id: "pole-2" }] }), 0, 0, 10),
    ).toBeNull();
    expect(nav.state.est).toEqual([5, -4]);
    expect(nav.recognize(frame({ landmarks: [pole] }), 1, 2, 10)?.what).toBe("fruit");
    expect(nav.state.est).toEqual([1, 2]);
    // Coming back and finding nothing, often enough, forgets it.
    for (let k = 0; k < PLACE_MISSES; k++) nav.missed();
    expect(nav.state.places).toHaveLength(0);
    // And so does time.
    nav.rememberFood("fruit", frame({ landmarks: [pole] }), 20);
    nav.integrate([0, 0, 0], 0.05, frame(), P, 20 + P.placeMemoryS - 1, "rest");
    expect(nav.state.places).toHaveLength(1);
    nav.integrate([0, 0, 0], 0.05, frame(), P, 20 + P.placeMemoryS + 1, "rest");
    expect(nav.state.places).toHaveLength(0);
  });
  const open = {
    center: [0, 0, 0] as [number, number, number],
    radius: 400,
    ceiling: 20,
    bounds: { min: { x: -400, z: -400 }, max: { x: 400, z: 400 } },
  };
  it("flies to remembered food when hungry, and only if it is far enough to fly to", () => {
    const home = open;
    const nav = new Navigator(initialNavigation(0, 0), mulberry32(1));
    nav.rememberFood("fruit", frame(), 0);
    nav.state.est = [3, 0];
    // Within RETURN_MIN_M it is searched for on foot, not flown to.
    expect(nav.chooseGoal(true, home, P, 1, { x: 3, z: 0 }, true)?.kind).not.toBe(
      "return",
    );
    nav.state.est = [8, 0];
    const back = nav.chooseGoal(true, home, P, 1, { x: 8, z: 0 }, true);
    expect(back?.kind).toBe("return");
    expect(back?.at).toEqual([0, 0]);
    // Not hungry, it explores instead.
    expect(nav.chooseGoal(false, home, P, 1, { x: 8, z: 0 }, true)?.kind).toBe("explore");
  });
  it("aims long flights where it has been least, inside its extent, and not where one stalled", () => {
    const home = open;
    const nav = new Navigator(initialNavigation(0, 0), mulberry32(3));
    // It has been all over a block east of here, 300 m long and 100 m wide (10 m cells).
    for (let i = 0; i < 30; i++)
      for (let j = -5; j < 5; j++) nav.state.visited.push([`${i},${j}`, 0]);
    let east = 0;
    for (let k = 0; k < 200; k++) {
      // A drawn distance under 2 m makes no long flight.
      const g = nav.chooseGoal(false, home, P, 0, { x: 0, z: 0 }, true);
      if (!g) continue;
      const heading = yawOf(g.at[0], g.at[1]);
      if (Math.abs(wrapAngle(heading)) < Math.PI / 8) east++;
      // Inside the extent, judged from where the fly truly is.
      expect(Math.abs(g.at[0])).toBeLessThanOrEqual(400);
      expect(Math.abs(g.at[1])).toBeLessThanOrEqual(400);
    }
    expect(east).toBe(0);
    // A heading that stalled here is not tried again soon.
    const fresh = new Navigator(initialNavigation(0, 0), mulberry32(4));
    const first = fresh.chooseGoal(false, home, P, 0, { x: 0, z: 0 }, true)!;
    const blocked = yawOf(first.at[0], first.at[1]);
    fresh.stalled(1);
    expect(fresh.state.goal).toBeNull();
    for (let k = 0; k < 200; k++) {
      const g = fresh.chooseGoal(false, home, P, 2, { x: 0, z: 0 }, true);
      if (g)
        expect(Math.abs(wrapAngle(yawOf(g.at[0], g.at[1]) - blocked))).toBeGreaterThan(
          Math.PI / 8,
        );
    }
    // In an arena too small for a long flight there is none.
    const small = {
      center: [0, 0, 0] as [number, number, number],
      radius: 0.5,
      ceiling: 1,
    };
    for (let k = 0; k < 50; k++)
      expect(fresh.chooseGoal(false, small, P, 2, { x: 0, z: 0 }, true)).toBeNull();
  });
});
