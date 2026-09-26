import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA_VERSION } from "./contract";
import { parseAxisDecision, readDecisionError, validateDecision } from "./decision";
import { fakeAnswers, makeObservation } from "./testing/fixtures";

const observation = makeObservation({ sequence: 42 });
const legal = observation.legal;

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const answers = fakeAnswers(legal, { weapon: "FIRE", turn: "TURN_RIGHT_SMALL" });
  const axes = Object.fromEntries(
    Object.entries(answers).map(([axis, answer]) => {
      const a = answer as { choice: string; confidence: number; probabilities: object };
      return [
        axis,
        { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities },
      ];
    }),
  );
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    sequence: 42,
    source: "typesafe",
    model: "jev-1.13.0",
    frame: {
      move: legal.move[0],
      turn: "TURN_RIGHT_SMALL",
      tilt: legal.tilt[0],
      weapon: "FIRE",
      target: "NONE",
      aim: "CENTER_MASS",
    },
    axes,
    latencyMs: 131,
    usage: { inputTokens: 1400, outputTokens: 80 },
    ...overrides,
  };
}

describe("TypeSafe choice answers", () => {
  it("accepts a well-formed answer and sorts probabilities, highest first", () => {
    const result = parseAxisDecision(
      "weapon",
      {
        type: "choice",
        choice: "FIRE",
        confidence: 0.61,
        probabilities: {
          NO_FIRE: 0.1,
          FIRE: 0.6,
          ADS: 0.2,
          ADS_FIRE: 0.05,
          RELOAD: 0.03,
          SWAP_WEAPON: 0.02,
        },
      },
      legal.weapon,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.choice).toBe("FIRE");
      expect(result.value.probabilities.map(([a]) => a)).toEqual([
        "FIRE",
        "ADS",
        "NO_FIRE",
        "ADS_FIRE",
        "RELOAD",
        "SWAP_WEAPON",
      ]);
    }
  });

  it("rejects an unknown action, a missing action, and an option that was not offered", () => {
    const base = fakeAnswers(legal)["weapon"] as Record<string, unknown>;
    expect(
      parseAxisDecision("weapon", { ...base, choice: "NUKE" }, legal.weapon).ok,
    ).toBe(false);
    expect(
      parseAxisDecision("weapon", { ...base, choice: undefined }, legal.weapon).ok,
    ).toBe(false);
    // RELOAD is a real action, but not one offered for this state.
    expect(
      parseAxisDecision("weapon", { ...base, choice: "RELOAD" }, ["NO_FIRE", "FIRE"]).ok,
    ).toBe(false);
  });

  it("rejects invalid probabilities and confidence, and never fills them in", () => {
    const base = fakeAnswers(legal)["weapon"] as {
      probabilities: Record<string, number>;
    } & Record<string, unknown>;
    const bad = (probabilities: Record<string, unknown>, confidence: unknown = 0.5) =>
      parseAxisDecision("weapon", { ...base, probabilities, confidence }, legal.weapon)
        .ok;
    expect(bad({ ...base.probabilities, FIRE: -0.1 })).toBe(false);
    expect(bad({ ...base.probabilities, FIRE: Number.NaN })).toBe(false);
    expect(bad({ ...base.probabilities, FIRE: 5 })).toBe(false);
    const missing = { ...base.probabilities };
    delete missing["FIRE"];
    expect(bad(missing)).toBe(false);
    expect(bad({ ...base.probabilities, EXTRA: 0 })).toBe(false);
    expect(bad(base.probabilities, 1.5)).toBe(false);
    const noConfidence: Record<string, unknown> = { ...base };
    delete noConfidence["confidence"];
    expect(parseAxisDecision("weapon", noConfidence, legal.weapon).ok).toBe(false);
    // Probabilities that do not sum to one are not a distribution.
    const scaled = Object.fromEntries(
      Object.entries(base.probabilities).map(([k, v]) => [k, v * 0.5]),
    );
    expect(bad(scaled)).toBe(false);
  });

  it("rejects a choice that is not the most probable option", () => {
    const answer = {
      type: "choice",
      choice: "NO_FIRE",
      confidence: 0.4,
      probabilities: { NO_FIRE: 0.1, FIRE: 0.9 },
    };
    expect(parseAxisDecision("weapon", answer, ["NO_FIRE", "FIRE"]).ok).toBe(false);
  });
});

describe("decision responses", () => {
  const expected = { sequence: 42, legal };

  it("accepts a valid response", () => {
    const result = validateDecision(response(), expected);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.frame.weapon).toBe("FIRE");
      expect(result.value.model).toBe("jev-1.13.0");
    }
  });

  it("rejects the wrong sequence, source, schema or model id", () => {
    expect(validateDecision(response({ sequence: 41 }), expected).ok).toBe(false);
    expect(validateDecision(response({ source: "random" }), expected).ok).toBe(false);
    expect(validateDecision(response({ schemaVersion: "x" }), expected).ok).toBe(false);
    expect(validateDecision(response({ model: "" }), expected).ok).toBe(false);
    expect(validateDecision(response({ model: "<script>" }), expected).ok).toBe(false);
  });

  it("rejects a frame that disagrees with its own axis answers", () => {
    const tampered = response();
    (tampered["frame"] as Record<string, string>)["weapon"] = "RELOAD";
    expect(validateDecision(tampered, expected).ok).toBe(false);
  });

  it("rejects malformed bodies", () => {
    for (const body of [
      null,
      "FIRE",
      [],
      42,
      { schemaVersion: DECISION_SCHEMA_VERSION },
    ]) {
      expect(validateDecision(body, expected).ok).toBe(false);
    }
  });

  it("reads structured error bodies and bounds their size", () => {
    const error = readDecisionError({
      error: { code: "upstream_timeout", message: "x".repeat(1000) },
      retryAfterMs: 1e9,
    });
    expect(error?.code).toBe("upstream_timeout");
    expect(error?.message.length).toBe(200);
    expect(error?.retryAfterMs).toBe(60_000);
    expect(readDecisionError("<html>")).toBeNull();
  });
});
