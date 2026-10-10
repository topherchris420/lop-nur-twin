/** Deterministic compiler. Model prose stays in lineage; executable narratives are host-derived. */
import { sha256Json, canonicalJson } from "../../rain/sha256.js";
import { METRICS, SCENARIO_LOCATIONS, type ExperimentProposal } from "./contracts.js";
import {
  checkData,
  DESIGN_SCHEMA,
  envelopeErrors,
  GENERATED_PROPOSAL_SCHEMA,
  type Design,
  type Envelope,
} from "./discoveryProtocol.js";
import {
  validateExperiment,
  type ExperimentDefinition,
  type Validated,
} from "./experiments.js";
import type { Checked } from "./validation.js";

export function hostNarrative(
  p: Pick<
    ExperimentProposal,
    "scenario" | "location" | "primary_metric" | "expected_direction" | "minimum_effect"
  >,
) {
  return {
    question: `In the Bethesda simulator, how does ${p.scenario} at ${p.location} change ${p.primary_metric} relative to a matched no-event control?`,
    hypothesis: `The intervention will ${p.expected_direction} ${p.primary_metric} by at least ${p.minimum_effect} ${METRICS[p.primary_metric].unit} on average, with every paired seed in the expected direction.`,
  };
}
/** Deliberately excludes names, seed order, primary metric and evaluation thresholds.
 * Every native run already measures all seven metrics: relabelling one is not discovery. */
export function physicalProtocol(d: ExperimentDefinition) {
  return {
    scenario: d.scenario.id,
    location: d.scenario.location,
    event: {
      ...d.scenario.event,
      // Storm intensity changes only unmeasured statistical district stocks.
      // Metro intensities 1/2 share radius and dispatch; 3 dispatches police.
      intensity:
        d.scenario.id === "storm"
          ? 1
          : d.scenario.id === "metro_closure" && d.scenario.event.intensity < 3
            ? 1
            : d.scenario.event.intensity,
      durationTicks: Math.min(d.scenario.event.durationTicks, d.window_ticks),
    },
    population: d.population,
    warmup_ticks: d.warmup_ticks,
    window_ticks: d.window_ticks,
    sample_interval: d.sample_interval,
    versions: d.versions,
  };
}
export const protocolFingerprint = (d: ExperimentDefinition) =>
  sha256Json(physicalProtocol(d));
export const seedFingerprint = (d: ExperimentDefinition) =>
  sha256Json({
    protocol: protocolFingerprint(d),
    seeds: [...d.seeds].sort((a, b) => a - b),
  });
export function envelopeAdmission(d: ExperimentDefinition, envelope: Envelope): string[] {
  const errors = envelopeErrors(envelope);
  if (errors.length) return errors;
  if (!d.parameters) return ["generated parameters missing"];
  const values = {
    ...d.parameters,
    warmup_ticks: d.warmup_ticks,
    observation_window_ticks: d.window_ticks,
  };
  for (const [key, value] of Object.entries(values)) {
    const range = envelope[key as keyof typeof values];
    if (!Number.isFinite(value) || value < range[0] || value > range[1])
      errors.push(`${key} outside the approved envelope`);
  }
  if (
    !envelope.scenarios.includes(d.scenario.id) ||
    !envelope.locations.includes(d.scenario.location) ||
    !envelope.metrics.includes(d.primary_metric)
  )
    errors.push("scenario, location or metric outside the approved envelope");
  if (d.seeds.length !== envelope.seeds_per_design)
    errors.push("seed count differs from charter");
  const ticks = 2 * d.seeds.length * (d.warmup_ticks + d.window_ticks);
  if (ticks > 36000 || actorTicks(d) > envelope.max_actor_ticks)
    errors.push("resource ceiling exceeded");
  if (
    d.primary_metric === "vehicles_held" &&
    !d.population.vehicles &&
    !d.population.buses
  )
    errors.push("vehicle outcome requires vehicles");
  if (
    d.primary_metric !== "cohort_mean_distance_m" &&
    d.minimum_effect >
      (d.primary_metric === "vehicles_held"
        ? d.population.vehicles + d.population.buses
        : d.population.pedestrians)
  )
    errors.push("minimum effect exceeds the measured population");
  const n = hostNarrative({
    scenario: d.scenario.id,
    location: d.scenario.location,
    primary_metric: d.primary_metric,
    expected_direction: d.expected_direction,
    minimum_effect: d.minimum_effect,
  });
  if (d.question !== n.question || d.hypothesis !== n.hypothesis)
    errors.push("executable narrative is not host-derived");
  return errors;
}
/** Execution and mandatory replay, both matched arms. */
export const actorTicks = (d: ExperimentDefinition) =>
  4 *
  d.seeds.length *
  (d.warmup_ticks + d.window_ticks) *
  (d.population.pedestrians + d.population.vehicles + d.population.buses);
