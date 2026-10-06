import { describe, expect, it } from "vitest";
import { questionsOf } from "./routing.js";
import { request } from "./fixtures.js";
import { TypeSafeJudgmentProvider, parseResponse } from "./typesafe.js";

/** The remote engine's adapter: what leaves, what comes back, and what is refused. */
const KEY = "fixture-key-0123456789abcdef";
const questions = questionsOf(request());
const state = {
  canonicalText: "A bounded step remains unfinished.",
  stateHash: "h".repeat(64),
};

type Call = { url: string; init: RequestInit };
function server(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  };
  return { calls, fetchImpl };
}
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const good = () =>
  json({
    model: "jev-latest",
    answers: {
      next_action: {
        type: "choice",
        choice: "CONTINUE",
        probabilities: { CONTINUE: 0.9, VERIFY: 0.1 },
        confidence: 0.9,
      },
    },
    usage: { input_tokens: 10, output_tokens: 2 },
  });

describe("TypeSafe judgment provider", () => {
  it("sends the SystemOne question with a bearer token and parses the typed answer", async () => {
    const { calls, fetchImpl } = server(good);
    const provider = new TypeSafeJudgmentProvider({ apiKey: KEY, fetchImpl });
    const result = await provider.evaluate(state, questions);
    expect(result.errorCode).toBeNull();
    expect(result.provider).toBe("typesafe");
    expect(result.model).toBe("jev-latest");
    expect(result.answers[0]!.value).toBe("CONTINUE");
    expect(result.answers[0]!.probabilities).toEqual([
      ["CONTINUE", 0.9],
      ["VERIFY", 0.1],
    ]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(call!.init.redirect).toBe("error");
    const body = JSON.parse(String(call!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("jev-latest");
    expect(body.state).toBe(state.canonicalText);
    expect(body.questions).toEqual({
      next_action: {
        type: "choice",
        instructions: "Choose a next step.",
        criteria: { CONTINUE: "Continue analysis.", VERIFY: "Verify evidence." },
      },
    });
  });

  it("is not configured without a key, and refuses a state that carries the key", async () => {
    const { calls, fetchImpl } = server(good);
    const unconfigured = new TypeSafeJudgmentProvider({ apiKey: undefined, fetchImpl });
    expect((await unconfigured.evaluate(state, questions)).errorCode).toBe(
      "provider_not_configured",
    );
    const provider = new TypeSafeJudgmentProvider({ apiKey: KEY, fetchImpl });
    const leaked = await provider.evaluate(
      { canonicalText: `the key is ${KEY}`, stateHash: state.stateHash },
      questions,
    );
    expect(leaked.errorCode).toBe("state_contains_secret");
    expect(leaked.model).toBeNull();
    const configured = new TypeSafeJudgmentProvider({
      apiKey: KEY,
      fetchImpl,
      env: { CONFIGURED_MODEL_API_KEY: "another-secret-value" },
    });
    expect(
      (
        await configured.evaluate(
          { canonicalText: "contains another-secret-value", stateHash: state.stateHash },
          questions,
        )
      ).errorCode,
    ).toBe("state_contains_secret");
    expect(calls).toEqual([]);
  });

  it("maps transport and HTTP failures to safe error codes", async () => {
    const cases: [() => Response, string][] = [
      [() => json({}, 401), "provider_authentication_error"],
      [() => json({}, 403), "provider_authentication_error"],
      [() => json({}, 429), "provider_rate_limited"],
      [() => json({}, 529), "provider_overloaded"],
      [() => json({}, 500), "provider_http_error"],
      [() => json({ model: "jev-latest", leaked: KEY }), "provider_malformed_response"],
      [() => new Response("[NaN]"), "provider_malformed_response"],
      [() => new Response("not json"), "provider_malformed_response"],
      [() => new Response("x".repeat(100_001)), "provider_response_too_large"],
    ];
    for (const [answer, code] of cases) {
      const provider = new TypeSafeJudgmentProvider({
        apiKey: KEY,
        fetchImpl: server(answer).fetchImpl,
      });
      const result = await provider.evaluate(state, questions);
      expect(result.errorCode, code).toBe(code);
      expect(result.answers).toEqual([]);
    }
    const down = new TypeSafeJudgmentProvider({
      apiKey: KEY,
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });
    expect((await down.evaluate(state, questions)).errorCode).toBe(
      "provider_transport_error",
    );
    expect(
      () => new TypeSafeJudgmentProvider({ apiKey: KEY, model: "not a model" }),
    ).toThrow();
  });

  it("copies only documented, validated fields from a response", () => {
    const base = {
      model: "jev-latest",
      answers: {
        next_action: {
          type: "choice",
          choice: "CONTINUE",
          probabilities: { CONTINUE: 0.9, VERIFY: 0.1 },
          confidence: 0.9,
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    };
    expect(parseResponse(base, state, questions).answers[0]!.confidence).toBe(0.9);
    const bad: unknown[] = [
      { ...base, model: "http://x" },
      { ...base, answers: { ...base.answers, extra: base.answers.next_action } },
      { ...base, usage: { input_tokens: -1, output_tokens: 2 } },
      {
        ...base,
        answers: {
          next_action: {
            ...base.answers.next_action,
            probabilities: { CONTINUE: 0.5, VERIFY: 0.1 },
          },
        },
      },
      {
        ...base,
        answers: { next_action: { ...base.answers.next_action, choice: "ELSEWHERE" } },
      },
      {
        ...base,
        answers: { next_action: { ...base.answers.next_action, type: "score" } },
      },
      [],
    ];
    for (const payload of bad)
      expect(
        () => parseResponse(payload, state, questions),
        JSON.stringify(payload),
      ).toThrow();
  });
});
