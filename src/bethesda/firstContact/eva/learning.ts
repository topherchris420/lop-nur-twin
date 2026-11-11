/**
 * Eva's sensorimotor learner, `deploy/garden/service/learning.py`, line for
 * line. Physics and learned predictions stay separate: `physicalStep` is the
 * world, `execute` predicts, runs the physics, observes with noise and
 * updates her estimates. Coordinates are garden fractions, time seconds. A
 * toy embodiment, not a biological or consciousness model.
 *
 * Every arithmetic expression keeps Python's operand order (left to right),
 * `math.dist`/`math.hypot` are CPython's (`pyMath.ts`), and Python's
 * two-term `sum(...)`, which starts from the integer 0, is written `0 + a + b`.
 *
 * Two research seams, both absent by default (and then every result is the
 * Python code's):
 * - `perceive(now)`: extra things in the garden, merged after her two
 *   built-in objects (`objectsAt`), which her own tracker follows exactly as
 *   it follows the midge;
 * - `obstruct(start, end, action)`: where a motion actually stops, applied
 *   after her boundary clamp (a shared world's collision).
 */
import { pyDist, pyHypot, pyRound } from "./pyMath.js";
import type { PyRandom } from "./pyRandom.js";

export type Point = [number, number];
export type Action = "fly" | "walk" | "rest" | "groom";

/** Her weather dict: the fetched or seasonal conditions. */
export interface Weather {
  temperature: number;
  code: number;
  wind: number;
  rain: number;
  fetched_at?: number;
  source?: string;
  /** Local date (YYYY-MM-DD) to [sunrise, sunset] unix seconds. */
  sun?: Record<string, number[]>;
}

export interface Body {
  wing_integrity: number;
  leg_integrity: number;
  wetness: number;
}

export interface MotorModel {
  gain: number;
  samples: number;
  successes: number;
  error: number;
}

export interface Track {
  samples: number;
  external_motion: number;
  self_only_error: number;
  moving_error: number;
  velocity: Point;
}

export interface Trial {
  at: number;
  action: Action;
  condition: string;
  command: Point;
  predicted_position: Point;
  observed_position: Point;
  prediction_error: number;
  predicted_landmark: Point;
  observed_landmark: Point;
  success: boolean;
}

export interface Learning {
  version: number;
  trials: number;
  models: Record<string, MotorModel>;
  sensory_error: number;
  last: Trial | null;
  objects: Record<string, Track>;
  surprises: number;
}

/** The part of her state the learner reads and writes. */
export interface LearnerState {
  energy: number;
  position: Point;
  updated_at: number;
  body: Body;
  learning: Learning;
}

/**
 * Research only. Things in the garden besides her own two, as garden
 * fractions at time `now`. It is asked for `now - dt` as well as `now` (her
 * tracker compares both), so it must answer for the past too; a thing absent
 * at `now - dt` is not tracked on that step. Keys must not be her own
 * objects' names; they are tracked in sorted order after hers.
 */
export type Perceive = (now: number) => Record<string, Point>;

/**
 * Research only. Given where her body started and where her physics (after
 * the garden boundary) would put it, returns where it actually stops. Called
 * for every executed action, including rest and groom (then `end` equals
 * `start`). The default is the identity.
 */
export type Obstruct = (start: Point, end: Point, action: Action) => Point;

export interface Seams {
  perceive?: Perceive;
  obstruct?: Obstruct;
}

export const OWN_OBJECTS = ["drifting_midge", "swaying_leaf"] as const;

export function clamp(x: number, low = 0.0, high = 1.0): number {
  return Math.max(low, Math.min(high, x));
}

export function freshBody(): Body {
  return { wing_integrity: 1.0, leg_integrity: 1.0, wetness: 0.0 };
}

export function freshLearning(): Learning {
  return {
    version: 1,
    trials: 0,
    models: {},
    sensory_error: 0.0,
    last: null,
    objects: {},
    surprises: 0,
  };
}

/** `learning.context`: sensed conditions, not access to the physics' gain. */
export function context(state: LearnerState, weather: Weather): string {
  const b = state.body;
  return [
    weather.temperature < 10 ? "cold" : "warm",
    state.energy < 35 ? "tired" : "rested",
    Math.min(b.wing_integrity, b.leg_integrity) < 0.7 ? "limited" : "sound",
    b.wetness > 0.4 ? "wet" : "dry",
  ].join(":");
}

/** `learning.model`: her estimate for an action in a condition (created on first use). */
export function model(
  state: LearnerState,
  action: Action,
  condition: string,
): MotorModel {
  const key = action + "/" + condition;
  const models = state.learning.models;
  return (models[key] ??= { gain: 0.006, samples: 0, successes: 0, error: 0.0 });
}

