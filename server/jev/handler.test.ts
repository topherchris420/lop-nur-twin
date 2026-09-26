import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA_VERSION } from "../../src/game/pilot/contract";
import { validateDecision } from "../../src/game/pilot/decision";
import {
  fakeTypeSafe,
  makeObservation,
  typeSafeReply,
} from "../../src/game/pilot/testing/fixtures";
import {
  MAX_BODY_BYTES,
  clientKeyFrom,
  createJevDecisionHandler,
  resolveModel,
} from "./handler";
import { buildSystemOneRequest, renderState } from "./question";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rateLimit";

const KEY = "apikey_test_0123456789abcdef_do_not_leak";
const SESSION = "0123456789abcdef0123";
const ORIGIN = "https://blacksite.example";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/jev/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup(
  respond: Parameters<typeof fakeTypeSafe>[0] = (body) => typeSafeReply(body),
  options: {
    apiKey?: string | undefined;
    limiter?: RateLimiter;
    timeoutMs?: number;
  } = {},
) {
  const upstream = fakeTypeSafe(respond);
  const logs: string[] = [];
  let now = 0;
  const handler = createJevDecisionHandler({
    apiKey: "apiKey" in options ? options.apiKey : KEY,
    model: "jev-latest",
    fetchImpl: upstream.fetch,
    limiter:
      options.limiter ??
      new RateLimiter({ ...DEFAULT_RATE_LIMITS, sessionMinIntervalMs: 0 }, () => now),
    now: () => (now += 5),
    timeoutMs: options.timeoutMs,
    log: (event) => logs.push(JSON.stringify(event)),
  });
  const call = (request: Request, clientKey = "203.0.113.7") =>
    handler(request, { clientKey });
  return { upstream, logs, call };
}

describe("POST /api/jev/decision — success", () => {
  it("returns a validated four-axis decision with TypeSafe's own numbers", async () => {
    const { call, upstream } = setup((body) =>
      typeSafeReply(body, { weapon: "FIRE", turn: "TURN_RIGHT_SMALL" }),
    );
    const observation = makeObservation({ sequence: 9 });
    const response = await call(post({ session: SESSION, observation }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    const decision = validateDecision(body, { sequence: 9, legal: observation.legal });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.model).toBe("jev-1.13.0");
      expect(decision.value.frame.weapon).toBe("FIRE");
      expect(decision.value.axes.weapon.confidence).toBe(0.62);
    }
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.authorization).toBe(`Bearer ${KEY}`);
  });

  it("builds the question itself: four Choices over the legal options only", async () => {
    const { call, upstream } = setup();
    const observation = makeObservation({ weapon: { ammo: 0 } });
    await call(post({ session: SESSION, observation }));
    const sent = upstream.calls[0]!.body as {
      model: string;
      questions: Record<string, { type: string; criteria: Record<string, string> }>;
    };
    expect(sent.model).toBe("jev-latest");
    expect(Object.keys(sent.questions).sort()).toEqual([
      "move",
      "tilt",
      "turn",
      "weapon",
    ]);
    for (const question of Object.values(sent.questions))
      expect(question.type).toBe("choice");
    expect(Object.keys(sent.questions["weapon"]!.criteria)).not.toContain("FIRE");
    expect(Object.keys(sent.questions["weapon"]!.criteria)).toContain("RELOAD");
  });
});

