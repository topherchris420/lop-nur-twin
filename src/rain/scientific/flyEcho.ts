/**
 * Project ECHO's experiment rig for the digital-fly backend: the conditions,
 * the hidden perturbation schedules, the arenas with temporary obstacles, a
 * trial runner, and the host's measurements of what the fly did against what
 * it intended and what it concluded against what was done to it.
 *
 * The rule the rig exists to keep: the experimenter knows the cause and the
 * fly does not. Schedules are drawn here from a seed and applied by the body
 * and the self-motion sense (perturbation.ts); the fly's controller is built
 * without them and never reads them. Scoring compares the fly's own
 * conclusions, which it reports as events, with the schedule afterwards.
 *
 * Two condition sets, never mixed: `development`, on which the self-model was
 * built and tuned, and `evaluation`, held out from that work (other strengths
 * in bands around the development values, combinations of causes, temporary
 * obstacles and a misleading sense, in an arena the development runs never
 * used). Registered experiments run the evaluation set only.
 *
 * Every measurement here is a simulated observation of a reduced-order model.
 * It characterizes the simulator and is never evidence about Drosophila, about
 * awareness or about subjective experience.
 */
import { mulberry32 } from "../../lib/noise.js";
import { arenaWorld, type ArenaSpec } from "../../bethesda/fly/arena.js";
import { EchoAdapter } from "../../bethesda/fly/echo/adapter.js";
import { serializeEchoCheckpoint } from "../../bethesda/fly/echo/checkpoint.js";
import { X } from "../../bethesda/fly/echo/forward.js";
import type { EchoEvent } from "../../bethesda/fly/echo/selfModel.js";
import { DigitalFly } from "../../bethesda/fly/fly.js";
import type { MotorCommand, Mode } from "../../bethesda/fly/neural.js";
import {
  PERTURBATION_SCHEMA,
  type PerturbationEpisode,
} from "../../bethesda/fly/perturbation.js";
import { forward, type V3, wrapAngle } from "../../bethesda/fly/units.js";
import type {
  FlyArm,
  FlyBlockSpec,
  FlyRun,
  FlyEchoApparatus,
  FlyEchoArm,
  FlyEchoCause,
  FlyEchoCondition,
  FlyEchoEffect,
  FlyEchoEffectField,
} from "./contracts.js";
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

// --------------------------------------------------------------- conditions

export type EchoCause = FlyEchoCause;
export type EchoEffectField = FlyEchoEffectField;
export type EchoEffect = FlyEchoEffect;
export type EchoCondition = FlyEchoCondition;

const e = (
  field: EchoEffectField,
  bands: [number, number][],
  signed = false,
): EchoEffect => ({
  field,
  bands,
  signed,
});
const cond = (id: string, cause: EchoCause, ...effects: EchoEffect[]): EchoCondition => ({
  id,
  cause,
  effects,
});

/**
 * The development conditions: one strength each, on which the self-model was
 * built and its constants chosen. Never in a registered experiment.
 */
export const ECHO_DEVELOPMENT_CONDITIONS = {
  speed_gain: cond("speed_gain", "self", e("speedGain", [[0.55, 0.55]])),
  turn_gain: cond("turn_gain", "self", e("turnGain", [[0.6, 0.6]])),
  turn_bias: cond("turn_bias", "self", e("turnBias", [[0.8, 0.8]], true)),
  push: cond("push", "external", e("drift", [[0.009, 0.009]], true)),
  spin: cond("spin", "external", e("spin", [[0.6, 0.6]], true)),
  sensor_noise: cond("sensor_noise", "sensor", e("flowNoise", [[4, 4]])),
} as const satisfies Record<string, EchoCondition>;

/**
 * The evaluation conditions, held out from development: strengths in bands on
 * either side of the development values, causes combined, a temporary
 * obstacle, and a sense that reads a motion that is not there.
 */
