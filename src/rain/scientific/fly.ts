import { runEchoBlock } from "./echoRig.js";
/**
 * The digital-fly backend: matched-seed behavioural experiments on the digital
 * fly (src/bethesda/fly/) in closed arenas.
 *
 * The rule is the lab's: models propose, the host writes. A design is a closed
 * object naming one of the closed protocols and how many seeds; the host builds the
 * arenas, stimuli and both arms, writes the question and hypothesis, freezes
 * the criteria and binds the fly's version, parameter table and source digest.
 *
 * The order is enforced, not assumed. A plan is preregistered first. Its
 * authorization then binds the registry's receipt and draws a random nonce,
 * and the seeds are SHA-256(receipt digest ‖ nonce ‖ counter): nobody chooses
 * them, and nobody can see their outcome before the plan is fixed. A plan is
 * authorized once and an authorization runs once. The criteria are an exact
 * one-sided sign test on the untied seeds at a host-fixed alpha, with
 * host-owned minimum effects. A record is evidence only when every run
 * re-simulates to the recorded state hashes on the engine that made it, from
 * committed code.
 *
 * Neither the fly's controller nor a model can run anything: the controller
 * only answers the arena it is put in, and every command it gives passes the
 * fly's own gate, whose refusals void the result. Every measurement is a
 * simulated observation of a reduced-order model that simulates no neurons. It
 * characterizes that simulator, never Drosophila.
 *
 * Shared with the browser: nothing here reads the disk, the registry or git.
 * Those arrive through a `FlyHost` (flyRegistry.ts builds the real one).
 */
import { canonicalJson, sha256, sha256Json } from "../sha256.js";
import { evaluate, type Criterion } from "../experiments/evaluate.js";
import { schemaErrors } from "../experiments/jsonSchema.js";
import type { Checked } from "../../bethesda/rain/validation.js";
import { OPERATOR } from "../../bethesda/rain/contracts.js";
import { mulberry32 } from "../../lib/noise.js";
import { arenaWorld } from "../../bethesda/fly/arena.js";
import { REDUCED_ORDER_DESCRIPTOR } from "../../bethesda/fly/controller.js";
import { DigitalFly, FLY_VERSION } from "../../bethesda/fly/fly.js";
import { PERCHED } from "../../bethesda/fly/neural.js";
import { PARAMS, resolveParams, type ParamName } from "../../bethesda/fly/params.js";
import { SKELETON } from "../../bethesda/fly/skeleton.js";
import type { V3 } from "../../bethesda/fly/units.js";
import type {
  FlyWorld,
  FoodPatch,
  Hit,
  Landmark,
  LandingSite,
  LightSample,
  Mover,
  Perch,
  PrimitiveWorld,
} from "../../bethesda/fly/world.js";
import { FLY_SOURCE } from "./flySource.js";
import {
  boundedData,
  closed,
  FLY_ALPHA,
  FLY_AUTHORIZATION,
  FLY_BACKEND,
  FLY_DESIGN,
  FLY_EXPERIMENT,
  FLY_METRICS,
  FLY_MIN_UNTIED_PAIRS,
  FLY_PILOT,
  FLY_PILOT_SEED_COUNT,
  FLY_PLAN,
  FLY_PROTOCOLS,
  FLY_RECORD,
  FLY_SCRIPT_OPERATOR,
  FLY_SEED_COUNT,
  parseFlyDesign,
  SCIENTIFIC_IR,
  type FlyArm,
  type FlyAuthorization,
  type FlyAuthorizationChannel,
  type FlyBlockId,
  type FlyBlockSpec,
  type FlyCodeState,
  type FlyControllerConfig,
  type FlyDesign,
  type FlyEngine,
  type FlyExperiment,
  type FlyPlan,
  type FlyPreregistration,
  type FlyRecord,
  type FlyResult,
  type FlyRun,
  type FlyTreatment,
  type ScientificExperimentIR,
} from "./contracts.js";

/** Keeps an experiment, its determinism replay included, near twenty seconds of wall time. */
export const MAX_SIMULATED_SECONDS = 16000;
const AUTH_SCOPE = "fly-behavior-simulation" as const;
const HOUR = 3600000;
/** The longest a run may take from start to finish (wall clock). */
export const MAX_RUN_MS = HOUR;
const PHYSICS_STEP_S = 0.005;
/**
 * The adaptation baseline: three habituation recovery time constants, so an
 * escape's fall in responsiveness is 95% recovered by the next presentation,
 * and an experiment fits the simulation budget at the seed count its pilot sized.
 */
export const BASELINE_ISI_S = 90;
/** The simulator's integration settings: not controller parameters, never varied. */
const INTEGRATION: readonly ParamName[] = [
  "physicsStepMs",
  "sensePeriodMs",
  "decisionPeriodMs",
];

// ----------------------------------------------------------------- apparatus

const ROOM: [number, number, number] = [4, 2.5, 4];
const GRID = [-1.2, -0.4, 0.4, 1.2];
/** Spontaneous takeoff, walking and grooming off: the fly stands still until the stimulus. */
const STILL: FlyControllerConfig = { takeoffHz: 0, walkStartHz: 0, groomHz: 0 };

/**
 * The fixed apparatus. A plan copies the blocks it uses, so changing any value
 * here makes every earlier plan fail recompilation rather than silently mean
 * something else (and changes the fly's source digest). The v3 values were
 * chosen with pilots (docs/benchmarks/fly-pilots/): clutter in which a fly
 * without avoidance collides in 31 of 32 pilot seeds; an escape stimulus that
 * stops at 90 degrees, past the size at which the fly commits to an escape at
 * every l/v from 20 ms on (50 to 57 degrees on average); and a repeated
 * stimulus whose final sizes leave a fully recovered fly answering some
 * presentations and not others in every pilot seed.
 */
export const FLY_APPARATUS: Readonly<Record<FlyBlockId, FlyBlockSpec>> = {
  echo_impairment: {
    id: "echo_impairment",
    arena: { size: [8, 2.5, 8], ambient: 0.6, pillars: [] },
    fixed_config: {},
    start_half_width_m: 0,
    tick_s: 0.05,
    duration_s: 12,
    trials: 4,
    light_at: null,
    near_miss_m: null,
    stimulus: null,
  },
  echo_causation: {
    id: "echo_causation",
    arena: { size: [8, 2.5, 8], ambient: 0.6, pillars: [] },
    fixed_config: {},
    start_half_width_m: 0,
    tick_s: 0.05,
    duration_s: 12,
    trials: 6,
    light_at: null,
    near_miss_m: null,
    stimulus: null,
  },
  echo_memory: {
    id: "echo_memory",
    arena: { size: [8, 2.5, 8], ambient: 0.6, pillars: [] },
    fixed_config: {},
    start_half_width_m: 0,
    tick_s: 0.05,
    duration_s: 24,
    trials: 4,
    light_at: null,
    near_miss_m: null,
    stimulus: null,
  },
  clutter: {
    id: "clutter",
    arena: {
      size: ROOM,
      ambient: 0.6,
      // Gaps of 50 cm: with 5 cm pillars a fly without avoidance went whole
      // runs without touching one, so most seeds tied.
      pillars: GRID.flatMap((x) => GRID.map((z) => ({ x, z, r: 0.15 }))),
    },
    // Raised from the default so that flight fills most of the run.
    fixed_config: { takeoffHz: 0.5 },
    start_half_width_m: 0.25,
    tick_s: PHYSICS_STEP_S,
    duration_s: 120,
    trials: 1,
    light_at: null,
    near_miss_m: 0.05,
    stimulus: null,
  },
  light: {
    id: "light",
    arena: { size: ROOM, ambient: 0.3, pillars: [] },
    fixed_config: {},
    start_half_width_m: 0.3,
    tick_s: 0.05,
    duration_s: 120,
    trials: 1,
    light_at: [1, 2.3, -1],
    near_miss_m: null,
    stimulus: null,
  },
  escape: {
    id: "escape",
    arena: { size: ROOM, ambient: 0.6, pillars: [] },
    fixed_config: STILL,
    start_half_width_m: 0.8,
    tick_s: PHYSICS_STEP_S,
    duration_s: 0.3,
    trials: 6,
    light_at: null,
    near_miss_m: null,
    stimulus: {
      radius_m: 0.04,
      start_distance_m: 1,
      final_size_deg: [90, 90],
      elevation_deg: [10, 40],
      azimuth_deg: [-180, 180],
      onset_s: 1,
      l_over_v_ms: 40,
    },
  },
  repeat: {
    id: "repeat",
    // A low ceiling keeps the flight after an escape short, so the schedule
    // seldom finds the fly still in the air.
    arena: { size: [4, 1, 4], ambient: 0.6, pillars: [] },
    fixed_config: { ...STILL, flightBoutMeanS: 0.5 },
    start_half_width_m: 0.5,
    tick_s: PHYSICS_STEP_S,
    duration_s: 0.3,
    // Twelve presentations whose final sizes straddle the sizes at which a
    // fully recovered fly escapes at this l/v (46 degrees on average in the
    // pilot), so the control answers 25 to 83% of them in every pilot seed and a
    // fall in responsiveness changes some presentations in most seeds.
    trials: 12,
    light_at: null,
    near_miss_m: null,
    stimulus: {
      radius_m: 0.04,
      start_distance_m: 1,
      final_size_deg: [30, 55],
      elevation_deg: [10, 30],
      azimuth_deg: [-90, 90],
      onset_s: 1,
      l_over_v_ms: 80,
    },
  },
};
const LIGHT_INTENSITY = 2;

