import { describe, expect, it } from "vitest";
import { metricDefinition } from "./metricRegistry";
import {
  actionConcentration,
  detectWarnings,
  slotPositionBias,
  type ArmView,
} from "./warnings";
import { legal, record } from "./testing/fixtures";

const kpm = metricDefinition("kills_per_minute")!;

function arm(overrides: Partial<ArmView>): ArmView {
  return {
    id: "a",
    brain: "script",
    control: "precision",
    navigation: "places",
    motor: "standard",
    policy: null,
    setting: "latencyMs=0&stale=strict",
    seeds: [42, 43, 44],
    simSeconds: 360,
    kills: 10,
    deaths: 3,
    distanceM: 900,
    exposureFraction: 0.3,
    opponentRoundsInSight: null,
    opponentHitsOnSeat: null,
    laggedEpisodes: 0,
    decisions: [],
    primary: new Map([
      [42, 1],
      [43, 1],
      [44, 1],
    ]),
    costUnknown: false,
    ...overrides,
  };
}

const ids = (w: { id: string }[]) => w.map((x) => x.id);

describe("benchmark warnings", () => {
  it("flags too few seeds as exploratory", () => {
    expect(ids(detectWarnings([arm({})], kpm, 3))).toContain("insufficient-seeds");
    expect(ids(detectWarnings([arm({})], kpm, 30))).not.toContain("insufficient-seeds");
  });

  it("flags a stationary arm that leads every other arm", () => {
    const still = arm({
      id: "still",
      distanceM: 0,
      primary: new Map([
        [42, 20],
        [43, 22],
        [44, 21],
      ]),
    });
    const mover = arm({ id: "mover", distanceM: 2000 });
    const w = detectWarnings([still, mover], kpm, 30);
    const hit = w.find((x) => x.id === "stationary-dominance");
    expect(hit?.arm).toBe("still");
    expect(hit?.suggestedRun).toContain("exposure.json");
  });

  it("flags one action chosen almost always where there was a choice", () => {
    const decisions = Array.from({ length: 60 }, () =>
      record({ frame: { move: "HOLD" } }),
    );
    expect(actionConcentration(decisions, "move")).toMatchObject({
      action: "HOLD",
      share: 1,
      n: 60,
    });
    expect(ids(detectWarnings([arm({ decisions })], kpm, 30))).toContain(
      "action-concentration",
    );
  });

  it("flags first-slot bias against a position-blind expectation and suggests shuffling", () => {
    const decisions = Array.from({ length: 40 }, () =>
      record({ legal: legal({ places: 3 }), frame: { go: "PLACE_0" } }),
    );
    const bias = slotPositionBias(decisions, "go")!;
    expect(bias.firstShare).toBe(1);
    expect(bias.expected).toBeCloseTo(1 / 3, 10);
    const w = detectWarnings([arm({ decisions })], kpm, 30).find(
      (x) => x.id === "option-position-bias",
    );
    expect(w?.suggestedRun).toBe("npm run experiment:shuffle-options");
    expect(w?.possibleCauses.join(" ")).toMatch(/option-order bias/);
  });

  it("does not flag a spread of slots", () => {
    const decisions = Array.from({ length: 60 }, (_, i) =>
      record({
        legal: legal({ places: 3 }),
        frame: { go: (["PLACE_0", "PLACE_1", "PLACE_2"] as const)[i % 3] },
      }),
    );
    expect(ids(detectWarnings([arm({ decisions })], kpm, 30))).not.toContain(
      "option-position-bias",
    );
  });

  it("flags survival that the exposure makes implausible", () => {
    expect(
      ids(detectWarnings([arm({ deaths: 0, exposureFraction: 0.4 })], kpm, 30)),
    ).toContain("impossible-survival");
  });

  it("flags opponents that almost never hit the seat", () => {
    const w = detectWarnings(
      [arm({ opponentRoundsInSight: 500, opponentHitsOnSeat: 3 })],
      kpm,
      30,
    );
    expect(ids(w)).toContain("low-opponent-hit-rate");
  });

  it("flags a random brain that matches a model through the same controllers", () => {
    const model = arm({
      id: "model",
      brain: "jev",
      primary: new Map([
        [42, 10],
        [43, 12],
        [44, 11],
      ]),
    });
    const random = arm({
      id: "random",
      brain: "random",
      primary: new Map([
        [42, 9.5],
        [43, 11],
        [44, 10.5],
      ]),
    });
    const w = detectWarnings([model, random], kpm, 30);
    expect(
      ids(w).some((id) => id === "controller-dominance" || id === "model-irrelevance"),
    ).toBe(true);
  });

  it("does not compare a model with a random arm under a different controller", () => {
    const model = arm({ id: "model", brain: "jev", control: "precision" });
    const random = arm({ id: "random", brain: "random", control: "direct" });
    const w = detectWarnings([model, random], kpm, 30);
    expect(ids(w)).not.toContain("controller-dominance");
    expect(ids(w)).not.toContain("model-irrelevance");
  });

  it("does not compare a model with a random arm that differs in any other setting", () => {
    // Same controller, navigator and motor, but the random arm's answers are
    // delayed: it is not the same seat with only the choices changed.
    const model = arm({ id: "model", brain: "jev" });
    const random = arm({
      id: "random",
      brain: "random",
      setting: "latencyMs=600&stale=strict",
    });
    const w = detectWarnings([model, random], kpm, 30);
    expect(ids(w)).not.toContain("controller-dominance");
    expect(ids(w)).not.toContain("model-irrelevance");
  });
});