export const ECHO_EVALUATION_CONDITIONS = {
  speed_gain: cond(
    "speed_gain",
    "self",
    e("speedGain", [
      [0.35, 0.45],
      [0.65, 0.75],
    ]),
  ),
  turn_gain: cond(
    "turn_gain",
    "self",
    e("turnGain", [
      [0.35, 0.5],
      [0.7, 0.8],
    ]),
  ),
  turn_bias: cond(
    "turn_bias",
    "self",
    e(
      "turnBias",
      [
        [0.4, 0.6],
        [1.0, 1.4],
      ],
      true,
    ),
  ),
  speed_and_turn_gain: cond(
    "speed_and_turn_gain",
    "self",
    e("speedGain", [[0.45, 0.7]]),
    e("turnGain", [[0.5, 0.8]]),
  ),
  speed_gain_and_turn_bias: cond(
    "speed_gain_and_turn_bias",
    "self",
    e("speedGain", [[0.45, 0.7]]),
    e("turnBias", [[0.5, 1.2]], true),
  ),
  push: cond(
    "push",
    "external",
    e(
      "drift",
      [
        [0.005, 0.007],
        [0.011, 0.014],
      ],
      true,
    ),
  ),
  spin: cond(
    "spin",
    "external",
    e(
      "spin",
      [
        [0.3, 0.45],
        [0.75, 1.0],
      ],
      true,
    ),
  ),
  sensor_noise: cond(
    "sensor_noise",
    "sensor",
    e("flowNoise", [
      [2.5, 3.5],
      [5, 7],
    ]),
  ),
  speed_gain_and_push: cond(
    "speed_gain_and_push",
    "self+external",
    e("speedGain", [[0.45, 0.7]]),
    e("drift", [[0.006, 0.012]], true),
  ),
  obstacle: cond("obstacle", "environment", e("obstacle", [[1, 1]])),
  misleading_sense: cond(
    "misleading_sense",
    "sensor",
    e("flowBias", [[0.005, 0.01]], true),
  ),
} as const satisfies Record<string, EchoCondition>;

export type EchoConditionSet = "development" | "evaluation";
const SETS = {
  development: ECHO_DEVELOPMENT_CONDITIONS as Record<string, EchoCondition>,
  evaluation: ECHO_EVALUATION_CONDITIONS as Record<string, EchoCondition>,
};
export const echoCondition = (set: EchoConditionSet, id: string): EchoCondition => {
  const c = SETS[set][id];
  if (!c) throw new Error(`no ${set} condition ${id}`);
  return c;
};

// ---------------------------------------------------------------- apparatus

export const ECHO_SCHEDULES = ["impairment", "attribution", "retention"] as const;
export type EchoSchedule = (typeof ECHO_SCHEDULES)[number];

export type EchoApparatus = FlyEchoApparatus;
export type EchoArmSpec = FlyEchoArm;

// -------------------------------------------------------------- the schedule

/** One applied change, as the experimenter knows it. */
export interface EchoTruth {
  condition: string;
  cause: EchoCause;
  from: number;
  until: number | null;
  /** The drawn values, by effect. */
  values: Record<string, number | [number, number]>;
}

const band = (r: () => number, bands: readonly [number, number][]) => {
  const total = bands.reduce((s, [lo, hi]) => s + (hi - lo), 0);
  if (total <= 0) return bands[0]![0];
  let u = r() * total;
  for (const [lo, hi] of bands) {
    if (u <= hi - lo) return lo + u;
    u -= hi - lo;
  }
  return bands[bands.length - 1]![1];
};
const between = (r: () => number, [lo, hi]: readonly [number, number]) =>
  lo + (hi - lo) * r();

/** Draw a condition's values. Every draw is made whatever the condition, so the stream stays aligned. */
function drawValues(c: EchoCondition, r: () => number): EchoTruth["values"] {
  const out: EchoTruth["values"] = {};
  for (const fx of c.effects) {
    const m = band(r, fx.bands);
    const sign = r() < 0.5 ? -1 : 1;
    const dir = r() * 2 * Math.PI;
    if (fx.field === "drift" || fx.field === "flowBias")
      out[fx.field] = [m * Math.cos(dir), m * Math.sin(dir)];
    else out[fx.field] = fx.signed ? sign * m : m;
  }
  return out;
}