/** `learning.choose_motion`: her own choice of fly or walk for a travel step. */
export function chooseMotion(state: LearnerState, weather: Weather): "fly" | "walk" {
  const condition = context(state, weather);
  const fly = model(state, "fly", condition);
  const walk = model(state, "walk", condition);
  // Try each unfamiliar action; periodically retest so recovery is discoverable.
  if (fly.samples < 3 || state.learning.trials % 37 === 0) return "fly";
  if (walk.samples < 3) return "walk";
  const score = (m: MotorModel) => (m.gain * (m.successes + 1)) / (m.samples + 2);
  return score(fly) >= score(walk) ? "fly" : "walk";
}

/**
 * `learning.objects_at`: independent world trajectories, neither reading the
 * fly. With `perceive`, the caller's things follow hers in sorted key order.
 */
export function objectsAt(now: number, perceive?: Perceive): Record<string, Point> {
  const out: Record<string, Point> = {
    drifting_midge: [0.55 + 0.22 * Math.sin(now / 23), 0.4 + 0.11 * Math.cos(now / 31)],
    swaying_leaf: [0.3 + 0.025 * Math.sin(now / 11), 0.34 + 0.012 * Math.cos(now / 17)],
  };
  if (perceive) {
    const extra = perceive(now);
    for (const key of Object.keys(extra).sort()) {
      if (key in out) throw new Error(`perceive may not replace her own ${key}`);
      const p = extra[key]!;
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
        throw new Error(`perceive gave ${key} a position that is not two finite numbers`);
      out[key] = [p[0], p[1]];
    }
  }
  return out;
}

/** `learning.physical_step`: the world's answer to a motor command. */
export function physicalStep(
  state: LearnerState,
  action: Action,
  command: readonly number[],
  dt: number,
  weather: Weather,
  obstruct?: Obstruct,
): Point {
  const b = state.body;
  let gain: number;
  if (action === "fly") {
    gain = 0.018 * (b.wing_integrity * b.wing_integrity) * (1 - 0.85 * b.wetness);
    gain *= weather.temperature < 10 ? 0.4 : 1;
    gain *= state.energy < 35 ? 0.35 : 1;
    if (b.wing_integrity < 0.18 || b.wetness > 0.92) gain = 0.0;
  } else if (action === "walk") {
    gain = 0.0035 * (b.leg_integrity * b.leg_integrity);
    if (b.leg_integrity < 0.15) gain = 0.0;
  } else gain = 0.0;
  const start: Point = [state.position[0], state.position[1]];
  // Collision with garden boundary is an observable limitation, not a teleport.
  const end: Point = [
    clamp(start[0] + command[0]! * dt * gain, 0.03, 0.97),
    clamp(start[1] + command[1]! * dt * gain, 0.03, 0.97),
  ];
  if (!obstruct) return end;
  const stop = obstruct([start[0], start[1]], [end[0], end[1]], action);
  if (!Array.isArray(stop) || stop.length !== 2 || !stop.every(Number.isFinite))
    throw new Error("obstruct must return two finite numbers");
  return [stop[0], stop[1]];
}

