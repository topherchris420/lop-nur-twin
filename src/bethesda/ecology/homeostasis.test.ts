/**
 * Stage B: the ecology's water (springs, canopies, spreading, drinking,
 * vapour), mortal research bodies' homeostasis, and the feedback policies.
 */
import { describe, expect, it } from "vitest";
import type { DecisionInput, FlyNeuralAdapter, MotorCommand } from "../fly/neural";
import { Ecosystem, referenceYard, type EcosystemSpec } from "./ecosystem";
import {
  Homeostasis,
  homeostasisParam,
  saturationKPa,
  type BodyContext,
} from "./homeostasis";
import { cloneEcosystem, EcologicalLife, replay, spinUp } from "./life";
import { P } from "./params";
import { HOT_C, HomeostaticAdapter, THIRSTY } from "./policy";

const HOUR = 3_600;

/** A small hot, dry yard with one spring under a canopy (a test world, not a study's). */
function dryYard(seed: number): EcosystemSpec {
  return {
    seed,
    startHour: 8,
    windHeading: Math.PI / 4,
    half: 10,
    climate: { meanTempC: 28, dailyTempAmpC: 5, humidityShift: -0.2, rainThreshold: 1.1 },
    trees: [
      { id: "tree-a", x: -5, z: -4, canopyM: 2.5 },
      { id: "tree-c", x: 6, z: 5, canopyM: 2.5 },
    ],
    flowers: [{ id: "flower-1", x: -2, z: 3 }],
    rocks: [{ id: "rock-1", x: 2, z: -2, half: 0.6, height: 0.4 }],
    springs: [{ id: "spring-1", x: 6.6, z: 4.2, inflowMmPerS: 0.003 }],
  };
}

function waterBooks(e: Ecosystem): number {
  const w = e.water;
  return w.rained + w.sprung - w.evaporated - w.drained - w.drunk - e.waterStock();
}

describe("the ecology's water", () => {
  it(
    "a spring wets a patch around it, kept in books that close",
    { timeout: 120_000 },
    () => {
      const e = new Ecosystem(dryYard(3));
      e.run(6 * HOUR);
      const c = e.cellAt(6.6, 4.2);
      expect(e.soil[c]).toBeGreaterThan(2);
      expect(e.soilWaterAt(6.6 + 0.5, 4.2)).toBeGreaterThan(0.1);
      expect(e.soilWaterAt(-8, -8)).toBeLessThan(1e-9);
      expect(e.water.sprung).toBeGreaterThan(0);
      expect(Math.abs(waterBooks(e))).toBeLessThan(
        1e-9 * (e.water.rained + e.water.sprung),
      );
      const v = e.vapour.books;
      expect(
        Math.abs(v.emitted + v.rounding - v.lost - v.out - e.vapour.total()),
      ).toBeLessThan(1e-9 * v.emitted);
    },
  );

  it("caps a flower's nectar in sugar, not only volume", { timeout: 120_000 }, () => {
    const e = new Ecosystem(referenceYard(42), { transport: false });
    e.run(10 * 86_400);
    const cap = P("nectarMaxUl") * P("nectarSugarMgPerUl");
    for (const f of e.flowers) expect(f.sugarMg).toBeLessThanOrEqual(cap + 1e-12);
  });

  it("drinking takes a cell's water, booked, up to what it holds", () => {
    const e = new Ecosystem(dryYard(3), { transport: false });
    e.run(HOUR);
    const c = e.cellAt(6.6, 4.2);
    const held = e.soil[c]!;
    expect(e.drink(c, held / 2, "research-test")).toBeCloseTo(held / 2, 12);
    expect(e.drink(c, held, "research-test")).toBeCloseTo(held / 2, 12);
    expect(e.soil[c]).toBe(0);
    expect(Math.abs(waterBooks(e))).toBeLessThan(1e-9 * (e.water.sprung + 1));
    expect(() => e.drink(e.cellAt(2, -2), 1, "research-test")).toThrow(/open cell/);
  });

  it("an ecosystem copied mid-life is the same ecosystem", { timeout: 120_000 }, () => {
    const a = spinUp(dryYard(5), HOUR);
    const b = cloneEcosystem(a);
    expect(b.stateHash()).toBe(a.stateHash());
    a.run(600);
    b.run(600);
    expect(b.stateHash()).toBe(a.stateHash());
  });
});

