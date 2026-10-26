import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../lib/noise";
import {
  GENESIS,
  live,
  mindOf,
  trainingLife,
  YARD_LIFE,
  YardLife,
  type YardGenesis,
} from "../../life/individuality";
import { birth, checkpointLife, restoreLife } from "../../life/continuity";
import { initialNavigation, Navigator, type Place } from "../navigation";
import { MushroomBody } from "./circuit";
import { MUSHROOM_BODY_DESCRIPTOR, MushroomBodyController } from "./controller";
import { MUSHROOM_BODY_PARAMS, resolveMushroomBodyParams } from "./params";

const P = resolveMushroomBodyParams();
const place = (landmarks: string[]): Place => ({
  kind: "food",
  what: "fruit",
  at: [5.5, 0],
  landmarks,
  t: 0,
  misses: 0,
});

describe("mushroom body: parameters", () => {
  it("fixes the published values and keeps model values in range", () => {
    expect(P.kenyonCells).toBe(2000);
    expect(P.kcCoding).toBe(0.05);
    expect(Object.isFrozen(P)).toBe(true);
    expect(() => resolveMushroomBodyParams({ kenyonCells: 100 })).toThrow(/published/);
    expect(() => resolveMushroomBodyParams({ learningRate: 0.5 })).toThrow(/within/);
    expect(resolveMushroomBodyParams({ learningRate: 0.1 }).learningRate).toBe(0.1);
    for (const p of Object.values(MUSHROOM_BODY_PARAMS))
      expect(p.kind === "published" ? "source" in p : p.min <= p.value).toBe(true);
  });
});

describe("mushroom body: the circuit", () => {
  it("codes a cue with about 5% of its Kenyon cells, summing to 10 Hz, per fly", () => {
    const mb = new MushroomBody(P, 1),
      other = new MushroomBody(P, 2);
    const a = mb.code("pole-east"),
      b = mb.code("pole-west");
    expect(a).toEqual(mb.code("pole-east"));
    expect(a.cells.length).toBeGreaterThan(60);
    expect(a.cells.length).toBeLessThan(140);
    expect(a.hz * a.cells.length).toBeCloseTo(10, 12);
    const overlap = a.cells.filter((j) => b.cells.includes(j)).length;
    expect(overlap).toBeLessThan(20);
    expect(other.code("pole-east").cells).not.toEqual(a.cells);
  });

  it("computes the prediction error with its DANs and moves the prediction toward the reinforcement", () => {
    const mb = new MushroomBody(P, 3);
    const t = mb.trial("pole-east", 1, "meal")!;
    // d+ − d− = 2(r − m̂) while both DANs fire (γΣk keeps them above zero).
    expect(t.dPlus - t.dMinus).toBeCloseTo(2 * (1 - t.before), 12);
    const k2 = t.kcActive * t.kcHz ** 2;
    const full = 2 * P.learningRate * k2 * (1 - t.before);
    // Weights clipped at zero can only shorten the step.
    expect(t.after - t.before).toBeGreaterThan(0.8 * full);
    expect(t.after - t.before).toBeLessThanOrEqual(full + 1e-12);
    expect(mb.predict("pole-east")).toBeCloseTo(t.after, 12);
    expect(mb.state.trials).toBe(1);
    expect(mb.state.fruitless).toBe(0);
  });

  it("values a place by its meals and devalues it by fruitless returns", () => {
    const mb = new MushroomBody(P, 4);
    const once = place(["pole-east", "pole-north"]),
      twice = place(["pole-west"]);
    expect(mb.worth(once)).toBe(false);
    mb.fed(once);
    expect(mb.worth(once)).toBe(true);
    expect(mb.missed(once)).toBe(false);
    expect(mb.worth(once)).toBe(false);
    mb.fed(twice);
    mb.fed(twice);
    mb.missed(twice);
    expect(mb.worth(twice)).toBe(true);
    mb.missed(twice);
    expect(mb.worth(twice)).toBe(false);
    expect(mb.state.fruitless).toBe(3);
    expect(once.misses + twice.misses).toBe(0);
    // Only the nearest landmark is the cue.
    expect(mb.state.last!.cue).toBe("pole-west");
  });

  it("learns nothing from a fruitless return with omission blocked", () => {
    const mb = new MushroomBody(P, 5, true);
    const p = place(["pole-south"]);
    mb.fed(p);
    const before = mb.predict("pole-south");
    mb.missed(p);
    expect(mb.state.last!.blocked).toBe(true);
    expect(mb.predict("pole-south")).toBe(before);
    expect(mb.worth(p)).toBe(true);
  });

  it("keeps the bookkeeping's rule for a place with no landmark", () => {
    const mb = new MushroomBody(P, 6);
    const bare = place([]);
    mb.fed(bare);
    expect(mb.state.trials).toBe(0);
    expect(mb.worth(bare)).toBe(true);
    expect(mb.missed(bare)).toBe(false);
    expect(mb.missed(bare)).toBe(true);
  });

  it("draws the same weights from the same seed", () => {
    expect(new MushroomBody(P, 7).state).toEqual(new MushroomBody(P, 7).state);
    expect(new MushroomBody(P, 7).state.wPlus).not.toEqual(
      new MushroomBody(P, 8).state.wPlus,
    );
  });
});

