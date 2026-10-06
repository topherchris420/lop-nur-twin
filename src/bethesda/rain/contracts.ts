/**
 * `rain-bethesda/v2` — the narrow, versioned protocol between this repository's
 * Bethesda simulation and its R.A.I.N. research runtime (`src/rain/`), which
 * serves it from the same process behind `/api/rain/*`.
 *
 * Shared with the server (`server/rain/`), so it is imported as
 * `./contracts.js` and imports only the runtime's pure protocol modules. It
 * holds vocabularies and wire types only: no map, no simulator, no renderer,
 * no corpus and no engine.
 *
 * Who owns what is the point of the whole directory:
 *
 *   R.A.I.N.  the four perspectives, retrieval, quote verification, the
 *             meeting, bounded proposals, pre-registration and the registry's
 *             run record (its own evaluation and interpretation).
 *   Bethesda  the world: scenarios, simulation ticks, world observations,
 *             matched runs, replay and deterministic world validation.
 *   A human   whether a validated experiment may run.
 *
 * Every message that crosses the boundary has a closed shape. Unknown fields,
 * unknown schemas, oversized payloads and stale or mismatched requests are
 * rejected in `validation.ts`; nothing is repaired or guessed.
 *
 * v2: model-written meetings run as jobs (`meeting-pending`, then
 * `meeting-status` until a `meeting` or `meeting-failed`), the offline
 * engine's own analysis fields are null where a model meeting computes none,
 * every turn says who wrote it, and a bounded decision carries R.A.I.N.'s
 * attempts — what each engine chose, with its probabilities — even when
 * R.A.I.N. acted on none of them. v1 had none of these and is refused. The
 * identity names the runtime that answers (before the consolidation of the
 * runtime into this repository it named a bridge process) and the repository
 * whose revision it reports.
 */
import {
  CRITERIA_RULE,
  type CompletedStatus,
  type CriterionResult,
  type Evaluation,
  type RunStatus,
  type Verdict as RunVerdict,
} from "../../rain/experiments/evaluate.js";
import {
  DECISION_SCHEMA,
  ESCALATION_REASONS,
  PROVIDER_ERRORS,
} from "../../rain/judgment/routing.js";
import {
  PERSPECTIVES,
  SOUL_FILES,
  type Perspective,
} from "../../rain/meeting/perspectives.js";
import {
  MODEL_ID,
  RAIN_BETHESDA_SCHEMA,
  RAIN_SESSION_ARTIFACT_SCHEMA,
  REPOSITORY,
  TURN_LIMITS,
  UNSAFE_TEXT,
} from "../../rain/protocol.js";

export {
  CRITERIA_RULE,
  MODEL_ID,
  PERSPECTIVES,
  RAIN_BETHESDA_SCHEMA,
  RAIN_SESSION_ARTIFACT_SCHEMA,
  REPOSITORY,
  SOUL_FILES,
  UNSAFE_TEXT,
  type CriterionResult,
  type Evaluation,
  type Perspective,
};
export const EXPERIMENT_PROPOSAL_SCHEMA = "rain-bethesda-experiment/v1" as const;
export const DEFINITION_SCHEMA = "bethesda-experiment-definition/v1" as const;
export const AUTHORIZATION_SCHEMA = "bethesda-experiment-authorization/v1" as const;
/**
 * Not `bethesda-observation/*`: that family is the agent-perspective schema the
 * city sends Jev (`contract.ts`, v2; v1 was retired), and the Jev endpoint
 * routes every `bethesda-observation/` payload to its city handler. A world
 * observation is the simulator's account of its own state, not an agent's view.
 */
export const WORLD_OBSERVATION_SCHEMA = "bethesda-world-observation/v1" as const;
/**
 * v2: the record's provenance names the R.A.I.N. runtime's repository and
 * revision in its own fields (`rain_*`); v1 named the bridge's james_library
 * checkout and is refused.
 */
export const RECORD_SCHEMA = "bethesda-rain-experiment-record/v2" as const;
/** R.A.I.N.'s external-run contract (`src/rain/experiments/schemas/submission.schema.json`). */
export const RAIN_SUBMISSION_SCHEMA = "rain-experiment-submission/v1" as const;
export const RAIN_DECISION_SCHEMA = DECISION_SCHEMA;
/**
 * R.A.I.N.'s escalation reasons (`src/rain/judgment/routing.ts`). A decision's
 * reason, and each attempt's, is one of these or null.
 */
export const RAIN_ESCALATION_REASONS = ESCALATION_REASONS;
/** The engines R.A.I.N.'s router can consult. `typesafe` is Jev. */
export const RAIN_DECISION_ENGINES = ["laya", "typesafe"] as const;
/** R.A.I.N.'s provider error codes for a failed attempt. */
export const RAIN_PROVIDER_ERRORS = PROVIDER_ERRORS;
export const LAB_REPOSITORY = "topherchris420/lop-nur-twin" as const;