function episodeOf(t: EchoTruth, index: number): PerturbationEpisode | null {
  const v = t.values;
  const ep: PerturbationEpisode = {
    id: `${t.condition}-${index}`,
    cause:
      t.cause === "self" || t.cause === "self+external"
        ? "self"
        : t.cause === "sensor"
          ? "sensor"
          : "external",
    from: t.from,
    until: t.until,
  };
  if (typeof v.speedGain === "number") ep.speedGain = v.speedGain;
  if (typeof v.turnGain === "number") ep.turnGain = v.turnGain;
  if (typeof v.turnBias === "number") ep.turnBias = v.turnBias;
  if (Array.isArray(v.drift)) ep.drift = v.drift;
  if (typeof v.spin === "number") ep.spin = v.spin;
  if (typeof v.flowNoise === "number") ep.flowNoise = v.flowNoise;
  if (Array.isArray(v.flowBias)) ep.flowBias = v.flowBias;
  const any = Object.keys(ep).length > 4;
  return any ? ep : null;
}

const pick = <T>(r: () => number, xs: readonly T[]): T =>
  xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;

/** The hidden schedule for one seed: what is done to the fly, and when. */
export function drawEchoSchedule(
  apparatus: EchoApparatus,
  durationS: number,
  r: () => number,
): EchoTruth[] {
  const cs = apparatus.condition_set;
  const truth = (c: EchoCondition, from: number, until: number | null): EchoTruth => ({
    condition: c.id,
    cause: c.cause,
    from,
    until,
    values: drawValues(c, r),
  });
  switch (apparatus.schedule) {
    case "impairment": {
      const onset = between(r, apparatus.onset_s);
      return [truth(pick(r, cs), Math.round(onset * 20) / 20, null)];
    }
    case "attribution": {
      const out: EchoTruth[] = [];
      apparatus.onsets_s.forEach((at, i) => {
        const from = Math.round((at + (r() * 2 - 1) * apparatus.jitter_s) * 20) / 20;
        const len = between(r, apparatus.episode_s);
        const last = i === apparatus.onsets_s.length - 1;
        const lasting = last && r() < apparatus.persistent_last;
        const until = lasting ? null : Math.round((from + len) * 20) / 20;
        const t = truth(pick(r, cs), from, until);
        // Drawn whatever the run's length, so a shorter run sees the same schedule's start.
        if (from < durationS)
          out.push(t.until !== null && t.until >= durationS ? { ...t, until: null } : t);
      });
      return out;
    }
    case "retention": {
      // A, then B (another self-change), then A again (the same values, within 5%), then C, an unfamiliar combination.
      const p = apparatus.phases_s;
      const selfs = cs.filter((c) => c.cause === "self");
      const singles = selfs.filter((c) => c.effects.length === 1);
      const combos = selfs.filter((c) => c.effects.length > 1);
      const a = pick(r, singles);
      const b = pick(
        r,
        singles.filter((c) => c.id !== a.id),
      );
      const c = pick(r, combos.length ? combos : singles);
      const A = truth(a, p[0]!, p[1]!);
      const B = truth(b, p[2]!, p[3]!);
      const again: EchoTruth = {
        condition: a.id,
        cause: a.cause,
        from: p[4]!,
        until: p[5]!,
        values: Object.fromEntries(
          Object.entries(A.values).map(([k, v]) => {
            const k5 = 1 + (r() * 2 - 1) * 0.05;
            return [k, Array.isArray(v) ? [v[0] * k5, v[1] * k5] : v * k5];
          }),
        ),
      };
      const C = truth(c, p[6]!, null);
      return [A, B, again, C];
    }
  }
}

// ------------------------------------------------------------------- worlds

/**
 * The arena, with temporary obstacles that appear and vanish on the schedule:
 * the host sets the time before each step and places each obstacle, at its
 * onset, across the fly's path. Solid and seen while present, absent before
 * and after.
 */
export class ObstacleWorld implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: FlyWorld["inputs"];
  private base: PrimitiveWorld;
  private now: PrimitiveWorld;
  private spec: ArenaSpec;
  constructor(spec: ArenaSpec, id: string) {
    this.spec = spec;
    this.base = arenaWorld(spec, id);
    this.now = this.base;
    this.id = this.base.id;
    this.home = this.base.home;
    this.inputs = this.base.inputs;
  }
  /** An obstacle appears: a box `half` (m) wide and deep, from the floor up, centred at (x, z). */
  place(x: number, z: number, half: [number, number, number]): void {
    this.now = arenaWorld(
      {
        ...this.spec,
        platforms: [
          ...(this.spec.platforms ?? []),
          { center: [x, half[1], z], half: [...half] },
        ],
      },
      this.base.id,
    );
  }
  clear(): void {
    this.now = this.base;
  }
  get obstructed(): boolean {
    return this.now !== this.base;
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.now.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.now.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.now.solid(p);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.now.movers(near, radius, out, t);
  }
  light(p: V3): LightSample {
    return this.now.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.now.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.now.foodAt(p);
  }
  odour(p: V3): number {
    return this.now.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.now.landmarks(near, radius, out);
  }
}

