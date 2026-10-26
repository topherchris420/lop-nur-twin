/**
 * When to ask the garden for its state.
 *
 * A new state exists once per five-second step, published when the server's
 * clock loop wakes; the wake falls a roughly constant `phase` after each step
 * boundary and drifts slowly. The scheduler learns that phase from fresh
 * answers (the smallest recent `server_time - updated_at` is the closest to a
 * publication) and asks just after the next expected publication: about one
 * request per step, the rate the previous page used, without missing steps.
 * Asking only after publications would let the estimate creep later, so
 * every eighth request goes slightly early; if the step is not out yet, a
 * quick retry follows. Failures back off; a hidden page asks rarely.
 */
export interface PollOptions {
  stepS: number;
  /** Seconds after the expected publication to ask. */
  marginS: number;
  /** How early the periodic probe asks, seconds. */
  probeS: number;
  probeEvery: number;
  /** Interval while the phase is unknown, ms. */
  discoverMs: number;
  /** Retry after an answer that had no new step yet, ms. */
  sameMs: number;
  maxSame: number;
  /** Interval while the page is hidden, ms. */
  hiddenMs: number;
  backoffMs: readonly number[];
}

export const POLL_DEFAULTS: PollOptions = {
  stepS: 5,
  marginS: 0.3,
  probeS: 0.6,
  probeEvery: 8,
  discoverMs: 2500,
  sameMs: 700,
  maxSame: 4,
  hiddenMs: 30_000,
  backoffMs: [2000, 4000, 8000, 15_000, 30_000],
};

export class PollScheduler {
  private lags: number[] = [];
  private same = 0;
  private failures = 0;
  private aligned = 0;

  constructor(private readonly o: PollOptions = POLL_DEFAULTS) {}

  /** The server's estimated publication phase, seconds after a step boundary, or null. */
  get phase(): number | null {
    return this.lags.length >= 2 ? Math.min(...this.lags) : null;
  }

  /**
   * After a successful answer: `updatedAt` and `serverTime` are from the
   * answer, `fresh` says whether it carried a step not seen before, and
   * `serverNow` is the current server-clock estimate. Returns the delay (ms).
   */
  success(
    updatedAt: number,
    serverTime: number,
    fresh: boolean,
    serverNow: number,
    hidden = false,
  ): number {
    this.failures = 0;
    const lag = serverTime - updatedAt;
    if (fresh && lag >= 0 && lag < 3 * this.o.stepS) {
      this.lags.push(lag);
      if (this.lags.length > 24) this.lags.shift();
    }
    if (hidden) return this.o.hiddenMs;
    const phase = this.phase;
    if (phase === null) return this.o.discoverMs;
    if (!fresh && this.same < this.o.maxSame) {
      this.same++;
      return this.o.sameMs;
    }
    this.same = 0;
    this.aligned++;
    const early = this.aligned % this.o.probeEvery === 0 ? -this.o.probeS : 0;
    // The next step's state is published about `phase` after its boundary.
    let due = updatedAt + this.o.stepS + phase + this.o.marginS + early;
    while (due < serverNow + 0.25) due += this.o.stepS;
    return Math.round(Math.min(this.o.stepS * 2, due - serverNow) * 1000);
  }

  /** After a failed request: the next delay (ms), growing to the last backoff. */
  failure(hidden = false): number {
    const b = this.o.backoffMs;
    const delay = b[Math.min(this.failures, b.length - 1)]!;
    this.failures++;
    return hidden ? Math.max(delay, this.o.hiddenMs) : delay;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }
}
