import { describe, expect, it } from "vitest";
import { createDecisionRouter, enabled } from "./config.js";
import { profile, request } from "./fixtures.js";
import { TypeSafeJudgmentProvider } from "./typesafe.js";

/** Explicit routing configuration; defaults construct no provider. */
describe("decision configuration", () => {
  it("is off by default and constructs no provider", async () => {
    const config = createDecisionRouter({});
    expect([config.mode, config.remoteAllowed]).toEqual(["off", false]);
    expect(config.router.jev).toBeNull();
    const result = await config.router.decide(request(), () => true);
    expect([result.destination, result.reason]).toEqual(["rain", "DISABLED"]);
  });

  it("refuses the modes that need R.A.I.N.'s Laya worker", () => {
    for (const mode of ["laya", "cascade"])
      expect(() => createDecisionRouter({ RAIN_DECISION_MODE: mode })).toThrow(
        /Laya worker/,
      );
    expect(() => createDecisionRouter({ RAIN_DECISION_MODE: "weird" })).toThrow(
      /unsupported decision mode/,
    );
  });

  it("builds a Jev router from the environment, with the credential passed by value", async () => {
    const config = createDecisionRouter(
      {
        RAIN_DECISION_MODE: "jev",
        RAIN_DECISION_REMOTE_ALLOWED: "true",
        RAIN_DECISION_TIMEOUT: "5",
        RAIN_DECISION_MINIMUM_SAMPLES: "50",
      },
      {
        decisionApiKey: "k".repeat(24),
        decisionModel: "jev-2",
        calibrationText: JSON.stringify([profile("typesafe")]),
        fetchImpl: async () =>
          new Response(JSON.stringify({ nothing: true }), {
            status: 500,
          }),
      },
    );
    expect([config.mode, config.remoteAllowed]).toEqual(["jev", true]);
    expect(config.router.jev).toBeInstanceOf(TypeSafeJudgmentProvider);
    expect((config.router.jev as TypeSafeJudgmentProvider).model).toBe("jev-2");
    expect([config.router.timeout, config.router.minimumSamples]).toEqual([5, 50]);
    expect(config.router.profiles).toHaveLength(1);
    const result = await config.router.decide(request(), () => true);
    expect(result.destination).toBe("rain");
    expect(result.attempts[0]!.errorCode).toBe("provider_http_error");
  });

  it("answers provider_not_configured when jev mode has no credential", async () => {
    const config = createDecisionRouter({ RAIN_DECISION_MODE: "jev" });
    expect(config.remoteAllowed).toBe(false);
    const result = await config.router.decide(request(), () => true);
    expect(result.reason).toBe("MODEL_UNAVAILABLE");
    expect(result.attempts[0]!.errorCode).toBe("provider_not_configured");
  });

  it("rejects malformed settings instead of guessing", () => {
    expect(() => createDecisionRouter({ RAIN_DECISION_REMOTE_ALLOWED: "yes" })).toThrow(
      /must be true or false/,
    );
    expect(() =>
      createDecisionRouter({ RAIN_DECISION_MODE: "jev", RAIN_DECISION_TIMEOUT: "soon" }),
    ).toThrow(/RAIN_DECISION_TIMEOUT/);
    expect(() =>
      createDecisionRouter({
        RAIN_DECISION_MODE: "jev",
        RAIN_DECISION_MINIMUM_SAMPLES: "1.5",
      }),
    ).toThrow(/RAIN_DECISION_MINIMUM_SAMPLES/);
    expect(() =>
      createDecisionRouter({ RAIN_DECISION_MODE: "jev" }, { calibrationText: "{}" }),
    ).toThrow(/invalid calibration file/);
    expect(enabled({ X: " TRUE " }, "X")).toBe(true);
    expect(enabled({}, "X")).toBe(false);
  });
});
