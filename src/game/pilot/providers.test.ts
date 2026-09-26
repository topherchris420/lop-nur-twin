import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA_VERSION } from "./contract";
import { JevHttpProvider, RandomProvider, newSessionId } from "./providers";
import { fakeAnswers, makeObservation } from "./testing/fixtures";

const observation = makeObservation({ sequence: 5 });

describe("random baseline", () => {
  it("reproduces the same action sequence for the same seed", () => {
    const a = new RandomProvider(42);
    const b = new RandomProvider(42);
    const c = new RandomProvider(43);
    const seqA = Array.from({ length: 200 }, () => a.pick(observation.legal));
    const seqB = Array.from({ length: 200 }, () => b.pick(observation.legal));
    const seqC = Array.from({ length: 200 }, () => c.pick(observation.legal));
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("only ever picks offered options, and covers them", () => {
    const provider = new RandomProvider(7);
    const legal = makeObservation({ weapon: { ammo: 0, reserve: 0 } }).legal;
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const frame = provider.pick(legal);
      expect(legal.weapon).toContain(frame.weapon);
      expect(legal.move).toContain(frame.move);
      seen.add(frame.weapon);
    }
    expect([...seen].sort()).toEqual([...legal.weapon].sort());
  });

  it("reports no probabilities — it has none worth inventing", async () => {
    const result = await new RandomProvider(1).decide({
      sequence: 1,
      observation,
      signal: new AbortController().signal,
    });
    expect(result.ok && result.decision.axes).toBeNull();
    expect(result.ok && result.decision.model).toBeNull();
  });
});

describe("Jev HTTP provider", () => {
  const decide = (fetchImpl: typeof fetch, signal = new AbortController().signal) =>
    new JevHttpProvider("0123456789abcdef", "/api/jev/decision", fetchImpl).decide({
      sequence: 5,
      observation,
      signal,
    });
  const errorBody = (code: string, retryAfterMs: number | null = null) => ({
    schemaVersion: DECISION_SCHEMA_VERSION,
    sequence: 5,
    error: { code, message: "x" },
    retryAfterMs,
  });

  it("sends the session and the observation, and nothing else", async () => {
    let sent: unknown = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json(errorBody("upstream_error"), { status: 502 });
    }) as unknown as typeof fetch;
    await decide(fetchImpl);
    expect(Object.keys(sent as object).sort()).toEqual(["observation", "session"]);
  });

  it("maps HTTP failures to typed failures", async () => {
    const cases: [number, unknown, string][] = [
      [504, errorBody("upstream_timeout"), "timeout"],
      [429, errorBody("rate_limited", 2000), "rate_limited"],
      [503, errorBody("not_configured"), "unavailable"],
      [502, errorBody("upstream_auth"), "unavailable"],
      [404, "<html>", "unavailable"],
      [405, null, "unavailable"],
      [500, errorBody("upstream_error"), "http_error"],
    ];
    for (const [status, body, failure] of cases) {
      const fetchImpl = (async () =>
        typeof body === "string"
          ? new Response(body, { status })
          : Response.json(body, { status })) as unknown as typeof fetch;
      const result = await decide(fetchImpl);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe(failure);
    }
  });

  it("passes the server's retry-after through", async () => {
    const fetchImpl = (async () =>
      Response.json(errorBody("rate_limited", 2500), {
        status: 429,
      })) as unknown as typeof fetch;
    const result = await decide(fetchImpl);
    expect(!result.ok && result.retryAfterMs).toBe(2500);
  });

  it("treats a network error as network and an abort as aborted", async () => {
    const network = (async () => {
      throw new TypeError("failed to fetch");
    }) as unknown as typeof fetch;
    const net = await decide(network);
    expect(!net.ok && net.failure).toBe("network");

    const controller = new AbortController();
    controller.abort();
    const aborted = await decide(network, controller.signal);
    expect(!aborted.ok && aborted.failure).toBe("aborted");
  });

  it("rejects malformed JSON, unknown actions and wrong sequences as invalid", async () => {
    const bodies: unknown[] = [
      "not json",
      { schemaVersion: DECISION_SCHEMA_VERSION, sequence: 5 },
      {
        schemaVersion: DECISION_SCHEMA_VERSION,
        sequence: 4,
        source: "typesafe",
        model: "jev-1.13.0",
        frame: {},
        axes: fakeAnswers(observation.legal),
        latencyMs: 10,
        usage: null,
      },
    ];
    for (const body of bodies) {
      const fetchImpl = (async () =>
        typeof body === "string"
          ? new Response(body, { status: 200 })
          : Response.json(body)) as unknown as typeof fetch;
      const result = await decide(fetchImpl);
      expect(!result.ok && result.failure).toBe("invalid");
    }
  });

  it("refuses to send an observation that fails its own validation", async () => {
    // The shape of the bug that once wedged the pilot: a negative outcome from
    // a statistics reset mid-frame. It must fail here, by name, and cost no request.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({});
    }) as unknown as typeof fetch;
    const bad = makeObservation({ sequence: 5 });
    bad.previous = {
      frame: { move: "HOLD", turn: "NO_TURN", tilt: "NO_TILT", weapon: "FIRE" },
      outcome: {
        shotsFired: -3,
        hitConfirmed: false,
        killConfirmed: false,
        damageTaken: false,
        movementBlocked: false,
      },
    };
    const result = await new JevHttpProvider("0123456789abcdef", "/x", fetchImpl).decide({
      sequence: 5,
      observation: bad,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(0);
    expect(!result.ok && result.failure).toBe("invalid");
    expect(!result.ok && result.detail).toContain("previous.outcome.shotsFired");
  });

  it("session ids are fresh random hex", () => {
    const a = newSessionId();
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(newSessionId()).not.toBe(a);
  });
});
