import type { DecisionTypeContract } from "./outcomeContracts.js";
import {
  offeredSlots,
  slotOf,
  type DecisionRecord,
  type FailureRecord,
} from "./records.js";
import { mean, ratio } from "./stats.js";

/**
 * Every metric an experiment may declare, with how it is computed.
 *
 * An experiment names its primary metric by id before it runs, and the runner
 * refuses one that is not here — so the deciding number is always one that has
 * a definition in code, not a column chosen after the table was printed.
 *
 * All metrics are computed **per episode**: the episode is the unit the seeds
 * pair on and the unit an interval is taken over. Decision-level metrics are an
 * episode's rate over the decisions its outcome contract selected; an episode
 * with no such decision has `null` for them, and is left out rather than
 * counted as zero.
 *
 * `direction` is used only by the benchmark warnings (e.g. "the controller
 * alone achieves most of this") and by nothing that ranks brains.
 */

/** The parts of a benchmark episode report a metric may read. Loose on purpose: it is JSON. */
export interface EpisodeReport {
  simSeconds: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  hits: number;
  accuracy: number | null;
  damageDealt: number;
  damageTaken: number;
  meanSurvivalS: number | null;
  distanceM: number;
  decisions: { accepted: number };
  debrief?: {
    exposedFraction: number | null;
    longestExposedS: number;
    kills: { meanSightToKillS: number | null };
  } | null;
  places?: { chosen: number; releases: Record<string, number> } | null;
}

export interface EpisodeInput {
  seed: number;
  metrics: EpisodeReport;
  decisions: readonly DecisionRecord[];
  failures: readonly FailureRecord[];
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  level: "episode" | "decision";
  direction: "higher" | "lower" | "none";
  description: string;
  read(episode: EpisodeInput, contract: DecisionTypeContract | null): number | null;
}

const perMinute = (value: number, simSeconds: number): number | null =>
  simSeconds > 0 ? (value / simSeconds) * 60 : null;

function matching(
  episode: EpisodeInput,
  contract: DecisionTypeContract | null,
): DecisionRecord[] {
  return contract ? episode.decisions.filter((r) => contract.matches(r)) : [];
}

function classRate(
  episode: EpisodeInput,
  contract: DecisionTypeContract | null,
  cls: "beneficial" | "harmful",
): number | null {
  const scored = matching(episode, contract)
    .map((r) => contract!.classify(r))
    .filter((c) => c !== null);
  return scored.length > 0
    ? scored.filter((c) => c === cls).length / scored.length
    : null;
}

function windowMean(
  episode: EpisodeInput,
  contract: DecisionTypeContract | null,
  read: (r: DecisionRecord) => number | null,
): number | null {
  const values = matching(episode, contract)
    .filter((r) => r.outcome?.complete)
    .map(read)
    .filter((v): v is number => v !== null);
  return mean(values);
}

const executedOrRejected = (r: DecisionRecord): boolean =>
  r.validation.status === "executed" ||
  r.validation.status === "executed_illegal" ||
  r.validation.status === "rejected_stale";

