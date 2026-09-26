import {
  MAX_DECISION_AGE_MS,
  MIN_DECISION_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  type ControlFrame,
} from "./contract";
import type { DecisionAxes } from "./decision";
import type { JevObservation } from "./observation";

/**
 * The decision loop: when to ask, and whether to believe the answer.
 *
 * It runs on a timer, never on the render loop, and it enforces the rules that
 * keep a slow or failing brain from ever freezing or confusing the game:
 *
 *  - **One request in flight.** There is no queue. While a decision is pending
 *    the loop only watches the clock.
 *  - **Monotonic sequence numbers.** Every observation gets the next number,
 *    and an answer is accepted only for the request currently in flight.
 *  - **Timeouts.** A request that runs past `REQUEST_TIMEOUT_MS` is aborted.
 *  - **Stale and duplicate rejection.** An answer for an abandoned request, a
 *    request from a previous life, a request older than `MAX_DECISION_AGE_MS`,
 *    or a second answer for the same request is counted and discarded.
 *  - **Backoff.** Failures slow the loop down instead of hammering the server.
 *
 * Providers never throw at the loop: they return a typed failure, and a failure
 * is never turned into a decision. An optional fallback provider may answer in
 * its place, and every decision carries the provider that made it, so a
 * fallback can never be mistaken for the primary.
 */

export type ProviderKind = "jev" | "random";

export type FailureKind =
  | "timeout"
  | "unavailable"
  | "rate_limited"
  | "http_error"
  | "invalid"
  | "network"
  | "aborted";

export interface ProviderDecision {
  frame: ControlFrame;
  /** TypeSafe's probabilities and confidence; null for brains that have none. */
  axes: DecisionAxes | null;
  /** The concrete model version that answered, when there is one. */
  model: string | null;
  /** Server-measured TypeSafe latency, when there is one. */
  serverLatencyMs: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export type ProviderResult =
  | { ok: true; decision: ProviderDecision }
  | { ok: false; failure: FailureKind; detail: string; retryAfterMs: number | null };

export interface DecisionRequest {
  sequence: number;
  observation: JevObservation;
  signal: AbortSignal;
}

export interface DecisionProvider {
  readonly kind: ProviderKind;
  decide(request: DecisionRequest): Promise<ProviderResult>;
}

export interface AcceptedDecision extends ProviderDecision {
  sequence: number;
  observation: JevObservation;
  /** Which provider answered; `fallback` marks a stand-in for the primary. */
  provider: ProviderKind;
  fallback: boolean;
  /** Wall-clock round trip, milliseconds. */
  latencyMs: number;
  issuedAt: number;
  receivedAt: number;
}

export type LoopEvent =
  | { kind: "requested"; sequence: number }
  | { kind: "stale"; sequence: number; reason: string }
  | { kind: "duplicate"; sequence: number }
  | { kind: "failure"; sequence: number; failure: FailureKind; detail: string }
  | { kind: "aborted"; sequence: number };

export interface LoopContext {
  /** True when a decision is wanted now: an AI brain, playing, alive. */
  eligible: boolean;
  /** Changes on every death and respawn; answers for another life are stale. */
  lifeId: number;
  /** Build the observation for this sequence number. Called only when asking. */
  capture(sequence: number): JevObservation;
}

export interface LoopClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LoopOptions {
  primary: DecisionProvider;
  fallback?: DecisionProvider | null;
  clock: LoopClock;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxAgeMs?: number;
  onDecision: (decision: AcceptedDecision) => void;
  onEvent?: (event: LoopEvent) => void;
}

interface Flight {
  sequence: number;
  observation: JevObservation;
  issuedAt: number;
  lifeId: number;
  controller: AbortController;
  timer: unknown;
  timedOut: boolean;
  settled: boolean;
}

/** Backoff after a failure, before the next request may start. */
function backoffFor(
  failure: FailureKind,
  attempt: number,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null) return Math.max(retryAfterMs, 250);
  switch (failure) {
    case "timeout":
      return 250;
    case "unavailable":
      return 5000;
    case "rate_limited":
      return 1000;
    case "aborted":
      return 0;
    default:
      return Math.min(4000, 500 * 2 ** Math.min(3, attempt));
  }
}

export class DecisionLoop {
  private readonly primary: DecisionProvider;
  private readonly fallback: DecisionProvider | null;
  private readonly clock: LoopClock;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxAgeMs: number;
  private readonly onDecision: (decision: AcceptedDecision) => void;
  private readonly onEvent: (event: LoopEvent) => void;

  private sequence = 0;
  private flight: Flight | null = null;
  private lastIssuedAt = -Infinity;
  private backoffUntil = -Infinity;
  private failureStreak = 0;
  /** Highest sequence accepted; anything at or below it is stale. */
  private lastAccepted = 0;
  private stopped = false;

