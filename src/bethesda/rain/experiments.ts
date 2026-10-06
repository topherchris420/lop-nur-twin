/**
 * Proposal → bounded Bethesda experiment definition. Host code only.
 *
 * A proposal names ids from a closed vocabulary (`contracts.ts`). This module
 * is the only place those ids acquire meaning in the map, and it does that
 * through the city's own deterministic scenario compiler: each supported
 * scenario/location pair is a fixed telemetry sentence written here, compiled
 * by `compileScenario`, and checked to resolve to exactly one event of the
 * expected family at the expected mapped place. Coordinates, radii, durations
 * and routes therefore come from the gazetteer and the compiler — never from
 * the proposer — and a proposal has no field that could carry code, a URL, a
 * coordinate or a world mutation.
 *
 * The definition is what a human approves. Its SHA-256 binds the approval, the
 * run, the record and the R.A.I.N. submission to these exact contents.
 */
import {
  compileScenario,
  validScenario,
  EVENT_EFFECTS,
  type Scenario,
} from "../scenarios";
import { DATA_VERSION, type Point } from "../model";
import { PROFILES, REPLAY_SCHEMA, SIM_VERSION, type Config } from "../simulation";
import { TERRAIN_VERSION } from "../terrain";
import { TRANSIT_VERSION } from "../streetscape";
import type { EventKind } from "../contract";
import {
  CRITERIA_RULE,
  DEFINITION_SCHEMA,
  EXPERIMENT_BOUNDS,
  LOCATION_LABELS,
  METRICS,
  METRIC_IDS,
  METRIC_LABELS,
  RAIN_BETHESDA_SCHEMA,
  SCENARIO_LABELS,
  WORLD_OBSERVATION_SCHEMA,
  type Direction,
  type ExperimentProposal,
  type LocationId,
  type MetricId,
  type ProposalOrigin,
  type ScenarioId,
} from "./contracts";
import { validateProposalShape, type Checked } from "./validation";
import { canonicalJson, sha256Json } from "../../rain/sha256";

/** Fixed telemetry per supported pair; compiled, never interpolated from input. */
const PHRASE: Record<LocationId, string> = {
  bethesda_metro: "the Bethesda Metro",
  bethesda_row: "Bethesda Row",
  veterans_park: "Veteran's Park",
  farm_womens_market: "Farm Women's Market",
  woodmont_bethesda: "Woodmont and Bethesda Ave",
  downtown: "downtown Bethesda",
};
/** The mapped place each location id must resolve to, as the gazetteer names it. */
export const EXPECTED_PLACE: Record<LocationId, string> = {
  bethesda_metro: "Bethesda Metro (Red Line) entrance",
  bethesda_row: "Bethesda Row",
  veterans_park: "Veteran's Park",
  farm_womens_market: "Montgomery Farm Women’s Co-operative Market",
  woodmont_bethesda: "Woodmont Avenue & Bethesda Avenue",
  downtown: "Downtown Bethesda",
};
const TELEMETRY: Record<ScenarioId, (place: string) => string> = {
  metro_closure: (p) => `Metro closure at ${p}`,
  fire: (p) => `Fire at ${p}`,
  gas_leak: (p) => `Gas leak at ${p}`,
  festival: (p) => `Street festival at ${p}`,
  rally: (p) => `Rally at ${p}`,
  crash: (p) => `Car crash at ${p}`,
  outage: () => "Power outage downtown",
  storm: () => "A thunderstorm rolls through downtown Bethesda",
};
export const SCENARIO_KIND: Record<ScenarioId, EventKind> = {
  metro_closure: "metro-closure",
  fire: "fire",
  gas_leak: "gas-leak",
  festival: "festival",
  rally: "rally",
  crash: "crash",
  outage: "outage",
  storm: "storm",
};

/**
 * Every arm runs the low-hardware city profile, whatever machine runs it: an
 * experiment's population is part of its definition, not of the device.
 */
export const EXPERIMENT_POPULATION: Omit<Config, "seed"> = (() => {
  const { seed: _seed, ...rest } = PROFILES[0]!;
  return rest;
})();
export const RADII = { catchment: 150, region: 300, focus: 420 } as const;

