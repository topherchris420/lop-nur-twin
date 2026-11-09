/**
 * The ECHO Intelligence Metrology Bench's frozen protocol: what an experiment
 * asks, which controllers it compares, under which conditions, on which
 * research subjects, with which endpoints, minimum meaningful effects,
 * statistics and decision rules, all fixed before any held-out run.
 *
 * A protocol is plain JSON (`protocols/*.json`), hashed into every record and
 * archive. Changing a single byte changes its digest, and with it the held-out
 * seeds, which are derived from the digest: a protocol cannot be edited after
 * its held-out run without the archive saying so, and nobody chooses the
 * held-out seeds. Development seeds are listed explicitly and are looked at.
 *
 * Nothing here runs a fly; `runner.ts` does. Pure: no I/O.
 */
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import {
  PERTURBATION_SCHEMA,
  perturbationErrors,
  type PerturbationEpisode,
} from "../fly/perturbation.js";
import { CONTROLLER_IDS, type ControllerId } from "./controllers.js";

export const PROTOCOL_SCHEMA = "eimb-protocol/v1" as const;

/** Behavioural metrics a record carries, per research subject (one run). */
export const BEHAVIOUR_METRICS = [
  "meals",
  "fedJ",
  "lateFedJ",
  "spentJ",
  "netJ",
  "endReserve",
  "collisions",
  "walkingBlocks",
  "rejected",
  "walkedM",
  "flownM",
  "walkingShare",
  "restrictedLatencyS",
  "placementsMissed",
  "meanFoodDistanceM",
  "firstMealAfterOnsetS",
] as const;
export type BehaviourMetric = (typeof BEHAVIOUR_METRICS)[number];

/** Which way is better, for the metrics that have one. */
export const METRIC_DIRECTION: Readonly<
  Record<BehaviourMetric, "higher" | "lower" | "neutral">
> = {
  meals: "higher",
  fedJ: "higher",
  lateFedJ: "higher",
  spentJ: "neutral",
  netJ: "higher",
  endReserve: "higher",
  collisions: "lower",
  walkingBlocks: "lower",
  rejected: "lower",
  walkedM: "neutral",
  flownM: "neutral",
  walkingShare: "neutral",
  restrictedLatencyS: "lower",
  placementsMissed: "lower",
  meanFoodDistanceM: "lower",
  firstMealAfterOnsetS: "lower",
};

export const METRIC_UNITS: Readonly<Record<BehaviourMetric, string>> = {
  meals: "feeding bouts",
  fedJ: "J",
  lateFedJ: "J",
  spentJ: "J",
  netJ: "J",
  endReserve: "share of capacity",
  collisions: "count",
  walkingBlocks: "count",
  rejected: "count",
  walkedM: "m",
  flownM: "m",
  walkingShare: "share of ticks",
  restrictedLatencyS: "s",
  placementsMissed: "count",
  meanFoodDistanceM: "m",
  firstMealAfterOnsetS: "s",
};

