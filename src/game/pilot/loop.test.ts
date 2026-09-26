import { beforeEach, describe, expect, it } from "vitest";
import {
  IDLE_FRAME,
  MAX_DECISION_AGE_MS,
  MIN_DECISION_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
} from "./contract";
import {
  DecisionLoop,
  type AcceptedDecision,
  type DecisionProvider,
  type DecisionRequest,
  type LoopClock,
  type LoopContext,
  type LoopEvent,
  type ProviderResult,
} from "./loop";
import { makeObservation } from "./testing/fixtures";

/** A clock whose time and timers only move when the test says so. */
class FakeClock implements LoopClock {
  time = 1000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  advance(ms: number): void {
    this.time += ms;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const timer of due) timer.fn();
  }
}

/** A provider whose answers are resolved by hand, in any order. */
class ManualProvider implements DecisionProvider {
  readonly kind = "jev" as const;
  readonly pending: { request: DecisionRequest; resolve: (r: ProviderResult) => void }[] =
    [];
  decide(request: DecisionRequest): Promise<ProviderResult> {
    return new Promise((resolve) => {
      this.pending.push({ request, resolve });
      request.signal.addEventListener("abort", () =>
        resolve({ ok: false, failure: "aborted", detail: "aborted", retryAfterMs: null }),
      );
    });
  }
}