/**
 * The fly this backend binds: its version, controller, every parameter with
 * its kind and the source digest of the code that runs it (FLY_SOURCE).
 */
export function flyIdentity(): {
  fly: string;
  fly_sha256: string;
  source_sha256: string;
} {
  return {
    fly: `${FLY_VERSION} ${REDUCED_ORDER_DESCRIPTOR.id}`,
    fly_sha256: sha256Json({
      version: FLY_VERSION,
      controller: REDUCED_ORDER_DESCRIPTOR.id,
      params: Object.fromEntries(
        Object.entries(PARAMS).map(([k, p]) => [
          k,
          { value: p.value, unit: p.unit, kind: p.kind },
        ]),
      ),
      measures: SKELETON.measures,
      source: FLY_SOURCE.sha256,
    }),
    source_sha256: FLY_SOURCE.sha256,
  };
}

export const flyPlanBody = (p: FlyPlan) => {
  const { definition_sha256: _digest, experiment_id: _id, ...body } = p;
  return body;
};

const protocolOf = (t: FlyTreatment) => FLY_PROTOCOLS.find((p) => p.id === t.kind)!;
const metricOf = (id: string) => FLY_METRICS.find((m) => m.id === id)!;
const configText = (c: FlyControllerConfig) =>
  Object.keys(c).length
    ? Object.entries(c)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ")
    : "the default parameters";
const STIMULUS_RADIUS_CM = Math.round(FLY_APPARATUS.escape.stimulus!.radius_m * 100);
/** A looming approach's speed (m/s) from its l/v (ms) and the sphere's radius. */
const speedOf = (radiusM: number, lOverVMs: number) => radiusM / (lOverVMs / 1000);
const looming = (lOverVMs: number) =>
  `l/v = ${lOverVMs} ms (${speedOf(FLY_APPARATUS.escape.stimulus!.radius_m, lOverVMs).toFixed(2)} m/s)`;

export function describeFlyTreatment(t: FlyTreatment): string {
  switch (t.kind) {
    case "echo_impairment":
    case "echo_causation":
    case "echo_memory":
      return `experimental ECHO self-model (${t.variant})`;
    case "obstacle_avoidance":
      return `turning away from surfaces whose time to contact falls below ${t.avoid_ttc_s} s`;
    case "light_preference":
      return `a point light of relative intensity ${t.light_intensity} above one quadrant of the arena`;
    case "visual_threat":
      return `a sphere of ${STIMULUS_RADIUS_CM} cm radius approaching the standing fly at ${looming(t.treatment_l_over_v_ms)}`;
    case "noisy_sensing":
      return `sensory noise of ${t.noise} (standard deviation ${(t.noise / Math.sqrt(3)).toFixed(2)}: relative on sizes, distances and light levels, in radians on directions)`;
    case "adaptation":
      return `repeating a looming stimulus every ${t.isi_s} s on a fixed schedule`;
    case "controller_comparison":
      return `controller configuration B (${configText(t.treatment)})`;
  }
}

export function describeFlyBaseline(t: FlyTreatment): string {
  switch (t.kind) {
    case "echo_impairment":
    case "echo_causation":
      return "the same motor probe with its self-model disabled";
    case "echo_memory":
      return "self-model reset at re-exposure";
    case "obstacle_avoidance":
      return "avoidance off (avoidTtcS = 0)";
    case "light_preference":
      return "no point light (ambient only)";
    case "visual_threat":
      return `the same sphere on the same lines approaching at ${looming(t.control_l_over_v_ms)}`;
    case "noisy_sensing":
      return "noiseless sensing";
    case "adaptation":
      return `the same stimuli every ${BASELINE_ISI_S} s on the same schedule`;
    case "controller_comparison":
      return `controller configuration A (${configText(t.baseline)})`;
  }
}

function armsOf(t: FlyTreatment): FlyArm[] {
  const base: Omit<FlyArm, "id"> = {
    config: {},
    noise: 0,
    light_intensity: LIGHT_INTENSITY,
    l_over_v_ms: FLY_APPARATUS.escape.stimulus!.l_over_v_ms,
    isi_s: BASELINE_ISI_S,
  };
  const arms = (control: Partial<FlyArm>, treatment: Partial<FlyArm>): FlyArm[] => [
    { ...base, ...control, id: "control" },
    { ...base, ...treatment, id: "treatment" },
  ];
  switch (t.kind) {
    case "echo_impairment":
    case "echo_causation":
      return arms({ echo_variant: "disabled" }, { echo_variant: t.variant });
    case "echo_memory":
      return arms({ echo_variant: "reset_memory" }, { echo_variant: t.variant });
    case "obstacle_avoidance":
      return arms({ config: { avoidTtcS: 0 } }, { config: { avoidTtcS: t.avoid_ttc_s } });
    case "light_preference":
      return arms({ light_intensity: 0 }, { light_intensity: t.light_intensity });
    case "visual_threat":
      return arms(
        { l_over_v_ms: t.control_l_over_v_ms },
        { l_over_v_ms: t.treatment_l_over_v_ms },
      );
    case "noisy_sensing":
      return arms({ noise: 0 }, { noise: t.noise });
    case "adaptation":
      return arms({ isi_s: BASELINE_ISI_S }, { isi_s: t.isi_s });
    case "controller_comparison":
      return arms(
        { config: structuredClone(t.baseline) },
        { config: structuredClone(t.treatment) },
      );
  }
}

type Stimulus = NonNullable<FlyBlockSpec["stimulus"]>;
/** Where an approach stops: the distance at which the sphere subtends `sizeDeg`. */
const endDistance = (stim: Stimulus, sizeDeg: number) =>
  stim.radius_m / Math.sin(rad(sizeDeg) / 2);
/** How long an approach at `lOverVMs` runs before it stops at `sizeDeg` (s). */
const approachS = (stim: Stimulus, lOverVMs: number, sizeDeg: number) =>
  (stim.start_distance_m - endDistance(stim, sizeDeg)) / speedOf(stim.radius_m, lOverVMs);
/** The longest approach the block's range of final sizes allows. */
const longestApproachS = (stim: Stimulus, lOverVMs: number) =>
  approachS(stim, lOverVMs, stim.final_size_deg[1]);

/**
 * The fly-seconds one run of `block` takes in `arm`, at most: the repeated
 * block runs to the end of its fixed schedule whatever the fly does.
 */
function runSeconds(block: FlyBlockSpec, arm: FlyArm): number {
  const s = block.stimulus;
  switch (block.id) {
    case "echo_impairment":
    case "echo_causation":
    case "echo_memory":
      return block.trials * block.duration_s;
    case "clutter":
    case "light":
      return block.duration_s;
    case "escape":
      return (
        block.trials *
        (s!.onset_s + longestApproachS(s!, arm.l_over_v_ms) + block.duration_s)
      );
    case "repeat":
      return (
        s!.onset_s +
        (block.trials - 1) * arm.isi_s +
        longestApproachS(s!, s!.l_over_v_ms) +
        block.duration_s
      );
  }
}

/** The fly's own parameter check, as design errors: overrides, kinds and ranges. */
function resolveErrors(label: string, config: FlyControllerConfig): string[] {
  try {
    resolveParams(config);
    return [];
  } catch (e) {
    return [`${label}: ${e instanceof Error ? e.message : "invalid configuration"}`];
  }
}

function configErrors(
  label: string,
  config: FlyControllerConfig,
  fixed: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const k of Object.keys(config)) {
    if ((INTEGRATION as readonly string[]).includes(k))
      errors.push(
        `${label}: ${k} is an integration setting of the simulator, not a controller parameter`,
      );
    else if (fixed.has(k))
      errors.push(`${label}: ${k} is fixed by the protocol's apparatus in both arms`);
  }
  return errors;
}

/** Evidence the host can show independently of the plan: never the plan's own claims. */
export interface FlyContext {
  evidenceIds?: ReadonlySet<string>;
  verifiedParentDigests?: ReadonlySet<string>;
}

