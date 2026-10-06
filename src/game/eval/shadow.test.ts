import { describe, expect, it } from "vitest";
import { ScriptedProvider } from "../pilot/policies";
import { RandomProvider } from "../pilot/providers";
import { makeObservation } from "../pilot/testing/fixtures";
import { record } from "./testing/fixtures";
import { SHADOW_SCHEMA, shadowEpisode, summarizeShadow } from "./shadow";
import type { DecisionRecord } from "./records";

/** An episode a seat played: its observations, in order, and what it chose. */
function played(
  choose: (observation: ReturnType<typeof makeObservation>) => DecisionRecord["frame"],
  count: number,
): DecisionRecord[] {
  const decisions: DecisionRecord[] = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const observation = makeObservation({
      sequence,
      control: "precision",
      // Alternate between a fight and a quiet moment so several axes are
      // genuine choices across the episode.
      ...(sequence % 3 === 0 ? { perception: { visibleEnemies: [] } } : {}),
    });
    decisions.push(
      record({
        sequence,
        source: "script",
        observation,
        legal: observation.legal,
        frame: choose(observation),
      }),
    );
  }
  return decisions;
}

describe("shadow agreement", () => {
  it("agrees with itself: a policy shown its own observations chooses the same", () => {
    const seat = new ScriptedProvider("marksman");
    const decisions = played((observation) => seat.pick(observation), 30);
    const result = shadowEpisode({ episodeId: "synthetic", decisions }, "marksman");
    expect(result.compared).toBe(30);
    for (const row of result.axes) {
      if (row.choices > 0) expect(row.agreed, row.axis).toBe(row.choices);
    }
  });

  it("computes chance exactly as 1/k per decision, and skips axes that were not choices", () => {
    const decisions = played(() => record().frame, 9);
    const result = shadowEpisode({ episodeId: "synthetic", decisions }, "marksman");
    for (const row of result.axes) {
      const expected = decisions
        .map((decision) => (decision.legal[row.axis] as readonly string[]).length)
        .filter((k) => k > 1)
        .reduce((sum, k) => sum + 1 / k, 0);
      expect(row.chanceAgreements, row.axis).toBeCloseTo(expected, 12);
      expect(row.choices, row.axis).toBe(
        decisions.filter(
          (decision) => (decision.legal[row.axis] as readonly string[]).length > 1,
        ).length,
      );
    }
  });

  it("sets fallback and replayed frames aside, and skips records without an observation", () => {
    const seat = new ScriptedProvider("marksman");
    const decisions = played((observation) => seat.pick(observation), 6);
    decisions[0] = { ...decisions[0]!, source: "fallback-random" };
    decisions[1] = { ...decisions[1]!, source: "replay" };
    decisions[2] = { ...decisions[2]!, observation: null };
    const result = shadowEpisode({ episodeId: "synthetic", decisions }, "marksman");
    expect(result).toMatchObject({ compared: 3, setAside: 2, skipped: 1 });
  });

  it("puts a seeded random seat at chance, which is what makes it the control", () => {
    const random = new RandomProvider(7);
    const decisions = played(
      (observation) =>
        random.pick(observation.legal, observation.control, observation.navigation),
      600,
    );
    const result = shadowEpisode({ episodeId: "synthetic", decisions }, "marksman");
    for (const row of result.axes) {
      if (row.choices < 100) continue;
      const agreement = row.agreed / row.choices;
      const chance = row.chanceAgreements / row.choices;
      expect(Math.abs(agreement - chance), row.axis).toBeLessThan(0.08);
    }
  });

  it("summarises over episodes, carrying n and the caveat", () => {
    const seat = new ScriptedProvider("marksman");
    const episodes = [1, 2, 3].map((index) =>
      shadowEpisode(
        {
          episodeId: `synthetic-${index}`,
          decisions: played((observation) => seat.pick(observation), 12),
        },
        "marksman",
      ),
    );
    const summary = summarizeShadow("marksman", episodes);
    expect(summary.schema).toBe(SHADOW_SCHEMA);
    expect(summary.episodes).toBe(3);
    expect(summary.caveat).toMatch(/not a counterfactual outcome and not a skill score/);
    const weapon = summary.axes.find((row) => row.axis === "weapon");
    expect(weapon?.episodes).toBe(3);
    expect(weapon?.agreement).toBe(1);
    expect(weapon?.lift).toBeCloseTo(1 - weapon!.chance!, 12);
  });
});