const ctx = (over: Partial<BodyContext>): BodyContext => ({
  t: 0,
  activity: 0,
  basePowerW: 0.025e-3,
  sunlit: false,
  light: 0.5,
  airTempC: 25,
  humidity: 0.5,
  onWetGround: false,
  reserveJ: 1,
  ...over,
});

describe("homeostasis of a mortal research body", () => {
  it("loses water with the vapour-pressure deficit, faster when active", () => {
    const run = (o: Partial<BodyContext>) => {
      const h = new Homeostasis(o.airTempC ?? 25);
      for (let k = 0; k < 3600; k++) h.step(1, ctx(o));
      return 1 - h.state.water;
    };
    const humid = run({ humidity: 0.9 }),
      dry = run({ humidity: 0.2 }),
      hot = run({ humidity: 0.2, airTempC: 33 }),
      active = run({ humidity: 0.2, activity: 1 });
    expect(dry).toBeGreaterThan(humid * 5);
    expect(hot / dry).toBeCloseTo(saturationKPa(33) / saturationKPa(25), 1);
    expect(active / dry).toBeCloseTo(1 + homeostasisParam("activityWaterGain"), 1);
    expect(saturationKPa(20)).toBeCloseTo(2.338, 2);
  });

  it("heats in the sun toward the air plus the sun's term, and costs more energy when warm", () => {
    const h = new Homeostasis(25);
    let extra = 0;
    for (let k = 0; k < 600; k++)
      extra += h.step(1, ctx({ airTempC: 30, sunlit: true, light: 1 })).energyJ;
    expect(h.state.tempC).toBeCloseTo(30 + homeostasisParam("sunHeatingC"), 1);
    expect(extra).toBeGreaterThan(0);
    const cold = new Homeostasis(15);
    expect(cold.step(1, ctx({ airTempC: 15 })).energyJ).toBeLessThan(0);
  });

  it("drinks on wet ground and from juice, and dies of desiccation, heat or starvation", () => {
    const h = new Homeostasis(25);
    for (let k = 0; k < 7200; k++) h.step(1, ctx({ humidity: 0.1, airTempC: 30 }));
    const low = h.state.water;
    expect(low).toBeLessThan(0.9);
    const r = h.step(10, ctx({ onWetGround: true }));
    expect(r.drankUl).toBeGreaterThan(0);
    expect(h.state.water).toBeGreaterThan(low);
    h.juice(0.1);
    expect(h.state.juiceUl).toBeGreaterThan(0);
    const dry = new Homeostasis(25);
    for (let k = 0; k < 200_000 && dry.state.alive; k++)
      dry.step(1, ctx({ humidity: 0, airTempC: 30, activity: 1 }));
    expect(dry.state.cause).toBe("desiccation");
    const heat = new Homeostasis(25);
    for (let k = 0; k < 600 && heat.state.alive; k++)
      heat.step(1, ctx({ airTempC: 37, sunlit: true, light: 1, humidity: 0.9 }));
    expect(heat.state.cause).toBe("heat");
    const hungry = new Homeostasis(25);
    for (let k = 0; k < 4000 && hungry.state.alive; k++)
      hungry.step(1, ctx({ reserveJ: 0, humidity: 0.9 }));
    expect(hungry.state.cause).toBe("starvation");
    // Death is the end: nothing more happens to it.
    expect(hungry.step(1, ctx({ onWetGround: true }))).toEqual({
      energyJ: 0,
      drankUl: 0,
    });
  });
});

/** Answers every decision with a fixed command. */
class Fixed implements FlyNeuralAdapter {
  readonly descriptor = {
    id: "fixed",
    label: "fixed",
    fidelity: "test",
    simulatesNeurons: false,
    regions: [],
  };
  command: MotorCommand = { mode: "walk", walkSpeed: 1, reason: "test" };
  decide(): MotorCommand {
    return this.command;
  }
  interrupt(): MotorCommand | null {
    return { mode: "escape", heading: 0, prepare: 0.05, reason: "reflex" };
  }
}

