import { describe, expect, it } from "vitest";
import { PilotMetrics, aggregateEpisodes, percentile, summarize } from "./metrics";

describe("latency statistics", () => {
  it("uses nearest-rank percentiles", () => {
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(samples, 50)).toBe(500);
    expect(percentile(samples, 95)).toBe(1000);
    expect(percentile([7], 95)).toBe(7);
  });

  it("reports null, never zero, when nothing was measured", () => {
    expect(percentile([], 50)).toBeNull();
    expect(summarize([])).toEqual({
      count: 0,
      meanMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    });
  });
});

describe("episode metrics", () => {
  it("counts only what the simulation reported", () => {
    const metrics = new PilotMetrics();
    metrics.reset(2, 1, 0);
    metrics.step(1 / 60, true, 0.1);
    metrics.onShot();
    metrics.onShot();
    metrics.onShot();
    metrics.onHit(24);
    metrics.onDamageTaken(40);
    metrics.step(1, true, 12); // a respawn teleport, not a walk
    metrics.onDeath();
    metrics.step(2, false, 0);
    const episode = metrics.snapshot(3, 2, 5000);
    expect(episode.kills).toBe(1);
    expect(episode.deaths).toBe(1);
    expect(episode.shotsFired).toBe(3);
    expect(episode.hits).toBe(1);
    expect(episode.accuracy).toBeCloseTo(1 / 3);
    expect(episode.damageDealt).toBe(24);
    expect(episode.damageTaken).toBe(40);
    expect(episode.distanceM).toBeCloseTo(0.1);
    expect(episode.lifeSeconds).toEqual([1 + 1 / 60]);
    expect(episode.wallSeconds).toBe(5);
  });

  it("leaves accuracy and survival null without samples", () => {
    const metrics = new PilotMetrics();
    metrics.reset(0, 0, 0);
    const episode = metrics.snapshot(0, 0, 0);
    expect(episode.accuracy).toBeNull();
    expect(episode.meanSurvivalS).toBeNull();
    expect(episode.latency.meanMs).toBeNull();
    expect(episode.confidence.move.count).toBe(0);
  });

  it("keeps confidence only when a provider supplied it", () => {
    const metrics = new PilotMetrics();
    metrics.reset(0, 0, 0);
    metrics.onDecisionLatency(150, 90, "jev-1.13.0", { move: 0.8, weapon: 0.4 });
    metrics.onDecisionLatency(3, null, null, null);
    const episode = metrics.snapshot(0, 0, 0);
    expect(episode.confidence.move.count).toBe(1);
    expect(episode.confidence.turn.count).toBe(0);
    expect(episode.serverLatency.count).toBe(1);
    expect(episode.latency.count).toBe(2);
    expect(episode.models).toEqual(["jev-1.13.0"]);
  });
});

describe("benchmark aggregation", () => {
  it("pools episodes and recomputes percentiles over pooled samples", () => {
    const a = new PilotMetrics();
    a.reset(0, 0, 0);
    a.onShot();
    a.onShot();
    a.onHit(30);
    a.step(10, true, 5);
    a.onDeath();
    const b = new PilotMetrics();
    b.reset(0, 0, 0);
    b.onShot();
    b.onHit(30);
    b.step(20, true, 5);
    const aggregate = aggregateEpisodes(
      [a.snapshot(1, 1, 0), b.snapshot(2, 0, 0)],
      [100, 200, 300],
      [50],
    );
    expect(aggregate.episodes).toBe(2);
    expect(aggregate.kills).toBe(3);
    expect(aggregate.deaths).toBe(1);
    expect(aggregate.killDeathRatio).toBe(3);
    expect(aggregate.shotsFired).toBe(3);
    expect(aggregate.hits).toBe(2);
    expect(aggregate.accuracy).toBeCloseTo(2 / 3);
    expect(aggregate.meanSurvivalS).toBeCloseTo(15);
    expect(aggregate.latency.p50Ms).toBe(200);
    expect(aggregate.serverLatency.count).toBe(1);
  });

  it("reports an undefined kill/death ratio as null, not infinity", () => {
    const m = new PilotMetrics();
    m.reset(0, 0, 0);
    expect(aggregateEpisodes([m.snapshot(4, 0, 0)]).killDeathRatio).toBeNull();
  });
});