/**
 * OFFLINE: the research runtime is switched off or could not start. Nothing is produced.
 * DEMO:    a bundled recording of a real offline-engine meeting, labelled
 *          prerecorded; no process runs.
 * LIVE:    the runtime answered through this site's route, and validated.
 */
export type RuntimeMode = "OFFLINE" | "DEMO" | "LIVE";

/** How the words in a meeting were produced. */
export const GENERATIONS = ["scripted", "model"] as const;
export type Generation = (typeof GENERATIONS)[number];

// ---------------------------------------------------------------------------
// Size limits. Every message is bounded in both directions.
// ---------------------------------------------------------------------------
export const LIMITS = {
  question: 500,
  hypothesis: 1000,
  ...TURN_LIMITS,
  terms: 32,
  readNext: 12,
  suggestions: 8,
  sourcePath: 300,
  /** Bytes, measured on the UTF-8 encoding. */
  meetingResponse: 512 * 1024,
  meetingJobResponse: 4 * 1024,
  identityResponse: 8 * 1024,
  proposalResponse: 16 * 1024,
  preregistrationResponse: 16 * 1024,
  admissionResponse: 96 * 1024,
  meetingRequest: 4 * 1024,
  meetingJobRequest: 1024,
  proposalRequest: 16 * 1024,
  preregisterRequest: 64 * 1024,
  submissionRequest: 256 * 1024,
  /** A research session: meetings, then it must be restarted. */
  meetingsPerSession: 12,
  sessionMinutes: 120,
  /** How long the lab waits for one model meeting before giving up on it. */
  meetingJobMinutes: 60,
  /** Engines one bounded decision may report (R.A.I.N.'s cascade has two). */
  attempts: 4,
  /** A R.A.I.N. proposal older than this is stale and is never approved. */
  proposalTtlMs: 15 * 60 * 1000,
  /** Experiment records kept in the in-browser registry. */
  registryEntries: 64,
} as const;

// ---------------------------------------------------------------------------
// The experimental substrate's closed vocabulary. Ids only: what each id
// means in the map is resolved by the host (`experiments.ts`), never by the
// proposer. A proposal can name these and nothing else.
// ---------------------------------------------------------------------------
export const SCENARIO_IDS = [
  "metro_closure",
  "fire",
  "gas_leak",
  "festival",
  "rally",
  "crash",
  "outage",
  "storm",
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const LOCATION_IDS = [
  "bethesda_metro",
  "bethesda_row",
  "veterans_park",
  "farm_womens_market",
  "woodmont_bethesda",
  "downtown",
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];
/** Which places each scenario may be run at. */
export const SCENARIO_LOCATIONS: Record<ScenarioId, readonly LocationId[]> = {
  metro_closure: ["bethesda_metro"],
  fire: ["bethesda_row", "veterans_park", "farm_womens_market"],
  gas_leak: ["bethesda_row", "farm_womens_market"],
  festival: ["bethesda_row"],
  rally: ["veterans_park"],
  crash: ["woodmont_bethesda"],
  outage: ["downtown"],
  storm: ["downtown"],
};
export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  metro_closure: "Metro closure",
  fire: "Fire",
  gas_leak: "Gas leak",
  festival: "Street festival",
  rally: "Rally",
  crash: "Vehicle collision",
  outage: "Power outage",
  storm: "Thunderstorm",
};
export const LOCATION_LABELS: Record<LocationId, string> = {
  bethesda_metro: "Bethesda Metro entrance",
  bethesda_row: "Bethesda Row",
  veterans_park: "Veteran's Park",
  farm_womens_market: "Farm Women's Market",
  woodmont_bethesda: "Woodmont Ave & Bethesda Ave",
  downtown: "Downtown Bethesda",
};

