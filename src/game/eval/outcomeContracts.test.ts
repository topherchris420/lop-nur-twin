import { describe, expect, it } from "vitest";
import {
  COVER_SELECTION,
  DECISION_TYPES,
  ENGAGE_DISENGAGE,
  ENGAGE_DISENGAGE_V2,
  RELOAD,
  SHOT,
  THREAT_PRIORITY,
  decisionType,
} from "./outcomeContracts";
import { legalActionsFor } from "../pilot/observation";
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

  it("engage/disengage applies with an enemy in view and scores the exchange", () => {
    const base = record({
      legal: legal({ enemies: 1 }),
      context: { ...record().context, visibleEnemies: 1 },
    });
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

  it("engage/disengage v2 gives each side its own rule, and v1 is unchanged", () => {
    const inView = {
      legal: legal({ enemies: 1 }),
      context: { ...record().context, visibleEnemies: 1 },
    };
    const engage = (o: Parameters<typeof outcome>[0]) =>
      record({
        ...inView,
        frame: { weapon: "FIRE", target: "TARGET_0" },
        outcome: outcome(o),
      });
    const disengage = (o: Parameters<typeof outcome>[0]) =>
      record({
        ...inView,
        frame: { weapon: "NO_FIRE", move: "BACK" },
        outcome: outcome(o),
      });
    const v2 = ENGAGE_DISENGAGE_V2;
    expect(v2.side!(engage({}))).toBe("ENGAGE");
    expect(v2.side!(disengage({}))).toBe("DISENGAGE");
    // Under precision control a fire choice that names no target is not engaging.
    expect(
      v2.side!(record({ ...inView, frame: { weapon: "ADS_FIRE", target: "NONE" } })),
    ).toBe("DISENGAGE");
    // Under direct control no target is ever named: any fire choice engages.
    const direct = legalActionsFor(
      { stance: "stand", grounded: true, pitchDeg: 0 },
      { ammo: 20, magSize: 30, reserve: 90, reloading: false, canFire: true },
      { control: "direct", visibleEnemies: 1 },
    );
    expect(
      v2.side!(record({ ...inView, legal: direct, frame: { weapon: "FIRE" } })),
    ).toBe("ENGAGE");

    // ENGAGE: the fight paid, or it did not.
    expect(v2.classify(engage({ damageDealt: 50, damageTaken: 10 }))).toBe("beneficial");
    expect(v2.classify(engage({ damageDealt: 10, damageTaken: 40 }))).toBe("neutral");
    expect(v2.classify(engage({ damageDealt: 90, died: true }))).toBe("harmful");
    // DISENGAGE: breaking off kept the seat safe, or did not.
    expect(v2.classify(disengage({}))).toBe("beneficial");
    expect(v2.classify(disengage({ damageTaken: 10 }))).toBe("neutral");
    expect(v2.classify(disengage({ damageTaken: 25 }))).toBe("harmful");
    expect(v2.classify(disengage({ died: true }))).toBe("harmful");
    expect(v2.classify(disengage({ complete: false }))).toBeNull();

    // v1 scores both sides by the fight: a clean break-off is only neutral there.
    expect(ENGAGE_DISENGAGE.side).toBeUndefined();
    expect(ENGAGE_DISENGAGE.classify(disengage({}))).toBe("neutral");
    expect(ENGAGE_DISENGAGE.classify(disengage({ damageTaken: 25 }))).toBe("neutral");
    expect(decisionType("engage-disengage/v1")).toBe(ENGAGE_DISENGAGE);
    expect(decisionType("engage-disengage/v2")).toBe(v2);
    expect(v2.matches(disengage({}))).toBe(ENGAGE_DISENGAGE.matches(disengage({})));
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