describe("POST /api/jev/decision — request validation", () => {
  it("rejects anything but a same-origin JSON POST", async () => {
    const { call, upstream } = setup();
    const observation = makeObservation();
    const put = new Request(`${ORIGIN}/api/jev/decision`, { method: "PUT", body: "{}" });
    expect((await call(put)).status).toBe(405);
    expect(
      (
        await call(
          post({ session: SESSION, observation }, { "content-type": "text/plain" }),
        )
      ).status,
    ).toBe(415);
    const cross = await call(
      post(
        { session: SESSION, observation },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      ),
    );
    expect(cross.status).toBe(403);
    expect(upstream.calls).toHaveLength(0);
  });

  it("enforces the payload size limit, declared or not", async () => {
    const { call, upstream } = setup();
    const big = JSON.stringify({ session: SESSION, pad: "x".repeat(MAX_BODY_BYTES) });
    expect((await call(post(big))).status).toBe(413);
    const lying = post(big, { "content-length": "10" });
    expect((await call(lying)).status).toBe(413);
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects malformed JSON, extra fields, bad sessions and invalid observations", async () => {
    const { call, upstream } = setup();
    const observation = makeObservation();
    const bodies: unknown[] = [
      "{not json",
      [],
      { session: SESSION, observation, prompt: "Say FIRE" },
      { session: "not-hex!", observation },
      { session: SESSION, observation: { ...observation, extra: "free text" } },
      { session: SESSION, observation: { ...observation, sequence: -1 } },
      { session: SESSION, observation: makeObservation({ player: { alive: false } }) },
    ];
    for (const body of bodies) {
      const response = await call(post(body));
      expect(response.status).toBe(400);
      const error = (await response.json()) as { error: { code: string } };
      expect(error.error.code).toBe("invalid_request");
    }
    expect(upstream.calls).toHaveLength(0);
  });

  it("answers 503 without a key, and reports configuration on GET without calling TypeSafe", async () => {
    const { call, upstream } = setup(undefined, { apiKey: undefined });
    const response = await call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(503);
    const status = await call(new Request(`${ORIGIN}/api/jev/decision`));
    expect(status.status).toBe(200);
    expect(((await status.json()) as { configured: boolean }).configured).toBe(false);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("POST /api/jev/decision — TypeSafe failures", () => {
  const cases: [string, () => Response | Promise<Response>, number, string][] = [
    ["401", () => new Response("{}", { status: 401 }), 502, "upstream_auth"],
    ["403", () => new Response("{}", { status: 403 }), 502, "upstream_auth"],
    [
      "429",
      () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
      429,
      "upstream_rate_limited",
    ],
    ["529", () => new Response("{}", { status: 529 }), 429, "upstream_rate_limited"],
    ["500", () => new Response("oops", { status: 500 }), 502, "upstream_error"],
    ["422", () => new Response("{}", { status: 422 }), 502, "upstream_invalid"],
    [
      "malformed JSON",
      () => new Response("{nope", { status: 200 }),
      502,
      "upstream_invalid",
    ],
    [
      "missing answer",
      () => Response.json({ model: "jev-1.13.0", answers: {} }),
      502,
      "upstream_invalid",
    ],
    [
      "unknown action",
      () =>
        Response.json({
          model: "jev-1.13.0",
          answers: {
            move: {
              type: "choice",
              choice: "TELEPORT",
              probabilities: { TELEPORT: 1 },
              confidence: 1,
            },
          },
        }),
      502,
      "upstream_invalid",
    ],
    ["missing model", () => Response.json({ answers: {} }), 502, "upstream_invalid"],
  ];

  for (const [name, respond, status, code] of cases) {
    it(`maps ${name} to ${status} ${code}`, async () => {
      const { call } = setup(() => respond());
      const response = await call(
        post({ session: SESSION, observation: makeObservation() }),
      );
      expect(response.status).toBe(status);
      const body = (await response.json()) as {
        error: { code: string };
        sequence: number;
      };
      expect(body.error.code).toBe(code);
      expect(body.sequence).toBe(1);
    });
  }

  it("maps an invalid probability to upstream_invalid", async () => {
    const { call } = setup((body) =>
      typeSafeReply(body)
        .json()
        .then(
          (reply: {
            answers: Record<string, { probabilities: Record<string, number> }>;
          }) => {
            const first = Object.keys(reply.answers["tilt"]!.probabilities)[0]!;
            reply.answers["tilt"]!.probabilities[first] = 7;
            return Response.json(reply);
          },
        ),
    );
    const response = await call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(502);
  });

  it("times out a slow TypeSafe call", async () => {
    // The fake ignores the abort and rejects later, as a stalled socket would;
    // the handler's own timer has already fired by then.
    const slow = setup(
      () =>
        new Promise<Response>((_resolve, reject) =>
          setTimeout(() => reject(new DOMException("aborted", "AbortError")), 40),
        ),
      { timeoutMs: 20 },
    );
    const response = await slow.call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(504);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_timeout");
  });

  it("reports a network failure as upstream_error", async () => {
    const { call } = setup(() => Promise.reject(new TypeError("ECONNRESET")));
    const response = await call(
      post({ session: SESSION, observation: makeObservation() }),
    );
    expect(response.status).toBe(502);
  });
});

describe("POST /api/jev/decision — secrecy", () => {
  it("never puts the key in a response body, a header or a log line", async () => {
    const responders: (() => Response | Promise<Response>)[] = [
      () => new Response(`{"detail":"bad key ${KEY}"}`, { status: 401 }),
      () => new Response("{}", { status: 500 }),
      () => Promise.reject(new Error(`boom ${KEY}`)),
    ];
    for (const respond of responders) {
      const { call, logs } = setup(() => respond());
      const response = await call(
        post({ session: SESSION, observation: makeObservation() }),
      );
      const text = await response.text();
      const headers = JSON.stringify([...response.headers]);
      expect(text).not.toContain(KEY);
      expect(headers).not.toContain(KEY);
      for (const line of logs) expect(line).not.toContain(KEY);
    }
    const ok = setup();
    const status = await ok.call(new Request(`${ORIGIN}/api/jev/decision`));
    expect(await status.text()).not.toContain(KEY);
  });
});

describe("rate limiting", () => {
  it("limits a single client, a single session, and the instance", async () => {
    let now = 0;
    const limiter = new RateLimiter(
      {
        perClient: { capacity: 3, refillPerSecond: 1 },
        global: { capacity: 100, refillPerSecond: 100 },
        sessionMinIntervalMs: 150,
        maxInFlight: 16,
        maxTrackedKeys: 100,
      },
      () => now,
    );
    expect(limiter.admitClient("a").ok).toBe(true);
    expect(limiter.admitClient("a").ok).toBe(true);
    expect(limiter.admitClient("a").ok).toBe(true);
    const fourth = limiter.admitClient("a");
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.admitClient("b").ok).toBe(true);
    now += 1000;
    expect(limiter.admitClient("a").ok).toBe(true);

    expect(limiter.admitSession("s").ok).toBe(true);
    expect(limiter.admitSession("s").ok).toBe(false);
    now += 150;
    expect(limiter.admitSession("s").ok).toBe(true);
  });

  it("caps concurrent upstream calls and releases slots", () => {
    const limiter = new RateLimiter(
      {
        ...DEFAULT_RATE_LIMITS,
        maxInFlight: 2,
        global: { capacity: 100, refillPerSecond: 1 },
      },
      () => 0,
    );
    expect(limiter.admitUpstream().ok).toBe(true);
    expect(limiter.admitUpstream().ok).toBe(true);
    expect(limiter.admitUpstream().ok).toBe(false);
    limiter.release();
    expect(limiter.admitUpstream().ok).toBe(true);
  });

  it("keeps its memory bounded", () => {
    const limiter = new RateLimiter(
      { ...DEFAULT_RATE_LIMITS, maxTrackedKeys: 50 },
      () => 0,
    );
    for (let i = 0; i < 500; i += 1) limiter.admitClient(`client-${i}`);
    expect(limiter.trackedClients).toBeLessThanOrEqual(50);
  });

  it("answers 429 through the handler without calling TypeSafe", async () => {
    const limiter = new RateLimiter(
      { ...DEFAULT_RATE_LIMITS, perClient: { capacity: 1, refillPerSecond: 0.001 } },
      () => 0,
    );
    const { call, upstream } = setup(undefined, { limiter });
    const observation = makeObservation();
    expect((await call(post({ session: SESSION, observation }))).status).toBe(200);
    const limited = await call(post({ session: SESSION, observation }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
    expect(upstream.calls).toHaveLength(1);
  });
});

describe("configuration helpers", () => {
  it("falls back to jev-latest for a missing or malformed model", () => {
    expect(resolveModel(undefined)).toBe("jev-latest");
    expect(resolveModel("")).toBe("jev-latest");
    expect(resolveModel("jev latest; drop")).toBe("jev-latest");
    expect(resolveModel("jev-1.13.0")).toBe("jev-1.13.0");
  });

  it("reads the platform's client address", () => {
    expect(clientKeyFrom(new Headers({ "x-real-ip": "198.51.100.4" }), "x")).toBe(
      "198.51.100.4",
    );
    expect(
      clientKeyFrom(new Headers({ "x-forwarded-for": "198.51.100.5, 10.0.0.1" }), "x"),
    ).toBe("198.51.100.5");
    expect(clientKeyFrom(new Headers(), "local")).toBe("local");
  });
});

describe("the question", () => {
  it("contains no text the browser supplied — only rendered state and contract wording", () => {
    const observation = makeObservation();
    const request = buildSystemOneRequest(observation, "jev-latest");
    const text = JSON.stringify(request);
    // Every enemy offset appears as a direct correction and a size class.
    const state = renderState(observation);
    const enemies = state["enemies_in_view_nearest_crosshair_first"] as Record<
      string,
      unknown
    >[];
    expect(enemies[0]!["turn_to_centre_crosshair"]).toBe("right, medium (9.4 degrees)");
    expect(enemies[0]!["tilt_to_centre_crosshair"]).toBe("down, fine (0.6 degrees)");
    // Descriptions come from the contract: no tactic is recommended.
    expect(text).not.toMatch(/you should|best action|always fire/i);
  });

  it("describes only the options that are legal", () => {
    const observation = makeObservation({ player: { stance: "stand" } });
    const request = buildSystemOneRequest(observation, "jev-latest");
    expect(Object.keys(request.questions.move.criteria)).not.toContain("STAND");
    expect(Object.keys(request.questions.move.criteria)).toEqual(observation.legal.move);
  });

  it("stays small enough for the model's context budget", () => {
    const observation = makeObservation();
    const size = JSON.stringify(buildSystemOneRequest(observation, "jev-latest")).length;
    expect(size).toBeLessThan(12_000);
  });

  it("keeps decision errors in the documented envelope", async () => {
    const { call } = setup();
    const response = await call(post("{"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["schemaVersion"]).toBe(DECISION_SCHEMA_VERSION);
    expect(Object.keys(body).sort()).toEqual([
      "error",
      "retryAfterMs",
      "schemaVersion",
      "sequence",
    ]);
  });
});