export function compileFlyExperiment(
  raw: unknown,
  context: FlyContext = {},
): Checked<FlyPlan> {
  const parsed = parseFlyDesign(raw);
  if (!parsed.ok) return parsed;
  const design = parsed.value,
    p = design.parameters,
    a = design.analysis,
    t = p.treatment;
  const protocol = protocolOf(t);
  const blocks = protocol.blocks.map((b) => structuredClone(FLY_APPARATUS[b]));
  const errors: string[] = [];
  const n = p.seed_count;
  const metric = metricOf(a.metric);
  if (!(protocol.blocks as readonly string[]).includes(metric.block))
    errors.push(`${a.metric} is not measured by the ${protocol.id} protocol`);
  const floor = metric.minimum_effect ?? Infinity;
  if (a.minimum_effect < floor)
    errors.push(
      `minimum_effect ${a.minimum_effect} is below the host's minimum effect for ${a.metric} (${floor} ${metric.unit}); a design may raise it, never lower it`,
    );
  const arms = armsOf(t);
  const fixed = new Set(blocks.flatMap((b) => Object.keys(b.fixed_config)));
  if (t.kind === "controller_comparison")
    errors.push(
      ...configErrors("configuration A", t.baseline, fixed),
      ...configErrors("configuration B", t.treatment, fixed),
    );
  // Every arm in every block goes through the fly's own parameter check, so an
  // override outside its range is a design error, never a run that breaks.
  const resolved = new Set<string>();
  for (const arm of arms)
    for (const block of blocks)
      for (const e of resolveErrors(
        t.kind === "controller_comparison"
          ? `configuration ${arm.id === "control" ? "A" : "B"}`
          : `${arm.id} arm`,
        { ...arm.config, ...block.fixed_config },
      ))
        resolved.add(e);
  errors.push(...resolved);
  if (t.kind === "controller_comparison" && !resolved.size)
    if (
      canonicalJson(resolveParams(t.baseline)) ===
      canonicalJson(resolveParams(t.treatment))
    )
      errors.push("the two controller configurations set the same parameter values");
  if (t.kind === "visual_threat" && t.control_l_over_v_ms === t.treatment_l_over_v_ms)
    errors.push("the two arms must approach at different l/v");
  if (t.kind === "adaptation") {
    const repeat = FLY_APPARATUS.repeat;
    const window =
      longestApproachS(repeat.stimulus!, repeat.stimulus!.l_over_v_ms) +
      repeat.duration_s;
    if (t.isi_s <= window)
      errors.push(
        `the interval must exceed one presentation (${window.toFixed(2)} s) so presentations do not overlap`,
      );
  }
  const simulated = arms.reduce(
    (sum, arm) => sum + n * blocks.reduce((s, b) => s + runSeconds(b, arm), 0),
    0,
  );
  const seconds = Math.ceil(simulated);
  if (seconds > design.budget.max_simulated_seconds || seconds > MAX_SIMULATED_SECONDS)
    errors.push(
      `two arms x ${n} seeds of ${protocol.id} take up to ${seconds} simulated fly-seconds, which exceeds the budget (${Math.min(design.budget.max_simulated_seconds, MAX_SIMULATED_SECONDS)})`,
    );
  if (
    design.hypothesis.trim().toLowerCase() ===
    design.competing_hypothesis.trim().toLowerCase()
  )
    errors.push("competing hypotheses must differ");
  if (new Set(design.provenance.source_ids).size !== design.provenance.source_ids.length)
    errors.push("duplicate motivating source ids");
  if (design.provenance.source_ids.some((id) => !context.evidenceIds?.has(id)))
    errors.push(
      "motivating sources require independently available evidence identifiers",
    );
  if (
    design.provenance.parent_record_sha256 &&
    !context.verifiedParentDigests?.has(design.provenance.parent_record_sha256)
  )
    errors.push("parent must be an independently replay-verified record");
  if (design.provenance.generation === "model" && !design.provenance.decision_sha256)
    errors.push("model proposals require an immutable decision receipt digest");
  if (design.provenance.generation !== "model" && design.provenance.decision_sha256)
    errors.push("only a model proposal carries a decision receipt digest");
  if (errors.length) return { ok: false, errors };

  const identity = flyIdentity();
  const experiment: FlyExperiment = {
    schema: FLY_EXPERIMENT,
    protocol: protocol.id,
    seed_count: n,
    blocks,
    arms,
  };
  const sign = a.expected_direction === "increase" ? 1 : -1;
  const treatment = describeFlyTreatment(t),
    baseline = describeFlyBaseline(t);
  const measured = FLY_METRICS.filter((m) =>
    (protocol.blocks as readonly string[]).includes(m.block),
  );
  const fixedText = blocks
    .filter((b) => Object.keys(b.fixed_config).length)
    .map((b) => `${b.id} block: ${configText(b.fixed_config)}`);
  const ir: ScientificExperimentIR = {
    schema: SCIENTIFIC_IR,
    domain: "fly-behavior-simulation",
    backend: "digital-fly",
    backend_version: `${FLY_BACKEND} (${identity.fly})`,
    question: `In the digital fly simulator, how does ${treatment} change ${metric.description}, against ${baseline} on matched seeds?`,
    hypothesis: `${treatment[0]!.toUpperCase()}${treatment.slice(1)} will ${a.expected_direction} ${a.metric} by at least ${a.minimum_effect} ${metric.unit} on average over ${n} matched seeds drawn after preregistration, compared with ${baseline}, and an exact one-sided sign test on the seeds that differ will find the ${a.expected_direction} at alpha ${FLY_ALPHA}.`,
    observables: [
      ...measured.map((m) => ({ id: m.id, unit: m.unit, description: m.description })),
      {
        id: "mean_paired_delta",
        unit: metric.unit,
        description: `treatment minus control ${a.metric}, averaged over the seeds where both are defined`,
      },
      {
        id: "sign_test_p_expected",
        unit: "probability",
        description: `exact one-sided sign test p-value for a ${a.expected_direction}, over untied seeds`,
      },
      {
        id: "sign_test_p_opposite",
        unit: "probability",
        description: "the same test in the opposite direction",
      },
    ],
    independent_variables: [treatment],
    dependent_variables: [a.metric],
    controls: [
      `baseline arm: ${baseline}`,
      "matched seeds: each seed places the fly, draws its stimuli and seeds its random streams identically in both arms",
      "the seeds are drawn by the host after preregistration from SHA-256 of the registry receipt and a random nonce in the authorization, so neither the design nor the operator chooses them",
      ...fixedText.map((f) => `fixed apparatus settings, both arms — ${f}`),
      "the fly's version, controller, full parameter table and source digest are bound into the plan digest",
    ],
    parameter_constraints: [
      `${FLY_PROTOCOLS.length} closed protocols with host-built arenas and stimuli`,
      "controller configurations override model parameters only, within their ranges; FlyBody and published values are fixed",
      "the integration settings (physics, sensing and decision periods) are never varied",
      `at most ${MAX_SIMULATED_SECONDS} simulated fly-seconds per experiment`,
      `${FLY_SEED_COUNT.min}-${FLY_SEED_COUNT.max} seeds, drawn by the host after preregistration`,
      `a minimum effect at or above the host's ${floor} ${metric.unit} for ${a.metric}`,
    ],
    resource_budget: {
      execution_steps: Math.ceil(seconds / PHYSICS_STEP_S),
      replay_steps: Math.ceil(seconds / PHYSICS_STEP_S),
      max_samples: 2 * n * blocks.length,
    },
    statistical_analysis: {
      method: `Exact one-sided sign test on the untied matched seeds at alpha ${FLY_ALPHA}, with at least ${FLY_MIN_UNTIED_PAIRS} untied seeds, and a mean paired difference beyond the minimum effect; frozen rain-criteria/v1`,
      independent_replicates: n,
      uncertainty:
        "The p-values are exact binomial tail probabilities over seeds of one deterministic model: they say how consistently the two arms differ across this simulator's seeds, not how uncertain anything is about a population, and nothing about real flies.",
    },
    falsification: {
      metric: "sign_test_p_opposite",
      op: "<=",
      value: FLY_ALPHA,
      unit: "probability",
    },
    provenance: structuredClone(design.provenance),
    limitations: [
      "The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.",
      "Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.",
      "Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.",
      "The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.",
      ...(protocol.caveat ? [protocol.caveat] : []),
      ...(t.kind === "light_preference" || t.kind === "controller_comparison"
        ? [
            "Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.",
          ]
        : []),
      ...(protocol.blocks.some((b) => b === "escape" || b === "repeat")
        ? [
            "Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.",
          ]
        : []),
      "Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.",
      "A result characterizes the simulator and is never empirical evidence about Drosophila.",
    ],
  };
  const criterion = (
    id: string,
    metricId: string,
    op: Criterion["op"],
    value: number,
    note: string,
  ) => ({ id, metric: metricId, op, value, note });
  const runs = 2 * n * blocks.length;
  const body = {
    schema: FLY_PLAN,
    design,
    ir,
    fly: identity.fly,
    fly_sha256: identity.fly_sha256,
    fly_source_sha256: identity.source_sha256,
    experiment,
    simulated_seconds: seconds,
    criteria: {
      guards: [
        criterion("G1", "runs_completed", ">=", runs, "Every matched run completes"),
        criterion(
          "G2",
          "determinism_check",
          ">=",
          1,
          "An independent re-simulation reproduces every state hash and measurement",
        ),
        criterion(
          "G3",
          "control_informative",
          ">=",
          1,
          "The control arm is not pinned at the metric's floor or ceiling in every seed, so the comparison can move both ways",
        ),
        criterion(
          "G4",
          "untied_pairs",
          ">=",
          FLY_MIN_UNTIED_PAIRS,
          "Enough seeds differ between the arms for the sign test",
        ),
        criterion(
          "G5",
          "gate_refusals",
          "<=",
          0,
          "The fly's gate refused no command in any run",
        ),
      ],
      success: [
        criterion(
          "S1",
          "mean_paired_delta",
          sign > 0 ? ">=" : "<=",
          sign * a.minimum_effect,
          "Mean paired difference beyond the minimum effect",
        ),
        criterion(
          "S2",
          "sign_test_p_expected",
          "<=",
          FLY_ALPHA,
          "Exact one-sided sign test in the expected direction",
        ),
      ],
      failure: [
        criterion(
          "F1",
          "sign_test_p_opposite",
          "<=",
          FLY_ALPHA,
          "Exact one-sided sign test finds the opposite direction",
        ),
      ],
    },
  };
  const digest = sha256Json(body);
  return {
    ok: true,
    value: {
      ...body,
      definition_sha256: digest,
      experiment_id: `FLY-${digest.slice(0, 24)}`,
    },
  };
}