function input(
  over: { mode?: string; t?: number; lightBearing?: number | null } = {},
): DecisionInput {
  return {
    body: {
      t: over.t ?? 10,
      mode: (over.mode ?? "rest") as never,
      p: [0, 0.001, 0],
      yaw: 0,
      reserve: 0.8,
      home: {
        center: [0, 0, 0],
        radius: 10,
        ceiling: 6,
        bounds: { min: { x: -10, z: -10 }, max: { x: 10, z: 10 } },
      },
    } as never,
    frame: { lightBearing: over.lightBearing ?? null } as never,
    sites: [],
    params: { flightReserveFloor: 0.05, takeoffPrepMs: 300 } as never,
    dt: 0.05,
  };
}

describe("homeostatic feedback policies", () => {
  it("a thirsty fly on wet ground stays to drink; elsewhere it searches the humidity", () => {
    const h = new Homeostasis(25);
    h.state.water = THIRSTY - 0.1;
    let hum = 1;
    let wet = true;
    const a = new HomeostaticAdapter(new Fixed(), h, {
      thirst: true,
      thermal: false,
      seed: 1,
      hygroAt: () => hum,
      wetUnderfoot: () => wet,
    });
    expect(a.decide(input()).mode).toBe("rest");
    hum = 0.4;
    wet = false;
    const c = a.decide(input({ t: 11 }));
    expect(c.mode).toBe("walk");
    expect(c.reason).toMatch(/humidity/);
    // Not thirsty: the controller's command stands.
    h.state.water = 0.9;
    expect(a.decide(input({ t: 12 })).reason).toBe("test");
  });

  it("a hot fly in the light walks away from it for a while, and in shade stays still", () => {
    const h = new Homeostasis(25);
    h.state.tempC = HOT_C + 2;
    const a = new HomeostaticAdapter(new Fixed(), h, {
      thirst: false,
      thermal: true,
      seed: 1,
      hygroAt: () => 0.5,
      wetUnderfoot: () => false,
    });
    expect(a.decide(input({ lightBearing: 0.5 })).mode).toBe("walk");
    // Then it rests as long as it walked.
    expect(a.decide(input({ t: 20, lightBearing: 0.5 })).mode).toBe("walk");
    expect(a.decide(input({ t: 80, lightBearing: 0.5 })).mode).toBe("rest");
    expect(a.decide(input({ t: 30, lightBearing: null })).mode).toBe("rest");
  });

  it("never stands in the way of an escape", () => {
    const h = new Homeostasis(25);
    h.state.water = 0.4;
    h.state.tempC = 36;
    const a = new HomeostaticAdapter(new Fixed(), h, {
      thirst: true,
      thermal: true,
      seed: 1,
      hygroAt: () => 1,
      wetUnderfoot: () => true,
    });
    expect(a.interrupt(input())?.mode).toBe("escape");
  });
});

describe("a mortal research fly in the dry yard", () => {
  it(
    "drinks, and the world it drank from replays from its records",
    { timeout: 300_000 },
    () => {
      const spec = dryYard(7);
      const life = new EcologicalLife(
        spec,
        {
          subject: "research-homeostasis-test",
          seed: 3,
          start: [6.7, 4.2],
          yaw: 0,
          startReserve: 1,
        },
        { kind: "mortal", thirst: true, thermal: true },
        // The world has lived two hours, so the spring has wetted its ground.
        spinUp(spec, 2 * HOUR),
      );
      // Thirsty from the start, on the spring's wet ground.
      life.homeostasis!.state.water = 0.6;
      life.step(6_000);
      const h = life.homeostasis!.state;
      expect(h.drankUl).toBeGreaterThan(0);
      expect(life.eco.water.drunk).toBeGreaterThan(0);
      expect(life.eco.interactions.some((i) => i.kind === "drink")).toBe(true);
      const again = replay(spec, life.eco.interactions, life.eco.steps);
      expect(again.stateHash()).toBe(life.eco.stateHash());
      // A deployed body never dies and drinks nothing.
      const deployed = new EcologicalLife(spec, {
        subject: "research-homeostasis-dep",
        seed: 3,
        start: [6.3, 4.2],
        yaw: 0,
        startReserve: 1,
      });
      deployed.step(600);
      expect(deployed.alive).toBe(true);
      expect(deployed.homeostasis).toBeNull();
    },
  );
});
