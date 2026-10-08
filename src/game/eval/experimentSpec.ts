import { HOST_CAPABILITIES } from "../pilot/capabilities.js";
import { canonicalHash } from "../pilot/hash.js";
import { decisionType } from "./outcomeContracts.js";
import { metricDefinition } from "./metricRegistry.js";

/**
 * The declared experiment: `blacksite-experiment/v1`.
 *
 * An experiment states its question, its hypothesis, the one metric that
 * decides it, the decision type and outcome window its decision metrics are
 * scored under, the seeds, and the arms — all before anything runs. The runner
 * refuses a definition that leaves any of that out or names something this
 * build cannot compute, and it hashes the canonical definition into every
 * artifact so a result can be matched to the exact question it answered.
 *
 * Changing the deciding metric after seeing a result is the failure this
 * format exists to make visible: a changed definition is a different hash.
 */

export const EXPERIMENT_SCHEMA = "blacksite-experiment/v1";

export const BRAINS = ["jev", "glide", "llm", "random", "script"] as const;
export type ExperimentBrain = (typeof BRAINS)[number];

/** Brains answered by a remote model: their latency is real and never altered. */
export const REMOTE_BRAINS: readonly ExperimentBrain[] = ["jev", "glide", "llm"];

export const POLICIES = ["marksman", "skirmisher"] as const;

export const INDEPENDENT_VARIABLES = [
  "brain",
  "latency",
  "cadence",
  "control",
  "navigation",
  "policy",
  "placeOrder",
  "targetOrder",
  "stale",
  "motor",
  "seat",
  "build",
] as const;

/**
 * Injected answer delay, ms. The maximum is the contract's 1.5 s decision max
 * age on purpose: `latency-sweep.json` puts a point at that edge to measure
 * answer loss there.
 */
const LATENCY_RANGE = [0, 1500] as const;

/**
 * Decision interval, ms. The floor is the host's: `negotiate()` never runs a
 * seat faster than `HOST_CAPABILITIES.minIntervalMs`, so a declared cadence
 * below it would run at the floor while every report stated the declared value.
 */
const CADENCE_RANGE = [HOST_CAPABILITIES.minIntervalMs, 2000] as const;

export const SEED_PRESETS: Readonly<Record<string, number>> = {
  quick: 3,
  dev: 10,
  eval: 30,
};

/** Seat configuration of one arm. Every field maps to a `/play` parameter. */
export interface ArmSpec {
  id: string;
  brain: ExperimentBrain;
  policy?: (typeof POLICIES)[number];
  control: "direct" | "precision";
  navigation?: "places" | "steps";
  /** Injected answer delay, local brains only (Jev's latency is never altered). */
  latencyMs?: number;
  cadenceMs?: number;
  stale?: "strict" | "observe";
  motor?: "standard" | "degraded";
  placeOrder?: "nearest" | "shuffled";
  targetOrder?: "nearest" | "shuffled";
  seat?: "mercy" | "even";
  /** Extra `/play` parameters, plain `name=value` pairs. */
  query?: string;
  /** A different build's origin, for before/after arms. */
  origin?: string;
  /** Use the offline LLM test double; the result is labelled as such. */
  fakeLlm?: boolean;
}

export interface ExperimentSpec {
  schema: typeof EXPERIMENT_SCHEMA;
  id: string;
  question: string;
  hypothesis: string;
  independentVariable: (typeof INDEPENDENT_VARIABLES)[number];
  primaryMetric: string;
  secondaryMetrics: string[];
  /** Outcome contract for decision-level metrics and calibration; null for episode metrics only. */
  decisionType: string | null;
  outcomeWindowS: number;
  seeds: number[];
  /** How the seeds were given: explicit list or a named preset. */
  seedPreset: string | null;
  duration: number;
  mode: "tdm" | "domination" | "ffa" | "hardpoint";
  arms: ArmSpec[];
  /** Arms that should *not* change under the manipulation: the control. */
  controls: string[];
  /** Which stated number to calibrate: the chosen option's probability, or the separate confidence. */
  calibrationField: "probability" | "confidence";
  /** Factors for the contribution analysis, when the arms form a factorial design. */
  contributionFactors: string[];
  notes: string | null;
}