const ok = (): ProviderResult => ({
  ok: true,
  decision: {
    frame: IDLE_FRAME,
    axes: null,
    model: "jev-1.13.0",
    serverLatencyMs: 90,
    usage: null,
  },
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("decision loop", () => {
  let clock: FakeClock;
  let provider: ManualProvider;
  let accepted: AcceptedDecision[];
  let events: LoopEvent[];
  let loop: DecisionLoop;
  let context: LoopContext;
  let captures: number;

  beforeEach(() => {
    clock = new FakeClock();
    provider = new ManualProvider();
    accepted = [];
    events = [];
    captures = 0;
    loop = new DecisionLoop({
      primary: provider,
      clock,
      onDecision: (d) => accepted.push(d),
      onEvent: (e) => events.push(e),
    });
    context = {
      eligible: true,
      lifeId: 1,
      capture: (sequence) => {
        captures += 1;
        return makeObservation({ sequence });
      },
    };
  });

  it("keeps at most one request in flight and never queues", () => {
    loop.tick(context);
    clock.advance(MIN_DECISION_INTERVAL_MS * 5);
    loop.tick(context);
    loop.tick(context);
    expect(provider.pending).toHaveLength(1);
    expect(captures).toBe(1);
  });

  it("issues monotonic sequence numbers and paces requests", async () => {
    loop.tick(context);
    provider.pending[0]!.resolve(ok());
    await flush();
    loop.tick(context); // too soon: the minimum interval has not passed
    expect(provider.pending).toHaveLength(1);
    clock.advance(MIN_DECISION_INTERVAL_MS);
    loop.tick(context);
    expect(provider.pending.map((p) => p.request.sequence)).toEqual([1, 2]);
    expect(accepted.map((d) => d.sequence)).toEqual([1]);
  });

  it("accepts an answer only for the request in flight", async () => {
    loop.tick(context);
    const first = provider.pending[0]!;
    first.resolve(ok());
    await flush();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.observation.sequence).toBe(1);
    expect(accepted[0]!.provider).toBe("jev");
    expect(accepted[0]!.fallback).toBe(false);
  });

  it("rejects a stale answer for an abandoned request (out-of-order arrival)", async () => {
    loop.tick(context);
    const first = provider.pending[0]!;
    loop.abandon(); // e.g. death, pause, takeover
    clock.advance(MIN_DECISION_INTERVAL_MS);
    loop.tick(context);
    const second = provider.pending[1]!;
    // Sequence 2 is answered first, then sequence 1 arrives late.
    second.resolve(ok());
    await flush();
    first.resolve(ok());
    await flush();
    expect(accepted.map((d) => d.sequence)).toEqual([2]);
  });

  it("counts a second answer for the same request as a duplicate", async () => {
    loop.tick(context);
    const flight = provider.pending[0]!;
    flight.resolve(ok());
    flight.resolve(ok()); // a promise settles once; a buggy provider cannot add a second
    await flush();
    expect(accepted).toHaveLength(1);
  });

  it("rejects an answer for a previous life", async () => {
    loop.tick(context);
    const flight = provider.pending[0]!;
    flight.resolve(ok());
    context.lifeId = 2; // the player died or respawned while the request was out
    await flush();
    expect(accepted).toHaveLength(0);
    expect(events.some((e) => e.kind === "stale")).toBe(true);
  });

  it("rejects an answer older than the maximum decision age", async () => {
    loop.tick(context);
    const flight = provider.pending[0]!;
    clock.time += MAX_DECISION_AGE_MS + 1; // arrives late without firing the timeout
    flight.resolve(ok());
    await flush();
    expect(accepted).toHaveLength(0);
    const stale = events.find((e) => e.kind === "stale");
    expect(stale && stale.kind === "stale" && stale.reason).toContain("too old");
  });

  it("times out a request, reports TIMEOUT, and asks again after a short backoff", async () => {
    loop.tick(context);
    clock.advance(REQUEST_TIMEOUT_MS + 1);
    await flush();
    const failure = events.find((e) => e.kind === "failure");
    expect(failure && failure.kind === "failure" && failure.failure).toBe("timeout");
    expect(loop.inFlight).toBe(false);
    loop.tick(context);
    expect(provider.pending).toHaveLength(1); // backing off
    clock.advance(300);
    loop.tick(context);
    expect(provider.pending).toHaveLength(2);
  });

  it("backs off longer when the service is unavailable, and never invents a decision", async () => {
    loop.tick(context);
    provider.pending[0]!.resolve({
      ok: false,
      failure: "unavailable",
      detail: "not_configured",
      retryAfterMs: null,
    });
    await flush();
    expect(accepted).toHaveLength(0);
    clock.advance(1000);
    loop.tick(context);
    expect(provider.pending).toHaveLength(1);
    clock.advance(5000);
    loop.tick(context);
    expect(provider.pending).toHaveLength(2);
  });

  it("honours a server-supplied retry-after on rate limiting", async () => {
    loop.tick(context);
    provider.pending[0]!.resolve({
      ok: false,
      failure: "rate_limited",
      detail: "slow down",
      retryAfterMs: 3000,
    });
    await flush();
    clock.advance(2000);
    loop.tick(context);
    expect(provider.pending).toHaveLength(1);
    clock.advance(1001);
    loop.tick(context);
    expect(provider.pending).toHaveLength(2);
  });

  it("abandons the request in flight when the player is no longer eligible", () => {
    loop.tick(context);
    expect(loop.inFlight).toBe(true);
    loop.tick({ ...context, eligible: false });
    expect(loop.inFlight).toBe(false);
    expect(provider.pending[0]!.request.signal.aborted).toBe(true);
  });

  it("does nothing after stop()", async () => {
    loop.tick(context);
    loop.stop();
    provider.pending[0]!.resolve(ok());
    await flush();
    clock.advance(10_000);
    loop.tick(context);
    expect(accepted).toHaveLength(0);
    expect(provider.pending).toHaveLength(1);
  });

  it("labels fallback decisions as fallback, never as the primary", async () => {
    const fallback: DecisionProvider = {
      kind: "random",
      decide: () => Promise.resolve(ok()),
    };
    const withFallback = new DecisionLoop({
      primary: provider,
      fallback,
      clock,
      onDecision: (d) => accepted.push(d),
    });
    withFallback.tick(context);
    provider.pending[0]!.resolve({
      ok: false,
      failure: "http_error",
      detail: "502",
      retryAfterMs: null,
    });
    await flush();
    await flush();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.fallback).toBe(true);
    expect(accepted[0]!.provider).toBe("random");
  });

  it("while the primary backs off, the fallback acts at the normal cadence", async () => {
    let fallbackCalls = 0;
    const fallback: DecisionProvider = {
      kind: "random",
      decide: () => {
        fallbackCalls += 1;
        return Promise.resolve(ok());
      },
    };
    const withFallback = new DecisionLoop({
      primary: provider,
      fallback,
      clock,
      onDecision: (d) => accepted.push(d),
    });
    withFallback.tick(context);
    provider.pending[0]!.resolve({
      ok: false,
      failure: "unavailable",
      detail: "not_configured",
      retryAfterMs: null,
    });
    await flush();
    // Five seconds of unavailable backoff: the primary is not asked again, but
    // the fallback answers every minimum interval, each labelled as fallback.
    for (let i = 0; i < 10; i += 1) {
      clock.advance(MIN_DECISION_INTERVAL_MS);
      withFallback.tick(context);
      await flush();
    }
    expect(provider.pending).toHaveLength(1);
    expect(fallbackCalls).toBeGreaterThanOrEqual(10);
    expect(accepted.length).toBeGreaterThanOrEqual(10);
    expect(accepted.every((d) => d.fallback && d.provider === "random")).toBe(true);
    const sequences = accepted.map((d) => d.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });
});