/**
 * Holds a model's design to its receipt (`rain-fly-design-receipt/v1`): the
 * design must be exactly the one the receipt's answer states, with the
 * receipt's digest as its decision. A design edited by hand afterwards is no
 * longer the model's proposal.
 */
export function flyReceiptErrors(design: FlyDesign, text: string | null): string[] {
  if (design.provenance.generation !== "model")
    return text ? ["a receipt accompanies a non-model design"] : [];
  if (!text) return ["a model design needs its receipt"];
  const errors: string[] = [];
  const digest = sha256(text);
  if (digest !== design.provenance.decision_sha256)
    errors.push("the receipt's SHA-256 does not match the design's decision_sha256");
  let r: { schema?: unknown; generation?: unknown; answer?: unknown };
  try {
    r = JSON.parse(text) as typeof r;
  } catch {
    return [...errors, "the receipt is not JSON"];
  }
  if (r.schema !== "rain-fly-design-receipt/v1" || r.generation !== "model")
    errors.push("not a rain-fly-design-receipt/v1 from a model");
  let rebuilt: unknown = null;
  try {
    if (typeof r.answer === "string") {
      const start = r.answer.indexOf("{"),
        end = r.answer.lastIndexOf("}");
      const answer = JSON.parse(r.answer.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
      rebuilt = {
        schema: FLY_DESIGN,
        question: answer.question ?? null,
        hypothesis: answer.hypothesis ?? null,
        competing_hypothesis: answer.competing_hypothesis ?? null,
        parameters: answer.parameters ?? null,
        analysis: answer.analysis ?? null,
        budget: answer.budget ?? null,
        provenance: {
          generation: "model",
          decision_sha256: digest,
          source_ids: [],
          parent_record_sha256: null,
        },
      };
    }
  } catch {
    rebuilt = null;
  }
  if (rebuilt === null || canonicalJson(rebuilt) !== canonicalJson(design))
    errors.push("the design is not the design the receipt's answer states");
  return errors;
}

/**
 * Recompiles against this fly. The evidence is the caller's, never the plan's
 * own claims: a plan citing sources or a parent verifies only where that
 * evidence is independently available. A plan bound to another fly, apparatus
 * or criteria is refused.
 */
export function verifyFlyPlan(raw: unknown, context: FlyContext = {}): string[] {
  const errors = boundedData(raw);
  if (errors.length) return errors;
  try {
    const p = raw as FlyPlan;
    const compiled = compileFlyExperiment(p.design, context);
    if (!compiled.ok) return compiled.errors;
    return canonicalJson(raw) === canonicalJson(compiled.value)
      ? []
      : [
          "plan does not match deterministic recompilation (criteria, apparatus, fly version, parameter table or source)",
        ];
  } catch {
    return ["malformed fly plan"];
  }
}

// --------------------------------------------------------------------- seeds

/** The receipt's digest, as an authorization binds it. */
export const flyPreregistrationSha256 = (receipt: FlyPreregistration) =>
  sha256Json(receipt);

/**
 * The seeds of an authorized run: `count` distinct 32-bit integers read in
 * order, eight per digest, from SHA-256(receipt digest ‖ nonce ‖ counter) for
 * counter 0, 1, 2 ... Fixed by the receipt and the nonce, so a verifier
 * derives them again; chosen by neither the design nor the operator.
 */
export function deriveFlySeeds(
  preregistrationSha256: string,
  nonce: string,
  count: number,
): number[] {
  const seeds: number[] = [];
  for (let counter = 0; seeds.length < count; counter++) {
    const block = sha256(`${preregistrationSha256}${nonce}${counter}`);
    for (let i = 0; i < 64 && seeds.length < count; i += 8) {
      const seed = Number.parseInt(block.slice(i, i + 8), 16);
      if (!seeds.includes(seed)) seeds.push(seed);
    }
  }
  return seeds;
}

/**
 * The pilot seeds: the first FLY_PILOT_SEED_COUNT distinct 32-bit integers
 * read, eight per digest, from SHA-256("rain-fly-pilot/v1|" + counter). Public
 * and fixed, so a pilot can be rerun by anyone; never drawn for an archived
 * run (authorization redraws, execution refuses, verification flags them).
 */
export const FLY_PILOT_SEEDS: readonly number[] = Object.freeze(
  (() => {
    const seeds: number[] = [];
    for (let counter = 0; seeds.length < FLY_PILOT_SEED_COUNT; counter++) {
      const block = sha256(`${FLY_PILOT}|${counter}`);
      for (let i = 0; i < 64 && seeds.length < FLY_PILOT_SEED_COUNT; i += 8) {
        const seed = Number.parseInt(block.slice(i, i + 8), 16);
        if (!seeds.includes(seed)) seeds.push(seed);
      }
    }
    return seeds;
  })(),
);
const PILOT_SEEDS = new Set(FLY_PILOT_SEEDS);
export const isFlyPilotSeed = (seed: number) => PILOT_SEEDS.has(seed);

/** 32 bytes from the platform CSPRNG (Web Crypto, in Node and browsers alike). */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------- authorization

/**
 * What authorizing and running a plan need from the host, which this module
 * cannot reach itself: the registry, the ledger of authorizations, the
 * archive's seeds and the source tree. `registryFlyHost` (flyRegistry.ts) is
 * the real one.
 */
export interface FlyHost {
  /** Errors unless `receipt` is this plan's preregistration as the registry holds it. */
  preregistrationErrors(plan: FlyPlan, receipt: FlyPreregistration): string[];
  /** Records a new authorization; refuses a second one for the same plan. */
  issue(authorization: FlyAuthorization): string[];
  /** Spends an authorization: refuses one never issued, or one already used. */
  spend(authorization: FlyAuthorization): string[];
  /** Whether this fly (`fly_sha256`) has already run `seed` in an archived record. */
  seen(flySha256: string, seed: number): boolean;
  /** The source tree this process runs from. */
  code(): FlyCodeState;
  /** Evidence the host holds independently, for plans that cite sources or a parent. */
  evidence?: FlyContext;
}

const DIGEST = { type: "string", pattern: "^[a-f0-9]{64}$" };
const AUTH_SCHEMA = closed({
  schema: { const: FLY_AUTHORIZATION },
  experiment_id: { type: "string", pattern: "^FLY-[a-f0-9]{24}$" },
  definition_sha256: DIGEST,
  registry_experiment_id: { type: "string", pattern: "^V3D-EXP-\\d{4,}$" },
  preregistration_sha256: DIGEST,
  registered_at: { type: "string", maxLength: 40 },
  nonce: DIGEST,
  channel: { type: "string", enum: ["terminal", "script"] },
  operator: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,64}$" },
  attestation: { type: "string", enum: ["local-operator", "demonstration-script"] },
  identity_verified: { const: false },
  human_design_attested: { type: "boolean" },
  scope: { const: AUTH_SCOPE },
  confirmed_prefix: { type: "string", pattern: "^[a-f0-9]{8}$" },
  authorized_at: { type: "string", maxLength: 40 },
  expires_at: { type: "string", maxLength: 40 },
  authorization_sha256: DIGEST,
});

/** Who may authorize what: the script runs only its own designs, a person everything else. */
function channelErrors(
  channel: unknown,
  operator: unknown,
  generation: FlyDesign["provenance"]["generation"],
  humanAttested: unknown,
): string[] {
  const errors: string[] = [];
  if (channel === "script") {
    if (operator !== FLY_SCRIPT_OPERATOR)
      errors.push(`the demonstration script authorizes as ${FLY_SCRIPT_OPERATOR} only`);
    if (generation !== "scripted")
      errors.push("the demonstration script authorizes only the host's scripted designs");
  } else if (channel === "terminal") {
    if (typeof operator !== "string" || !OPERATOR.test(operator))
      errors.push("operator must be a role label");
    else if (operator === FLY_SCRIPT_OPERATOR)
      errors.push(`${FLY_SCRIPT_OPERATOR} names the demonstration script, not a person`);
    if (generation === "scripted")
      errors.push(
        "a scripted design is the host's demonstration and runs only through the demonstration script",
      );
  } else errors.push("authorization channel must be terminal or script");
  if (generation === "human" && humanAttested !== true)
    errors.push(
      "a design declared human needs the operator's attestation that a person wrote it",
    );
  if (generation !== "human" && humanAttested !== false)
    errors.push("only a design declared human is attested as human");
  return errors;
}

export interface FlyAuthorizationInput {
  channel: FlyAuthorizationChannel;
  operator: string;
  /** What the operator typed: the first eight characters of the plan digest. */
  typedPrefix: string;
  reviewed: boolean;
  /** For a design declared human: the operator attests that a person wrote it. */
  humanDesignAttested?: boolean;
}

/**
 * Authorizes a preregistered plan on the real clock. Draws the nonce that,
 * with the receipt, fixes the seeds (avoiding any seed this fly has already
 * run) and records the authorization with the host: a plan is authorized
 * once, so its seeds cannot be drawn again.
 */
