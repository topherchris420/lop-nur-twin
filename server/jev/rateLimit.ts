import { SERVER_MIN_INTERVAL_MS } from "../../src/game/pilot/contract.js";

/**
 * Abuse protection for the one endpoint that spends money.
 *
 * `/api/jev/decision` is public, and every request it forwards costs TypeSafe
 * credit and counts against the account's rate limit. Four limits apply, in
 * this order, all in memory:
 *
 *  1. **Per client** — a token bucket keyed by client address.
 *  2. **Per session** — a minimum interval between one page's requests, so a
 *     single tab cannot run faster than the game ever asks.
 *  3. **Per instance** — a global token bucket under the account's own limit.
 *  4. **Concurrency** — a cap on TypeSafe calls in flight at once.
 *
 * The honest limitation: this state lives in one function instance. Vercel may
 * run several, and a cold start forgets everything, so these are brakes, not a
 * wall. A determined client rotating addresses is bounded by the per-instance
 * budget, not stopped. Durable, cross-instance limits belong in the platform's
 * firewall (see docs/JEV_BLACKSITE.md) or a shared store.
 */

export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

export interface RateLimitConfig {
  perClient: BucketConfig;
  global: BucketConfig;
  sessionMinIntervalMs: number;
  maxInFlight: number;
  /** Tracked clients and sessions, each; idle entries are evicted beyond this. */
  maxTrackedKeys: number;
}

/**
 * A live game asks at most five times a second and usually about three (one
 * request in flight, 250–500 ms each). The per-client bucket allows that plus a
 * second tab; the global bucket stays below the 20 requests a second the
 * TypeSafe account allows.
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perClient: { capacity: 10, refillPerSecond: 6 },
  global: { capacity: 40, refillPerSecond: 16 },
  sessionMinIntervalMs: SERVER_MIN_INTERVAL_MS,
  maxInFlight: 16,
  maxTrackedKeys: 5000,
};

export type Admission = { ok: true } | { ok: false; retryAfterMs: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const IDLE_EVICT_MS = 60_000;

export class RateLimiter {
  private readonly clients = new Map<string, Bucket>();
  private readonly sessions = new Map<string, number>();
  private readonly global: Bucket;
  private inFlight = 0;

  constructor(
    private readonly config: RateLimitConfig = DEFAULT_RATE_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.global = { tokens: config.global.capacity, updatedAt: now() };
  }

  /** Charge one request to a client's bucket. */
  admitClient(key: string): Admission {
    const now = this.now();
    let bucket = this.clients.get(key);
    if (bucket) {
      // Re-insert so iteration order tracks recency for eviction.
      this.clients.delete(key);
    } else {
      bucket = { tokens: this.config.perClient.capacity, updatedAt: now };
      this.evict(this.clients, (b) => b.updatedAt, now);
    }
    this.clients.set(key, bucket);
    return take(bucket, this.config.perClient, now);
  }

  /** Enforce the minimum interval between one session's requests. */
  admitSession(session: string): Admission {
    const now = this.now();
    const last = this.sessions.get(session);
    if (last !== undefined) {
      const wait = last + this.config.sessionMinIntervalMs - now;
      if (wait > 0) return { ok: false, retryAfterMs: Math.ceil(wait) };
      this.sessions.delete(session);
    } else {
      this.evict(this.sessions, (t) => t, now);
    }
    this.sessions.set(session, now);
    return { ok: true };
  }

  /** Charge the instance-wide budget and claim an in-flight slot. */
  admitUpstream(): Admission {
    if (this.inFlight >= this.config.maxInFlight) return { ok: false, retryAfterMs: 250 };
    const admission = take(this.global, this.config.global, this.now());
    if (admission.ok) this.inFlight += 1;
    return admission;
  }

  /** Release a slot claimed by `admitUpstream`. */
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  get trackedClients(): number {
    return this.clients.size;
  }

  private evict<V>(map: Map<string, V>, stamp: (value: V) => number, now: number): void {
    if (map.size < this.config.maxTrackedKeys) return;
    for (const [key, value] of map) {
      if (now - stamp(value) > IDLE_EVICT_MS) map.delete(key);
    }
    // Still full of recent keys: drop the least recently used.
    while (map.size >= this.config.maxTrackedKeys) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }
}

function take(bucket: Bucket, config: BucketConfig, now: number): Admission {
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(
    config.capacity,
    bucket.tokens + elapsed * config.refillPerSecond,
  );
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  return {
    ok: false,
    retryAfterMs: Math.ceil(((1 - bucket.tokens) / config.refillPerSecond) * 1000),
  };
}
