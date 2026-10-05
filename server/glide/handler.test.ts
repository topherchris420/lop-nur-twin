import { describe, expect, it } from "vitest";
import { GLIDE_CAPABILITIES } from "../../src/game/pilot/capabilities";
import { validateDecision } from "../../src/game/pilot/decision";
import {
  fakeTypeSafe,
  makeObservation,
  typeSafeReply,
} from "../../src/game/pilot/testing/fixtures";
import { createJevDecisionHandler, resolveModel } from "../jev/handler";
import { joinInstructions } from "../jev/question";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "../jev/rateLimit";
import {
  FASTINO_ENDPOINT,
  FASTINO_UPSTREAM,
  GLIDE_UPSTREAM_TIMEOUT_MS,
  createGlideDecisionHandler,
} from "./handler";

const KEY = "fast_sk_test_0123456789abcdef_do_not_leak";
const SESSION = "0123456789abcdef0123";
const ORIGIN = "https://blacksite.example";

function post(body: unknown, path = "/api/glide/decision"): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

/** Fastino's reply: TypeSafe's wire shape, naming the model it ran. */
async function glideReply(
  body: Record<string, unknown>,
  pick: Parameters<typeof typeSafeReply>[1] = {},
): Promise<Response> {
  const reply = (await typeSafeReply(body, pick).json()) as Record<string, unknown>;
  return Response.json({ ...reply, model: "glide", token_usage: 1480 });
}

function setup(
  respond: Parameters<typeof fakeTypeSafe>[0] = (body) => glideReply(body),
  options: { apiKey?: string | undefined; model?: string } = {},
) {
  const upstream = fakeTypeSafe(respond);
  const logs: string[] = [];
  let now = 0;
  const handler = createGlideDecisionHandler({
    apiKey: "apiKey" in options ? options.apiKey : KEY,
    model: options.model,
    fetchImpl: upstream.fetch,
    limiter: new RateLimiter(
      { ...DEFAULT_RATE_LIMITS, sessionMinIntervalMs: 0 },
      () => now,
    ),
    now: () => (now += 5),
    log: (event) => logs.push(JSON.stringify(event)),
  });
  const call = (request: Request) => handler(request, { clientKey: "203.0.113.7" });
  return { upstream, logs, call };
}