export type SpecResult =
  { ok: true; spec: ExperimentSpec } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const QUERY = /^[A-Za-z0-9_=&.,-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
  optional = false,
): T | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${path}: must be one of ${allowed.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function intIn(
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    errors.push(`${path}: must be an integer in [${min}, ${max}]`);
    return undefined;
  }
  return value;
}

const KNOWN_TOP = new Set([
  "$schema",
  "schema",
  "id",
  "question",
  "hypothesis",
  "independentVariable",
  "primaryMetric",
  "secondaryMetrics",
  "decisionType",
  "outcomeWindowS",
  "seeds",
  "duration",
  "mode",
  "seat",
  "arms",
  "sweep",
  "controls",
  "calibrationField",
  "contributionFactors",
  "notes",
]);

const KNOWN_ARM = new Set([
  "id",
  "brain",
  "policy",
  "control",
  "navigation",
  "latencyMs",
  "cadenceMs",
  "stale",
  "motor",
  "placeOrder",
  "targetOrder",
  "seat",
  "query",
  "origin",
  "fakeLlm",
]);

function parseArm(value: unknown, path: string, errors: string[]): ArmSpec | null {
  if (!isRecord(value)) {
    errors.push(`${path}: expected an object`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_ARM.has(key)) errors.push(`${path}.${key}: unknown field`);
  }
  const id = value["id"];
  if (typeof id !== "string" || !ID.test(id))
    errors.push(`${path}.id: lowercase id required`);
  const brain = oneOf(value["brain"], BRAINS, `${path}.brain`, errors);
  const control = oneOf(
    value["control"],
    ["direct", "precision"] as const,
    `${path}.control`,
    errors,
  );
  const policy = oneOf(value["policy"], POLICIES, `${path}.policy`, errors, true);
  if (brain === "script" && policy === undefined)
    errors.push(`${path}.policy: a script arm names its policy`);
  if (brain !== "script" && policy !== undefined)
    errors.push(`${path}.policy: only script arms take a policy`);
  const latencyMs = intIn(
    value["latencyMs"],
    ...LATENCY_RANGE,
    `${path}.latencyMs`,
    errors,
  );
  const cadenceMs = intIn(
    value["cadenceMs"],
    ...CADENCE_RANGE,
    `${path}.cadenceMs`,
    errors,
  );
  if (
    brain !== undefined &&
    REMOTE_BRAINS.includes(brain) &&
    latencyMs !== undefined &&
    latencyMs > 0
  ) {
    errors.push(
      `${path}.latencyMs: a remote model's latency is real and is never altered`,
    );
  }
  const query = value["query"];
  if (query !== undefined && (typeof query !== "string" || !QUERY.test(query))) {
    errors.push(`${path}.query: plain name=value pairs joined by &`);
  }
  const origin = value["origin"];
  if (
    origin !== undefined &&
    (typeof origin !== "string" || !/^https?:\/\/[^\s]+$/.test(origin))
  ) {
    errors.push(`${path}.origin: an http(s) origin`);
  }
  const fakeLlm = value["fakeLlm"];
  if (fakeLlm !== undefined && typeof fakeLlm !== "boolean")
    errors.push(`${path}.fakeLlm: boolean`);
  if (fakeLlm === true && brain !== "llm") errors.push(`${path}.fakeLlm: only llm arms`);
  const arm: ArmSpec = {
    id: String(id),
    brain: brain ?? "random",
    control: control ?? "precision",
  };
  if (policy) arm.policy = policy;
  const navigation = oneOf(
    value["navigation"],
    ["places", "steps"] as const,
    `${path}.navigation`,
    errors,
    true,
  );
  if (navigation) arm.navigation = navigation;
  if (latencyMs !== undefined) arm.latencyMs = latencyMs;
  if (cadenceMs !== undefined) arm.cadenceMs = cadenceMs;
  const stale = oneOf(
    value["stale"],
    ["strict", "observe"] as const,
    `${path}.stale`,
    errors,
    true,
  );
  if (stale) arm.stale = stale;
  const motor = oneOf(
    value["motor"],
    ["standard", "degraded"] as const,
    `${path}.motor`,
    errors,
    true,
  );
  if (motor) arm.motor = motor;
  const placeOrder = oneOf(
    value["placeOrder"],
    ["nearest", "shuffled"] as const,
    `${path}.placeOrder`,
    errors,
    true,
  );
  if (placeOrder) arm.placeOrder = placeOrder;
  const targetOrder = oneOf(
    value["targetOrder"],
    ["nearest", "shuffled"] as const,
    `${path}.targetOrder`,
    errors,
    true,
  );
  if (targetOrder) arm.targetOrder = targetOrder;
  const seat = oneOf(
    value["seat"],
    ["mercy", "even"] as const,
    `${path}.seat`,
    errors,
    true,
  );
  if (seat) arm.seat = seat;
  if (typeof query === "string" && query) arm.query = query;
  if (typeof origin === "string") arm.origin = origin;
  if (fakeLlm === true) arm.fakeLlm = true;
  return arm;
}