export const METRIC_IDS = [
  "cohort_mean_distance_m",
  "cohort_indoors",
  "pedestrians_near",
  "leaving",
  "sheltering",
  "watching",
  "vehicles_held",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export interface MetricSpec {
  unit: "m" | "count";
  /** How the arm's value is formed from its window samples. */
  aggregate: "final" | "mean";
  description: string;
  /** The largest minimum effect a proposal may pre-register. */
  maxEffect: number;
}
/**
 * Every metric is computed by `observations.ts` from authoritative simulator
 * state — agents, actions, events — never from anything rendered.
 */
export const METRICS: Record<MetricId, MetricSpec> = {
  cohort_mean_distance_m: {
    unit: "m",
    aggregate: "final",
    description:
      "Mean distance from the location of the pedestrians who were outdoors in its 150 m catchment at the start of the window (the cohort) and are outdoors at its end.",
    maxEffect: 500,
  },
  cohort_indoors: {
    unit: "count",
    aggregate: "final",
    description:
      "Cohort members inside a building, the Metro or a bus at the end of the window.",
    maxEffect: 200,
  },
  pedestrians_near: {
    unit: "count",
    aggregate: "mean",
    description:
      "Outdoor pedestrians within the near radius of the location, averaged over the window's samples.",
    maxEffect: 200,
  },
  leaving: {
    unit: "count",
    aggregate: "mean",
    description:
      "Outdoor pedestrians within 300 m of the location whose current action is leave, averaged over the window's samples.",
    maxEffect: 200,
  },
  sheltering: {
    unit: "count",
    aggregate: "mean",
    description:
      "Outdoor pedestrians within 300 m of the location whose current action is shelter, averaged over the window's samples.",
    maxEffect: 200,
  },
  watching: {
    unit: "count",
    aggregate: "mean",
    description:
      "Outdoor pedestrians within 300 m of the location who are watching or recording, averaged over the window's samples.",
    maxEffect: 200,
  },
  vehicles_held: {
    unit: "count",
    aggregate: "mean",
    description:
      "Cars and buses within 300 m of the location that are stopped or detouring, averaged over the window's samples.",
    maxEffect: 100,
  },
};
export const METRIC_LABELS: Record<MetricId, string> = {
  cohort_mean_distance_m: "Cohort mean distance from the location",
  cohort_indoors: "Cohort members indoors",
  pedestrians_near: "Pedestrians near the location",
  leaving: "Pedestrians leaving",
  sheltering: "Pedestrians heading to shelter",
  watching: "Pedestrians watching or recording",
  vehicles_held: "Vehicles stopped or detouring",
};

export const EXPERIMENT_BOUNDS = {
  maxSeeds: 5,
  warmup: { min: 100, max: 1200 },
  window: { min: 300, max: 3000 },
  /** Ticks between world observations; warmup and window are multiples. */
  sampleInterval: 100,
  /** Seeds × 2 arms × (warmup + window). */
  maxTotalTicks: 36000,
} as const;
export const DIRECTIONS = ["increase", "decrease"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const PROPOSAL_ORIGINS = ["rain", "fixture", "human"] as const;
export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

// ---------------------------------------------------------------------------
// Wire types. Snake case, like R.A.I.N.'s own contracts.
// ---------------------------------------------------------------------------
export interface Quote {
  /** Corpus-relative path as R.A.I.N. reported it. Displayed, never opened. */
  source: string;
  line: number;
  /** `[start, end)` character offsets in that file, from R.A.I.N.'s verifier. */
  span_start: number;
  span_end: number;
  text: string;
  /** R.A.I.N.'s `verifyQuote` result when the record was produced. */
  verified: boolean;
}
export interface Turn {
  index: number;
  speaker: Perspective;
  /** As R.A.I.N. declared it. */
  role: string;
  move: string;
  lead: string;
  quotes: Quote[];
  coda: string;
  /** Quoted spans R.A.I.N. could not verify. */
  unverified: number;
  /**
   * Who wrote these words. The offline engine's turns, and the fixed lines
   * R.A.I.N.'s code adds to a model meeting (its closing line), are
   * `scripted`; what the meeting's model wrote is `model`.
   */
  generation: Generation;
}
export interface Verdict {
  agreed: string;
  contested: string;
  next_move: string;
  read_next: string[];
}
export interface CitationAudit {
  checked: number;
  verified: number;
  corpus_files: number;
  corpus_sha256: string;
}
/**
 * The revision of the code that produced a record: the runtime's repository
 * (`owner/name`) and its commit, or null when unknown. The DEMO recording was
 * made by the engine at a named commit; a LIVE meeting names the runtime's.
 */
export interface RainRevision {
  repository: string;
  commit: string | null;
  dirty: boolean | null;
}
export interface MeetingRecord {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "meeting";
  request_id: string;
  meeting_id: string;
  question: string;
  generation: Generation;
  /** The R.A.I.N. code path that produced the meeting. */
  engine: string;
  /** Only when `generation` is `model`. */
  model: string | null;
  /**
   * The offline engine's own analysis: how well the corpus covers the
   * question, and where the room stands. R.A.I.N.'s model meeting computes
   * none of it, so a model meeting carries null here — never a filled-in guess.
   */
  grounding: "strong" | "partial" | "none" | null;
  matched_terms: string[] | null;
  missing_terms: string[] | null;
  turns: Turn[];
  verdict: Verdict | null;
  audit: CitationAudit;
  suggestions: string[];
  rain: RainRevision;
  produced_at: string;
  /** R.A.I.N.'s own record of a model meeting, by its id and the SHA-256 of the file. */
  source_artifact: SourceArtifact | null;
}
export interface SourceArtifact {
  schema: typeof RAIN_SESSION_ARTIFACT_SCHEMA;
  session_id: string;
  status: string;
  sha256: string;
}
/** A model meeting R.A.I.N. is still holding. Its words arrive only when it ends. */
export interface MeetingPending {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "meeting-pending";
  request_id: string;
  job_id: string;
  question: string;
  model: string;
  started_at: string;
  elapsed_s: number;
  /** Turns R.A.I.N. has started: progress, not evidence. */
  turns_started: number;
  turns_planned: number;
}
export interface MeetingFailed {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "meeting-failed";
  request_id: string;
  job_id: string;
  reason: string;
}
export interface RainIdentity {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "identity";
  /** The runtime answering: its name and version. */
  runtime: { name: string; version: string };
  rain: RainRevision;
  corpus: { files: number; sha256: string };
  meeting_engine: string;
  meeting_generation: Generation;
  model: string | null;
  /** RAIN_DECISION_MODE as the runtime reports it; "off" proposes nothing. */
  bounded_decision: string;
  /**
   * RAIN_DECISION_REMOTE_ALLOWED: whether R.A.I.N. may send a decision's
   * question to a remote engine (Jev). Off, Jev is never asked.
   */
  remote_decisions: boolean;
  registry: { available: boolean; scratch: boolean };
}
/** One of the host's own experiment options, offered to R.A.I.N.'s router. */
export interface ProposalOption {
  id: string;
  description: string;
}
export interface ProposalChoice {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "proposal-choice";
  request_id: string;
  decision: {
    schema_version: typeof RAIN_DECISION_SCHEMA;
    decision_id: string;
    destination: string;
    selected: string | null;
    reason: string | null;
    envelope_hash: string;
    /** Every engine R.A.I.N. consulted, including ones whose answer it did not act on. */
    attempts: DecisionAttempt[];
    latency_ms: number;
  };
}
export interface DecisionAttempt {
  engine: (typeof RAIN_DECISION_ENGINES)[number];
  model: string | null;
  selected: string | null;
  /** As the engine returned them, by option id. Never filled in. */
  probabilities: [string, number][];
  confidence: number | null;
  /** Why R.A.I.N. did not act on this attempt; null when it would have. */
  reason: (typeof RAIN_ESCALATION_REASONS)[number] | null;
  error_code: (typeof RAIN_PROVIDER_ERRORS)[number] | null;
  latency_ms: number;
}
export interface Preregistration {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "preregistration";
  request_id: string;
  experiment_id: string;
  experiment_version: number;
  definition_sha256: string;
  created_at: string;
  registry: "scratch" | "configured";
}
export type RainRunStatus = Exclude<RunStatus, "running">;
export type RainCompletedStatus = CompletedStatus;
export type RainVerdict = RunVerdict;
export interface Admission {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "admission";
  request_id: string;
  run_id: string;
  status: RainRunStatus;
  hypothesis_verdict: RainVerdict;
  evaluation: Evaluation | null;
  interpretation: { deterministic: string; model: null };
  definition_sha256: string;
  recorded_at: string;
}
/** A structured experiment proposal. Ids from the closed vocabulary only. */
export interface ExperimentProposal {
  schema: typeof EXPERIMENT_PROPOSAL_SCHEMA;
  proposal_id: string;
  origin: ProposalOrigin;
  question: string;
  hypothesis: string;
  scenario: ScenarioId;
  location: LocationId;
  primary_metric: MetricId;
  expected_direction: Direction;
  minimum_effect: number;
  comparison: "matched_seed_control";
  seeds: number[];
  warmup_ticks: number;
  observation_window_ticks: number;
  /** R.A.I.N.'s bounded decision, when R.A.I.N. chose this option. */
  rain_decision: { decision_id: string; envelope_hash: string } | null;
  /** The meeting the proposal answers, if any. */
  meeting_id: string | null;
}

export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;
export const HEX32 = /^[0-9a-f]{32}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const COMMIT = /^[0-9a-f]{40}$/;
export const RAIN_EXPERIMENT_ID = /^V3D-EXP-[0-9]{4,}$/;
export const RAIN_RUN_ID = /^V3D-EXP-[0-9]{4,}-RUN-[0-9]{4,}$/;
/** R.A.I.N.'s actor pattern: a role label, never a name or an address. */
export const OPERATOR = /^[A-Za-z0-9_.-]{1,64}$/;