export interface Criterion {
  id: string;
  metric: string;
  op: ">=" | ">" | "<=" | "<";
  value: number;
  note: string;
}
export interface ExperimentDefinition {
  schema: typeof DEFINITION_SCHEMA;
  question: string;
  hypothesis: string;
  proposal: {
    proposal_id: string;
    origin: ProposalOrigin;
    sha256: string;
    rain_decision: ExperimentProposal["rain_decision"];
    meeting_id: string | null;
  };
  scenario: {
    id: ScenarioId;
    label: string;
    location: LocationId;
    place: string;
    /** The host's fixed sentence, compiled by the city's scenario compiler. */
    telemetry: string;
    event: Scenario;
    /** What the event declares, from `EVENT_EFFECTS`; the rules respond to these. */
    effects: string[];
  };
  center: Point;
  radii: { near: number; catchment: number; region: number; focus: number };
  population: Omit<Config, "seed">;
  seeds: number[];
  warmup_ticks: number;
  window_ticks: number;
  sample_interval: number;
  primary_metric: MetricId;
  expected_direction: Direction;
  minimum_effect: number;
  metrics: MetricId[];
  criteria: {
    rule: typeof CRITERIA_RULE;
    guards: Criterion[];
    success: Criterion[];
    failure: Criterion[];
  };
  limitations: string[];
  versions: {
    sim: typeof SIM_VERSION;
    replay: typeof REPLAY_SCHEMA;
    data: string;
    terrain: string;
    transit: string;
    contract: typeof RAIN_BETHESDA_SCHEMA;
    observation: typeof WORLD_OBSERVATION_SCHEMA;
  };
}

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
export interface Validated {
  proposal: ExperimentProposal;
  definition: ExperimentDefinition;
  definitionSha256: string;
  experimentId: string;
  checks: CheckResult[];
}

export const experimentIdOf = (definitionSha256: string) =>
  `BX-${definitionSha256.slice(0, 12)}`;

export function currentVersions(): ExperimentDefinition["versions"] {
  return {
    sim: SIM_VERSION,
    replay: REPLAY_SCHEMA,
    data: DATA_VERSION,
    terrain: TERRAIN_VERSION,
    transit: TRANSIT_VERSION,
    contract: RAIN_BETHESDA_SCHEMA,
    observation: WORLD_OBSERVATION_SCHEMA,
  };
}

function effectsOf(kind: EventKind): string[] {
  const e = EVENT_EFFECTS[kind];
  const out: string[] = [];
  if (e.avoid) out.push(`an area to avoid (×${e.avoid} radius)`);
  if (e.attract) out.push(`something to look at from up to ${e.attract} m beyond it`);
  if (e.closesRoads) out.push(`closed road edges (${e.closesRoads})`);
  if (e.closesWalks)
    out.push(`closed sidewalks within ${Math.round(e.closesWalks * 100)}% of its radius`);
  if (e.shelter) out.push("a reason to shelter");
  if (e.slowdown < 1) out.push(`traffic slowed to ${Math.round(e.slowdown * 100)}%`);
  if (e.signalsDark) out.push("dark signals (all-way stops)");
  if (e.metroClosed) out.push("Metro service closed (the entrance stays open)");
  const units = e.dispatch(2);
  const sent = Object.entries(units).filter(([, n]) => n > 0);
  if (sent.length) out.push(`dispatch: ${sent.map(([k, n]) => `${n} ${k}`).join(", ")}`);
  return out.length ? out : ["no declared effect"];
}

/** The fixed criteria template, in R.A.I.N.'s `rain-criteria/v1` form. */
export function criteriaFor(
  seeds: number,
  metric: MetricId,
  direction: Direction,
  minimum: number,
): ExperimentDefinition["criteria"] {
  const up = direction === "increase";
  const unit = METRICS[metric].unit;
  const guards: Criterion[] = [
    {
      id: "G1",
      metric: "seeds_completed",
      op: ">=",
      value: seeds,
      note: "Every seed ran both arms to the end of the window.",
    },
    {
      id: "G2",
      metric: "matched_t0_seeds",
      op: ">=",
      value: seeds,
      note: "In every seed, control and treatment were in identical states until the intervention.",
    },
  ];
  if (metric.startsWith("cohort_"))
    guards.push({
      id: "G3",
      metric: "cohort_min",
      op: ">=",
      value: 5,
      note: "Every seed's catchment cohort has at least five pedestrians.",
    });
  return {
    rule: CRITERIA_RULE,
    guards,
    success: [
      {
        id: "S1",
        metric: "primary_delta_mean",
        op: up ? ">=" : "<=",
        value: up ? minimum : -minimum,
        note: `Mean treatment − control difference is at least ${minimum} ${unit} in the expected direction.`,
      },
      {
        id: "S2",
        metric: "seeds_in_expected_direction",
        op: ">=",
        value: seeds,
        note: "Every seed moved in the expected direction.",
      },
    ],
    failure: [
      {
        id: "F1",
        metric: "primary_delta_mean",
        op: up ? "<=" : ">=",
        value: 0,
        note: "No mean difference, or one in the opposite direction.",
      },
    ],
  };
}