// -------------------------------------------------------------------- trials

/** One decision as the host saw it: the true body, and what the fly intended and commanded. */
export interface EchoDecisionLog {
  t: number;
  p: V3;
  yaw: number;
  mode: Mode;
  edge: boolean;
  intention: MotorCommand;
  command: MotorCommand;
}

export interface EchoTrialSpec {
  arena: ArenaSpec;
  arenaId: string;
  startHalfWidth: number;
  config: Record<string, number>;
  durationS: number;
  truth: EchoTruth[];
  arm: EchoArmSpec;
  seed: number;
  geometry: () => number;
  /**
   * Checkpoint recovery: at this time (on the host's tick), serialize the
   * self-model's checkpoint, parse it and restore it into the same running
   * fly. Absent: never.
   */
  checkpointAt?: number;
}

export interface EchoTrial {
  fly: DigitalFly;
  adapter: EchoAdapter;
  decisions: EchoDecisionLog[];
  events: EchoEvent[];
  truth: EchoTruth[];
  /** The fly's belief vector at the end (null without a self-model). */
  finalBelief: number[] | null;
}

/** The host's tick: one decision period, so obstacles and resets fall between decisions. */
export const ECHO_TICK_S = 0.05;
const OBSTACLE_HALF: [number, number, number] = [0.03, 0.025, 0.015];

/** Run one trial: place the fly, apply the hidden schedule, and log what it did. */
export function runEchoTrial(spec: EchoTrialSpec): EchoTrial {
  const world = new ObstacleWorld(spec.arena, spec.arenaId);
  const w = spec.startHalfWidth;
  const x = (spec.geometry() * 2 - 1) * w,
    z = (spec.geometry() * 2 - 1) * w,
    yaw = (spec.geometry() * 2 - 1) * Math.PI;
  const episodes = spec.truth
    .map((t, i) => episodeOf(t, i))
    .filter((ep): ep is PerturbationEpisode => ep !== null);
  const obstacles = spec.truth.filter((t) => t.values.obstacle !== undefined);
  const decisions: EchoDecisionLog[] = [];
  const events: EchoEvent[] = [];
  let fly: DigitalFly | null = null;
  const adapter = (rng: () => number, streams: { navigation: () => number }) =>
    new EchoAdapter(rng, streams, {
      variant: spec.arm.variant,
      seed: spec.seed,
      onEvent: (ev) => events.push({ ...ev }),
      onDecision: (d) => {
        const s = fly!.state;
        decisions.push({
          t: d.t,
          p: [s.p[0], s.p[1], s.p[2]],
          yaw: s.yaw,
          mode: s.mode,
          edge: s.edge,
          intention: d.intention,
          command: d.command,
        });
      },
    });
  fly = new DigitalFly({
    seed: spec.seed,
    world,
    start: { p: [x, 0.5, z], yaw },
    config: spec.config,
    adapter,
    ...(episodes.length
      ? { perturbation: { schema: PERTURBATION_SCHEMA, episodes } }
      : {}),
    logSize: 16,
  });
  const echo = fly.adapter as EchoAdapter;
  const ticks = Math.round(spec.durationS / ECHO_TICK_S);
  let reset = false;
  for (let i = 0; i < ticks; i++) {
    const t = i * ECHO_TICK_S;
    for (const o of obstacles) {
      if (Math.abs(t - o.from) < 1e-9) {
        // Across the fly's path, 2 cm ahead of where it faces.
        const f = forward(fly.state.yaw);
        const p = fly.state.p;
        world.place(p[0] + f[0] * 0.035, p[2] + f[2] * 0.035, OBSTACLE_HALF);
        if (fly.world.solid(p)) world.clear();
      }
      if (o.until !== null && Math.abs(t - o.until) < 1e-9) world.clear();
    }
    if (spec.checkpointAt !== undefined && Math.abs(t - spec.checkpointAt) < 1e-9) {
      const errors = echo.restore(serializeEchoCheckpoint(echo.checkpoint()!));
      if (errors.length) throw new Error(`checkpoint refused: ${errors.join("; ")}`);
    }
    if (!reset && spec.arm.reset_s !== null && t >= spec.arm.reset_s - 1e-9) {
      echo.reset();
      reset = true;
    }
    fly.advance(ECHO_TICK_S);
  }
  const s = fly.state;
  if (![...s.p, ...s.v, s.yaw, s.t].every(Number.isFinite))
    throw new Error("the fly's state became non-finite");
  return {
    fly,
    adapter: echo,
    decisions,
    events,
    truth: spec.truth,
    finalBelief: echo.model ? echo.model.state.belief.x.slice() : null,
  };
}

