/**
 * Matched experiment arms on separate simulator instances.
 *
 * Never the live city: every arm is a fresh `CitySimulation` built from the
 * definition's population and one seed. Control and treatment receive the same
 * recorded commands — the full-rate focus at tick 0 — and the treatment alone
 * receives the compiled scenario at the end of warm-up, through the city's own
 * `inject`. Both arms must therefore be in identical states at that tick; the
 * runner records each arm's state hash there and the evaluation's guard
 * refuses a conclusion if any pair differs.
 *
 * The runner is a generator so a worker or a time-sliced loop can drive it,
 * and it refuses to start unless the definition re-verifies against this build
 * and an authority binds to its exact SHA-256: a person's authorization of
 * that definition, or a standing authority (`standing.ts`) — a charter a
 * person authorized that lists this definition's exact design, and the
 * autonomy policy's admission of it. A proposal, however it arrived, cannot
 * reach this code without both.
 */
import { CitySimulation, type Command, type Config } from "../simulation";
import { canonicalHash } from "../../game/pilot/hash";
import { METRIC_IDS, type MetricId } from "./contracts";
import { verifyDefinition, type ExperimentDefinition } from "./experiments";
import { verifyAuthorization, type Authorization } from "./authorization";
import { isStanding, verifyStanding, type StandingAuthority } from "./standing";
import {
  aggregate,
  cohortAt,
  observeWorld,
  type Region,
  type WorldObservation,
} from "./observations";
import { evaluate } from "../../rain/experiments/evaluate";
import type { Evaluation, RainCompletedStatus, RainVerdict } from "./contracts";

export type ArmName = "control" | "treatment";
export interface ArmRecord {
  id: string;
  seed: number;
  arm: ArmName;
  config: Config;
  /** Exactly what the simulator recorded: replay re-applies these and nothing else. */
  commands: Command[];
  tick: number;
  t0_tick: number;
  t0_hash: string;
  cohort: number[];
  baseline: WorldObservation;
  observations: WorldObservation[];
  values: Record<MetricId, number | null>;
  checkpoints: { tick: number; hash: string }[];
  final_hash: string;
  decisions: number;
  decisions_hash: string;
}
export interface SeedResult {
  seed: number;
  control: number | null;
  treatment: number | null;
  delta: number | null;
  t0_matched: boolean;
  cohort: number;
}
export interface RunResult {
  arms: ArmRecord[];
  per_seed: SeedResult[];
  measurements: Record<string, number | null>;
  series: Record<string, number[]>;
  status: RainCompletedStatus;
  verdict: RainVerdict;
  evaluation: Evaluation;
}
/** Live presentation of an arm in progress. Not part of any record. */
export interface Progress {
  seed: number;
  arm: ArmName;
  armIndex: number;
  arms: number;
  tick: number;
  totalTicks: number;
  packet: WorldObservation | null;
  /** Flattened x, z of outdoor pedestrians, then of road vehicles, for the room's map. */
  pedestrians: number[];
  vehicles: number[];
  events: { x: number; z: number; r: number }[];
}

export class RunRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("Run refused: " + reasons.join("; "));
    this.reasons = reasons;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
export const regionOf = (d: ExperimentDefinition): Region => ({
  location: d.scenario.location,
  center: { ...d.center },
  near_m: d.radii.near,
  region_m: d.radii.region,
  catchment_m: d.radii.catchment,
});
export const armId = (experimentId: string, arm: ArmName, seed: number) =>
  `${experimentId}:${arm}:${seed}`;

/** The commands an arm must carry, derived from the definition with the simulator's own rules. */
export function expectedCommands(d: ExperimentDefinition, seed: number, arm: ArmName) {
  const sim = new CitySimulation({ ...d.population, seed });
  sim.setFocus(d.center, d.radii.focus);
  const commands: Command[] = structuredClone(sim.commands);
  if (arm === "treatment")
    commands.push({ type: "scenario", tick: d.warmup_ticks, scenario: d.scenario.event });
  return commands;
}

function snapshot(sim: CitySimulation) {
  const pedestrians: number[] = [],
    vehicles: number[] = [];
  for (const a of sim.agents) {
    if (a.inside) continue;
    const out = a.kind === "pedestrian" ? pedestrians : vehicles;
    out.push(Math.round(a.point.x), Math.round(a.point.z));
  }
  return {
    pedestrians,
    vehicles,
    events: sim.events.map((e) => ({ x: e.at.x, z: e.at.z, r: e.radius })),
  };
}

function* runArm(
  d: ExperimentDefinition,
  experimentId: string,
  seed: number,
  arm: ArmName,
  armIndex: number,
): Generator<Progress, ArmRecord> {
  const sim = new CitySimulation({ ...d.population, seed });
  sim.setFocus(d.center, d.radii.focus);
  const region = regionOf(d);
  const id = armId(experimentId, arm, seed);
  const subject = `${experimentId}/${arm}/seed-${seed}`;
  const total = d.warmup_ticks + d.window_ticks;
  const progress = (packet: WorldObservation | null): Progress => ({
    seed,
    arm,
    armIndex,
    arms: d.seeds.length * 2,
    tick: sim.tick,
    totalTicks: total,
    packet,
    ...snapshot(sim),
  });
  for (let i = 0; i < d.warmup_ticks; i++) {
    sim.step();
    if (sim.tick % d.sample_interval === 0 && sim.tick < d.warmup_ticks)
      yield progress(null);
  }
  const t0Hash = sim.stateHash();
  const cohort = cohortAt(sim, d.center, d.radii.catchment);
  const context = { subject, experimentId, arm, region, cohort, replayId: id };
  const baseline = observeWorld(sim, context);
  yield progress(baseline);
  if (arm === "treatment" && !sim.inject(d.scenario.event))
    throw new Error("The simulator refused the compiled scenario");
  const observations: WorldObservation[] = [];
  for (let i = 0; i < d.window_ticks; i++) {
    sim.step();
    if (sim.tick % d.sample_interval === 0) {
      const packet = observeWorld(sim, context);
      observations.push(packet);
      yield progress(packet);
    }
  }
  const trace = sim.export();
  return {
    id,
    seed,
    arm,
    config: { ...sim.config },
    commands: trace.commands,
    tick: trace.tick,
    t0_tick: d.warmup_ticks,
    t0_hash: t0Hash,
    cohort,
    baseline,
    observations,
    values: aggregate(observations),
    checkpoints: trace.checkpoints,
    final_hash: trace.finalHash,
    decisions: trace.decisions.length,
    decisions_hash: canonicalHash(trace.decisions),
  };
}