function limitationsFor(
  d: Pick<
    ExperimentDefinition,
    "scenario" | "seeds" | "primary_metric" | "window_ticks" | "population"
  >,
): string[] {
  const out = [
    `Simulated: this describes the Bethesda simulator (${SIM_VERSION}), not Bethesda. Agents follow illustrative rules that respond to the event's declared effects; no crowd, fire, weather or transit physics is modelled.`,
    `Population is the fixed experiment profile (${d.population.pedestrians} pedestrians, ${d.population.vehicles} cars, ${d.population.buses} buses), not measured demand; routines and schedules are illustrative.`,
    `${d.seeds.length} seed${d.seeds.length === 1 ? "" : "s"}: a small sample. The result is descriptive and no significance test is computed.`,
    `World observations are sampled every ${EXPERIMENT_BOUNDS.sampleInterval} ticks (${EXPERIMENT_BOUNDS.sampleInterval / 10} simulated seconds); behaviour between samples is not measured.`,
  ];
  if (d.primary_metric.startsWith("cohort_"))
    out.push(
      `The cohort is the pedestrians outdoors within ${RADII.catchment} m of the location when the window opens; members inside a building, the Metro or a bus at the end are counted separately and excluded from the distance mean.`,
    );
  if (d.scenario.event.durationTicks < d.window_ticks)
    out.push(
      `The event lasts ${d.scenario.event.durationTicks} ticks, ${d.window_ticks - d.scenario.event.durationTicks} fewer than the observation window.`,
    );
  if (d.scenario.id === "metro_closure")
    out.push(
      "A Metro closure closes the service, not the place: the rules make commuters at the entrance wait or re-route to bus stops, and the entrance attracts onlookers.",
    );
  return out;
}

/** Compile one supported pair with the city's own compiler, checking the result. */
export function compileFor(
  scenario: ScenarioId,
  location: LocationId,
): { ok: true; event: Scenario; telemetry: string } | { ok: false; error: string } {
  const telemetry = TELEMETRY[scenario](PHRASE[location]);
  const compiled = compileScenario(telemetry);
  if (compiled.error) return { ok: false, error: compiled.error };
  if (compiled.events.length !== 1)
    return { ok: false, error: `compiled to ${compiled.events.length} events, not one` };
  const event = compiled.events[0]!;
  if (event.kind !== SCENARIO_KIND[scenario])
    return {
      ok: false,
      error: `compiled to ${event.kind}, not ${SCENARIO_KIND[scenario]}`,
    };
  if (event.place !== EXPECTED_PLACE[location])
    return { ok: false, error: `resolved to “${event.place}”, not the expected place` };
  if (!validScenario(event)) return { ok: false, error: "the compiled event is invalid" };
  return { ok: true, event, telemetry };
}

/**
 * Deterministic validation: the shape, the vocabulary, the map, the budget and
 * the build. Returns the definition only when every check passes; the checks
 * are returned either way so a person can see exactly what failed.
 */
