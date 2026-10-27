import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DigitalFly } from "../../fly/fly.js";
import type { DecisionInput, MotorCommand } from "../../fly/neural.js";
import { MushroomBodyController } from "../../fly/mushroomBody/controller.js";
import { birth, checkpointLife, restoreLife } from "../continuity.js";
import { LifeStore } from "../store.js";
import { snapshotGraph } from "../snapshot.js";
import { sha256Json } from "../../../rain/sha256.js";
import { checkpointWithEvents } from "../immortal/checkpoint.js";
import {
  ImmortalLife,
  IMMORTAL_RESEARCH_LIFE,
  researchGenesis,
} from "../immortal/life.js";
import { FORAGING_RESEARCH_LIFE as KIND, foragingGenesis } from "./life.js";
import { ForagingAdapter } from "./adapter.js";
import { OlfactoryNavigation, olfactoryView, type OlfactoryView } from "./olfaction.js";
import { OdorTunnel, temporalAssay, assay } from "./study.js";

const view: OlfactoryView = {
  odour: 0.5,
  windFrom: Math.PI / 2,
  reserve: 0.2,
  hungerSeek: 0.2,
  mode: "walk",
  edge: false,
  clearance: Infinity,
  contactTime: Infinity,
  walkMaxCmS: 4,
};
const command: MotorCommand = {
  mode: "walk",
  yawRate: 0,
  walkSpeed: 1,
  reason: "walking",
};
const sample = (model: OlfactoryNavigation, odor: number, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 20); i++) model.sample(odor, 0.05);
};
const genesis = () => ({
  ...foragingGenesis(1201),
  olfactoryNavigation: true,
  flags: { immortality: true, associativeLearning: true, predictiveSelfModel: true },
});

describe("odor history, sensory boundaries and motor priority", () => {
  it("agrees with an independent continuous-equation solver and has ON adaptation/OFF response", () => {
    const result = temporalAssay();
    expect(result.passed).toBe(true);
    expect(result.maxError).toBeLessThan(0.002);
    expect(result.peakOn).toBeGreaterThan(result.sustainedOn * 1.2);
  });
  it("responds differently to the same present odor after different histories, then recovers", () => {
    const fresh = new OlfactoryNavigation(7),
      experienced = new OlfactoryNavigation(7);
    sample(experienced, 0.5, 30);
    sample(experienced, 0, 1);
    sample(fresh, 0.5, 1);
    sample(experienced, 0.5, 1);
    expect(experienced.state.adaptationOn).toBeGreaterThan(fresh.state.adaptationOn);
    expect(experienced.state.on).toBeLessThan(fresh.state.on);
    sample(experienced, 0, 180);
    expect(experienced.state.on).toBeLessThan(1e-9);
    expect(experienced.state.adaptationOn).toBeLessThan(1e-7);
  });
  it("turns toward sensed wind, requires hunger, and searches after loss even without wind", () => {
    const a = new OlfactoryNavigation(1201);
    sample(a, 0.5, 15);
    expect(a.modulate(command, view, 0.05).yawRate).toBeGreaterThan(0);
    expect(
      a.modulate(command, { ...view, windFrom: -Math.PI / 2 }, 0.05).yawRate,
    ).toBeLessThan(0);
    expect(a.modulate(command, { ...view, reserve: 1 }, 0.05)).toEqual(command);
    expect(a.modulate(command, { ...view, hungerSeek: 1 }, 0.05)).toEqual(command);
    for (let k = 0; k < 200; k++) {
      a.sample(0, 0.05);
      a.modulate(command, { ...view, odour: 0, windFrom: null }, 0.05);
      expect(a.state.lastWindTurn).toBe(0);
    }
    expect(a.state.searchTurns).toBeGreaterThan(0);
  });
  it("leaves feeding, escape, flight, landing, edges and impending contact to existing control", () => {
    const a = new OlfactoryNavigation(1);
    sample(a, 0.5, 10);
    for (const mode of ["feed", "escape", "flight", "land", "rest", "groom"] as const) {
      const c = { mode, reason: "priority" };
      expect(a.modulate(c, view, 0.05)).toBe(c);
    }
    for (const blocked of [{ edge: true }, { clearance: 0.001 }, { contactTime: 0.1 }])
      expect(a.modulate(command, { ...view, ...blocked }, 0.05)).toBe(command);
  });
  it("rejects invalid samples or corrupt filter state without erasing the history", () => {
    const a = new OlfactoryNavigation(1);
    sample(a, 0.5, 2);
    const before = structuredClone(a.state);
    for (const bad of [-1, NaN, Infinity, 1e8])
      expect(() => a.sample(bad, 0.05)).toThrow(/no reset/);
    expect(a.state).toEqual(before);
    a.state.on = NaN;
    expect(() => a.sample(0, 0.05)).toThrow(/no reset/);
    expect(a.state.adaptationOn).toBe(before.adaptationOn);
  });
  it("has no access to ground-truth coordinates, headings, identities or experiment schedules", () => {
    let input: DecisionInput | undefined;
    const fly = new DigitalFly({
      seed: 1201,
      world: new OdorTunnel("pulse"),
      start: { p: [0, 0.002, 0], yaw: 0 },
      adapter: (rng, streams) => {
        const a = new ForagingAdapter(rng, streams, 1201, genesis().flags, true);
        const decide = a.decide.bind(a);
        a.decide = (i) => {
          input = structuredClone(i);
          return decide(i);
        };
        return a;
      },
    });
    fly.advance(0.2);
    expect(input).toBeDefined();
    const scrambled = structuredClone(input!);
    Object.assign(scrambled.body, {
      p: [99, 88, 77],
      v: [9, 8, 7],
      yaw: 123,
      onFood: "secret",
      target: null,
    });
    scrambled.sites = [];
    scrambled.frame.landmarks = [{ id: "hidden-label", distance: 99, bearing: 99 }];
    expect(olfactoryView(scrambled)).toEqual(olfactoryView(input!));
  });
});