export function authorizeFly(
  plan: FlyPlan,
  receipt: FlyPreregistration,
  input: FlyAuthorizationInput,
  host: FlyHost,
): Checked<FlyAuthorization> {
  const errors = verifyFlyPlan(plan, host.evidence);
  if (!errors.length) errors.push(...host.preregistrationErrors(plan, receipt));
  if (input.reviewed !== true) errors.push("operator must confirm protocol review");
  const generation = plan.design?.provenance?.generation;
  errors.push(
    ...channelErrors(
      input.channel,
      input.operator,
      generation,
      input.humanDesignAttested ?? false,
    ),
  );
  const prefix =
    typeof input.typedPrefix === "string" ? input.typedPrefix.trim().toLowerCase() : "";
  if (prefix.length !== 8 || !plan.definition_sha256?.startsWith(prefix))
    errors.push("repeat the first eight characters of this fly plan digest");
  const now = new Date();
  const registered = Date.parse(receipt?.created_at);
  if (!Number.isFinite(registered) || now.getTime() < registered)
    errors.push("an authorization cannot precede the plan's preregistration");
  if (errors.length) return { ok: false, errors };
  const receiptSha256 = flyPreregistrationSha256(receipt);
  const identity = flyIdentity();
  let nonce = randomNonce();
  for (
    let tries = 1;
    deriveFlySeeds(receiptSha256, nonce, plan.experiment.seed_count).some(
      (s) => isFlyPilotSeed(s) || host.seen(identity.fly_sha256, s),
    );
    tries++
  ) {
    if (tries >= 64)
      return {
        ok: false,
        errors: ["could not draw seeds that are neither pilot seeds nor already run"],
      };
    nonce = randomNonce();
  }
  const body = {
    schema: FLY_AUTHORIZATION,
    experiment_id: plan.experiment_id,
    definition_sha256: plan.definition_sha256,
    registry_experiment_id: receipt.experiment_id,
    preregistration_sha256: receiptSha256,
    registered_at: receipt.created_at,
    nonce,
    channel: input.channel,
    operator: input.operator,
    attestation:
      input.channel === "script"
        ? ("demonstration-script" as const)
        : ("local-operator" as const),
    identity_verified: false as const,
    human_design_attested: input.humanDesignAttested ?? false,
    scope: AUTH_SCOPE,
    confirmed_prefix: prefix,
    authorized_at: now.toISOString(),
    expires_at: new Date(now.getTime() + HOUR).toISOString(),
  };
  const authorization = { ...body, authorization_sha256: sha256Json(body) };
  const issued = host.issue(authorization);
  return issued.length
    ? { ok: false, errors: issued }
    : { ok: true, value: authorization };
}

/**
 * Checks an authorization against its plan and receipt at time `at`: its
 * digest, the plan and receipt it binds, who gave it, and that it was given
 * after the preregistration and is still within its hour.
 */
export function verifyFlyAuthorization(
  raw: unknown,
  plan: FlyPlan,
  receipt: FlyPreregistration,
  at: Date,
): string[] {
  const bounded = boundedData(raw);
  if (bounded.length) return bounded;
  const errors = schemaErrors(raw, AUTH_SCHEMA);
  if (errors.length) return errors;
  const a = raw as FlyAuthorization;
  const { authorization_sha256, ...body } = a;
  if (sha256Json(body) !== authorization_sha256)
    errors.push("fly authorization digest mismatch");
  if (
    a.definition_sha256 !== plan.definition_sha256 ||
    a.experiment_id !== plan.experiment_id ||
    a.confirmed_prefix !== plan.definition_sha256.slice(0, 8)
  )
    errors.push("fly approval binds a different plan");
  if (
    a.registry_experiment_id !== receipt?.experiment_id ||
    a.preregistration_sha256 !== flyPreregistrationSha256(receipt) ||
    a.registered_at !== receipt.created_at ||
    receipt.plan_sha256 !== plan.definition_sha256
  )
    errors.push("fly approval binds a different preregistration");
  if (
    (a.channel === "script") !== (a.attestation === "demonstration-script") ||
    (a.channel === "terminal") !== (a.attestation === "local-operator")
  )
    errors.push("fly approval's attestation does not match its channel");
  errors.push(
    ...channelErrors(
      a.channel,
      a.operator,
      plan.design?.provenance?.generation,
      a.human_design_attested,
    ),
  );
  const registered = Date.parse(a.registered_at),
    issued = Date.parse(a.authorized_at),
    expires = Date.parse(a.expires_at),
    clock = at.getTime();
  if (![registered, issued, expires, clock].every(Number.isFinite) || issued < registered)
    errors.push("fly approval precedes the plan's preregistration");
  else if (expires - issued !== HOUR || clock < issued || clock > expires)
    errors.push("fly approval outside its one-hour validity");
  return errors;
}

// -------------------------------------------------------------------- engine

/** The JavaScript engine this process runs on. */
export function currentFlyEngine(): FlyEngine {
  const versions = (globalThis as { process?: { versions?: Record<string, string> } })
    .process?.versions;
  if (versions?.bun)
    return { runtime: "bun", version: versions.bun, js: "JavaScriptCore" };
  if (versions?.node)
    return { runtime: "node", version: versions.node, js: `V8 ${versions.v8 ?? "?"}` };
  return { runtime: "unknown", version: "unknown", js: "unknown" };
}
export const flyEngineText = (e: FlyEngine) => `${e.runtime} ${e.version} (${e.js})`;
const sameEngine = (a: FlyEngine, b: FlyEngine) =>
  a.runtime === b.runtime && a.version === b.version && a.js === b.js;

/** Uncommitted or unknown code: a run from it is kept, never admitted. */
export const isDevelopmentCode = (code: FlyCodeState) =>
  !(typeof code.commit === "string" && /^[0-9a-f]{40}$/.test(code.commit)) ||
  code.dirty !== false;

// ------------------------------------------------------------------- the rig

/** One stimulus presentation: a sphere moving from `from` to `to` over `dur` seconds. */
interface Presentation {
  id: string;
  t0: number;
  dur: number;
  from: V3;
  to: V3;
  radius: number;
}

/**
 * The arena with a stimulus display: presentations are placed by the host
 * during a run (aimed at where the fly stands at onset) and are a function of
 * time once placed. They are seen, never touched.
 */
class StimulusWorld implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: FlyWorld["inputs"];
  readonly shown: Presentation[] = [];
  private inner: PrimitiveWorld;
  constructor(inner: PrimitiveWorld) {
    this.inner = inner;
    this.id = inner.id;
    this.home = inner.home;
    this.inputs = inner.inputs;
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.inner.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.inner.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.inner.solid(p);
  }
  light(p: V3): LightSample {
    return this.inner.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.inner.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.inner.foodAt(p);
  }
  odour(p: V3): number {
    return this.inner.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.inner.landmarks(near, radius, out);
  }
  /** Where a presentation's sphere is at `t`, or null when it is not showing. */
  at(s: Presentation, t: number): V3 | null {
    if (t < s.t0 || t > s.t0 + s.dur) return null;
    const u = s.dur > 0 ? (t - s.t0) / s.dur : 1;
    return [
      s.from[0] + (s.to[0] - s.from[0]) * u,
      s.from[1] + (s.to[1] - s.from[1]) * u,
      s.from[2] + (s.to[2] - s.from[2]) * u,
    ];
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.inner.movers(near, radius, out, t);
    for (const s of this.shown) {
      const c = this.at(s, t);
      if (!c) continue;
      if (Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) > radius + s.radius)
        continue;
      out.push({ id: s.id, kind: "stimulus", center: c, radius: s.radius });
    }
  }
}

/** A 32-bit seed for one stream of one run, from the experiment seed and labels. */
function derive(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part >>> 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}
const BLOCK_SALT: Record<FlyBlockId, number> = {
  clutter: 0x636c75,
  light: 0x6c6967,
  escape: 0x657363,
  repeat: 0x726570,
  echo_impairment: 0x656331,
  echo_causation: 0x656332,
  echo_memory: 0x656333,
};

const finite = (x: number | null): number | null =>
  x !== null && Number.isFinite(x) ? x : null;
const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

function arenaOf(block: FlyBlockSpec, lightIntensity: number): PrimitiveWorld {
  return arenaWorld(
    {
      size: [...block.arena.size],
      ambient: block.arena.ambient,
      pillars: block.arena.pillars.map((p) => ({ ...p })),
      lights:
        block.light_at && lightIntensity > 0
          ? [{ at: [...block.light_at], intensity: lightIntensity }]
          : [],
    },
    `fly-${block.id}`,
  );
}

function placeFly(
  block: FlyBlockSpec,
  arm: FlyArm,
  world: FlyWorld,
  geometry: () => number,
  seed: number,
): DigitalFly {
  const w = block.start_half_width_m;
  const x = (geometry() * 2 - 1) * w,
    z = (geometry() * 2 - 1) * w,
    yaw = (geometry() * 2 - 1) * Math.PI;
  return new DigitalFly({
    seed,
    world,
    start: { p: [x, 0.5, z], yaw },
    config: { ...arm.config, ...block.fixed_config },
    noise: arm.noise,
    logSize: 16,
  });
}

function sealed(fly: DigitalFly): string {
  const s = fly.state;
  if (![...s.p, ...s.v, s.yaw, s.t].every(Number.isFinite))
    throw new Error("the fly's state became non-finite");
  return fly.stateHash();
}

/**
 * The horizontal distance from `p` to the nearest pillar or wall surface (m),
 * from the arena's own geometry: the host's measure, not what the fly senses.
 */
function clearanceAt(block: FlyBlockSpec, p: V3): number {
  const [sx, , sz] = block.arena.size;
  let c = Math.min(sx / 2 - Math.abs(p[0]), sz / 2 - Math.abs(p[2]));
  for (const q of block.arena.pillars)
    c = Math.min(c, Math.hypot(p[0] - q.x, p[2] - q.z) - q.r);
  return c;
}