/**
 * Expand a `sweep` into arms: every base arm once per value of the swept
 * parameter. Only local brains may sweep latency — a remote model's latency is
 * measured, not chosen.
 */
function expandSweep(sweep: unknown, arms: ArmSpec[], errors: string[]): ArmSpec[] {
  if (sweep === undefined) return arms;
  if (!isRecord(sweep)) {
    errors.push("sweep: expected an object");
    return arms;
  }
  const param = oneOf(
    sweep["param"],
    ["latencyMs", "cadenceMs"] as const,
    "sweep.param",
    errors,
  );
  const values = sweep["values"];
  if (!Array.isArray(values) || values.length < 2) {
    errors.push("sweep.values: at least two values");
    return arms;
  }
  const out: ArmSpec[] = [];
  for (const arm of arms) {
    if (param === "latencyMs" && REMOTE_BRAINS.includes(arm.brain)) {
      errors.push(`sweep: arm ${arm.id} is a remote model; its latency cannot be swept`);
      continue;
    }
    for (const v of values) {
      const checked =
        param === "latencyMs"
          ? intIn(v, ...LATENCY_RANGE, "sweep.values[]", errors)
          : intIn(v, ...CADENCE_RANGE, "sweep.values[]", errors);
      if (checked === undefined || param === undefined) continue;
      out.push({
        ...arm,
        id: `${arm.id}@${param === "latencyMs" ? "lat" : "cad"}${checked}`,
        [param]: checked,
      });
    }
  }
  return out;
}

