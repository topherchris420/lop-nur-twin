import { describe, expect, it } from "vitest";
import { metricDefinition, type EpisodeInput } from "./metricRegistry";

const episode = (releases?: Record<string, number>): EpisodeInput => ({
  seed: 42,
  metrics: {
    simSeconds: 10,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    hits: 0,
    accuracy: null,
    damageDealt: 0,
    damageTaken: 0,
    meanSurvivalS: null,
    distanceM: 0,
    decisions: { accepted: 0 },
    places: releases ? { chosen: 8, releases } : null,
  },
  decisions: [],
  failures: [],
});

describe("ended-travel metrics", () => {
  it("keeps replacements and timeouts in the denominator", () => {
    const e = episode({ arrived: 2, blocked: 1, replaced: 4, timeout: 1 });
    expect(metricDefinition("place_blocked_rate")!.read(e, null)).toBe(1 / 8);
    expect(metricDefinition("place_arrival_rate")!.read(e, null)).toBe(2 / 8);
  });
  it("does not invent a perfect rate when there are no ended travels", () => {
    for (const e of [episode(), episode({})]) {
      expect(metricDefinition("place_blocked_rate")!.read(e, null)).toBeNull();
      expect(metricDefinition("place_arrival_rate")!.read(e, null)).toBeNull();
    }
  });
});