/** Free flight in pillar clutter: collisions, near misses, distance and saccades. */
function runClutter(block: FlyBlockSpec, arm: FlyArm, seed: number): FlyRun {
  const salt = BLOCK_SALT.clutter;
  const fly = placeFly(
    block,
    arm,
    arenaOf(block, 0),
    mulberry32(derive(seed, salt, 0)),
    derive(seed, salt, 1),
  );
  // Observed every physics step, so each contact is seen in the step it happened in.
  const ticks = Math.round(block.duration_s / block.tick_s);
  let episodes = 0,
    cruiseEpisodes = 0,
    lastContact = -Infinity,
    contacts = 0,
    contactS = 0,
    flightS = 0,
    // Whole ticks, so the fraction does not depend on summing floats.
    cruiseTicks = 0,
    nearTicks = 0;
  for (let i = 0; i < ticks; i++) {
    // A contact can turn a landing approach into cruise, or slow flight into a
    // touchdown, within its own step: an episode is classified by the mode the
    // step began in.
    const before = fly.state.mode;
    fly.advance(block.tick_s);
    const s = fly.state;
    if (s.counts.collisions > contacts) {
      if (s.t - lastContact > 0.1 + 1e-9) {
        episodes++;
        if (before === "flight") cruiseEpisodes++;
      }
      lastContact = s.t;
      contacts = s.counts.collisions;
      contactS += block.tick_s;
    }
    if (s.mode === "flight" || s.mode === "land") flightS += block.tick_s;
    // Cruising flight only: a landing approach closes on a surface on purpose.
    if (s.mode === "flight") {
      cruiseTicks++;
      if (clearanceAt(block, s.p) < block.near_miss_m!) nearTicks++;
    }
  }
  const c = fly.state.counts;
  const perMetre = (n: number) => (c.flownM >= 0.5 ? finite(n / c.flownM) : null);
  const cruiseS = cruiseTicks * block.tick_s;
  return {
    arm: arm.id,
    seed,
    block: "clutter",
    final_hashes: [sealed(fly)],
    simulated_s: fly.state.t,
    gate_refusals: c.rejected,
    metrics: {
      collision_episodes: episodes,
      collision_episodes_per_m: perMetre(episodes),
      cruise_collision_episodes_per_m: perMetre(cruiseEpisodes),
      near_miss_fraction: cruiseS >= 1 ? nearTicks / cruiseTicks : null,
      flown_m: finite(c.flownM),
      saccades_per_flight_s: flightS >= 1 ? finite(c.saccades / flightS) : null,
      contact_s: Math.round(contactS * 1000) / 1000,
    },
  };
}

/** Free behaviour with or without a point light: where the fly spends its time. */
function runLight(block: FlyBlockSpec, arm: FlyArm, seed: number): FlyRun {
  const salt = BLOCK_SALT.light;
  const fly = placeFly(
    block,
    arm,
    arenaOf(block, arm.light_intensity),
    mulberry32(derive(seed, salt, 0)),
    derive(seed, salt, 1),
  );
  const [lx, , lz] = block.light_at!;
  const ticks = Math.round(block.duration_s / block.tick_s);
  let distance = 0,
    near = 0,
    active = 0;
  for (let i = 0; i < ticks; i++) {
    fly.advance(block.tick_s);
    const s = fly.state;
    const d = Math.hypot(s.p[0] - lx, s.p[2] - lz);
    distance += d;
    if (d <= 1) near++;
    if (s.mode !== "rest" && s.mode !== "groom") active++;
  }
  return {
    arm: arm.id,
    seed,
    block: "light",
    final_hashes: [sealed(fly)],
    simulated_s: fly.state.t,
    gate_refusals: fly.state.counts.rejected,
    metrics: {
      mean_light_distance_m: finite(distance / ticks),
      time_near_light: near / ticks,
      active_fraction: active / ticks,
    },
  };
}

/**
 * The line a stimulus runs along, aimed at `p` from `azimuth` and
 * `elevation` relative to the fly: from its start distance to `end`.
 */
function stimulusLine(
  p: V3,
  yaw: number,
  azimuth: number,
  elevation: number,
  stim: Stimulus,
  end: number,
): { near: V3; far: V3 } {
  const a = yaw + azimuth;
  const dir: V3 = [
    Math.cos(elevation) * Math.cos(a),
    Math.sin(elevation),
    -Math.cos(elevation) * Math.sin(a),
  ];
  const at = (d: number): V3 => [p[0] + dir[0] * d, p[1] + dir[1] * d, p[2] + dir[2] * d];
  return { near: at(end), far: at(stim.start_distance_m) };
}

const between = (r: () => number, [lo, hi]: [number, number]) => lo + (hi - lo) * r();

/** The stimulus's angular size seen from the fly (deg), or null when not showing. */
function sizeSeen(world: StimulusWorld, s: Presentation, fly: DigitalFly): number | null {
  const c = world.at(s, Math.min(fly.state.t, s.t0 + s.dur));
  if (!c) return null;
  const d = Math.hypot(
    c[0] - fly.state.p[0],
    c[1] - fly.state.p[1],
    c[2] - fly.state.p[2],
  );
  return d > s.radius ? deg(2 * Math.asin(s.radius / d)) : 180;
}

/**
 * Single stimulus trials, each on a fresh fly standing still: a sphere
 * approaches on a line aimed at the fly at the arm's l/v and stops at the
 * block's final size. Matched seeds give both arms the same flies, lines and
 * final sizes, so only the l/v differs.
 */
function runEscape(block: FlyBlockSpec, arm: FlyArm, seed: number): FlyRun {
  const salt = BLOCK_SALT.escape,
    stim = block.stimulus!;
  const speed = speedOf(stim.radius_m, arm.l_over_v_ms);
  const hashes: string[] = [];
  const latency: number[] = [],
    ttc: number[] = [],
    size: number[] = [];
  let escapes = 0,
    short = 0,
    simulated = 0,
    refused = 0;
  for (let trial = 0; trial < block.trials; trial++) {
    const geometry = mulberry32(derive(seed, salt, trial, 0));
    const world = new StimulusWorld(arenaOf(block, 0));
    const fly = placeFly(block, arm, world, geometry, derive(seed, salt, trial, 1));
    const azimuth = rad(between(geometry, stim.azimuth_deg)),
      elevation = rad(between(geometry, stim.elevation_deg)),
      final = between(geometry, stim.final_size_deg);
    const end = endDistance(stim, final);
    const { near, far } = stimulusLine(
      fly.state.p,
      fly.state.yaw,
      azimuth,
      elevation,
      stim,
      end,
    );
    const shown: Presentation = {
      id: `stimulus-${trial}`,
      t0: stim.onset_s,
      dur: approachS(stim, arm.l_over_v_ms, final),
      from: far,
      to: near,
      radius: stim.radius_m,
    };
    world.shown.push(shown);
    // When the centre would reach the fly, had it kept coming.
    const arrival = shown.t0 + stim.start_distance_m / speed;
    const ticks = Math.round(
      (stim.onset_s + shown.dur + block.duration_s) / block.tick_s,
    );
    let escaped = false;
    for (let i = 0; i < ticks; i++) {
      fly.advance(block.tick_s);
      if (!escaped && fly.state.counts.escapes > 0) {
        escaped = true;
        escapes++;
        const t = fly.state.t;
        latency.push(t - shown.t0);
        ttc.push(arrival - t);
        const seen = sizeSeen(world, shown, fly);
        if (seen !== null) size.push(seen);
        if (fly.state.takeoff?.short) short++;
      }
    }
    hashes.push(sealed(fly));
    simulated += fly.state.t;
    refused += fly.state.counts.rejected;
  }
  return {
    arm: arm.id,
    seed,
    block: "escape",
    final_hashes: hashes,
    simulated_s: simulated,
    gate_refusals: refused,
    metrics: {
      escape_probability: escapes / block.trials,
      escape_ttc_s: finite(mean(ttc)),
      escape_latency_s: finite(mean(latency)),
      size_at_escape_deg: finite(mean(size)),
      short_mode_fraction: escapes ? short / escapes : null,
    },
  };
}

/**
 * Repeated presentations to one fly on a fixed schedule: presentation k falls
 * due at onset + k x the arm's interval, whatever the fly did. A presentation
 * due while the fly is still in the air is skipped and counted, never delayed,
 * so the interval is the design's and never the fly's. Each presentation's
 * final size and candidate directions come from its own stream, so both arms
 * see the same sequence; it is aimed at where the fly stands, from the first
 * candidate direction whose whole line stays inside the arena (else the one
 * with the most room).
 */
