import { describe, expect, it } from "vitest";
import {
  COVER_SELECTION,
  DECISION_TYPES,
  ENGAGE_DISENGAGE,
  RELOAD,
  SHOT,
  THREAT_PRIORITY,
  decisionType,
  engages,
} from "./outcomeContracts";
import { legal, outcome, record } from "./testing/fixtures";

const placeChoice = (overrides: Parameters<typeof outcome>[0] = {}, places = 3) =>
  record({
    legal: legal({ places }),
    frame: { go: "PLACE_1" },
    execution: {
      actionStart: 0,
      actionEnd: 0.4,
      endReason: "replaced",
      targetBound: null,
      placeBound: true,
      placeKind: "cover",
    },
    outcome: outcome(overrides),
  });

describe("outcome contracts", () => {
  it("are versioned, unique, and state their rule in words", () => {
    const ids = DECISION_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of DECISION_TYPES) {
      expect(t.id).toMatch(/^[a-z-]+\/v\d+$/);
      expect(t.rule.length).toBeGreaterThan(30);
      expect(t.controllerCannot.length).toBeGreaterThan(0);
    }
    expect(decisionType("cover-selection/v1")).toBe(COVER_SELECTION);
    expect(decisionType("cover-selection/v2")).toBeNull();
  });

  it("cover selection counts only a real choice between places", () => {
    expect(COVER_SELECTION.matches(placeChoice())).toBe(true);
    expect(COVER_SELECTION.matches(placeChoice({}, 1))).toBe(false);
    const unbound = placeChoice();
    unbound.execution.placeBound = false;
    expect(COVER_SELECTION.matches(unbound)).toBe(false);
    const rejected = placeChoice();
    rejected.validation.status = "rejected_stale";
    expect(COVER_SELECTION.matches(rejected)).toBe(false);
  });

  it("cover selection classes hidden, hurt and in-between outcomes", () => {
    expect(COVER_SELECTION.classify(placeChoice({ exposedSamples: 5 }))).toBe(
      "beneficial",
    );
    expect(COVER_SELECTION.classify(placeChoice({ exposedSamples: 6 }))).toBe("neutral");
    expect(COVER_SELECTION.classify(placeChoice({ damageTaken: 10 }))).toBe("neutral");
    expect(COVER_SELECTION.classify(placeChoice({ damageTaken: 25 }))).toBe("harmful");
    expect(COVER_SELECTION.classify(placeChoice({ died: true }))).toBe("harmful");
  });

  it("does not score an incomplete window", () => {
    expect(COVER_SELECTION.classify(placeChoice({ complete: false }))).toBeNull();
  });

  it("threat priority needs two enemies in view and a bound target", () => {
    const r = record({
      legal: legal({ enemies: 2 }),
      frame: { target: "TARGET_1" },
      context: { ...record().context, visibleEnemies: 2 },
      execution: {
        actionStart: 0,
        actionEnd: 0.4,
        endReason: "replaced",
        targetBound: true,
        placeBound: null,
        placeKind: null,
      },
      outcome: outcome({ target: { hit: true, killed: true, damage: 100 } }),
    });
    expect(THREAT_PRIORITY.matches(r)).toBe(true);
    expect(THREAT_PRIORITY.classify(r)).toBe("beneficial");
    r.outcome!.died = true;
    expect(THREAT_PRIORITY.classify(r)).toBe("harmful");
    const single = {
      ...r,
      legal: legal({ enemies: 1 }),
      frame: { ...r.frame, target: "TARGET_0" as const },
    };
    expect(THREAT_PRIORITY.matches(single)).toBe(false);
  });

  it("engage/disengage reads fire permission with a target", () => {
    const base = record({
      legal: legal({ enemies: 1 }),
      context: { ...record().context, visibleEnemies: 1 },
    });
    expect(
      engages({
        ...base,
        frame: { ...base.frame, weapon: "ADS_FIRE", target: "TARGET_0" },
      }),
    ).toBe(true);
    expect(
      engages({ ...base, frame: { ...base.frame, weapon: "ADS_FIRE", target: "NONE" } }),
    ).toBe(false);
    expect(
      engages({
        ...base,
        frame: { ...base.frame, weapon: "NO_FIRE", target: "TARGET_0" },
      }),
    ).toBe(false);
    expect(ENGAGE_DISENGAGE.matches(base)).toBe(true);
    expect(
      ENGAGE_DISENGAGE.classify({
        ...base,
        outcome: outcome({ damageDealt: 50, damageTaken: 10 }),
      }),
    ).toBe("beneficial");
    expect(
      ENGAGE_DISENGAGE.classify({
        ...base,
        outcome: outcome({ damageDealt: 0, damageTaken: 10 }),
      }),
    ).toBe("neutral");
  });

  it("reload and shot read their own outcomes", () => {
    const reload = record({
      frame: { weapon: "RELOAD" },
      outcome: outcome({ damageTaken: 0 }),
    });
    expect(RELOAD.matches(reload)).toBe(true);
    expect(RELOAD.classify(reload)).toBe("beneficial");
    const shot = record({
      frame: { weapon: "FIRE" },
      context: { ...record().context, visibleEnemies: 1 },
      outcome: outcome({ shotsFired: 4, hits: 1 }),
    });
    expect(SHOT.matches(shot)).toBe(true);
    expect(SHOT.classify(shot)).toBe("beneficial");
    expect(SHOT.measure.read(shot)).toBe(0.25);
  });
});