describe("POST /api/glide/decision — success", () => {
  it("asks Fastino and returns a decision sourced to it, with its own numbers", async () => {
    const { call, upstream } = setup((body) =>
      glideReply(body, { weapon: "FIRE", turn: "TURN_RIGHT_SMALL" }),
    );
    const observation = makeObservation({ sequence: 9 });
    const response = await call(post({ session: SESSION, observation }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["source"]).toBe("fastino");
    expect(body["model"]).toBe("glide");
    const decision = validateDecision(body, {
      sequence: 9,
      legal: observation.legal,
      source: "fastino",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.frame.weapon).toBe("FIRE");
      expect(decision.value.usage).toEqual({ inputTokens: 1400, outputTokens: 80 });
    }
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.url).toBe(FASTINO_ENDPOINT);
    expect(upstream.calls[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(upstream.calls[0]!.body["model"]).toBe("fastino/glide");
  });

  it("is never accepted as Jev's answer, nor Jev's as Glide's", async () => {
    const { call } = setup();
    const observation = makeObservation({ sequence: 4 });
    const body = await (await call(post({ session: SESSION, observation }))).json();
    const asJev = validateDecision(body, { sequence: 4, legal: observation.legal });
    expect(asJev).toEqual({
      ok: false,
      error: "decision from fastino, expected typesafe",
    });
    const jev = createJevDecisionHandler({
      apiKey: KEY,
      fetchImpl: fakeTypeSafe((b) => typeSafeReply(b)).fetch,
    });
    const jevBody = await (
      await jev(post({ session: SESSION, observation }, "/api/jev/decision"), {
        clientKey: "203.0.113.8",
      })
    ).json();
    expect(
      validateDecision(jevBody, {
        sequence: 4,
        legal: observation.legal,
        source: "fastino",
      }).ok,
    ).toBe(false);
  });
});

describe("Glide is asked Jev's question", () => {
  const cases = [
    ["direct, steps", makeObservation()],
    [
      "precision, places",
      makeObservation({ control: "precision", navigation: "places" }),
    ],
  ] as const;

  for (const [label, observation] of cases) {
    it(`the same state, options and words — ${label}`, async () => {
      const glide = setup();
      await glide.call(post({ session: SESSION, observation }));
      const jevUpstream = fakeTypeSafe((b) => typeSafeReply(b));
      const jev = createJevDecisionHandler({ apiKey: KEY, fetchImpl: jevUpstream.fetch });
      await jev(post({ session: SESSION, observation }, "/api/jev/decision"), {
        clientKey: "203.0.113.9",
      });
      type Asked = {
        state: unknown;
        questions: Record<
          string,
          { type: string; instructions: unknown; criteria: unknown }
        >;
      };
      const g = glide.upstream.calls[0]!.body as unknown as Asked;
      const j = jevUpstream.calls[0]!.body as unknown as Asked;
      expect(g.state).toEqual(j.state);
      expect(Object.keys(g.questions)).toEqual(Object.keys(j.questions));
      for (const axis of Object.keys(j.questions)) {
        const jq = j.questions[axis]!;
        const gq = g.questions[axis]!;
        const parts = jq.instructions as { context: string; question: string };
        // The only difference is the envelope Fastino requires: one string.
        expect(typeof gq.instructions).toBe("string");
        expect(gq.instructions).toBe(joinInstructions(parts.context, parts.question));
        expect(gq.criteria).toEqual(jq.criteria);
        expect(gq.type).toBe(jq.type);
      }
    });
  }
});

describe("POST /api/glide/decision — configuration and failures", () => {
  it("names the missing credential, never a value, and calls nobody", async () => {
    const { call, upstream } = setup(undefined, { apiKey: undefined });
    const response = await call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({
      code: "not_configured",
      message: "FASTINO_API_KEY is not configured.",
    });
    expect(upstream.calls).toHaveLength(0);
  });

  it("reports its status without spending a request", async () => {
    const { call, upstream } = setup();
    const response = await call(new Request(`${ORIGIN}/api/glide/decision`));
    const status = (await response.json()) as Record<string, unknown>;
    expect(status["service"]).toBe("blacksite-glide");
    expect(status["configured"]).toBe(true);
    expect(status["model"]).toBe("fastino/glide");
    expect(status["capabilities"]).toEqual(GLIDE_CAPABILITIES);
    expect((status["limits"] as Record<string, unknown>)["upstreamTimeoutMs"]).toBe(
      GLIDE_UPSTREAM_TIMEOUT_MS,
    );
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(upstream.calls).toHaveLength(0);
  });

  it("accepts Fastino's model ids and falls back on malformed ones", () => {
    const resolve = (value: string | undefined) => resolveModel(value, FASTINO_UPSTREAM);
    expect(resolve(undefined)).toBe("fastino/glide");
    expect(resolve(" fastino/GLiNER-2.5-Decide ")).toBe("fastino/GLiNER-2.5-Decide");
    expect(resolve("3f1c9a2e-7b4d-4e8a-9c1f-0a2b3c4d5e6f")).toBe(
      "3f1c9a2e-7b4d-4e8a-9c1f-0a2b3c4d5e6f",
    );
    for (const bad of ["a/b/c", "/glide", "glide/", "fastino glide", "<script>"])
      expect(resolve(bad)).toBe("fastino/glide");
    // Jev's own rule is unchanged: no slash in a TypeSafe model id.
    expect(resolveModel("fastino/glide")).toBe("jev-latest");
  });

  it("says Fastino, not TypeSafe, and keeps the key out of every failure", async () => {
    for (const [status, code, message] of [
      [401, "upstream_auth", "Fastino rejected the server's credentials."],
      [422, "upstream_invalid", "Fastino rejected the question."],
      [500, "upstream_error", "Fastino returned HTTP 500."],
    ] as const) {
      const { call, logs } = setup(() =>
        Response.json({ error: { message: `bad key ${KEY}` } }, { status }),
      );
      const response = await call(
        post({ session: SESSION, observation: makeObservation() }),
      );
      const text = await response.text();
      expect(response.status).toBe(502);
      expect(JSON.parse(text).error).toEqual({ code, message });
      expect(text).not.toContain(KEY);
      expect(logs.join("\n")).not.toContain(KEY);
      expect(logs.join("\n")).toContain("glide_decision_error");
    }
  });

  it("refuses an answer that does not cover the offered options", async () => {
    const { call } = setup(async (body) => {
      const reply = (await (await glideReply(body)).json()) as {
        answers: Record<string, { probabilities: Record<string, number> }>;
      };
      delete reply.answers["move"]!.probabilities["HOLD"];
      return Response.json(reply);
    });
    const response = await call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_invalid");
    expect(body.error.message).toMatch(/^Fastino's answer failed validation: move:/);
  });

  it("does not answer for the Bethesda city: that observation is Jev's", async () => {
    const { call, upstream } = setup();
    const response = await call(
      post({ session: SESSION, observation: { schema: "bethesda-observation/v3" } }),
    );
    expect(response.status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });
});