export const VERDICTS = [
  "IMPROVEMENT",
  "NO_DEMONSTRATED_IMPROVEMENT",
  "REGRESSION",
  "INCONCLUSIVE",
  "INVALID",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface FoodSchedule {
  /** `moves`: the food goes to the next site every `everyS`; `steady`: it stays at the first. */
  kind: "moves" | "steady";
  everyS: number;
  /** `compass`: the yard's four sites (5.5 m out, beside the poles); `diagonal`: between them, 6.5 m out, away from every pole. */
  layout: "compass" | "diagonal";
}

export interface ConditionSpec {
  id: string;
  family: "unimpaired" | "motor" | "generalization";
  description: string;
  food: FoodSchedule;
  /** The reserve the fly starts with, as a share of capacity. */
  startReserve: number;
  /** The experimenter's perturbation episodes (perturbation.ts), seconds of fly time. */
  episodes: PerturbationEpisode[];
  /** True when the candidate's own development never met this condition. */
  novelToCandidate: boolean;
  /** Controllers run in this condition (validity controllers are added where `validity` says). */
  controllers: ControllerId[];
}

export interface ConfirmatoryEndpoint {
  id: string;
  metric: BehaviourMetric;
  condition: string;
  contrast: [ControllerId, ControllerId];
  /** The minimum meaningful effect, in the metric's unit, and the rule that set it. */
  mme: number;
  mmeRule: string;
}

export interface GuardrailEndpoint {
  metric: BehaviourMetric;
  condition: string;
  contrast: [ControllerId, ControllerId];
}

export interface FamilySpec {
  metric: BehaviourMetric;
  mme: number;
  contrasts: [ControllerId, ControllerId][];
  conditions: string[];
}

export interface Protocol {
  schema: typeof PROTOCOL_SCHEMA;
  id: string;
  title: string;
  question: string;
  hypotheses: string[];
  /** What was known before this protocol was frozen, so nobody mistakes it for a blind test of that. */
  priorKnowledge: string[];
  baseline: ControllerId;
  candidate: ControllerId;
  controls: ControllerId[];
  ablations: ControllerId[];
  validity: { identicalToBaseline: ControllerId[]; conditions: string[] };
  /** Simulated seconds per run, the trajectory block, and how often (ticks) the instrument samples. */
  durationS: number;
  blockS: number;
  sampleEveryTicks: number;
  /** From this time on, `lateFedJ` counts energy taken in. */
  lateFromS: number;
  experimentalUnit: string;
  conditions: ConditionSpec[];
  splits: {
    dev: { seeds: number[] };
    heldout: { count: number; salt: string };
  };
  /** Seeds no split may use (earlier studies' seeds), so a held-out subject is new. */
  reservedSeeds: number[];
  endpoints: {
    confirmatory: ConfirmatoryEndpoint[];
    guardrails: GuardrailEndpoint[];
    /** Where the effect holds: the confirmatory metric in every condition, corrected over conditions. */
    boundary: FamilySpec;
    /** Which part of the mechanism carries an effect: contrasts among the 2×2 of learning and acting. */
    mechanism: FamilySpec;
  };
  analysis: {
    estimator: string;
    interval: "percentile-bootstrap";
    resamples: number;
    seed: number;
    alpha: number;
    multiplicity: "bonferroni";
    guardrailAlpha: number;
  };
  decision: { maxFailedFraction: number; rules: string[] };
  stopping: string;
  limits: { maxWallSPerRun: number };
}

const TOP_KEYS = [
  "schema",
  "id",
  "title",
  "question",
  "hypotheses",
  "priorKnowledge",
  "baseline",
  "candidate",
  "controls",
  "ablations",
  "validity",
  "durationS",
  "blockS",
  "sampleEveryTicks",
  "lateFromS",
  "experimentalUnit",
  "conditions",
  "splits",
  "reservedSeeds",
  "endpoints",
  "analysis",
  "decision",
  "stopping",
  "limits",
];
const CONDITION_KEYS = [
  "id",
  "family",
  "description",
  "food",
  "startReserve",
  "episodes",
  "novelToCandidate",
  "controllers",
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isController = (v: unknown): v is ControllerId =>
  typeof v === "string" && (CONTROLLER_IDS as readonly string[]).includes(v);
const isMetric = (v: unknown): v is BehaviourMetric =>
  typeof v === "string" && (BEHAVIOUR_METRICS as readonly string[]).includes(v);

function unknownKeys(o: Record<string, unknown>, allowed: string[], at: string): string[] {
  return Object.keys(o)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${at}: unknown field ${k}`);
}

/** Why a value is not a runnable protocol; empty when it is. */
export function protocolErrors(p: unknown): string[] {
  if (!isObj(p)) return ["a protocol is an object"];
  const e: string[] = unknownKeys(p, TOP_KEYS, "protocol");
  for (const k of TOP_KEYS) if (!(k in p)) e.push(`protocol: missing ${k}`);
  if (e.length) return e;
  if (p.schema !== PROTOCOL_SCHEMA) e.push(`schema must be ${PROTOCOL_SCHEMA}`);
  if (!isStr(p.id) || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(p.id))
    e.push("id: lowercase letters, digits and dashes");
  for (const k of ["title", "question", "experimentalUnit", "stopping"] as const)
    if (!isStr(p[k])) e.push(`${k}: required text`);
  for (const k of ["hypotheses", "priorKnowledge"] as const)
    if (!Array.isArray(p[k]) || !(p[k] as unknown[]).every(isStr))
      e.push(`${k}: a list of text`);
  if (!isController(p.baseline)) e.push("baseline: unknown controller");
  if (!isController(p.candidate)) e.push("candidate: unknown controller");
  if (p.baseline === p.candidate) e.push("candidate and baseline must differ");
  for (const k of ["controls", "ablations"] as const)
    if (!Array.isArray(p[k]) || !(p[k] as unknown[]).every(isController))
      e.push(`${k}: a list of known controllers`);
  for (const k of ["durationS", "blockS", "lateFromS"] as const)
    if (!isNum(p[k]) || (p[k] as number) <= 0) e.push(`${k}: a positive number`);
  if (isNum(p.durationS) && isNum(p.blockS) && p.durationS % p.blockS !== 0)
    e.push("durationS must be a whole number of blocks");
  if (isNum(p.durationS) && isNum(p.lateFromS) && p.lateFromS >= p.durationS)
    e.push("lateFromS must fall inside the run");
  if (!isInt(p.sampleEveryTicks) || (p.sampleEveryTicks as number) < 1)
    e.push("sampleEveryTicks: a positive integer");

  const ids = new Set<string>();
  if (!Array.isArray(p.conditions) || p.conditions.length === 0)
    e.push("conditions: at least one");
  else
    p.conditions.forEach((c, i) => {
      const at = `condition ${i}`;
      if (!isObj(c)) return void e.push(`${at}: an object`);
      e.push(...unknownKeys(c, CONDITION_KEYS, at));
      for (const k of CONDITION_KEYS) if (!(k in c)) e.push(`${at}: missing ${k}`);
      if (!isStr(c.id) || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(c.id))
        e.push(`${at}: id lowercase letters, digits and dashes`);
      else if (ids.has(c.id)) e.push(`${at}: duplicate id ${c.id}`);
      else ids.add(c.id);
      if (!["unimpaired", "motor", "generalization"].includes(c.family as string))
        e.push(`${at}: unknown family`);
      if (!isStr(c.description)) e.push(`${at}: description required`);
      const f = c.food;
      if (
        !isObj(f) ||
        !["moves", "steady"].includes(f.kind as string) ||
        !["compass", "diagonal"].includes(f.layout as string) ||
        !isNum(f.everyS) ||
        (f.everyS as number) <= 0 ||
        Object.keys(f).some((k) => !["kind", "everyS", "layout"].includes(k))
      )
        e.push(`${at}: food is {kind: moves|steady, everyS > 0, layout: compass|diagonal}`);
      if (!isNum(c.startReserve) || c.startReserve <= 0 || c.startReserve > 1)
        e.push(`${at}: startReserve in (0, 1]`);
      if (!Array.isArray(c.episodes)) e.push(`${at}: episodes is a list`);
      else if (c.episodes.length)
        for (const err of perturbationErrors({
          schema: PERTURBATION_SCHEMA,
          episodes: c.episodes as PerturbationEpisode[],
        }))
          e.push(`${at}: ${err}`);
      if (typeof c.novelToCandidate !== "boolean")
        e.push(`${at}: novelToCandidate is true or false`);
      if (
        !Array.isArray(c.controllers) ||
        !c.controllers.every(isController) ||
        new Set(c.controllers).size !== c.controllers.length
      )
        e.push(`${at}: controllers is a list of distinct known controllers`);
      else if (
        !(c.controllers as unknown[]).includes(p.baseline) ||
        !(c.controllers as unknown[]).includes(p.candidate)
      )
        e.push(`${at}: every condition runs the baseline and the candidate`);
    });

  const v = p.validity;
  if (
    !isObj(v) ||
    !Array.isArray(v.identicalToBaseline) ||
    !v.identicalToBaseline.every(isController) ||
    !Array.isArray(v.conditions) ||
    !v.conditions.every((c) => typeof c === "string" && ids.has(c))
  )
    e.push("validity: {identicalToBaseline: controllers, conditions: known condition ids}");

  const s = p.splits;
  if (
    !isObj(s) ||
    !isObj(s.dev) ||
    !Array.isArray(s.dev.seeds) ||
    !s.dev.seeds.every((x) => isInt(x) && x >= 0) ||
    new Set(s.dev.seeds).size !== s.dev.seeds.length ||
    !isObj(s.heldout) ||
    !isInt(s.heldout.count) ||
    (s.heldout.count as number) < 2 ||
    !isStr(s.heldout.salt)
  )
    e.push("splits: {dev: {seeds: distinct integers}, heldout: {count ≥ 2, salt}}");
  if (!Array.isArray(p.reservedSeeds) || !p.reservedSeeds.every(isInt))
    e.push("reservedSeeds: a list of integers");
  else if (isObj(s) && isObj(s.dev) && Array.isArray(s.dev.seeds))
    for (const x of s.dev.seeds)
      if ((p.reservedSeeds as number[]).includes(x as number))
        e.push(`dev seed ${String(x)} is reserved`);

  const ep = p.endpoints;
  if (!isObj(ep)) e.push("endpoints: an object");
  else {
    const condOk = (c: unknown) => typeof c === "string" && ids.has(c);
    const pairOk = (x: unknown) =>
      Array.isArray(x) && x.length === 2 && isController(x[0]) && isController(x[1]);
    if (!Array.isArray(ep.confirmatory) || ep.confirmatory.length === 0)
      e.push("endpoints.confirmatory: at least one");
    else
      ep.confirmatory.forEach((c, i) => {
        if (
          !isObj(c) ||
          !isStr(c.id) ||
          !isMetric(c.metric) ||
          METRIC_DIRECTION[c.metric] === "neutral" ||
          !condOk(c.condition) ||
          !pairOk(c.contrast) ||
          !isNum(c.mme) ||
          (c.mme as number) <= 0 ||
          !isStr(c.mmeRule)
        )
          e.push(
            `endpoints.confirmatory ${i}: {id, metric with a direction, condition, contrast, mme > 0, mmeRule}`,
          );
      });
    if (!Array.isArray(ep.guardrails)) e.push("endpoints.guardrails: a list");
    else
      ep.guardrails.forEach((g, i) => {
        if (
          !isObj(g) ||
          !isMetric(g.metric) ||
          METRIC_DIRECTION[g.metric] === "neutral" ||
          !condOk(g.condition) ||
          !pairOk(g.contrast)
        )
          e.push(`endpoints.guardrails ${i}: {metric with a direction, condition, contrast}`);
      });
    for (const k of ["boundary", "mechanism"] as const) {
      const f = ep[k];
      if (
        !isObj(f) ||
        !isMetric(f.metric) ||
        METRIC_DIRECTION[f.metric] === "neutral" ||
        !isNum(f.mme) ||
        (f.mme as number) <= 0 ||
        !Array.isArray(f.contrasts) ||
        f.contrasts.length === 0 ||
        !f.contrasts.every(pairOk) ||
        !Array.isArray(f.conditions) ||
        f.conditions.length === 0 ||
        !f.conditions.every(condOk)
      )
        e.push(`endpoints.${k}: {metric with a direction, mme > 0, contrasts, conditions}`);
    }
  }

  const a = p.analysis;
  if (
    !isObj(a) ||
    !isStr(a.estimator) ||
    a.interval !== "percentile-bootstrap" ||
    !isInt(a.resamples) ||
    (a.resamples as number) < 1000 ||
    !isInt(a.seed) ||
    !isNum(a.alpha) ||
    (a.alpha as number) <= 0 ||
    (a.alpha as number) >= 0.5 ||
    a.multiplicity !== "bonferroni" ||
    !isNum(a.guardrailAlpha) ||
    (a.guardrailAlpha as number) <= 0 ||
    (a.guardrailAlpha as number) >= 0.5
  )
    e.push(
      "analysis: {estimator, interval: percentile-bootstrap, resamples ≥ 1000, seed, alpha, multiplicity: bonferroni, guardrailAlpha}",
    );
  const d = p.decision;
  if (
    !isObj(d) ||
    !isNum(d.maxFailedFraction) ||
    (d.maxFailedFraction as number) < 0 ||
    (d.maxFailedFraction as number) >= 1 ||
    !Array.isArray(d.rules) ||
    !d.rules.every(isStr)
  )
    e.push("decision: {maxFailedFraction in [0, 1), rules}");
  const l = p.limits;
  if (!isObj(l) || !isNum(l.maxWallSPerRun) || (l.maxWallSPerRun as number) <= 0)
    e.push("limits: {maxWallSPerRun > 0}");
  return e;
}

/** A checked protocol; throws with every reason it cannot run. */
export function parseProtocol(p: unknown): Protocol {
  const errors = protocolErrors(p);
  if (errors.length) throw new Error(`protocol refused: ${errors.join("; ")}`);
  return p as Protocol;
}

/** The protocol's identity: SHA-256 of its canonical JSON. */
export const protocolDigest = (p: Protocol): string => sha256(canonicalJson(p));

const SEED_FLOOR = 100_000;
const SEED_SPAN = 2 ** 31 - SEED_FLOOR;

/**
 * Held-out seeds, derived from the protocol's digest and its salt: nobody picks
 * them, and they change if any byte of the protocol does. Skips dev and reserved
 * seeds and repeats, deterministically.
 */
export function heldoutSeeds(p: Protocol): number[] {
  const digest = protocolDigest(p);
  const taken = new Set([...p.splits.dev.seeds, ...p.reservedSeeds]);
  const out: number[] = [];
  for (let i = 0; out.length < p.splits.heldout.count; i++) {
    const h = sha256(`${digest}:${p.splits.heldout.salt}:${i}`);
    const seed = SEED_FLOOR + (parseInt(h.slice(0, 8), 16) % SEED_SPAN);
    if (taken.has(seed)) continue;
    taken.add(seed);
    out.push(seed);
  }
  return out;
}

export type Split = "dev" | "heldout";

export const seedsOf = (p: Protocol, split: Split): number[] =>
  split === "dev" ? [...p.splits.dev.seeds] : heldoutSeeds(p);

export interface Unit {
  seed: number;
  condition: string;
  controller: ControllerId;
}

/** Controllers that run in one condition: its own, then the validity controllers where validity applies. */
export function controllersIn(p: Protocol, condition: ConditionSpec): ControllerId[] {
  const out = [...condition.controllers];
  if (p.validity.conditions.includes(condition.id))
    for (const c of p.validity.identicalToBaseline) if (!out.includes(c)) out.push(c);
  return out;
}

/** Every run a split takes, in a fixed order. */
export function unitsOf(p: Protocol, split: Split): Unit[] {
  const units: Unit[] = [];
  for (const seed of seedsOf(p, split))
    for (const condition of p.conditions)
      for (const controller of controllersIn(p, condition))
        units.push({ seed, condition: condition.id, controller });
  return units;
}

export const unitKey = (u: Unit): string =>
  `${u.condition}|${String(u.seed).padStart(10, "0")}|${u.controller}`;

export function conditionOf(p: Protocol, id: string): ConditionSpec {
  const c = p.conditions.find((x) => x.id === id);
  if (!c) throw new Error(`unknown condition ${id}`);
  return c;
}