export function parseExperiment(value: unknown): SpecResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["experiment: expected an object"] };
  for (const key of Object.keys(value)) {
    if (!KNOWN_TOP.has(key)) errors.push(`${key}: unknown field (misspelled?)`);
  }
  if (value["schema"] !== EXPERIMENT_SCHEMA)
    errors.push(`schema: must be "${EXPERIMENT_SCHEMA}"`);
  const id = value["id"];
  if (typeof id !== "string" || !ID.test(id))
    errors.push("id: lowercase id, e.g. cover-selection-v1");
  for (const key of ["question", "hypothesis"] as const) {
    const text = value[key];
    if (typeof text !== "string" || text.trim().length < 10) {
      errors.push(`${key}: required, stated before the run`);
    }
  }
  const independentVariable = oneOf(
    value["independentVariable"],
    INDEPENDENT_VARIABLES,
    "independentVariable",
    errors,
  );
  const decisionTypeId = value["decisionType"] ?? null;
  if (
    decisionTypeId !== null &&
    (typeof decisionTypeId !== "string" || !decisionType(decisionTypeId))
  ) {
    errors.push(`decisionType: unknown outcome contract ${String(decisionTypeId)}`);
  }
  const primary = value["primaryMetric"];
  const primaryDef = typeof primary === "string" ? metricDefinition(primary) : null;
  if (!primaryDef) {
    errors.push(
      `primaryMetric: required, and must be a registered metric (got ${String(primary)})`,
    );
  } else if (primaryDef.level === "decision" && decisionTypeId === null) {
    errors.push(
      `primaryMetric: ${primaryDef.id} is a decision metric; declare a decisionType`,
    );
  }
  const secondaryRaw = value["secondaryMetrics"] ?? [];
  const secondary: string[] = [];
  if (!Array.isArray(secondaryRaw)) errors.push("secondaryMetrics: expected an array");
  else {
    for (const metric of secondaryRaw) {
      const def = typeof metric === "string" ? metricDefinition(metric) : null;
      if (!def) errors.push(`secondaryMetrics: unknown metric ${String(metric)}`);
      else if (def.id === primary)
        errors.push("secondaryMetrics: must not repeat the primary metric");
      else if (def.level === "decision" && decisionTypeId === null) {
        errors.push(`secondaryMetrics: ${def.id} needs a decisionType`);
      } else secondary.push(def.id);
    }
  }
  // Whole seconds: the seat reads `?outcomeWindow=` as an integer and falls
  // back to 5 on anything else, so 2.5 here would run as 5 while every report
  // said 2.5.
  const window = value["outcomeWindowS"] ?? 5;
  if (
    typeof window !== "number" ||
    !Number.isInteger(window) ||
    !(window >= 1 && window <= 30)
  ) {
    errors.push(
      "outcomeWindowS: whole seconds in [1, 30] (the seat's ?outcomeWindow= takes an integer)",
    );
  }

  let seeds: number[] = [];
  let seedPreset: string | null = null;
  const seedsRaw = value["seeds"];
  if (Array.isArray(seedsRaw)) {
    if (seedsRaw.length === 0) errors.push("seeds: at least one");
    for (const seed of seedsRaw) {
      if (
        typeof seed !== "number" ||
        !Number.isInteger(seed) ||
        seed < 0 ||
        seed > 2 ** 31
      ) {
        errors.push(`seeds: ${String(seed)} is not a non-negative integer`);
      }
    }
    seeds = seedsRaw.filter((s): s is number => typeof s === "number");
    if (new Set(seeds).size !== seeds.length) errors.push("seeds: duplicates");
  } else if (isRecord(seedsRaw) && typeof seedsRaw["preset"] === "string") {
    const count = SEED_PRESETS[seedsRaw["preset"]];
    const base = seedsRaw["base"] ?? 42;
    if (count === undefined)
      errors.push(`seeds.preset: one of ${Object.keys(SEED_PRESETS).join(", ")}`);
    else if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
      errors.push("seeds.base: a non-negative integer");
    } else {
      seedPreset = seedsRaw["preset"];
      seeds = Array.from({ length: count }, (_, i) => base + i);
    }
  } else {
    errors.push('seeds: a list, or { "preset": "quick" | "dev" | "eval", "base": 42 }');
  }
  if (seeds.length > 500)
    errors.push("seeds: more than 500 is a job for a cluster, not this runner");

  const duration = value["duration"];
  if (typeof duration !== "number" || !(duration >= 10 && duration <= 1800)) {
    errors.push("duration: seconds of match time per episode, in [10, 1800]");
  }
  const mode = oneOf(
    value["mode"] ?? "tdm",
    ["tdm", "domination", "ffa", "hardpoint"] as const,
    "mode",
    errors,
  );
  const seat = oneOf(value["seat"], ["mercy", "even"] as const, "seat", errors, true);

  const armsRaw = value["arms"];
  let arms: ArmSpec[] = [];
  if (!Array.isArray(armsRaw) || armsRaw.length === 0) errors.push("arms: at least one");
  else {
    arms = armsRaw
      .map((arm, i) => parseArm(arm, `arms[${i}]`, errors))
      .filter((a): a is ArmSpec => a !== null);
  }
  if (seat) arms = arms.map((arm) => ({ seat, ...arm }));
  arms = expandSweep(value["sweep"], arms, errors);
  const ids = arms.map((a) => a.id);
  if (new Set(ids).size !== ids.length) errors.push("arms: duplicate ids");

  const controlsRaw = value["controls"] ?? [];
  const controls = Array.isArray(controlsRaw) ? controlsRaw.map(String) : [];
  for (const control of controls) {
    if (!ids.includes(control)) errors.push(`controls: ${control} is not an arm`);
  }
  const calibrationField = oneOf(
    value["calibrationField"] ?? "probability",
    ["probability", "confidence"] as const,
    "calibrationField",
    errors,
  );
  const factorsRaw = value["contributionFactors"] ?? [];
  const contributionFactors = Array.isArray(factorsRaw) ? factorsRaw.map(String) : [];
  for (const factor of contributionFactors) {
    if (!["brain", "control", "navigation", "motor", "policy"].includes(factor)) {
      errors.push(`contributionFactors: ${factor} is not an arm factor`);
    }
  }
  const notes = typeof value["notes"] === "string" ? value["notes"] : null;

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    spec: {
      schema: EXPERIMENT_SCHEMA,
      id: String(id),
      question: String(value["question"]),
      hypothesis: String(value["hypothesis"]),
      independentVariable: independentVariable!,
      primaryMetric: String(primary),
      secondaryMetrics: secondary,
      decisionType: decisionTypeId as string | null,
      outcomeWindowS: window as number,
      seeds,
      seedPreset,
      duration: duration as number,
      mode: mode!,
      arms,
      controls,
      calibrationField: calibrationField!,
      contributionFactors,
      notes,
    },
  };
}