describe("embodied integration and individual continuity", () => {
  it("changes actual walking trajectories with no rejected body commands", () => {
    const on = assay(1201, true, "pulse"),
      off = assay(1201, false, "pulse");
    expect(on.trace).not.toEqual(off.trace);
    expect(on.modulatedDecisions).toBeGreaterThan(0);
    expect(on.onAlignment).toBeGreaterThan(off.onAlignment!);
    expect(on.rejected + off.rejected).toBe(0);
    expect(on.predictionChecks).toBeGreaterThan(0);
    expect(on.predictionMismatches + off.predictionMismatches).toBe(0);
  }, 30000);
  it("keeps the disabled extension's body, controller and streams identical to the previous research model", () => {
    const g = researchGenesis(1201);
    g.flags = genesis().flags;
    const previous = new ImmortalLife(g);
    const disabled = KIND.build({ ...g, olfactoryNavigation: false });
    for (const ticks of [10, 100, 200]) {
      previous.advanceTicks(ticks);
      disabled.advanceTicks(ticks);
      expect(disabled.fly.state).toEqual(previous.fly.state);
      expect(disabled.adapter.inner.state).toEqual(previous.adapter.inner.state);
      expect(disabled.adapter.model?.state).toEqual(previous.adapter.model?.state);
      expect(disabled.adapter.physiology.state).toEqual(
        previous.adapter.physiology.state,
      );
    }
  }, 30000);
  it("preserves sensory history, learned weights, identity and future RNG through an archived restart", () => {
    const g = genesis(),
      life = KIND.build(g);
    const first = checkpointLife(KIND, life, {
      genesis: g,
      birth: birth(KIND.id, g, randomBytes(16).toString("hex")),
      previous: null,
    });
    const path = mkdtempSync(join(tmpdir(), "echo-foraging-test-"));
    const store = LifeStore.create(path, KIND, first, { keepGraphs: 2 });
    try {
      KIND.apply!(life, {
        tick: 0,
        kind: "food",
        data: { food: { site: "east", at: [0, 0] } },
      });
      life.advanceTicks(300);
      const inner = life.adapter.inner;
      expect(inner).toBeInstanceOf(MushroomBodyController);
      if (inner instanceof MushroomBodyController)
        expect(inner.circuit.state.trials).toBeGreaterThan(0);
      const saved = checkpointWithEvents(KIND, life, store, first);
      expect(saved.birth.individual).toBe(first.birth.individual);
      expect(store.events().length).toBeGreaterThan(0);
      const back = restoreLife(KIND, saved);
      const beforeInspection = sha256Json(snapshotGraph(back));
      expect(back.inspect()).toEqual(life.inspect());
      expect(sha256Json(snapshotGraph(back))).toBe(beforeInspection);
      for (const ticks of [1, 23, 200]) {
        life.advanceTicks(ticks);
        back.advanceTicks(ticks);
        expect(KIND.hash(back)).toBe(KIND.hash(life));
      }
      expect(() => restoreLife(IMMORTAL_RESEARCH_LIFE, saved)).toThrow();
    } finally {
      store.release();
      rmSync(path, { recursive: true, force: true });
    }
  }, 60000);
  it("preserves v1 graph bytes when using the default factory seam", () => {
    const g = researchGenesis(1201),
      a = IMMORTAL_RESEARCH_LIFE.build(g);
    a.advanceTicks(50);
    // Captured from the unchanged v1 implementation at published tree f5a57e67.
    expect(IMMORTAL_RESEARCH_LIFE.hash(a)).toBe(
      "dbdc57e76c64cfb3fc818988e05ccb7c2e365399b967d059ec98d8b7840f50a4",
    );
    expect(sha256Json(snapshotGraph(a))).toBe(
      "f1d4a65bea4f05c87b579856f3371fc5d5e53fa1553a1850ee3ea120b340a6d1",
    );
  });
});