/** `learning.execute`: predict, execute independent physics, observe, then update. */
export function execute(
  state: LearnerState,
  action: Action,
  command: readonly number[],
  now: number,
  dt: number,
  weather: Weather,
  rng: PyRandom,
  seams: Seams = {},
): number {
  const condition = context(state, weather);
  const m = model(state, action, condition);
  const start: Point = [state.position[0], state.position[1]];
  const u: Point = [command[0]! * dt, command[1]! * dt];
  const moves = action === "fly" || action === "walk";
  const predictedDelta: Point = moves ? [m.gain * u[0], m.gain * u[1]] : [0.0, 0.0];
  const predicted: Point = [start[0] + predictedDelta[0], start[1] + predictedDelta[1]];
  const end = physicalStep(state, action, command, dt, weather, seams.obstruct);
  // Noisy localization is the learner's observation.
  const ox = end[0] + rng.uniform(-0.00015, 0.00015);
  const oy = end[1] + rng.uniform(-0.00015, 0.00015);
  const observed: Point = [ox, oy];
  const delta: Point = [observed[0] - start[0], observed[1] - start[1]];
  const error = pyDist(predicted, observed);
  const excitation = 0 + u[0] * u[0] + u[1] * u[1];
  if (excitation > 1e-10) {
    const measuredGain = (0 + u[0] * delta[0] + u[1] * delta[1]) / excitation;
    m.gain = clamp(m.gain + 0.22 * (measuredGain - m.gain), 0.0, 0.04);
  }
  const success = moves ? pyDist(start, end) > 0.0003 : true;
  m.samples += 1;
  m.successes += success ? 1 : 0;
  m.error += 0.15 * (error - m.error);
  const learning = state.learning;
  learning.trials += 1;
  learning.sensory_error += 0.12 * (error - learning.sensory_error);
  if (error > 0.025) learning.surprises += 1;
  // Retinal prediction: stationary landmarks should move opposite to self-motion.
  const landmark: Point = [0.82, 0.375];
  const predictedView: Point = [landmark[0] - predicted[0], landmark[1] - predicted[1]];
  const observedView: Point = [landmark[0] - observed[0], landmark[1] - observed[1]];
  const oldObjects = objectsAt(now - dt, seams.perceive);
  const newObjects = objectsAt(now, seams.perceive);
  for (const [name, point] of Object.entries(newObjects)) {
    const old = oldObjects[name];
    if (!old) continue; // only a perceived thing can be new; hers are always there
    const track = (learning.objects[name] ??= {
      samples: 0,
      external_motion: 0.0,
      self_only_error: 0.0,
      moving_error: 0.0,
      velocity: [0.0, 0.0],
    });
    const oldRelative: Point = [old[0] - start[0], old[1] - start[1]];
    const newRelative: Point = [point[0] - observed[0], point[1] - observed[1]];
    const selfOnly: Point = [
      oldRelative[0] - predictedDelta[0],
      oldRelative[1] - predictedDelta[1],
    ];
    const moving: Point = [
      selfOnly[0] + track.velocity[0] * dt,
      selfOnly[1] + track.velocity[1] * dt,
    ];
    // Compensate sensed self-displacement before attributing movement to others.
    const external: Point = [
      newRelative[0] - oldRelative[0] + delta[0],
      newRelative[1] - oldRelative[1] + delta[1],
    ];
    track.samples += 1;
    track.self_only_error +=
      0.12 * (pyDist(selfOnly, newRelative) - track.self_only_error);
    track.moving_error += 0.12 * (pyDist(moving, newRelative) - track.moving_error);
    track.external_motion +=
      0.12 * (pyHypot(external[0], external[1]) / dt - track.external_motion);
    track.velocity = [external[0] / dt, external[1] / dt];
  }
  learning.last = {
    at: now,
    action,
    condition,
    command: [command[0]!, command[1]!],
    predicted_position: predicted,
    observed_position: observed,
    prediction_error: error,
    predicted_landmark: predictedView,
    observed_landmark: observedView,
    success,
  };
  state.position = end;
  // Gentle wear, wet wings, and recovery alter real capabilities without ending the life.
  const b = state.body;
  b.wetness = clamp(
    b.wetness + dt * (weather.rain > 0.2 && action === "fly" ? 0.002 : -0.001),
  );
  if (action === "fly")
    b.wing_integrity = clamp(b.wing_integrity - dt * 0.000002, 0.1, 1.0);
  else if (action === "rest" || action === "groom") {
    b.wing_integrity = clamp(b.wing_integrity + dt * 0.00003);
    b.leg_integrity = clamp(b.leg_integrity + dt * 0.00003);
  }
  return pyDist(start, end);
}

export interface Capability {
  samples: number;
  estimated_speed: number;
  success_rate: number;
}

export interface NearbyThing extends Partial<Track> {
  name: string;
  position: Point;
  independent: boolean;
}

export interface LearningSummary {
  trials: number;
  condition: string;
  capabilities: { fly: Capability | null; walk: Capability | null };
  prediction_error: number;
  last: Trial | null;
  surprises: number;
  body: Body;
  nearby: NearbyThing[];
}

/** `learning.summary`, for her `/state`. Plain data, deep-copied. */
export function summary(
  state: LearnerState,
  weather: Weather,
  perceive?: Perceive,
): LearningSummary {
  const learning = state.learning;
  const condition = context(state, weather);
  const capability = (action: Action): Capability | null => {
    const m = learning.models[action + "/" + condition];
    return !m || !m.samples
      ? null
      : {
          samples: m.samples,
          estimated_speed: pyRound(m.gain, 5),
          success_rate: pyRound(m.successes / m.samples, 3),
        };
  };
  const nearby = Object.entries(objectsAt(state.updated_at, perceive)).map(
    ([name, point]): NearbyThing => {
      const track = learning.objects[name];
      return {
        name,
        position: point,
        ...structuredClone(track ?? {}),
        independent:
          (track?.samples ?? 0) >= 10 && (track?.external_motion ?? 0) > 0.0003,
      };
    },
  );
  return {
    trials: learning.trials,
    condition,
    capabilities: { fly: capability("fly"), walk: capability("walk") },
    prediction_error: pyRound(learning.sensory_error, 6),
    last: structuredClone(learning.last),
    surprises: learning.surprises,
    body: structuredClone(state.body),
    nearby,
  };
}