/** Hash of the canonical definition, as parsed. Changes with any declared field. */
export function experimentHash(spec: ExperimentSpec): string {
  return canonicalHash(spec);
}

/** Environment flags each kind of arm needs before it may spend money. */
export const LIVE_FLAGS: Readonly<Record<string, string>> = {
  jev: "JEV_LIVE_TEST",
  glide: "FASTINO_LIVE_TEST",
  llm: "LLM_LIVE_TEST",
};

/**
 * Refuse arms that would call a paid API unless the operator said so. The
 * offline LLM test double needs no flag: it calls nothing outside the machine.
 */
export function liveGate(
  arms: readonly ArmSpec[],
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const errors: string[] = [];
  for (const arm of arms) {
    if (arm.brain === "llm" && arm.fakeLlm) continue;
    const flag = LIVE_FLAGS[arm.brain];
    if (flag && env[flag] !== "1") {
      errors.push(
        `arm ${arm.id} calls a paid ${arm.brain} API; set ${flag}=1 to confirm`,
      );
    }
  }
  return errors;
}

/** The `/play` query an arm runs under, excluding seed, mode and autoplay. */
export function armQuery(arm: ArmSpec): string {
  const parts: string[] = [`brain=${arm.brain}`, `jevControl=${arm.control}`];
  if (arm.policy) parts.push(`policy=${arm.policy}`);
  if (arm.navigation) parts.push(`jevNav=${arm.navigation}`);
  if (arm.latencyMs !== undefined) parts.push(`latency=${arm.latencyMs}`);
  if (arm.cadenceMs !== undefined) parts.push(`cadence=${arm.cadenceMs}`);
  if (arm.stale) parts.push(`stale=${arm.stale}`);
  if (arm.motor) parts.push(`motor=${arm.motor}`);
  if (arm.placeOrder) parts.push(`placeOrder=${arm.placeOrder}`);
  if (arm.targetOrder) parts.push(`targetOrder=${arm.targetOrder}`);
  if (arm.seat) parts.push(`seat=${arm.seat}`);
  if (arm.query) parts.push(arm.query);
  return parts.join("&");
}