export interface PriorDesign {
  id: string;
  definition: ExperimentDefinition;
  run_id: string | null;
  replay_verified: boolean;
  /** A preregistration consumes a panel even if its process did not finish. */
  reserved?: boolean;
}
export interface CompiledDesign {
  design: Design;
  validated: Validated;
  fingerprint: string;
  score: number;
  priority: { information: number; novelty: number; feasibility: number; cost: number };
}

export function compileDesign(
  raw: unknown,
  context: {
    envelope: Envelope;
    seeds: number[];
    decision: { decision_id: string; envelope_hash: string };
    prior: readonly PriorDesign[];
    evidenceIds: ReadonlySet<string>;
  },
): Checked<CompiledDesign> {
  const parsed = checkData<Design>(raw, DESIGN_SCHEMA);
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  const errors: string[] = [];
  if (d.hypothesis.trim().toLowerCase() === d.competing_hypothesis.trim().toLowerCase())
    errors.push("competing hypotheses must differ");
  if (d.evidence_ids.some((id) => !context.evidenceIds.has(id)))
    errors.push("unavailable or unverified motivating evidence");
  if (!SCENARIO_LOCATIONS[d.scenario].includes(d.location))
    errors.push("unsupported disruption/location pair");
  const parent = context.prior.find((p) => p.id === d.parent_design_id);
  if (
    d.parent_design_id &&
    (!parent?.run_id ||
      !parent.replay_verified ||
      !d.evidence_ids.includes(parent.run_id))
  )
    errors.push("parent must be a replay-verified result explicitly cited as motivation");
  const p: ExperimentProposal = {
    schema: GENERATED_PROPOSAL_SCHEMA,
    proposal_id: `ND-${sha256Json(d).slice(0, 24)}`,
    origin: "rain",
    ...hostNarrative(d),
    scenario: d.scenario,
    location: d.location,
    primary_metric: d.primary_metric,
    expected_direction: d.expected_direction,
    minimum_effect: d.minimum_effect,
    comparison: "matched_seed_control",
    seeds: [...context.seeds],
    warmup_ticks: d.warmup_ticks,
    observation_window_ticks: d.observation_window_ticks,
    parameters: { ...d.parameters },
    rain_decision: context.decision,
    meeting_id: null,
    mathematical_basis: [],
  };
  const v = validateExperiment(p);
  if (!v.ok) return { ok: false, errors: [...errors, ...v.errors] };
  const def = v.value.definition;
  errors.push(...envelopeAdmission(def, context.envelope));
  const fingerprint = protocolFingerprint(def);
  const equivalent = context.prior.filter(
    (x) => protocolFingerprint(x.definition) === fingerprint,
  );
  if (d.purpose === "confirmatory") {
    if (
      !parent ||
      protocolFingerprint(parent.definition) !== fingerprint ||
      parent.definition.primary_metric !== def.primary_metric ||
      canonicalJson(parent.definition.scenario.event) !==
        canonicalJson(def.scenario.event) ||
      canonicalJson(parent.definition.criteria) !== canonicalJson(def.criteria)
    )
      errors.push(
        "confirmation must freeze the parent's protocol and preregistered criteria",
      );
    if (
      equivalent.some((x) => x.definition.seeds.some((seed) => def.seeds.includes(seed)))
    )
      errors.push("confirmation seeds were already exposed to an equivalent protocol");
    if (equivalent.filter((x) => x.run_id || x.reserved).length >= 2)
      errors.push("replication limit reached for this protocol");
  } else if (equivalent.length)
    errors.push(
      "equivalent protocol already exists; prose, metric and threshold changes are not novelty",
    );
  if (context.prior.some((x) => seedFingerprint(x.definition) === seedFingerprint(def)))
    errors.push("duplicate measured seed panel");
  if (errors.length) return { ok: false, errors };
  // Deterministic heuristic, not a measured entropy or probability of discovery.
  // The model's information_value estimate is preserved, never used for ranking.
  const information = parent ? 1 : 0.5;
  const novelty = equivalent.length ? 0 : 1;
  const cost = actorTicks(def) / context.envelope.max_actor_ticks;
  const feasibility = 1 - cost;
  return {
    ok: true,
    value: {
      design: d,
      validated: v.value,
      fingerprint,
      score: 4 * information + 3 * novelty + feasibility - cost,
      priority: { information, novelty, feasibility, cost },
    },
  };
}