function runRepeat(block: FlyBlockSpec, arm: FlyArm, seed: number): FlyRun {
  const salt = BLOCK_SALT.repeat,
    stim = block.stimulus!;
  const world = new StimulusWorld(arenaOf(block, 0));
  const fly = placeFly(
    block,
    arm,
    world,
    mulberry32(derive(seed, salt, 0)),
    derive(seed, salt, 1),
  );
  const [sx, sy, sz] = block.arena.size;
  const margin = (q: V3) =>
    Math.min(sx / 2 - Math.abs(q[0]), sz / 2 - Math.abs(q[2]), sy - q[1], q[1]);
  const shown: { index: number; escaped: boolean; size: number | null }[] = [];
  let index = 0,
    airborne = 0,
    active: Presentation | null = null,
    escapesBefore = 0;
  // Whole ticks: the schedule's onsets fall on the same steps in every run.
  const ticks = Math.round(runSeconds(block, arm) / block.tick_s);
  const dueTick = (k: number) =>
    Math.round((stim.onset_s + k * arm.isi_s) / block.tick_s);
  for (let i = 1; i <= ticks; i++) {
    fly.advance(block.tick_s);
    const s = fly.state;
    if (active) {
      const current = shown[shown.length - 1]!;
      if (!current.escaped && s.counts.escapes > escapesBefore) {
        current.escaped = true;
        current.size = sizeSeen(world, active, fly);
      }
      if (s.t > active.t0 + active.dur + block.duration_s) active = null;
    }
    if (index >= block.trials || i < dueTick(index)) continue;
    const draw = mulberry32(derive(seed, salt, 2, index));
    const final = between(draw, stim.final_size_deg);
    if (!PERCHED.has(s.mode)) {
      airborne++;
      index++;
      continue;
    }
    const end = endDistance(stim, final);
    let best: { near: V3; far: V3; room: number } | null = null;
    for (let k = 0; k < 8; k++) {
      const line = stimulusLine(
        s.p,
        s.yaw,
        rad(between(draw, stim.azimuth_deg)),
        rad(between(draw, stim.elevation_deg)),
        stim,
        end,
      );
      const room = Math.min(margin(line.near), margin(line.far));
      if (!best || room > best.room) best = { ...line, room };
      if (room >= 0.15) break;
    }
    active = {
      id: `stimulus-${index}`,
      t0: s.t,
      dur: approachS(stim, stim.l_over_v_ms, final),
      from: best!.far,
      to: best!.near,
      radius: stim.radius_m,
    };
    world.shown.push(active);
    shown.push({ index, escaped: false, size: null });
    escapesBefore = s.counts.escapes;
    index++;
  }
  const late = shown.filter((d) => d.index >= Math.ceil(block.trials / 2));
  const sizes = shown.flatMap((d) => (d.escaped && d.size !== null ? [d.size] : []));
  const answered = (xs: typeof shown) =>
    xs.length ? xs.filter((d) => d.escaped).length / xs.length : null;
  return {
    arm: arm.id,
    seed,
    block: "repeat",
    final_hashes: [sealed(fly)],
    simulated_s: fly.state.t,
    gate_refusals: fly.state.counts.rejected,
    metrics: {
      presentations: shown.length,
      airborne_presentations: airborne,
      repeat_escape_probability: answered(shown),
      late_escape_probability: answered(late),
      repeat_size_at_escape_deg: finite(mean(sizes)),
    },
  };
}

const RUNNERS: Record<FlyBlockId, (b: FlyBlockSpec, a: FlyArm, seed: number) => FlyRun> =
  {
    echo_impairment: runEchoBlock,
    echo_causation: runEchoBlock,
    echo_memory: runEchoBlock,
    clutter: runClutter,
    light: runLight,
    escape: runEscape,
    repeat: runRepeat,
  };

/**
 * Every run of an experiment on `seeds`, block by block, seed by seed, control
 * before treatment. Exported for pilots: running it makes no record, and a
 * record's seeds are never chosen by the caller (`deriveFlySeeds`).
 */
export function runFlyExperiment(
  experiment: FlyExperiment,
  seeds: readonly number[],
): FlyRun[] {
  const runs: FlyRun[] = [];
  for (const block of experiment.blocks)
    for (const seed of seeds)
      for (const arm of experiment.arms) runs.push(RUNNERS[block.id](block, arm, seed));
  return runs;
}

/**
 * Every block for one arm on `seeds`: what a pilot runs for each dose of a
 * series. Like `runFlyExperiment`, it makes no record.
 */
export function runFlyArm(
  blocks: readonly FlyBlockSpec[],
  arm: FlyArm,
  seeds: readonly number[],
): FlyRun[] {
  return blocks.flatMap((block) =>
    seeds.map((seed) => RUNNERS[block.id](block, arm, seed)),
  );
}

// ------------------------------------------------------------------ analysis

/**
 * P(X >= k) for X ~ Binomial(m, 1/2), exactly: the one-sided sign test's
 * p-value for k of m untied seeds in one direction. A count over 2^m, so it is
 * the same on every engine.
 */
export function signTestTail(k: number, m: number): number {
  if (k <= 0) return 1;
  if (k > m) return 0;
  let c = 1, // C(m, 0)
    tail = 0;
  for (let j = 0; j <= m; j++) {
    if (j >= k) tail += c;
    c = (c * (m - j)) / (j + 1);
  }
  return tail / 2 ** m;
}

/** Derived from the runs; the same function serves execution and replay. */
export function flyMeasurements(
  plan: FlyPlan,
  seeds: readonly number[],
  runs: readonly FlyRun[] | null,
  deterministic: boolean,
): Record<string, number | null> {
  const metricId = plan.design.analysis.metric,
    sign = plan.design.analysis.expected_direction === "increase" ? 1 : -1;
  const metric = metricOf(metricId);
  const blocks = plan.experiment.blocks.map((b) => b.id as string);
  const refusals = (arm: string | null) =>
    runs
      ? runs
          .filter((r) => arm === null || r.arm === arm)
          .reduce((s, r) => s + r.gate_refusals, 0)
      : null;
  // Without runs nothing was checked or counted: unknown, not zero.
  const out: Record<string, number | null> = {
    runs_completed: runs ? runs.length : 0,
    determinism_check: runs ? (deterministic ? 1 : 0) : null,
    seeds: seeds.length,
    simulated_seconds: runs
      ? Math.round(runs.reduce((s, r) => s + r.simulated_s, 0) * 1000) / 1000
      : null,
    gate_refusals: refusals(null),
    control_gate_refusals: refusals("control"),
    treatment_gate_refusals: refusals("treatment"),
    control_mean: null,
    treatment_mean: null,
    mean_paired_delta: null,
    seeds_expected_direction: null,
    seeds_opposite: null,
    seeds_unchanged: null,
    seeds_undefined: null,
    untied_pairs: null,
    sign_test_p_expected: null,
    sign_test_p_opposite: null,
    control_informative: null,
  };
  const measured = FLY_METRICS.filter((m) => blocks.includes(m.block));
  for (const m of measured) {
    out[`control_${m.id}`] = null;
    out[`treatment_${m.id}`] = null;
  }
  if (!runs) return out;
  const value = (arm: string, seed: number, id: string) => {
    const block = metricOf(id).block;
    const v = runs.find((r) => r.arm === arm && r.seed === seed && r.block === block)
      ?.metrics[id];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  for (const m of measured)
    for (const arm of ["control", "treatment"])
      out[`${arm}_${m.id}`] = mean(
        seeds.flatMap((s) => {
          const v = value(arm, s, m.id);
          return v === null ? [] : [v];
        }),
      );
  // A seed whose metric is undefined in either arm drops out of the paired
  // test; it does not void the others.
  const pairs = seeds.flatMap((s) => {
    const c = value("control", s, metricId),
      t = value("treatment", s, metricId);
    return c === null || t === null ? [] : [{ c, t, d: t - c }];
  });
  out.seeds_undefined = seeds.length - pairs.length;
  const expected = pairs.filter((p) => p.d * sign > 0).length,
    opposite = pairs.filter((p) => p.d * sign < 0).length;
  out.seeds_expected_direction = expected;
  out.seeds_opposite = opposite;
  out.seeds_unchanged = pairs.length - expected - opposite;
  out.untied_pairs = expected + opposite;
  out.sign_test_p_expected = signTestTail(expected, expected + opposite);
  out.sign_test_p_opposite = signTestTail(opposite, expected + opposite);
  if (pairs.length) {
    out.control_mean = mean(pairs.map((p) => p.c));
    out.treatment_mean = mean(pairs.map((p) => p.t));
    out.mean_paired_delta = mean(pairs.map((p) => p.d));
  }
  // A control pinned at the metric's floor or ceiling in every seed can only
  // move one way: whatever the treatment does, that is no comparison.
  const control = pairs.map((p) => p.c);
  const pinned = (bound: number | null) =>
    bound !== null && control.every((v) => v === bound);
  out.control_informative =
    control.length && !pinned(metric.floor) && !pinned(metric.ceiling) ? 1 : 0;
  return out;
}

function simulate(plan: FlyPlan, seeds: readonly number[]): FlyResult {
  let runs: FlyRun[] | null = null;
  let error: string | null = null;
  try {
    runs = runFlyExperiment(plan.experiment, seeds);
  } catch (e) {
    error = e instanceof Error ? e.message : "the fly simulation failed";
  }
  // The guard G2: an independent second simulation must reach every state hash
  // and every measurement again.
  let deterministic = false;
  if (runs) {
    try {
      deterministic =
        canonicalJson(runFlyExperiment(structuredClone(plan.experiment), [...seeds])) ===
        canonicalJson(runs);
    } catch {
      deterministic = false;
    }
  }
  const measurements = flyMeasurements(plan, seeds, runs, deterministic);
  const expected = 2 * seeds.length * plan.experiment.blocks.length;
  const completed = runs !== null && runs.length === expected;
  if (!completed)
    return {
      runs: runs ?? [],
      completed,
      measurements,
      status: "error",
      verdict: "not_evaluated",
      evaluation: null,
      error: error ?? "incomplete fly experiment",
    };
  return {
    runs: runs!,
    completed,
    measurements,
    ...evaluate(plan.criteria, measurements),
    error: null,
  };
}

// ----------------------------------------------------------------- execution

export class FlyRunRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("Fly run refused: " + reasons.join("; "));
    this.reasons = reasons;
  }
}