export function validateExperiment(raw: unknown): Checked<Validated> & {
  checks: CheckResult[];
} {
  const checks: CheckResult[] = [];
  const shape = validateProposalShape(raw);
  checks.push({
    id: "shape",
    label: "Closed rain-bethesda-experiment/v1 shape and vocabulary",
    ok: shape.ok,
    detail: shape.ok ? "all fields typed, bounded and known" : shape.errors.join("; "),
  });
  if (!shape.ok) return { ok: false, errors: shape.errors, checks };
  const p = shape.value;
  const compiled = compileFor(p.scenario, p.location);
  checks.push({
    id: "scenario",
    label: "Supported scenario at a mapped place",
    ok: compiled.ok,
    detail: compiled.ok
      ? `${SCENARIO_LABELS[p.scenario]} → ${compiled.event.kind} at ${compiled.event.place} (radius ${compiled.event.radius} m, ${compiled.event.durationTicks} ticks)`
      : compiled.error,
  });
  if (!compiled.ok) return { ok: false, errors: [compiled.error], checks };
  const ticks = p.seeds.length * 2 * (p.warmup_ticks + p.observation_window_ticks);
  checks.push({
    id: "budget",
    label: "Seeds, window and actor limits",
    ok: true,
    detail: `${p.seeds.length} seed(s) × 2 arms × ${p.warmup_ticks + p.observation_window_ticks} ticks = ${ticks} of ${EXPERIMENT_BOUNDS.maxTotalTicks}; ${EXPERIMENT_POPULATION.pedestrians} pedestrians per arm`,
  });
  checks.push({
    id: "metric",
    label: "Pre-registered metric is computable from simulator state",
    ok: true,
    detail: `${METRIC_LABELS[p.primary_metric]} (${METRICS[p.primary_metric].unit}, ${METRICS[p.primary_metric].aggregate})`,
  });
  const event = compiled.event;
  const definitionBody = {
    scenario: {
      id: p.scenario,
      label: SCENARIO_LABELS[p.scenario],
      location: p.location,
      place: event.place,
      telemetry: compiled.telemetry,
      event,
      effects: effectsOf(event.kind),
    },
    seeds: [...p.seeds],
    primary_metric: p.primary_metric,
    window_ticks: p.observation_window_ticks,
    population: { ...EXPERIMENT_POPULATION },
  };
  const definition: ExperimentDefinition = {
    schema: DEFINITION_SCHEMA,
    question: p.question,
    hypothesis: p.hypothesis,
    proposal: {
      proposal_id: p.proposal_id,
      origin: p.origin,
      sha256: sha256Json(p),
      rain_decision: p.rain_decision,
      meeting_id: p.meeting_id,
    },
    ...definitionBody,
    center: { x: event.point.x, z: event.point.z },
    radii: {
      near: Math.max(30, Math.min(250, event.radius)),
      catchment: RADII.catchment,
      region: RADII.region,
      focus: RADII.focus,
    },
    warmup_ticks: p.warmup_ticks,
    sample_interval: EXPERIMENT_BOUNDS.sampleInterval,
    expected_direction: p.expected_direction,
    minimum_effect: p.minimum_effect,
    metrics: [...METRIC_IDS],
    criteria: criteriaFor(
      p.seeds.length,
      p.primary_metric,
      p.expected_direction,
      p.minimum_effect,
    ),
    limitations: limitationsFor(definitionBody),
    versions: currentVersions(),
  };
  const definitionSha256 = sha256Json(definition);
  checks.push({
    id: "replay",
    label: "Replay-compatible with this build",
    ok: true,
    detail: `${SIM_VERSION} · ${REPLAY_SCHEMA} · map ${DATA_VERSION.slice(0, 12)}…`,
  });
  return {
    ok: true,
    value: {
      proposal: p,
      definition,
      definitionSha256,
      experimentId: experimentIdOf(definitionSha256),
      checks,
    },
    checks,
  };
}

/**
 * Re-check a stored definition before anything runs or replays: its digest,
 * and that this build would simulate it the same way. A definition recorded
 * under another simulator, map or contract is refused, never re-interpreted.
 */
export function verifyDefinition(
  definition: ExperimentDefinition,
  definitionSha256: string,
): string[] {
  const errors: string[] = [];
  let actual = "";
  try {
    actual = sha256Json(definition);
  } catch {
    errors.push("definition is not hashable JSON");
  }
  if (actual !== definitionSha256) errors.push("definition does not match its SHA-256");
  if (definition?.schema !== DEFINITION_SCHEMA)
    errors.push("unsupported definition schema");
  const now = currentVersions();
  for (const k of Object.keys(now) as (keyof typeof now)[])
    if (definition?.versions?.[k] !== now[k])
      errors.push(
        `recorded under a different ${k} version; replay it with that revision`,
      );
  const compiled =
    definition?.scenario &&
    compileFor(definition.scenario.id, definition.scenario.location);
  if (!compiled || !compiled.ok)
    errors.push("the scenario no longer compiles in this build");
  else if (canonicalJson(compiled.event) !== canonicalJson(definition.scenario.event))
    errors.push("the scenario compiles differently in this build");
  return errors;
}

/** What the Experiment Bay shows. Derived from the definition, never written by hand. */
export function protocolOf(d: ExperimentDefinition) {
  const m = METRICS[d.primary_metric];
  const sign = d.expected_direction === "increase" ? "higher" : "lower";
  const f = d.criteria.failure[0]!;
  return {
    question: d.question,
    hypothesis: d.hypothesis,
    control: `Seeds ${d.seeds.join(", ")}: ${d.population.pedestrians} pedestrians, ${d.population.vehicles} cars, ${d.population.buses} buses; full-rate focus on ${d.scenario.place}; no event.`,
    treatment: `Same seeds and initial conditions, plus “${d.scenario.telemetry}” compiled to ${d.scenario.event.kind} at ${d.scenario.place} (radius ${d.scenario.event.radius} m, ${d.scenario.event.durationTicks} ticks), injected at tick ${d.warmup_ticks}.`,
    metric: `${METRIC_LABELS[d.primary_metric]} — ${m.description}`,
    seeds: d.seeds.join(", "),
    failure: `${f.id}: ${f.metric} ${f.op} ${f.value} — ${f.note} Failure dominates success (rain-criteria/v1).`,
    expected: `If the hypothesis holds, every treatment arm ends with ${METRIC_LABELS[d.primary_metric].toLowerCase()} ${sign} than its matched control, by at least ${d.minimum_effect} ${m.unit} on average.`,
    limitations: d.limitations,
    location: LOCATION_LABELS[d.scenario.location],
  };
}