// ---------------------------------------------------------------- measuring

export interface PathWindow {
  t0: number;
  t1: number;
  /** Distance from the intended end point, over the intended path length. */
  error: number;
  intendedM: number;
}

/**
 * The path error of steady walking: over consecutive windows of `windowS`,
 * where the fly walked throughout, intended to walk throughout and met no
 * edge, the distance between where it ended and where an unimpaired body
 * following its intentions from the same start would have ended, over the
 * length of that intended path. 0 is perfect.
 */
export function pathWindows(
  decisions: readonly EchoDecisionLog[],
  windowS: number,
  stepS: number,
  tauS: number,
): PathWindow[] {
  const per = Math.max(1, Math.round(windowS / ECHO_TICK_S));
  const out: PathWindow[] = [];
  const a = tauS > 0 ? Math.exp(-stepS / tauS) : 0;
  const steps = Math.max(1, Math.round(ECHO_TICK_S / stepS));
  for (let i = 0; i + per < decisions.length; i += per) {
    let ok = true;
    for (let j = i; j <= i + per && ok; j++) {
      const d = decisions[j]!;
      if (d.mode !== "walk" || d.edge) ok = false;
      if (
        j < i + per &&
        (d.intention.mode !== "walk" || !((d.intention.walkSpeed ?? 0) > 0.05))
      )
        ok = false;
    }
    if (!ok) continue;
    const start = decisions[i]!;
    let px = start.p[0],
      pz = start.p[2],
      yaw = start.yaw,
      v = (start.intention.walkSpeed ?? 0) / 100,
      length = 0;
    for (let j = i; j < i + per; j++) {
      const it = decisions[j]!.intention;
      const c = (it.walkSpeed ?? 0) / 100,
        r = it.yawRate ?? 0;
      for (let k = 0; k < steps; k++) {
        v = c + (v - c) * a;
        yaw = wrapAngle(yaw + r * stepS);
        const f = forward(yaw);
        px += f[0] * v * stepS;
        pz += f[2] * v * stepS;
        length += v * stepS;
      }
    }
    if (length < 0.002) continue;
    const end = decisions[i + per]!;
    out.push({
      t0: start.t,
      t1: end.t,
      error: Math.hypot(end.p[0] - px, end.p[2] - pz) / length,
      intendedM: length,
    });
  }
  return out;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const finite = (x: number | null): number | null =>
  x !== null && Number.isFinite(x) ? x : null;
const windowsIn = (ws: readonly PathWindow[], from: number, to: number) =>
  ws.filter((w) => w.t0 >= from - 1e-9 && w.t1 <= to + 1e-9).map((w) => w.error);

/** The fly's explanation as the experimenter's cause. */
const causeOf = (explanation: string | undefined): EchoCause | "none" =>
  explanation === "self"
    ? "self"
    : explanation === "external"
      ? "external"
      : explanation === "both"
        ? "self+external"
        : explanation === "sensor"
          ? "sensor"
          : "none";

/** The first conclusion of an inquiry the fly opened within `[from, from + 6 s]`, with its noticing. */
function answerTo(
  events: readonly EchoEvent[],
  from: number,
): { noticed: EchoEvent; concluded: EchoEvent | null } | null {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.kind !== "noticed" || ev.t < from - 1e-9 || ev.t > from + 6) continue;
    const concluded = events.slice(i + 1).find((x) => x.kind === "concluded") ?? null;
    return { noticed: ev, concluded };
  }
  return null;
}