/** Per-seed differences, the summary measurements and the deterministic evaluation. */
export function summarize(
  d: ExperimentDefinition,
  arms: ArmRecord[],
): Omit<RunResult, "arms"> {
  const metric = d.primary_metric;
  const up = d.expected_direction === "increase";
  const per_seed: SeedResult[] = d.seeds.map((seed) => {
    const c = arms.find((a) => a.seed === seed && a.arm === "control");
    const t = arms.find((a) => a.seed === seed && a.arm === "treatment");
    const cv = c?.values[metric] ?? null,
      tv = t?.values[metric] ?? null;
    return {
      seed,
      control: cv,
      treatment: tv,
      delta: cv !== null && tv !== null ? round(tv - cv) : null,
      t0_matched:
        !!c &&
        !!t &&
        c.t0_hash === t.t0_hash &&
        JSON.stringify(c.cohort) === JSON.stringify(t.cohort),
      cohort: c?.cohort.length ?? 0,
    };
  });
  const complete = per_seed.filter(
    (s) =>
      arms.some((a) => a.seed === s.seed && a.arm === "control") &&
      arms.some((a) => a.seed === s.seed && a.arm === "treatment"),
  );
  const deltas = per_seed.map((s) => s.delta);
  const known = deltas.filter((v): v is number => v !== null);
  const allKnown = known.length === deltas.length && known.length > 0;
  const mean = (values: number[]) =>
    values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : null;
  const measurements: Record<string, number | null> = {
    seeds_completed: complete.length,
    matched_t0_seeds: per_seed.filter((s) => s.t0_matched).length,
    cohort_min: per_seed.length ? Math.min(...per_seed.map((s) => s.cohort)) : 0,
    primary_delta_mean: allKnown ? mean(known) : null,
    primary_delta_min: allKnown ? Math.min(...known) : null,
    primary_delta_max: allKnown ? Math.max(...known) : null,
    seeds_in_expected_direction: known.filter((v) => (up ? v > 0 : v < 0)).length,
    control_primary_mean: mean(
      per_seed.map((s) => s.control).filter((v): v is number => v !== null),
    ),
    treatment_primary_mean: mean(
      per_seed.map((s) => s.treatment).filter((v): v is number => v !== null),
    ),
  };
  for (const id of METRIC_IDS) {
    const values = d.seeds.map((seed) => {
      const c = arms.find((a) => a.seed === seed && a.arm === "control")?.values[id];
      const t = arms.find((a) => a.seed === seed && a.arm === "treatment")?.values[id];
      return typeof c === "number" && typeof t === "number" ? t - c : null;
    });
    measurements[`delta_mean_${id}`] = values.every((v) => v !== null)
      ? mean(values)
      : null;
  }
  const { status, verdict, evaluation } = evaluate(d.criteria, measurements);
  return {
    per_seed,
    measurements,
    series: {
      primary_delta_by_seed: known,
      control_primary_by_seed: per_seed
        .map((s) => s.control)
        .filter((v): v is number => v !== null),
      treatment_primary_by_seed: per_seed
        .map((s) => s.treatment)
        .filter((v): v is number => v !== null),
    },
    status,
    verdict,
    evaluation,
  };
}

/** Who allowed a run: a person, for this definition; or a charter a person authorized. */
export type RunAuthority = Authorization | StandingAuthority;

/** Every precondition, re-checked at the moment of execution. */
export function preflight(
  d: ExperimentDefinition,
  definitionSha256: string,
  experimentId: string,
  authorization: RunAuthority | null,
  now: Date = new Date(),
): string[] {
  return [
    ...verifyDefinition(d, definitionSha256),
    ...(!authorization
      ? ["no authorization record: a human must approve this exact definition"]
      : isStanding(authorization)
        ? verifyStanding(authorization, experimentId, d, definitionSha256, { now })
        : verifyAuthorization(authorization, experimentId, definitionSha256)),
  ];
}

export function* runExperiment(
  d: ExperimentDefinition,
  definitionSha256: string,
  experimentId: string,
  authorization: RunAuthority | null,
): Generator<Progress, RunResult> {
  const refused = preflight(d, definitionSha256, experimentId, authorization);
  if (refused.length) throw new RunRefused(refused);
  const arms: ArmRecord[] = [];
  let index = 0;
  for (const seed of d.seeds)
    for (const arm of ["control", "treatment"] as const)
      arms.push(yield* runArm(d, experimentId, seed, arm, index++));
  return { arms, ...summarize(d, arms) };
}

/** Drive a run to completion synchronously (tests, tools). */
export function runToCompletion(
  d: ExperimentDefinition,
  definitionSha256: string,
  experimentId: string,
  authorization: RunAuthority | null,
): RunResult {
  const steps = runExperiment(d, definitionSha256, experimentId, authorization);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
