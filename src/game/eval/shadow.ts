import { AXES, type Axis } from "../pilot/contract.js";
import { ScriptedProvider, type ScriptPolicy } from "../pilot/policies.js";
import type { DecisionRecord } from "./records.js";
import { mean, meanInterval, type Interval } from "./stats.js";

/**
 * Same observations, other minds.
 *
 * A matched experiment puts different brains on the same seeds, and the worlds
 * diverge within seconds: after the first decision, no two seats see the same
 * thing again, so outcome comparisons are between different situations. The
 * decision records hold something stronger — the exact observation each
 * decision was made from — and a scripted reference policy is a pure function
 * of the observation and a few integers of its own memory. So it can be shown
 * the very observations a model was shown, in order, and asked what it would
 * have chosen.
 *
 * What comes out is **agreement**: on how many decisions, per axis, the
 * recorded choice and the reference's choice were the same option. Read it
 * with four cautions, which every report repeats:
 *
 *  - It is not a counterfactual outcome. The reference's choices act on
 *    nothing; had it held the seat, its own choices would have changed every
 *    later observation. This is a comparison of choices on identical inputs.
 *  - It is not a skill score. Agreeing with the marksman means choosing what a
 *    hand-written rule chooses, which is good only where that rule is good.
 *  - Chance is computed exactly, not simulated: a uniform chooser over the
 *    offered options agrees with any fixed choice with probability 1/k on an
 *    axis offering k options. Axes that offered one option are not choices and
 *    are left out of both.
 *  - The episode is the unit. Decisions within an episode are correlated, so
 *    intervals are over per-episode rates, never over pooled decisions.
 *
 * Only the seat's own decisions are compared: fallback and replayed frames are
 * counted and set aside, and a record without its observation is skipped and
 * counted, never guessed at.
 */

export const SHADOW_SCHEMA = "blacksite-shadow/v1";

export const SHADOW_REFERENCES = [
  "marksman",
  "skirmisher",
] as const satisfies readonly ScriptPolicy[];
export type ShadowReference = (typeof SHADOW_REFERENCES)[number];

export const SHADOW_CAVEAT =
  "Agreement on identical observations, not a counterfactual outcome and not a skill score: the reference acted on nothing, and agreeing with a hand-written rule is good only where the rule is.";

/** One episode, one reference, one axis. */
export interface ShadowAxisEpisode {
  axis: Axis;
  /** Decisions on which the axis offered more than one option. */
  choices: number;
  /** Of those, how many recorded choices the reference matched. */
  agreed: number;
  /** Sum of 1/k over the same decisions: the expected agreements of a uniform chooser. */
  chanceAgreements: number;
}

export interface ShadowEpisode {
  episodeId: string;
  seed: number | null;
  reference: ShadowReference;
  /** The seat's own decisions compared. */
  compared: number;
  /** Fallback and replayed frames, set aside. */
  setAside: number;
  /** Records that carried no observation, skipped. */
  skipped: number;
  axes: readonly ShadowAxisEpisode[];
}

/** Records that are the seat's own choices, in the order they were made. */
function ownDecisions(records: readonly DecisionRecord[]): {
  own: DecisionRecord[];
  setAside: number;
  skipped: number;
} {
  let setAside = 0;
  let skipped = 0;
  const own: DecisionRecord[] = [];
  for (const record of [...records].sort((a, b) => a.sequence - b.sequence)) {
    if (record.source === "fallback-random" || record.source === "replay") {
      setAside += 1;
      continue;
    }
    // A record whose observation was dropped cannot be shown to anyone else.
    if (record.observation === null) {
      skipped += 1;
      continue;
    }
    own.push(record);
  }
  return { own, setAside, skipped };
}

/**
 * Show one episode's observations to a reference policy, in order, and count
 * per-axis agreement with what the seat chose. A fresh policy per episode: its
 * memory starts empty, as it would at the start of a match.
 */
export function shadowEpisode(
  episode: {
    episodeId: string;
    seed?: number | null;
    decisions: readonly DecisionRecord[];
  },
  reference: ShadowReference,
): ShadowEpisode {
  const { own, setAside, skipped } = ownDecisions(episode.decisions);
  const policy = new ScriptedProvider(reference);
  const tallies = new Map<Axis, ShadowAxisEpisode>(
    AXES.map((axis) => [axis, { axis, choices: 0, agreed: 0, chanceAgreements: 0 }]),
  );
  for (const record of own) {
    const observation = record.observation!;
    const theirs = policy.pick(observation);
    for (const axis of AXES) {
      const offered = (record.legal[axis] as readonly string[]).length;
      if (offered < 2) continue;
      const tally = tallies.get(axis)!;
      tally.choices += 1;
      tally.chanceAgreements += 1 / offered;
      if (theirs[axis] === record.frame[axis]) tally.agreed += 1;
    }
  }
  return {
    episodeId: episode.episodeId,
    seed: episode.seed ?? null,
    reference,
    compared: own.length,
    setAside,
    skipped,
    axes: AXES.map((axis) => tallies.get(axis)!),
  };
}

/** One axis, summarised over episodes. */
export interface ShadowAxisSummary {
  axis: Axis;
  /** Episodes in which the axis was a real choice at least once. */
  episodes: number;
  choices: number;
  /** Mean of per-episode agreement rates. */
  agreement: number | null;
  /** Mean of per-episode chance rates. */
  chance: number | null;
  /** Per-episode (agreement − chance), with a descriptive interval over episodes. */
  lift: number | null;
  liftInterval: Interval | null;
}

export interface ShadowSummary {
  schema: typeof SHADOW_SCHEMA;
  reference: ShadowReference;
  episodes: number;
  compared: number;
  setAside: number;
  skipped: number;
  axes: readonly ShadowAxisSummary[];
  caveat: string;
}

export function summarizeShadow(
  reference: ShadowReference,
  episodes: readonly ShadowEpisode[],
): ShadowSummary {
  const own = episodes.filter((episode) => episode.reference === reference);
  return {
    schema: SHADOW_SCHEMA,
    reference,
    episodes: own.length,
    compared: own.reduce((sum, episode) => sum + episode.compared, 0),
    setAside: own.reduce((sum, episode) => sum + episode.setAside, 0),
    skipped: own.reduce((sum, episode) => sum + episode.skipped, 0),
    axes: AXES.map((axis): ShadowAxisSummary => {
      const rows = own
        .map((episode) => episode.axes.find((row) => row.axis === axis)!)
        .filter((row) => row.choices > 0);
      const agreement = rows.map((row) => row.agreed / row.choices);
      const chance = rows.map((row) => row.chanceAgreements / row.choices);
      const lifts = agreement.map((rate, index) => rate - chance[index]!);
      return {
        axis,
        episodes: rows.length,
        choices: rows.reduce((sum, row) => sum + row.choices, 0),
        agreement: mean(agreement),
        chance: mean(chance),
        lift: mean(lifts),
        liftInterval: meanInterval(lifts),
      };
    }),
    caveat: SHADOW_CAVEAT,
  };
}