export interface ScoredChange {
  condition: string;
  cause: EchoCause;
  /** "onset" or "offset" of the change. */
  edge: "onset" | "offset";
  at: number;
  answered: EchoCause | "none" | "missed";
  probability: number | null;
  correct: boolean;
  latencyS: number | null;
}

/**
 * Every change the fly could notice, scored against its conclusion: each
 * onset, and the end of each change to its body or its surroundings (a sense
 * that becomes reliable again is followed by a gradual return of trust, not
 * an inquiry). An obstacle is answered correctly by any conclusion that does
 * not blame the fly's own body.
 */
export function scoreChanges(
  truth: readonly EchoTruth[],
  events: readonly EchoEvent[],
): ScoredChange[] {
  const out: ScoredChange[] = [];
  const score = (t: EchoTruth, edge: "onset" | "offset", at: number) => {
    const a = answerTo(events, at);
    const answered = a
      ? a.concluded
        ? causeOf(a.concluded.explanation)
        : "none"
      : "missed";
    const blamesSelf = answered === "self" || answered === "self+external";
    const correct = t.cause === "environment" ? !blamesSelf : answered === t.cause;
    out.push({
      condition: t.condition,
      cause: t.cause,
      edge,
      at,
      answered: a ? answered : "missed",
      probability: a?.concluded?.probability ?? null,
      correct,
      latencyS: a?.concluded ? a.concluded.t - at : null,
    });
  };
  for (const t of truth) {
    score(t, "onset", t.from);
    if (
      t.until !== null &&
      (t.cause === "self" || t.cause === "external" || t.cause === "self+external")
    )
      score(t, "offset", t.until);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** How far the fly's final beliefs are from the truth of a lasting self-change, relatively; null without beliefs. */
export function identificationError(
  belief: readonly number[] | null,
  t: EchoTruth,
): number | null {
  if (!belief) return null;
  const errs: number[] = [];
  const v = t.values;
  if (typeof v.speedGain === "number")
    errs.push(Math.abs(belief[X.legGain]! - v.speedGain) / v.speedGain);
  if (typeof v.turnGain === "number")
    errs.push(Math.abs(belief[X.legTurnGain]! - v.turnGain) / v.turnGain);
  if (typeof v.turnBias === "number")
    errs.push(Math.abs(belief[X.legTurnBias]! - v.turnBias) / Math.abs(v.turnBias));
  return mean(errs);
}

export interface EchoImpairmentMetrics {
  impaired_path_error: number | null;
  late_path_error: number | null;
  baseline_path_error: number | null;
  detection_latency_s: number | null;
  attribution_latency_s: number | null;
  identification_error: number | null;
  false_alarms_per_min: number | null;
  impaired_walked_m: number | null;
  coverage_90: number | null;
}

/** The rig's own coverage measure: the share of observed components inside the fly's predicted 90% interval. */
function coverage(trial: EchoTrial): number | null {
  const c = trial.adapter.model?.state.calibration;
  if (!c || c.n === 0) return null;
  return c.in90.reduce((s, x) => s + x, 0) / (3 * c.n);
}

export function impairmentMetrics(
  trial: EchoTrial,
  a: EchoApparatus,
  durationS: number,
): EchoImpairmentMetrics {
  const onset = trial.truth[0]!.from;
  const P = trial.fly.params;
  const ws = pathWindows(
    trial.decisions,
    a.window_s,
    P.physicsStepMs / 1000,
    P.walkSpeedTauS,
  );
  const noticed = trial.events.find((ev) => ev.kind === "noticed" && ev.t >= onset);
  const blamed = trial.events.find(
    (ev) =>
      ev.kind === "concluded" &&
      ev.t >= onset &&
      (ev.explanation === "self" || ev.explanation === "both"),
  );
  const early = trial.events.filter(
    (ev) => ev.kind === "concluded" && ev.t < onset && ev.explanation !== "none",
  ).length;
  const walked = (() => {
    let m = 0;
    const ds = trial.decisions;
    for (let i = 1; i < ds.length; i++)
      if (ds[i]!.t >= onset && ds[i - 1]!.mode === "walk")
        m += Math.hypot(ds[i]!.p[0] - ds[i - 1]!.p[0], ds[i]!.p[2] - ds[i - 1]!.p[2]);
    return m;
  })();
  return {
    impaired_path_error: finite(mean(windowsIn(ws, onset, durationS))),
    late_path_error: finite(mean(windowsIn(ws, durationS - 40, durationS))),
    baseline_path_error: finite(mean(windowsIn(ws, 0, onset))),
    detection_latency_s: trial.adapter.model
      ? noticed
        ? noticed.t - onset
        : null
      : null,
    attribution_latency_s: trial.adapter.model
      ? blamed
        ? blamed.t - onset
        : null
      : null,
    identification_error: finite(identificationError(trial.finalBelief, trial.truth[0]!)),
    false_alarms_per_min: trial.adapter.model ? early / (onset / 60) : null,
    impaired_walked_m: walked,
    coverage_90: coverage(trial),
  };
}

export interface EchoBusyMetrics {
  busy_attribution_latency_s: number | null;
  busy_identification_error: number | null;
  busy_impaired_path_error: number | null;
}

/**
 * ECHO-04: the impairment schedule's measures on a fly with urges. The time to
 * conclude that it changed itself counts a fly that never does as the rest of
 * the run, so failing to conclude is never left out.
 */
export function busyMetrics(
  trial: EchoTrial,
  a: EchoApparatus,
  durationS: number,
): EchoBusyMetrics {
  const m = impairmentMetrics(trial, a, durationS);
  const onset = trial.truth[0]!.from;
  return {
    busy_attribution_latency_s: trial.adapter.model
      ? (m.attribution_latency_s ?? durationS - onset)
      : null,
    busy_identification_error: m.identification_error,
    busy_impaired_path_error: m.impaired_path_error,
  };
}

export interface EchoAttributionMetrics {
  attribution_accuracy: number | null;
  false_self_attribution: number | null;
  attribution_brier: number | null;
  attribution_path_error: number | null;
  missed_changes: number | null;
  misleading_sense_blamed_self: number | null;
  attribution_coverage_90: number | null;
}

export function attributionMetrics(
  trial: EchoTrial,
  a: EchoApparatus,
): EchoAttributionMetrics {
  const P = trial.fly.params;
  const ws = pathWindows(
    trial.decisions,
    a.window_s,
    P.physicsStepMs / 1000,
    P.walkSpeedTauS,
  );
  const has = trial.adapter.model !== null;
  const scored = scoreChanges(trial.truth, trial.events);
  // A misleading sense reads a motion that is not there: no sense here can tell it from a push, so it is reported apart.
  const counted = scored.filter((s) => s.condition !== "misleading_sense");
  const external = counted.filter((s) => s.cause === "external");
  const brier = counted.flatMap((s) =>
    s.probability === null ? [] : [(s.probability - (s.correct ? 1 : 0)) ** 2],
  );
  const misleading = scored.filter(
    (s) => s.condition === "misleading_sense" && s.edge === "onset",
  );
  return {
    attribution_accuracy:
      has && counted.length
        ? counted.filter((s) => s.correct).length / counted.length
        : null,
    false_self_attribution:
      has && external.length
        ? external.filter((s) => s.answered === "self" || s.answered === "self+external")
            .length / external.length
        : null,
    attribution_brier: has ? finite(mean(brier)) : null,
    attribution_path_error: finite(mean(ws.map((w) => w.error))),
    missed_changes: has ? counted.filter((s) => s.answered === "missed").length : null,
    misleading_sense_blamed_self:
      has && misleading.length
        ? misleading.filter(
            (s) => s.answered === "self" || s.answered === "self+external",
          ).length / misleading.length
        : null,
    attribution_coverage_90: coverage(trial),
  };
}

export interface EchoRetentionMetrics {
  reexposure_path_error: number | null;
  reexposure_latency_s: number | null;
  first_exposure_path_error: number | null;
  first_exposure_latency_s: number | null;
  unfamiliar_path_error: number | null;
  recalls: number | null;
  false_recalls: number | null;
}

export function retentionMetrics(
  trial: EchoTrial,
  a: EchoApparatus,
): EchoRetentionMetrics {
  const P = trial.fly.params;
  const ws = pathWindows(
    trial.decisions,
    a.window_s,
    P.physicsStepMs / 1000,
    P.walkSpeedTauS,
  );
  const [A, , again, C] = trial.truth;
  const has = trial.adapter.model !== null;
  const latency = (from: number, to: number) => {
    const ev = trial.events.find(
      (x) =>
        x.kind === "concluded" &&
        x.t >= from &&
        x.t < to &&
        (x.explanation === "self" || x.explanation === "both"),
    );
    return has ? (ev ? ev.t - from : null) : null;
  };
  const recalls = trial.events.filter(
    (x) => x.kind === "concluded" && x.candidate?.startsWith("recall:"),
  );
  return {
    reexposure_path_error: finite(
      mean(windowsIn(ws, again!.from, again!.from + a.reexposure_s)),
    ),
    reexposure_latency_s: latency(again!.from, again!.until ?? Infinity),
    first_exposure_path_error: finite(
      mean(windowsIn(ws, A!.from, A!.from + a.reexposure_s)),
    ),
    first_exposure_latency_s: latency(A!.from, A!.until ?? Infinity),
    unfamiliar_path_error: finite(mean(windowsIn(ws, C!.from, C!.from + a.reexposure_s))),
    recalls: has ? recalls.length : null,
    false_recalls: has ? recalls.filter((x) => x.t >= C!.from).length : null,
  };
}

/** A 32-bit seed for one stream of one run, from the experiment seed and labels. */
export function deriveEcho(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part >>> 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** A trial of `schedule` on `seed`, its schedule drawn from the geometry stream after the fly is placed. */
export function echoTrialFor(
  block: {
    arena: {
      size: [number, number, number];
      ambient: number;
      pillars: { x: number; z: number; r: number }[];
    };
    id: string;
    fixed_config: Record<string, number>;
    start_half_width_m: number;
    duration_s: number;
    echo: EchoApparatus;
  },
  arm: EchoArmSpec & { config: Record<string, number> },
  seed: number,
  salt: number,
): EchoTrial {
  const geometry = mulberry32(deriveEcho(seed, salt, 0));
  const schedule = mulberry32(deriveEcho(seed, salt, 2));
  return runEchoTrial({
    arena: {
      size: [...block.arena.size],
      ambient: block.arena.ambient,
      pillars: block.arena.pillars.map((p) => ({ ...p })),
    },
    arenaId: `fly-${block.id}`,
    startHalfWidth: block.start_half_width_m,
    config: { ...arm.config, ...block.fixed_config },
    durationS: block.duration_s,
    truth: drawEchoSchedule(block.echo, block.duration_s, schedule),
    arm: { variant: arm.variant, reset_s: arm.reset_s },
    seed: deriveEcho(seed, salt, 1),
    geometry,
  });
}

/** The backend's run of an ECHO block in one arm on one seed: what fly.ts's RUNNERS call. */
export function runEchoBlock(
  block: FlyBlockSpec,
  arm: FlyArm,
  seed: number,
  salt: number,
): FlyRun {
  const apparatus = block.echo;
  const echo = arm.echo;
  if (!apparatus || !echo)
    throw new Error(`${block.id} is an ECHO block and needs an ECHO arm`);
  const trial = echoTrialFor(
    { ...block, echo: apparatus },
    { variant: echo.variant, reset_s: echo.reset_s, config: arm.config },
    seed,
    salt,
  );
  const metrics: Record<string, number | null> = {
    ...(() => {
      if (block.id === "busy") return busyMetrics(trial, apparatus, block.duration_s);
      switch (apparatus.schedule) {
        case "impairment":
          return impairmentMetrics(trial, apparatus, block.duration_s);
        case "attribution":
          return attributionMetrics(trial, apparatus);
        case "retention":
          return retentionMetrics(trial, apparatus);
      }
    })(),
  };
  return {
    arm: arm.id,
    seed,
    block: block.id,
    final_hashes: [trial.fly.stateHash()],
    simulated_s: trial.fly.state.t,
    gate_refusals: trial.fly.state.counts.rejected,
    metrics,
  };
}