describe("mushroom body: the navigator's valuation", () => {
  it("skips places the valuation no longer values, and keeps them remembered", () => {
    const mb = new MushroomBody(P, 9);
    const state = initialNavigation(0, 0);
    const nav = new Navigator(state, mulberry32(1), mb);
    const p = place(["pole-east"]);
    state.places.push(p);
    expect(nav.foodPlace()).toBeNull();
    mb.fed(p);
    expect(nav.foodPlace()).toBe(p);
    state.est = [5.5, 0];
    nav.missed();
    expect(state.places).toEqual([p]);
    expect(nav.foodPlace()).toBeNull();
  });

  it("leaves the reduced-order controller's graph as it was", () => {
    const life = new YardLife(GENESIS);
    expect(JSON.stringify(mindOf(life))).not.toMatch(/valuation|circuit/);
  });
});

describe("mushroom body: the controller in a fly", () => {
  const MB: YardGenesis = { ...GENESIS, mind: "mushroom-body" };

  it("declares its neurons and learns from the meals of a fly that forages", () => {
    expect(MUSHROOM_BODY_DESCRIPTOR.simulatesNeurons).toBe(true);
    const { journal } = trainingLife("east", 1);
    const life = new YardLife(MB);
    live(life, journal, journal[0]!.tick + 3000);
    const mind = life.mind as MushroomBodyController;
    expect(mind).toBeInstanceOf(MushroomBodyController);
    expect(life.fly.state.counts.meals).toBeGreaterThan(0);
    expect(mind.circuit.state.trials).toBe(life.fly.state.counts.meals);
    expect(mind.circuit.state.last!.event).toBe("meal");
    expect(mind.circuit.worth(life.nav.places[0]!)).toBe(true);
  }, 60_000);

  it("survives a checkpoint and lives on exactly as the uninterrupted fly", () => {
    const { journal } = trainingLife("west", 2);
    const life = YARD_LIFE.build(structuredClone(MB));
    const b = birth(YARD_LIFE.id, MB, "a".repeat(32));
    live(life, journal, journal[0]!.tick + 2000);
    const cp = checkpointLife(YARD_LIFE, life, { genesis: MB, birth: b, previous: null });
    const back = restoreLife(YARD_LIFE, cp);
    expect(YARD_LIFE.hash(back)).toBe(YARD_LIFE.hash(life));
    expect((back.mind as MushroomBodyController).circuit.state).toEqual(
      (life.mind as MushroomBodyController).circuit.state,
    );
    life.step(600);
    back.step(600);
    expect(YARD_LIFE.hash(back)).toBe(YARD_LIFE.hash(life));
  }, 60_000);
});
