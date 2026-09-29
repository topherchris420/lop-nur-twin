import { IDLE_FRAME, type ControlFrame } from "../../pilot/contract";
import { legalActionsFor, type LegalActions } from "../../pilot/observation";
import type { EpisodeRun } from "../evaluation";
import {
  DECISION_RECORD_VERSION,
  type DecisionRecord,
  type OutcomeWindow,
} from "../records";

/**
 * Hand-built decision records for the evaluation tests. Imported by
 * `*.test.ts` only. Every record here is synthetic and says so in its
 * `episodeId`; none resembles, or is ever written as, a measurement.
 */

export function legal(options: { enemies?: number; places?: number } = {}): LegalActions {
  return legalActionsFor(
    { stance: "stand", grounded: true, pitchDeg: 0 },
    { ammo: 20, magSize: 30, reserve: 90, reloading: false, canFire: true },
    {
      control: "precision",
      visibleEnemies: options.enemies ?? 0,
      navigation: "places",
      places: options.places ?? 0,
      travelling: false,
    },
  );
}

export function outcome(overrides: Partial<OutcomeWindow> = {}): OutcomeWindow {
  return {
    windowS: 5,
    elapsedS: 5,
    complete: true,
    damageTaken: 0,
    damageDealt: 0,
    shotsFired: 0,
    hits: 0,
    kills: 0,
    died: false,
    timeToDeathS: null,
    exposureSamples: 20,
    exposedSamples: 0,
    movedM: 0,
    objectiveStartM: null,
    objectiveEndM: null,
    enemyShotsInSight: 0,
    target: null,
    place: null,
    ...overrides,
  };
}

let sequence = 0;

export function record(
  overrides: Partial<Omit<DecisionRecord, "frame">> & {
    frame?: Partial<ControlFrame>;
  } = {},
): DecisionRecord {
  sequence += 1;
  const { frame, ...rest } = overrides;
  return {
    schema: DECISION_RECORD_VERSION,
    episodeId: "synthetic",
    seed: 42,
    sequence,
    source: "random",
    brain: "random",
    observationHash: "0000000000000000",
    observation: null,
    context: {
      visibleEnemies: 0,
      enemiesFiring: 0,
      contacts: 0,
      damageRecent: false,
      health: 100,
      ammo: 20,
      magSize: 30,
      reserve: 90,
      reloading: false,
      stance: "stand",
      motion: "still",
      targets: [],
      places: [],
      objectiveDistanceM: null,
    },
    legal: legal(),
    frame: { ...IDLE_FRAME, ...frame },
    confidence: { source: "none", perAxis: {} },
    accounting: {
      provider: "local",
      model: null,
      wallLatencyMs: 1,
      providerLatencyMs: null,
      requestBytes: null,
      responseBytes: null,
      inputTokens: null,
      outputTokens: null,
      reportedCostUsd: null,
      retries: null,
      traceId: null,
      questionHash: null,
      injectedLatencyMs: 0,
    },
    issuedAtSim: 0,
    acceptedAtSim: 0,
    validation: {
      status: "executed",
      ageAtExecutionMs: 2,
      worldChanged: [],
      illegalAtExecution: [],
    },
    execution: {
      actionStart: 0,
      actionEnd: 0.4,
      endReason: "replaced",
      targetBound: null,
      placeBound: null,
      placeKind: null,
    },
    outcome: outcome(),
    ...rest,
  };
}

export function episode(
  seed: number,
  decisions: DecisionRecord[],
  metrics: Partial<EpisodeRun["metrics"]> = {},
): EpisodeRun {
  return {
    runId: `synthetic-${seed}`,
    seed,
    simSeconds: 60,
    wallSeconds: 60,
    lagged: false,
    metrics: {
      simSeconds: 60,
      kills: 0,
      deaths: 0,
      shotsFired: 0,
      hits: 0,
      accuracy: null,
      damageDealt: 0,
      damageTaken: 0,
      meanSurvivalS: 60,
      distanceM: 100,
      decisions: { accepted: decisions.length },
      debrief: {
        exposedFraction: 0.3,
        longestExposedS: 2,
        kills: { meanSightToKillS: null },
      },
      places: null,
      opponent: null,
      ...metrics,
    },
    decisions,
    failures: [],
    brain: { id: "random", kind: "random", provider: "local", testDouble: false },
    interface: {},
    artifacts: { report: `synthetic/${seed}.json`, decisions: null, trace: null },
  };
}
