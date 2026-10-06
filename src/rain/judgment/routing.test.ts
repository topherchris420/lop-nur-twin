import { describe, expect, it } from "vitest";
import type { JudgmentResult, JudgmentState, QuestionSet } from "./contracts.js";
import { Provider, allow, profile, request } from "./fixtures.js";
import {
  DecisionRouter,
  type DecisionRequest,
  type RouterOptions,
  envelopeToDict,
} from "./routing.js";

/**
 * Bounded decisions never confer authority or suppress deterministic
 * refusals: R.A.I.N.'s `tests/test_decision_routing.py`, ported. The router
 * is asynchronous here, and the configured secret the last case plants is
 * passed under the name the runtime uses for it.
 */
function router(overrides: Partial<RouterOptions> = {}) {
  return new DecisionRouter({
    mode: "cascade",
    laya: new Provider(),
    jev: new Provider("typesafe"),
    profiles: [profile("laya"), profile("typesafe")],
    ...overrides,
  });
}

const laya = (r: DecisionRouter) => r.laya as Provider;
const jev = (r: DecisionRouter) => r.jev as Provider;

describe("bounded decision routing", () => {
  it("takes the local fast path, checking before and after", async () => {
    const calls: (string | null)[] = [];
    const r = router();
    const result = await r.decide(request(), (_, choice) => {
      calls.push(choice);
      return true;
    });
    expect(calls).toEqual([null, "CONTINUE"]);
    expect(result.selected).toBe("CONTINUE");
    expect(result.validatorResult).toBe(true);
    expect(result.destination).toBe("proposal");
    expect([laya(r).calls, jev(r).calls]).toEqual([1, 0]);
    expect(envelopeToDict(result).final_action).toBeNull();
    expect(envelopeToDict(result).schema_version).toBe("rain-bounded-decision/v1");
    expect(typeof envelopeToDict(result).envelope_hash).toBe("string");
  });

  it("escalates a Laya failure or uncertainty to Jev", async () => {
    for (const local of [
      null,
      new Provider("laya", "CONTINUE", 0.99, "provider_not_configured"),
      new Provider("laya", "CONTINUE", 0.55),
      new Provider("laya", "CONTINUE", 0.99, "provider_timeout"),
    ]) {
      const r = router({ laya: local });
      const result = await r.decide(request(), allow);
      expect(result.destination).toBe("proposal");
      expect(result.attempts.at(-1)!.engine).toBe("typesafe");
      expect(jev(r).calls).toBe(1);
    }
  });

  it("returns unresolved questions to R.A.I.N. without an action", async () => {
    const cases: [Partial<RouterOptions>, string][] = [
      [{ laya: null, jev: null }, "MODEL_UNAVAILABLE"],
      [
        {
          laya: new Provider("laya", "CONTINUE", 0.55),
          jev: new Provider("typesafe", "CONTINUE", 0.55),
        },
        "LOW_CONFIDENCE",
      ],
      [{ profiles: [] }, "INSUFFICIENT_CALIBRATION"],
    ];
    for (const [options, reason] of cases) {
      const result = await router(options).decide(request(), allow);
      expect(result.destination).toBe("rain");
      expect(result.selected).toBeNull();
      expect(result.reason).toBe(reason);
    }
  });

  it("applies policy before any model", async () => {
    const cases: [Partial<DecisionRequest>, string][] = [
      [{ consequence: "high" }, "HIGH_CONSEQUENCE"],
      [{ requiresEvidence: true }, "EVIDENCE_REQUIRED"],
      [{ requiresReview: true }, "POLICY_REQUIRES_REVIEW"],
      [{ outOfDistribution: true }, "OUT_OF_DISTRIBUTION"],
    ];
    for (const [overrides, reason] of cases) {
      const r = router();
      const result = await r.decide(request(overrides), allow);
      expect(result.reason).toBe(reason);
      expect([laya(r).calls, jev(r).calls]).toEqual([0, 0]);
    }
  });

  it("lets no confidence override post-validation", async () => {
    const result = await router().decide(request(), (_, choice) => choice === null);
    expect(result.selected).toBeNull();
    expect(result.destination).toBe("rejected");
    expect(result.reason).toBe("VALIDATION_FAILED");
    expect(result.attempts[0]!.confidence).toBe(0.99);
  });

  it("constructs no model result after a pre-check refusal", async () => {
    const r = router();
    const result = await r.decide(request(), () => false);
    expect(result.attempts).toEqual([]);
    expect([laya(r).calls, jev(r).calls]).toEqual([0, 0]);
  });

  it("fails closed on a validator that throws or answers a truthy non-boolean", async () => {
    expect(
      (await router().decide(request(), () => "yes" as unknown as boolean)).destination,
    ).toBe("rejected");
    expect(
      (
        await router().decide(request(), () => {
          throw new Error("private detail");
        })
      ).destination,
    ).toBe("rejected");
  });

  it("treats disagreement as unresolved, not as a confidence contest", async () => {
    const r = router({ compare: true, jev: new Provider("typesafe", "VERIFY", 0.95) });
    const result = await r.decide(request(), allow);
    expect(result.reason).toBe("ENGINE_DISAGREEMENT");
    expect(result.selected).toBeNull();
    expect(result.attempts.map((a) => a.selected)).toEqual(["CONTINUE", "VERIFY"]);
  });

  it("compares only when both engines are available and calibrated", async () => {
    expect(
      (await router({ compare: true, jev: null }).decide(request(), allow)).destination,
    ).toBe("rain");
    const result = await router({
      compare: true,
      profiles: [profile("typesafe")],
    }).decide(request(), allow);
    expect(result.destination).toBe("rain");
    expect(result.reason).toBe("INSUFFICIENT_CALIBRATION");
  });

  it("sends nothing to a remote engine without the request's consent", async () => {
    const r = router({ laya: null });
    const result = await r.decide(request({ remoteAllowed: false }), allow);
    expect(result.reason).toBe("POLICY_REQUIRES_REVIEW");
    expect(jev(r).calls).toBe(0);
  });

  it("modes are selective", async () => {
    for (const mode of ["jev", "laya", "off"] as const) {
      const r = router({ mode });
      const result = await r.decide(request(), allow);
      expect(laya(r).calls).toBe(mode === "laya" ? 1 : 0);
      expect(jev(r).calls).toBe(mode === "jev" ? 1 : 0);
      expect(result.destination).toBe(mode === "off" ? "rain" : "proposal");
      if (mode === "off") expect(result.reason).toBe("DISABLED");
    }
  });

  it("a deterministic resolution skips the models but not policy or the validator", async () => {
    const r = router();
    const result = await r.decide(request({ deterministicChoice: "VERIFY" }), allow);
    expect(result.selected).toBe("VERIFY");
    expect(result.attempts).toEqual([]);
    expect([laya(r).calls, jev(r).calls]).toEqual([0, 0]);
    const high = await r.decide(
      request({ deterministicChoice: "VERIFY", consequence: "high" }),
      allow,
    );
    expect(high.reason).toBe("HIGH_CONSEQUENCE");
  });

  it("abstains on question drift, model drift and an expired profile", async () => {
    const r = router({ mode: "laya" });
    expect(
      (await r.decide(request({ instructions: "Changed semantics" }), allow)).reason,
    ).toBe("INSUFFICIENT_CALIBRATION");
    r.profiles = [{ ...profile("laya"), model: "different-model" }];
    expect((await r.decide(request(), allow)).reason).toBe("INSUFFICIENT_CALIBRATION");
    r.profiles = [{ ...profile("laya"), expires_at: "2020-01-01T00:00:00+00:00" }];
    expect((await r.decide(request(), allow)).reason).toBe("INSUFFICIENT_CALIBRATION");
  });

  it("escalates a small margin even with a high top probability", async () => {
    const r = router({
      mode: "laya",
      laya: new Provider("laya", "CONTINUE", 0.91),
      profiles: [{ ...profile("laya"), margin: 0.9 }],
    });
    expect((await r.decide(request(), allow)).reason).toBe("MARGIN_TOO_SMALL");
  });

  it("bounds a timed-out provider to one in-flight call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Slow extends Provider {
      override async evaluate(state: JudgmentState, questions: QuestionSet) {
        this.calls += 1;
        await gate;
        return this.result(state, questions);
      }
    }
    const slow = new Slow();
    const r = router({ mode: "laya", laya: slow, timeout: 0.02 });
    try {
      expect((await r.decide(request(), allow)).reason).toBe("TIMEOUT");
      expect((await r.decide(request(), allow)).reason).toBe("TIMEOUT");
      expect(slow.calls).toBe(1);
    } finally {
      release();
    }
  });

  it("rejects malformed results", async () => {
    const mutations: [string, (r: JudgmentResult) => unknown][] = [
      ["state hash", (r) => ({ ...r, stateHash: "wrong" })],
      ["question set version", (r) => ({ ...r, questionSetVersion: "wrong" })],
      ["provider", (r) => ({ ...r, provider: "typesafe" })],
      ["model", (r) => ({ ...r, model: "private details with spaces" })],
      ["value", (r) => ({ ...r, answers: [{ ...r.answers[0]!, value: "OUTSIDE" }] })],
      [
        "NaN",
        (r) => ({
          ...r,
          answers: [{ ...r.answers[0]!, probabilities: [["CONTINUE", NaN]] }],
        }),
      ],
      ["not a result", () => ({ selected: "CONTINUE" })],
    ];
    for (const [label, mutate] of mutations) {
      class Bad extends Provider {
        override async evaluate(state: JudgmentState, questions: QuestionSet) {
          return mutate(this.result(state, questions)) as JudgmentResult;
        }
      }
      const result = await router({ mode: "laya", laya: new Bad() }).decide(
        request(),
        allow,
      );
      expect(result.reason, label).toBe("INVALID_OUTPUT");
      expect(result.selected, label).toBeNull();
    }
  });

  it("lets no configured secret reach a provider or an artifact", async () => {
    const r = router({ env: { CONFIGURED_DECISION_API_KEY: "fixture-secret-value" } });
    const result = await r.decide(request({ state: "fixture-secret-value" }), allow);
    expect(result.reason).toBe("SENSITIVE_INPUT");
    expect(result.attempts).toEqual([]);
    expect([laya(r).calls, jev(r).calls]).toEqual([0, 0]);
    expect(JSON.stringify(envelopeToDict(result))).not.toContain("fixture-secret-value");
  });

  it("refuses invalid requests before inference", () => {
    expect(() => request({ consequence: "unknown" as "low" })).toThrow();
    expect(() => request({ remoteAllowed: "false" as unknown as boolean })).toThrow();
    expect(() =>
      request({
        choices: [
          ["A", "a"],
          ["A", "b"],
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() => request({ state: "x".repeat(24_001) })).toThrow();
    expect(() => request({ deterministicChoice: "ELSEWHERE" })).toThrow();
  });
});
