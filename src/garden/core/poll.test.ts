import { describe, expect, it } from "vitest";
import { POLL_DEFAULTS, PollScheduler } from "./poll.js";

/**
 * A model of the server: each five-second step is published `phase` seconds
 * after its boundary. Returns what a request at server time `at` would see.
 */
function serve(at: number, phase: number) {
  const k = Math.floor((at - phase) / 5);
  return { updatedAt: k * 5, serverTime: at };
}

/** Drives the scheduler for `seconds` and reports what it saw. */
function run(phase: (t: number) => number, seconds: number, start = 1000.3) {
  const p = new PollScheduler();
  let t = start,
    last = -1,
    requests = 0,
    worstStaleness = 0;
  const seen = new Set<number>();
  while (t < start + seconds) {
    const r = serve(t, phase(t));
    requests++;
    const fresh = r.updatedAt !== last;
    if (fresh) {
      // How long after its publication this state reached the page.
      if (last >= 0)
        worstStaleness = Math.max(worstStaleness, t - (r.updatedAt + phase(t)));
      last = r.updatedAt;
      seen.add(r.updatedAt);
    }
    t += p.success(r.updatedAt, r.serverTime + 0.02, fresh, t + 0.04) / 1000 + 0.04;
  }
  return { requests, seen, worstStaleness, p };
}

describe("PollScheduler", () => {
  it("settles to about one request per step, just after publication", () => {
    const { requests, worstStaleness, p } = run(() => 3.2, 600);
    expect(p.phase).not.toBeNull();
    expect(requests / (600 / 5)).toBeLessThan(1.35);
    // Every state reaches the page within a second of being published (after discovery).
    expect(worstStaleness).toBeLessThan(2.6);
  });

  it("misses no step while the phase drifts and wraps", () => {
    // The server's wake drifts later by 20 ms a step and wraps from 5 s to 0.
    const { seen } = run((t) => (4.2 + ((t - 1000) / 5) * 0.02) % 5, 600);
    const steps = [...seen].sort((a, b) => a - b);
    let gaps = 0;
    for (let i = 1; i < steps.length; i++) if (steps[i]! - steps[i - 1]! > 5) gaps++;
    // The wrap publishes two steps at once, so at most one step can go unseen there.
    expect(gaps).toBeLessThanOrEqual(1);
  });

  it("backs off after failures and resets after a success", () => {
    const p = new PollScheduler();
    const delays = [1, 2, 3, 4, 5, 6].map(() => p.failure());
    expect(delays).toEqual([2000, 4000, 8000, 15000, 30000, 30000]);
    expect(p.consecutiveFailures).toBe(6);
    p.success(1000, 1003, true, 1003);
    expect(p.consecutiveFailures).toBe(0);
    expect(p.failure()).toBe(2000);
  });

  it("asks rarely while the page is hidden", () => {
    const p = new PollScheduler();
    expect(p.success(1000, 1003, true, 1003, true)).toBe(POLL_DEFAULTS.hiddenMs);
    expect(p.failure(true)).toBe(POLL_DEFAULTS.hiddenMs);
  });
});
