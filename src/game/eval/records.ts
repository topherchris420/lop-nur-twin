import type { Axis, ControlFrame } from "../pilot/contract.js";
import type { JevObservation, LegalActions, PlaceKind } from "../pilot/observation.js";

/**
 * One decision, reconstructable end to end: `blacksite-decision/v1`.
 *
 * The record follows the pipeline every brain goes through, one section per
 * stage, so a reader can answer each question the evaluation is accountable
 * for without joining files:
 *
 *   OBSERVATION   what did it see?           `observationHash`, `observation`, `context`
 *   OPTIONS       what could it choose?      `legal`
 *   DECISION      what did it choose?        `frame`, `source`, `brain`
 *   CONFIDENCE    how sure did it say it was `confidence` (with its source, or none)
 *   ACCOUNTING    what did the choice cost?  `accounting`
 *   VALIDATION    was it still legal?        `validation`
 *   EXECUTION     what did software do?      `execution`
 *   OUTCOME       what did the world do?     `outcome`
 *
 * The browser writes these (`pilot/outcomes.ts`); nothing in it judges them.
 * Whether an outcome was a success is decided offline, by the outcome contract
 * the experiment declared before it ran (`outcomeContracts.ts`). Measuring and
 * scoring are kept in different files on purpose: the scoring function can be
 * read, versioned and argued with without re-running a match.
 */

export const DECISION_RECORD_VERSION = "blacksite-decision/v1";

export type RecordSource =
  "jev" | "glide" | "llm" | "random" | "script" | "replay" | "fallback-random";

/**
 * Where a confidence number came from. They are different claims and are
 * never pooled:
 *
 *  - `provider-probability` — the provider's own distribution over the offered
 *    options (TypeSafe's probabilities and confidence);
 *  - `verbalized` — a number the model wrote in its answer when asked for one;
 *  - `none` — the brain states nothing, and nothing is filled in.
 */
export type ConfidenceSource = "provider-probability" | "verbalized" | "none";

export interface AxisConfidence {
  /** Probability the brain gave the option it chose, when it gave one. */
  probability: number | null;
  /** A separate confidence figure, when the brain states one. */
  confidence: number | null;
}

export interface DecisionConfidence {
  source: ConfidenceSource;
  perAxis: Partial<Record<Axis, AxisConfidence>>;
}

/**
 * What one decision cost, as measured or reported. Every unknown is `null`,
 * never zero: a brain with no tokens has `null` tokens, and a model with no
 * configured price has a `null` cost.
 */
export interface DecisionAccounting {
  /** Who served it: `typesafe`, `anthropic`, `openai-compatible`, `local`. */
  provider: string;
  model: string | null;
  /** Browser round trip, issue to answer, milliseconds. */
  wallLatencyMs: number | null;
  /** The server's measurement of the upstream call alone, when there is one. */
  providerLatencyMs: number | null;
  /** Bytes the browser sent and received for this decision. */
  requestBytes: number | null;
  responseBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** A cost the provider itself reported. None does today; kept for when one does. */
  reportedCostUsd: number | null;
  /** Upstream attempts beyond the first, server-side. */
  retries: number | null;
  /** The provider's own id for the call, when it returns one. */
  traceId: string | null;
  /** FNV-1a of the exact question the server built, so "what was asked" is checkable. */
  questionHash: string | null;
  /** Answer delay injected by an experiment (local brains only), milliseconds. */
  injectedLatencyMs: number;
}

/**
 * Facts from the observation at decision time that the outcome contracts
 * read. They are copies, not new measurements — everything here is in the
 * observation the brain received.
 */
export interface DecisionContext {
  visibleEnemies: number;
  enemiesFiring: number;
  contacts: number;
  damageRecent: boolean;
  health: number;
  ammo: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  stance: string;
  motion: string;
  targets: {
    distanceM: number;
    firing: boolean;
    fullyExposed: boolean;
    onCrosshair: boolean;
    tracked: boolean;
  }[];
  places: {
    kind: PlaceKind;
    hidden: boolean;
    distanceM: number;
    routeExposedM: number;
  }[];
  objectiveDistanceM: number | null;
}

export type ValidationStatus =
  /** Executed; nothing it chose had become illegal. */
  | "executed"
  /** Executed although part of it was illegal by then (the `observe` policy). */
  | "executed_illegal"
  /** Refused at execution: part of it had become illegal (the `strict` policy). */
  | "rejected_stale"
  /** A newer decision arrived before this one could start. */
  | "superseded"
  /** Accepted but never started: death, pause, takeover or episode end. */
  | "not_executed";

