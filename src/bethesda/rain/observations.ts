/**
 * `bethesda-world-observation/v1`: the simulator's typed account of its own
 * state at one tick. The only way a measurement enters the R.A.I.N. Lab.
 *
 * Every number here is computed from a `CitySimulation` — its agents, their
 * actions, its events — at the tick the packet names, and the packet carries
 * that state's hash. Nothing rendered can produce one: this module imports no
 * renderer, takes no positions from a scene, and `verifyObservation`
 * recomputes a packet from the simulator and rejects any that differ. An
 * avatar standing somewhere is a place to look, not a thing that was seen.
 */
import { DATA_VERSION, distance, type Point } from "../model";
import { SIM_VERSION, type CitySimulation } from "../simulation";
import {
  METRICS,
  METRIC_IDS,
  WORLD_OBSERVATION_SCHEMA,
  type LocationId,
  type MetricId,
} from "./contracts";
import { canonicalJson } from "./sha256";

export type Arm = "control" | "treatment" | "live";
export interface Region {
  location: LocationId;
  center: Point;
  near_m: number;
  region_m: number;
  catchment_m: number;
}
export interface WorldObservation {
  schema: typeof WORLD_OBSERVATION_SCHEMA;
  source: "bethesda-simulator";
  subject: string;
  experiment_id: string | null;
  arm: Arm;
  seed: number;
  tick: number;
  region: Region;
  metrics: Record<MetricId, number | null>;
  /** `CitySimulation.stateHash()` at this tick: the replay checkpoint hash family. */
  world_hash: string;
  replay_id: string;
  /** SHA-256 of the OSM snapshot the simulator ran on. */
  data_hash: string;
  sim_version: typeof SIM_VERSION;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The pedestrians the cohort metrics follow: outdoors in the catchment at T0. */
export function cohortAt(sim: CitySimulation, center: Point, radius: number): number[] {
  return sim.agents
    .filter(
      (a) => a.kind === "pedestrian" && !a.inside && distance(a.point, center) < radius,
    )
    .map((a) => a.id);
}

/** Metric values from authoritative state. Cohort metrics are null without a cohort. */
export function measure(
  sim: CitySimulation,
  region: Region,
  cohort: readonly number[] | null,
): Record<MetricId, number | null> {
  const { center } = region;
  let near = 0,
    leaving = 0,
    sheltering = 0,
    watching = 0,
    held = 0;
  for (const a of sim.agents) {
    if (a.inside) continue;
    const d = distance(a.point, center);
    if (a.kind === "pedestrian") {
      if (d < region.near_m) near++;
      if (d >= region.region_m) continue;
      if (a.action === "leave") leaving++;
      else if (a.action === "shelter") sheltering++;
      else if (a.action === "watch" || a.action === "record") watching++;
    } else if (
      (a.kind === "vehicle" || a.kind === "bus") &&
      d < region.region_m &&
      (a.action === "stop" || a.action === "detour")
    )
      held++;
  }
  let distanceMean: number | null = null,
    indoors: number | null = null;
  if (cohort) {
    const members = cohort.map((id) => sim.agents[id]!).filter(Boolean);
    const outdoors = members.filter((a) => !a.inside);
    indoors = members.length - outdoors.length;
    distanceMean = outdoors.length
      ? round(
          outdoors.reduce((s, a) => s + distance(a.point, center), 0) / outdoors.length,
        )
      : null;
  }
  return {
    cohort_mean_distance_m: distanceMean,
    cohort_indoors: indoors,
    pedestrians_near: near,
    leaving,
    sheltering,
    watching,
    vehicles_held: held,
  };
}

export function observeWorld(
  sim: CitySimulation,
  context: {
    subject: string;
    experimentId: string | null;
    arm: Arm;
    region: Region;
    cohort: readonly number[] | null;
    replayId: string;
  },
): WorldObservation {
  return {
    schema: WORLD_OBSERVATION_SCHEMA,
    source: "bethesda-simulator",
    subject: context.subject,
    experiment_id: context.experimentId,
    arm: context.arm,
    seed: sim.config.seed,
    tick: sim.tick,
    region: structuredClone(context.region),
    metrics: measure(sim, context.region, context.cohort),
    world_hash: sim.stateHash(),
    replay_id: context.replayId,
    data_hash: DATA_VERSION,
    sim_version: SIM_VERSION,
  };
}

/**
 * Recompute a packet from the simulator it claims to describe. A packet built
 * from anything else — a rendered frame, a guess, an edited file — fails
 * because its state hash or a metric does not match the simulator's.
 */
export function verifyObservation(
  packet: unknown,
  sim: CitySimulation,
  cohort: readonly number[] | null,
): string[] {
  const p = packet as WorldObservation | null;
  if (!p || typeof p !== "object") return ["not an observation"];
  const errors: string[] = [];
  if (p.schema !== WORLD_OBSERVATION_SCHEMA)
    errors.push("unsupported observation schema");
  if (p.source !== "bethesda-simulator") errors.push("not produced by the simulator");
  if (p.tick !== sim.tick)
    errors.push(`describes tick ${p.tick}, simulator is at ${sim.tick}`);
  if (p.seed !== sim.config.seed) errors.push("describes a different seed");
  if (p.world_hash !== sim.stateHash())
    errors.push("world hash does not match simulator state");
  if (p.data_hash !== DATA_VERSION || p.sim_version !== SIM_VERSION)
    errors.push("produced by a different map or simulator version");
  if (!p.region || typeof p.region !== "object") errors.push("missing region");
  else {
    const expected = measure(sim, p.region, cohort);
    if (canonicalJson(expected) !== canonicalJson(p.metrics))
      errors.push("metrics do not match simulator state");
  }
  return errors;
}

/** One arm's value per metric, from its window samples, by each metric's rule. */
export function aggregate(
  packets: readonly WorldObservation[],
): Record<MetricId, number | null> {
  const out = {} as Record<MetricId, number | null>;
  for (const id of METRIC_IDS) {
    const values = packets.map((p) => p.metrics[id]);
    if (!values.length) {
      out[id] = null;
      continue;
    }
    if (METRICS[id].aggregate === "final") out[id] = values.at(-1) ?? null;
    else {
      const numbers = values.filter((v): v is number => v !== null);
      out[id] =
        numbers.length === values.length
          ? round(numbers.reduce((s, v) => s + v, 0) / numbers.length)
          : null;
    }
  }
  return out;
}
