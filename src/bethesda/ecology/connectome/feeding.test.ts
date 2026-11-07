/**
 * The feeding hybrid's decision logic: off food the controller stands; on
 * food the readout decides; an escape always stands; and the same fly makes
 * the same decisions. The circuit here is the synthetic conformance network
 * (not a connectome), its last two neurons standing in for a readout.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalHash } from "../../../game/pilot/hash";
import type { DecisionInput, FlyNeuralAdapter, MotorCommand } from "../../fly/neural";
import { FeedingHybridAdapter, type FeedingBrain } from "./feeding";
import type { CircuitFile } from "./lif";

const circuit = (
  JSON.parse(
    readFileSync(new URL("./fixtures/lif-conformance.json", import.meta.url), "utf8"),
  ) as { circuit: CircuitFile }
).circuit;

/** A controller that always asks for one command. */
function stub(mode: MotorCommand["mode"]): FlyNeuralAdapter {
  return {
    descriptor: { id: "stub", label: "stub" } as FlyNeuralAdapter["descriptor"],
    decide: () => ({ mode, reason: "stub" }),
  };
}

function input(t: number, onFood: string | null, reserve: number, mode = "rest") {
  return { body: { t, onFood, reserve, mode } } as unknown as DecisionInput;
}

describe("the feeding hybrid", () => {
  it("lets the controller stand off food, and decides on food by its threshold", () => {
    const brain: FeedingBrain = { kind: "threshold", hungerAt: 0.3 };
    const a = new FeedingHybridAdapter(stub("feed"), brain, 1);
    expect(a.decide(input(0, null, 0.2)).mode).toBe("feed"); // off food: the stub's own
    expect(a.decide(input(0.05, "fruit-1", 0.9)).mode).toBe("rest"); // sated: vetoed
    expect(a.decide(input(0.1, "fruit-1", 0.5)).mode).toBe("feed"); // hungry: feeds
    expect(a.state.vetoed).toBe(1);
    expect(a.state.meals).toBe(1);
    const esc = new FeedingHybridAdapter(stub("escape"), brain, 1);
    expect(esc.decide(input(0, "fruit-1", 0.1)).mode).toBe("escape");
  });

  it("tells the controller nothing edible is underfoot while the readout is off", () => {
    // A controller that feeds on food and walks elsewhere, as the deployed one does when hungry.
    const seen: (string | null)[] = [];
    const ctrl: FlyNeuralAdapter = {
      descriptor: { id: "stub", label: "stub" } as FlyNeuralAdapter["descriptor"],
      decide: (i) => {
        seen.push(i.body.onFood);
        return i.body.onFood
          ? { mode: "feed", reason: "food" }
          : { mode: "walk", reason: "none" };
      },
    };
    const a = new FeedingHybridAdapter(ctrl, { kind: "threshold", hungerAt: 0.3 }, 1);
    // Sated on fruit: the readout is off, so the controller sees no food and walks on.
    expect(a.decide(input(0, "fruit-1", 0.9)).mode).toBe("walk");
    // Hungry on fruit: the readout is on, the controller sees the fruit, and the fly feeds.
    expect(a.decide(input(0.05, "fruit-1", 0.4)).mode).toBe("feed");
    expect(seen).toEqual([null, "fruit-1"]);
    expect(a.state.vetoed).toBe(0);
  });

  it("feeds once the circuit's readout reaches threshold, and the same fly decides the same", () => {
    const brain: FeedingBrain = {
      kind: "connectome",
      circuit,
      wiring: "intact",
      maxRateHz: 300,
      windowMs: 500,
      thresholdHz: 1,
    };
    const run = () => {
      const a = new FeedingHybridAdapter(stub("rest"), brain, 7);
      const modes: string[] = [];
      for (let k = 0; k < 200; k++)
        modes.push(a.decide(input(k * 0.05, "fruit-1", 0)).mode);
      return { modes, hash: canonicalHash(a.state), readout: a.state.readoutHz };
    };
    const one = run();
    expect(one.modes[0]).toBe("rest"); // nothing has reached the readout yet
    expect(one.modes).toContain("feed");
    expect(run()).toEqual(one);
  });

  it("names a shuffled wiring in its descriptor and keeps it deterministic", () => {
    const brain: FeedingBrain = {
      kind: "connectome",
      circuit,
      wiring: "shuffled",
      maxRateHz: 300,
      windowMs: 500,
      thresholdHz: 1,
    };
    const a = new FeedingHybridAdapter(stub("rest"), brain, 7);
    const b = new FeedingHybridAdapter(stub("rest"), brain, 7);
    expect(a.descriptor.id).toMatch(/weights shuffled/);
    for (let k = 0; k < 50; k++) {
      a.decide(input(k * 0.05, "fruit-1", 0));
      b.decide(input(k * 0.05, "fruit-1", 0));
    }
    expect(canonicalHash(a.state as never)).toBe(canonicalHash(b.state as never));
  });
});