export interface DecisionValidation {
  status: ValidationStatus;
  /** Observation to execution, wall milliseconds; null if never executed. */
  ageAtExecutionMs: number | null;
  /** What differed at execution from what the brain was shown. */
  worldChanged: string[];
  /** Axes whose chosen option was no longer legal at execution. */
  illegalAtExecution: Axis[];
}

export interface DecisionExecution {
  /** Simulation seconds. */
  actionStart: number | null;
  actionEnd: number | null;
  endReason: string | null;
  /** Precision control: the chosen slot bound a living enemy. */
  targetBound: boolean | null;
  /** Places navigation: the chosen slot bound a place, and its kind. */
  placeBound: boolean | null;
  placeKind: PlaceKind | null;
}

/**
 * What the world did in the `windowS` seconds after the decision started to
 * execute. Raw quantities only; no field here says "good".
 */
export interface OutcomeWindow {
  windowS: number;
  /** Seconds actually observed; less than `windowS` when the episode ended. */
  elapsedS: number;
  complete: boolean;
  damageTaken: number;
  damageDealt: number;
  shotsFired: number;
  hits: number;
  kills: number;
  died: boolean;
  timeToDeathS: number | null;
  /** Samples of "does any living enemy hold a sight line to the seat". */
  exposureSamples: number;
  exposedSamples: number;
  movedM: number;
  objectiveStartM: number | null;
  objectiveEndM: number | null;
  /** Enemy rounds fired while that enemy held a sight line to the seat. */
  enemyShotsInSight: number;
  /** The enemy the decision's target slot bound, if any. */
  target: { hit: boolean; killed: boolean; damage: number } | null;
  /** The place the decision's go slot bound, if any, and how travel ended. */
  place: { reached: boolean; endReason: string | null } | null;
}

export interface DecisionRecord {
  schema: typeof DECISION_RECORD_VERSION;
  episodeId: string;
  seed: number;
  sequence: number;
  source: RecordSource;
  /** The brain descriptor id, e.g. `jev`, `llm:anthropic`, `script:marksman`. */
  brain: string;
  observationHash: string;
  /** The full observation. Omitted only when the recorder was told to drop it. */
  observation: JevObservation | null;
  context: DecisionContext;
  legal: LegalActions;
  frame: ControlFrame;
  confidence: DecisionConfidence;
  accounting: DecisionAccounting;
  /** Simulation seconds at issue and at acceptance. */
  issuedAtSim: number;
  acceptedAtSim: number;
  validation: DecisionValidation;
  execution: DecisionExecution;
  outcome: OutcomeWindow | null;
}

/** A request that produced no decision: timeout, invalid, refusal, error. */
export interface FailureRecord {
  schema: typeof DECISION_RECORD_VERSION;
  episodeId: string;
  sequence: number;
  kind: string;
  detail: string;
  /** Wall milliseconds from issue to the failure. */
  latencyMs: number | null;
  /** True when the answer arrived but was discarded as stale by the loop. */
  staleAnswer: boolean;
}

/** Build the context section from an observation. Pure. */
export function contextOf(observation: JevObservation): DecisionContext {
  const p = observation.perception;
  return {
    visibleEnemies: p.visibleEnemies.length,
    enemiesFiring: p.visibleEnemies.filter((e) => e.firing).length,
    contacts: p.contacts.length,
    damageRecent: p.damage !== null,
    health: observation.player.health,
    ammo: observation.weapon.ammo,
    magSize: observation.weapon.magSize,
    reserve: observation.weapon.reserve,
    reloading: observation.weapon.reloading,
    stance: observation.player.stance,
    motion: observation.player.motion,
    targets: p.visibleEnemies.map((e) => ({
      distanceM: e.distanceM,
      firing: e.firing,
      fullyExposed: e.headVisible && e.chestVisible,
      onCrosshair: e.onCrosshair,
      tracked: e.tracked,
    })),
    places: p.places.map((place) => ({
      kind: place.kind,
      hidden: place.hidden,
      distanceM: place.distanceM,
      routeExposedM: place.routeExposedM,
    })),
    objectiveDistanceM: observation.objective.distanceM,
  };
}

/** Slot index of a TARGET_n / PLACE_n choice, or null. */
export function slotOf(action: string): number | null {
  const match = /^(?:TARGET|PLACE)_(\d)$/.exec(action);
  return match ? Number(match[1]) : null;
}

/** How many slot options of an axis were offered (TARGET_n or PLACE_n entries). */
export function offeredSlots(legal: LegalActions, axis: "target" | "go"): number {
  return (legal[axis] as readonly string[]).filter((a) => slotOf(a) !== null).length;
}