  constructor(options: LoopOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback ?? null;
    this.clock = options.clock;
    this.minIntervalMs = options.minIntervalMs ?? MIN_DECISION_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.maxAgeMs = options.maxAgeMs ?? MAX_DECISION_AGE_MS;
    this.onDecision = options.onDecision;
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  get inFlight(): boolean {
    return this.flight !== null;
  }

  get lastSequence(): number {
    return this.sequence;
  }

  /** Called on the loop's timer. Starts a request when one is due. */
  tick(context: LoopContext): void {
    if (this.stopped) return;
    if (!context.eligible) {
      this.abandon();
      return;
    }
    if (this.flight) return;
    const now = this.clock.now();
    if (now - this.lastIssuedAt < this.minIntervalMs) return;
    if (now < this.backoffUntil) {
      // While the primary backs off, a fallback keeps the player acting at the
      // normal cadence — labelled as the fallback on every frame it makes.
      if (this.fallback) this.issueFallback(context, now);
      return;
    }
    this.issue(context, now);
  }

  /**
   * Abandon the request in flight: its answer, if it comes, is stale. Used on
   * death, pause, takeover and brain switches.
   */
  abandon(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.clock.clearTimeout(flight.timer);
    flight.controller.abort();
    this.onEvent({ kind: "aborted", sequence: flight.sequence });
  }

  /** Stop for good. Nothing is requested or accepted afterwards. */
  stop(): void {
    this.abandon();
    this.stopped = true;
  }

  private issue(context: LoopContext, now: number): void {
    this.sequence += 1;
    const sequence = this.sequence;
    const observation = context.capture(sequence);
    const controller = new AbortController();
    const flight: Flight = {
      sequence,
      observation,
      issuedAt: now,
      lifeId: context.lifeId,
      controller,
      timer: null,
      timedOut: false,
      settled: false,
    };
    flight.timer = this.clock.setTimeout(() => {
      if (this.flight !== flight) return;
      flight.timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    this.flight = flight;
    this.lastIssuedAt = now;
    this.onEvent({ kind: "requested", sequence });

    void this.primary.decide({ sequence, observation, signal: controller.signal }).then(
      (result) => this.settle(flight, result, context),
      (error: unknown) =>
        this.settle(
          flight,
          {
            ok: false,
            failure: "network",
            detail:
              error instanceof Error ? error.message.slice(0, 120) : "provider threw",
            retryAfterMs: null,
          },
          context,
        ),
    );
  }

  private settle(flight: Flight, result: ProviderResult, context: LoopContext): void {
    if (flight.settled) {
      this.onEvent({ kind: "duplicate", sequence: flight.sequence });
      return;
    }
    flight.settled = true;
    this.clock.clearTimeout(flight.timer);
    const current = this.flight === flight;
    if (current) this.flight = null;

    if (!result.ok) {
      if (!current) return; // abandoned; its failure is expected and uncounted
      const failure: FailureKind = flight.timedOut ? "timeout" : result.failure;
      this.failureStreak += 1;
      this.onEvent({
        kind: "failure",
        sequence: flight.sequence,
        failure,
        detail: flight.timedOut ? "no answer in time" : result.detail,
      });
      this.backoffUntil =
        this.clock.now() + backoffFor(failure, this.failureStreak, result.retryAfterMs);
      if (this.fallback && failure !== "aborted") this.askFallback(flight, context);
      return;
    }

    const receivedAt = this.clock.now();
    const stale = !current
      ? "request was abandoned"
      : flight.sequence <= this.lastAccepted
        ? "a newer decision was already accepted"
        : flight.lifeId !== context.lifeId
          ? "the player died or respawned since"
          : receivedAt - flight.issuedAt > this.maxAgeMs
            ? "the observation is too old"
            : null;
    if (stale !== null) {
      this.onEvent({ kind: "stale", sequence: flight.sequence, reason: stale });
      return;
    }
    this.failureStreak = 0;
    this.lastAccepted = flight.sequence;
    this.onDecision({
      ...result.decision,
      sequence: flight.sequence,
      observation: flight.observation,
      provider: this.primary.kind,
      fallback: false,
      latencyMs: receivedAt - flight.issuedAt,
      issuedAt: flight.issuedAt,
      receivedAt,
    });
  }

  /** Let the fallback answer the observation the primary failed on. */
  private askFallback(flight: Flight, context: LoopContext): void {
    this.fallbackDecide(
      flight.sequence,
      flight.observation,
      flight.issuedAt,
      flight.lifeId,
      context,
    );
  }

  /** A fresh fallback decision while the primary is backing off. */
  private issueFallback(context: LoopContext, now: number): void {
    this.sequence += 1;
    const sequence = this.sequence;
    this.lastIssuedAt = now;
    const observation = context.capture(sequence);
    this.fallbackDecide(sequence, observation, now, context.lifeId, context);
  }

  private fallbackDecide(
    sequence: number,
    observation: JevObservation,
    issuedAt: number,
    lifeId: number,
    context: LoopContext,
  ): void {
    const fallback = this.fallback;
    if (!fallback) return;
    const controller = new AbortController();
    void fallback
      .decide({ sequence, observation, signal: controller.signal })
      .then((result) => {
        if (!result.ok || this.stopped || this.flight) return;
        if (lifeId !== context.lifeId || sequence <= this.lastAccepted) return;
        this.lastAccepted = sequence;
        const now = this.clock.now();
        this.onDecision({
          ...result.decision,
          sequence,
          observation,
          provider: fallback.kind,
          fallback: true,
          latencyMs: now - issuedAt,
          issuedAt,
          receivedAt: now,
        });
      });
  }
}