export const METRICS: readonly MetricDefinition[] = [
  ...(["blocked", "arrived"] as const).map((reason): MetricDefinition => ({
    id: reason === "blocked" ? "place_blocked_rate" : "place_arrival_rate",
    label: reason === "blocked" ? "Travels stopped by obstruction" : "Travels arriving",
    unit: "share",
    level: "episode",
    direction: reason === "blocked" ? "lower" : "higher",
    description: `Share of ended travels released as ${reason}. Replacements, timeouts and clears remain in the denominator; active travels and resets on death are not ended-travel samples.`,
    read: (e) => {
      const releases = e.metrics.places?.releases;
      return releases
        ? ratio(
            releases[reason] ?? 0,
            Object.values(releases).reduce((a, b) => a + b, 0),
          )
        : null;
    },
  })),
  {
    id: "kills_per_minute",
    label: "Kills per minute",
    unit: "/min",
    level: "episode",
    direction: "higher",
    description: "Eliminations credited to the seat per minute of match time.",
    read: (e) => perMinute(e.metrics.kills, e.metrics.simSeconds),
  },
  {
    id: "deaths_per_minute",
    label: "Deaths per minute",
    unit: "/min",
    level: "episode",
    direction: "lower",
    description: "Times the seat was eliminated per minute of match time.",
    read: (e) => perMinute(e.metrics.deaths, e.metrics.simSeconds),
  },
  {
    id: "kd_ratio",
    label: "K/D",
    unit: "ratio",
    level: "episode",
    direction: "higher",
    description:
      "Kills per death; null with no deaths (an undefined ratio is not infinity).",
    read: (e) => ratio(e.metrics.kills, e.metrics.deaths),
  },
  {
    id: "accuracy",
    label: "Accuracy",
    unit: "share",
    level: "episode",
    direction: "higher",
    description: "Rounds that struck a body over rounds fired; null with none fired.",
    read: (e) => e.metrics.accuracy,
  },
  {
    id: "damage_dealt_per_minute",
    label: "Damage dealt / min",
    unit: "hp/min",
    level: "episode",
    direction: "higher",
    description: "Damage the resolver applied from the seat per minute.",
    read: (e) => perMinute(e.metrics.damageDealt, e.metrics.simSeconds),
  },
  {
    id: "damage_taken_per_minute",
    label: "Damage taken / min",
    unit: "hp/min",
    level: "episode",
    direction: "lower",
    description: "Damage the resolver applied to the seat per minute.",
    read: (e) => perMinute(e.metrics.damageTaken, e.metrics.simSeconds),
  },
  {
    id: "exposure_fraction",
    label: "Time in an enemy sight line",
    unit: "share",
    level: "episode",
    direction: "lower",
    description:
      "Share of time alive with at least one living enemy holding a sight line to the seat (the debrief's measure).",
    read: (e) => e.metrics.debrief?.exposedFraction ?? null,
  },
  {
    id: "longest_exposed_s",
    label: "Longest stretch in a sight line",
    unit: "s",
    level: "episode",
    direction: "lower",
    description: "The longest unbroken stretch in some enemy's sight line.",
    read: (e) => e.metrics.debrief?.longestExposedS ?? null,
  },
  {
    id: "distance_m",
    label: "Distance moved",
    unit: "m",
    level: "episode",
    direction: "none",
    description: "Metres the body actually moved.",
    read: (e) => e.metrics.distanceM,
  },
  {
    id: "survival_mean_s",
    label: "Mean survival per life",
    unit: "s",
    level: "episode",
    direction: "higher",
    description: "Seconds alive per life, the life in progress included.",
    read: (e) => e.metrics.meanSurvivalS,
  },
  {
    id: "first_sight_to_kill_s",
    label: "First sight to kill",
    unit: "s",
    level: "episode",
    direction: "lower",
    description: "Mean time from an enemy first entering view to the seat killing it.",
    read: (e) => e.metrics.debrief?.kills.meanSightToKillS ?? null,
  },
  {
    id: "decisions_per_minute",
    label: "Decisions per minute",
    unit: "/min",
    level: "episode",
    direction: "none",
    description: "Decisions accepted per minute of match time.",
    read: (e) => perMinute(e.metrics.decisions.accepted, e.metrics.simSeconds),
  },
  {
    id: "success_rate",
    label: "Decision success rate",
    unit: "share",
    level: "decision",
    direction: "higher",
    description:
      "Share of the outcome contract's scored decisions classed beneficial. The rule is printed with it.",
    read: (e, c) => classRate(e, c, "beneficial"),
  },
  {
    id: "harmful_rate",
    label: "Decision harm rate",
    unit: "share",
    level: "decision",
    direction: "lower",
    description: "Share of the outcome contract's scored decisions classed harmful.",
    read: (e, c) => classRate(e, c, "harmful"),
  },
  {
    id: "decision_count",
    label: "Decisions of this type",
    unit: "count",
    level: "decision",
    direction: "none",
    description: "How many decisions the outcome contract selected in the episode.",
    read: (e, c) => (c ? matching(e, c).length : null),
  },
  {
    id: "first_slot_share",
    label: "Slot 0 chosen",
    unit: "share",
    level: "decision",
    direction: "none",
    description:
      "Among the selected decisions that chose a slot (TARGET_n or PLACE_n, on the contract's axis) with two or more offered, the share that chose slot 0. A position-blind chooser averages 1/k.",
    read: (e, c) => {
      if (!c || (c.calibrationAxis !== "target" && c.calibrationAxis !== "go"))
        return null;
      const axis = c.calibrationAxis;
      const slots = matching(e, c).filter(
        (r) => slotOf(r.frame[axis]) !== null && offeredSlots(r.legal, axis) >= 2,
      );
      return ratio(slots.filter((r) => slotOf(r.frame[axis]) === 0).length, slots.length);
    },
  },
  {
    id: "exposure_fraction_next_window",
    label: "Exposure in the window after",
    unit: "share",
    level: "decision",
    direction: "lower",
    description:
      "Mean over the selected decisions of the share of window samples in which some enemy held a sight line to the seat.",
    read: (e, c) =>
      windowMean(e, c, (r) =>
        r.outcome && r.outcome.exposureSamples > 0
          ? r.outcome.exposedSamples / r.outcome.exposureSamples
          : null,
      ),
  },
  {
    id: "damage_taken_next_window",
    label: "Damage taken in the window after",
    unit: "hp",
    level: "decision",
    direction: "lower",
    description: "Mean damage taken in the window after each selected decision.",
    read: (e, c) => windowMean(e, c, (r) => r.outcome?.damageTaken ?? null),
  },
  {
    id: "death_rate_next_window",
    label: "Deaths in the window after",
    unit: "share",
    level: "decision",
    direction: "lower",
    description:
      "Share of selected decisions followed by the seat's death within the window.",
    read: (e, c) =>
      windowMean(e, c, (r) => (r.outcome ? (r.outcome.died ? 1 : 0) : null)),
  },
  {
    id: "target_kill_rate_next_window",
    label: "Chosen target eliminated in window",
    unit: "share",
    level: "decision",
    direction: "higher",
    description:
      "Share of selected decisions whose bound target was eliminated within the window.",
    read: (e, c) =>
      windowMean(e, c, (r) =>
        r.outcome?.target ? (r.outcome.target.killed ? 1 : 0) : null,
      ),
  },
  {
    id: "objective_progress_m",
    label: "Objective progress in window",
    unit: "m",
    level: "decision",
    direction: "higher",
    description:
      "Mean metres the objective drew nearer over the window; null in modes without one.",
    read: (e, c) =>
      windowMean(e, c, (r) =>
        r.outcome &&
        r.outcome.objectiveStartM !== null &&
        r.outcome.objectiveEndM !== null
          ? r.outcome.objectiveStartM - r.outcome.objectiveEndM
          : null,
      ),
  },
  {
    id: "place_reached_rate",
    label: "Chosen place reached in window",
    unit: "share",
    level: "decision",
    direction: "higher",
    description:
      "Share of selected decisions whose bound place was reached within the window.",
    read: (e, c) =>
      windowMean(e, c, (r) =>
        r.outcome?.place ? (r.outcome.place.reached ? 1 : 0) : null,
      ),
  },
  {
    id: "reversal_rate",
    label: "Travel reversals",
    unit: "share",
    level: "episode",
    direction: "none",
    description:
      "Share of ended travels ended because a later choice replaced them before arrival.",
    read: (e) => {
      const releases = e.metrics.places?.releases;
      if (!releases) return null;
      const total = Object.values(releases).reduce((a, b) => a + b, 0);
      return ratio(releases["replaced"] ?? 0, total);
    },
  },
  {
    id: "stale_rejection_rate",
    label: "Rejected as stale at execution",
    unit: "share",
    level: "episode",
    direction: "none",
    description:
      "Share of decisions reaching execution that were refused because part of the choice had become illegal.",
    read: (e) => {
      const reached = e.decisions.filter(executedOrRejected);
      return ratio(
        reached.filter((r) => r.validation.status === "rejected_stale").length,
        reached.length,
      );
    },
  },
  {
    id: "illegal_executed_rate",
    label: "Executed although partly illegal",
    unit: "share",
    level: "episode",
    direction: "lower",
    description:
      "Share of decisions reaching execution that ran with an axis no longer legal (only possible under the observe policy).",
    read: (e) => {
      const reached = e.decisions.filter(executedOrRejected);
      return ratio(
        reached.filter((r) => r.validation.status === "executed_illegal").length,
        reached.length,
      );
    },
  },
  {
    id: "world_changed_rate",
    label: "World changed before execution",
    unit: "share",
    level: "episode",
    direction: "none",
    description:
      "Share of decisions reaching execution where something the brain was shown had changed.",
    read: (e) => {
      const reached = e.decisions.filter(executedOrRejected);
      return ratio(
        reached.filter((r) => r.validation.worldChanged.length > 0).length,
        reached.length,
      );
    },
  },
  {
    id: "age_at_execution_ms",
    label: "Observation age at execution",
    unit: "ms",
    level: "episode",
    direction: "lower",
    description: "Mean wall milliseconds from observation to the start of execution.",
    read: (e) =>
      mean(
        e.decisions
          .map((r) => r.validation.ageAtExecutionMs)
          .filter((v): v is number => v !== null),
      ),
  },
  {
    id: "decision_latency_ms",
    label: "Decision round trip",
    unit: "ms",
    level: "episode",
    direction: "lower",
    description: "Mean browser round trip of accepted decisions.",
    read: (e) =>
      mean(
        e.decisions
          .map((r) => r.accounting.wallLatencyMs)
          .filter((v): v is number => v !== null),
      ),
  },
];

export function metricDefinition(id: string): MetricDefinition | null {
  return METRICS.find((m) => m.id === id) ?? null;
}