const runIdOf = (planDigest: string, authDigest: string, startedAt: string) =>
  `FR-${sha256Json({ plan: planDigest, authorization: authDigest, started_at: startedAt }).slice(0, 24)}`;

/**
 * Runs a preregistered, authorized plan on the real clock and seals the
 * record. Refuses a plan the registry does not hold, an authorization that
 * binds another plan or receipt, precedes the preregistration, has expired,
 * was never issued or was already used, and seeds this fly has already run.
 * The authorization is spent before the fly moves, so a run that fails still
 * used it.
 */
export function executeFly(
  plan: FlyPlan,
  preregistration: FlyPreregistration,
  authorization: unknown,
  host: FlyHost,
): FlyRecord {
  const started = new Date();
  const errors = verifyFlyPlan(plan, host.evidence);
  if (!errors.length)
    errors.push(
      ...host.preregistrationErrors(plan, preregistration),
      ...verifyFlyAuthorization(authorization, plan, preregistration, started),
    );
  if (errors.length) throw new FlyRunRefused(errors);
  const auth = structuredClone(authorization) as FlyAuthorization;
  const seeds = deriveFlySeeds(
    auth.preregistration_sha256,
    auth.nonce,
    plan.experiment.seed_count,
  );
  const pilots = seeds.filter(isFlyPilotSeed);
  if (pilots.length)
    throw new FlyRunRefused([
      `seeds ${pilots.join(", ")} are pilot seeds, which never feed an archived run`,
    ]);
  const reused = seeds.filter((s) => host.seen(plan.fly_sha256, s));
  if (reused.length)
    throw new FlyRunRefused([`this fly has already run seeds ${reused.join(", ")}`]);
  const spent = host.spend(auth);
  if (spent.length) throw new FlyRunRefused(spent);
  const code = host.code();
  const frozen = structuredClone(plan),
    receipt = structuredClone(preregistration);
  const startedAt = started.toISOString();
  const result = simulate(frozen, seeds);
  const body = {
    schema: FLY_RECORD,
    run_id: runIdOf(frozen.definition_sha256, auth.authorization_sha256, startedAt),
    plan: frozen,
    preregistration: receipt,
    authorization: auth,
    seeds,
    engine: currentFlyEngine(),
    code: { commit: code.commit, dirty: code.dirty },
    development: isDevelopmentCode(code),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    result,
    evidence_class: "simulated" as const,
  };
  return { ...body, sha256: sha256Json(body) };
}

// -------------------------------------------------------------- verification

const RECORD_KEYS = [
  "schema",
  "run_id",
  "plan",
  "preregistration",
  "authorization",
  "seeds",
  "engine",
  "code",
  "development",
  "started_at",
  "finished_at",
  "result",
  "evidence_class",
  "sha256",
];
const RECEIPT_SCHEMA = closed({
  experiment_id: { type: "string", pattern: "^V3D-EXP-\\d{4,}$" },
  registry_definition_sha256: DIGEST,
  plan_sha256: DIGEST,
  created_at: { type: "string", maxLength: 40 },
});
const ENGINE_SCHEMA = closed({
  runtime: { type: "string", maxLength: 40 },
  version: { type: "string", maxLength: 80 },
  js: { type: "string", maxLength: 80 },
});
const CODE_SCHEMA = closed({
  commit: { oneOf: [{ type: "string", pattern: "^[0-9a-f]{7,64}$" }, { type: "null" }] },
  dirty: { oneOf: [{ type: "boolean" }, { type: "null" }] },
});

/**
 * What holds for any record of this schema, whatever code or engine checks
 * it: the seal, the plan's own digest, the receipt and authorization it binds
 * and their order in time, the seeds they fix, the run identity and the
 * development flag. Re-simulation is separate (`verifyFlyRecord`).
 */
export function flyRecordIntegrityErrors(raw: unknown): string[] {
  const bounded = boundedData(raw, 400000);
  if (bounded.length) return bounded;
  try {
    const r = raw as FlyRecord;
    const errors: string[] = [];
    if (
      Object.keys(r).length !== RECORD_KEYS.length ||
      Object.keys(r).some((k) => !RECORD_KEYS.includes(k)) ||
      r.schema !== FLY_RECORD ||
      r.evidence_class !== "simulated"
    )
      return ["unsupported fly record shape/classification"];
    const { sha256: sealedSha256, ...body } = r;
    if (sha256Json(body) !== sealedSha256) errors.push("fly record digest mismatch");
    const planSha256 = sha256Json(flyPlanBody(r.plan));
    if (
      r.plan.schema !== FLY_PLAN ||
      r.plan.definition_sha256 !== planSha256 ||
      r.plan.experiment_id !== `FLY-${planSha256.slice(0, 24)}`
    )
      errors.push("the plan's digest does not match the plan");
    errors.push(
      ...schemaErrors(r.preregistration, RECEIPT_SCHEMA).map(
        (e) => `preregistration: ${e}`,
      ),
      ...schemaErrors(r.engine, ENGINE_SCHEMA).map((e) => `engine: ${e}`),
      ...schemaErrors(r.code, CODE_SCHEMA).map((e) => `code: ${e}`),
    );
    if (errors.length) return errors;
    const started = new Date(r.started_at),
      finished = new Date(r.finished_at);
    if (
      ![started.getTime(), finished.getTime()].every(Number.isFinite) ||
      finished < started ||
      finished.getTime() - started.getTime() > MAX_RUN_MS
    )
      errors.push("invalid fly record clocks");
    errors.push(
      ...verifyFlyAuthorization(r.authorization, r.plan, r.preregistration, started),
    );
    if (errors.length) return errors;
    if (
      canonicalJson(r.seeds) !==
      canonicalJson(
        deriveFlySeeds(
          r.authorization.preregistration_sha256,
          r.authorization.nonce,
          r.plan.experiment.seed_count,
        ),
      )
    )
      errors.push("the seeds are not the ones the receipt and nonce fix");
    if (r.seeds.some(isFlyPilotSeed))
      errors.push("the seeds include a pilot seed, which never feeds an archived run");
    if (
      runIdOf(
        r.plan.definition_sha256,
        r.authorization.authorization_sha256,
        r.started_at,
      ) !== r.run_id
    )
      errors.push("run identity does not bind plan, approval and start");
    if (r.development !== isDevelopmentCode(r.code))
      errors.push("the development flag does not match the recorded source tree");
    return errors;
  } catch {
    return ["malformed fly record"];
  }
}

export type FlyVerificationStatus = "ok" | "failed" | "other_code" | "not_resimulable";
export interface FlyVerification {
  /** Every check passed and every run re-simulated to the record. */
  ok: boolean;
  /**
   * `other_code`: sound, but made by another fly or source, so this code cannot
   * re-simulate it. `not_resimulable`: sound, but made on another JavaScript
   * engine. Neither is a pass or a failure.
   */
  status: FlyVerificationStatus;
  errors: string[];
  replay_sha256: string | null;
  note: string | null;
}

/** The replay digest a record implies once its result has re-simulated exactly. */
export const flyReplaySha256 = (record: FlyRecord) =>
  sha256Json({ plan: flyPlanBody(record.plan), result: record.result });

/**
 * Checks a record's integrity, recompiles its plan against this fly and
 * re-simulates every run on the recorded seeds, requiring the recorded result
 * exactly. On another engine it re-simulates only within the same runtime,
 * and a difference there is reported as not re-simulable, not as tampering.
 */
export function verifyFlyRecord(raw: unknown, context: FlyContext = {}): FlyVerification {
  const fail = (errors: string[]): FlyVerification => ({
    ok: false,
    status: "failed",
    errors,
    replay_sha256: null,
    note: null,
  });
  const integrity = flyRecordIntegrityErrors(raw);
  if (integrity.length) return fail(integrity);
  const r = raw as FlyRecord;
  const identity = flyIdentity();
  if (r.plan.fly_sha256 !== identity.fly_sha256)
    return {
      ok: false,
      status: "other_code",
      errors: [],
      replay_sha256: null,
      note: `made by ${r.plan.fly} with source ${r.plan.fly_source_sha256.slice(0, 12)}; this code is ${identity.fly} with source ${identity.source_sha256.slice(0, 12)}`,
    };
  const recompiled = verifyFlyPlan(r.plan, context);
  if (recompiled.length) return fail(recompiled);
  const here = currentFlyEngine();
  const elsewhere = `recorded on ${flyEngineText(r.engine)}, checked on ${flyEngineText(here)}`;
  if (here.runtime !== r.engine.runtime)
    return {
      ok: false,
      status: "not_resimulable",
      errors: [],
      replay_sha256: null,
      note: `not re-simulable on this engine: ${elsewhere}`,
    };
  const replay = simulate(r.plan, r.seeds);
  if (canonicalJson(replay) === canonicalJson(r.result))
    return {
      ok: true,
      status: "ok",
      errors: [],
      replay_sha256: flyReplaySha256(r),
      note: sameEngine(here, r.engine) ? null : `re-simulated exactly; ${elsewhere}`,
    };
  return sameEngine(here, r.engine)
    ? fail(["state hashes, measurements or frozen evaluation differ on re-simulation"])
    : {
        ok: false,
        status: "not_resimulable",
        errors: [],
        replay_sha256: null,
        note: `differs on re-simulation and the engine version differs, so not re-simulable on this engine: ${elsewhere}`,
      };
}
