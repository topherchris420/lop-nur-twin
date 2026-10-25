/**
 * Labelled experimental perturbations of the digital fly: changes to its body,
 * pushes from outside it and faults in its self-motion sense, applied by the
 * simulator on a schedule an experimenter writes.
 *
 * A perturbation is the experimenter's, never the fly's. The body and the
 * self-motion sense (selfMotion.ts) read it; no decision maker is handed it,
 * its labels or its schedule, and nothing a decision maker returns can change
 * it. A fly only meets its consequences: a step that carries it less far than
 * its legs moved, a turn sharper or weaker than commanded, ground or air that
 * carries it along, a sense that reads noisier or wrong.
 *
 * What each field does, and where (a model of the perturbation, chosen for
 * this simulator, not a model of any real injury or wind):
 *
 * - `speedGain`: movement effectiveness. Walking, the legs step at the
 *   commanded speed but the body advances `speedGain` times as far (a slipping
 *   or weakened leg set); flying, the horizontal velocity the wings hold is
 *   `speedGain` times the command. 1 is unimpaired.
 * - `turnGain`, `turnBias`: the turning response. The yaw rate is
 *   `turnGain` × the commanded rate + `turnBias` (rad/s) while walking or in
 *   flight, and a saccade turns `turnGain` × its amplitude. Perched still, a
 *   bias does nothing: it is the body's, not the ground's.
 * - `drift` (m/s, world x and z): an external displacement. In the air it is
 *   wind, added to the velocity the wings hold; on a surface it is the surface
 *   or a push carrying the standing or walking fly, which stops at an edge or
 *   a solid as walking does.
 * - `spin` (rad/s): the surface turning the fly standing or walking on it (a
 *   turntable); none in the air. Nothing acts on a fly preparing a takeoff, which grips the
 *   surface until the jump.
 * - `flowNoise`, `flowGain`, `flowBias`: faults of the self-motion sense only
 *   (selfMotion.ts): its noise multiplied, its translation reading scaled, and
 *   a constant velocity (m/s, body forward and left) added to it. The body
 *   moves as it would; only what the fly feels of it is wrong.
 *
 * Episodes add: gains multiply, biases, drifts and spins sum, over every
 * episode active at that time. An episode runs from `from` to `until`
 * (seconds of fly time; `until` null runs to the end).
 */
import type { V3 } from "./units.js";

export const PERTURBATION_SCHEMA = "fly-perturbation/v1" as const;

/** What an episode stands for, for the experimenter's labels and scoring only. */
export const PERTURBATION_CAUSES = ["self", "external", "sensor"] as const;
export type PerturbationCause = (typeof PERTURBATION_CAUSES)[number];

export interface PerturbationEpisode {
  /** The experimenter's label. Never shown to the fly. */
  id: string;
  cause: PerturbationCause;
  from: number;
  until: number | null;
  speedGain?: number;
  turnGain?: number;
  turnBias?: number;
  drift?: [number, number];
  spin?: number;
  flowNoise?: number;
  flowGain?: number;
  flowBias?: [number, number];
}

export interface Perturbation {
  schema: typeof PERTURBATION_SCHEMA;
  episodes: PerturbationEpisode[];
}

/** The combined effect of every episode active at one time. */
export interface ActivePerturbation {
  speedGain: number;
  turnGain: number;
  turnBias: number;
  drift: [number, number];
  spin: number;
  flowNoise: number;
  flowGain: number;
  flowBias: [number, number];
}

export const NO_PERTURBATION: Readonly<ActivePerturbation> = Object.freeze({
  speedGain: 1,
  turnGain: 1,
  turnBias: 0,
  drift: Object.freeze([0, 0]) as unknown as [number, number],
  spin: 0,
  flowNoise: 1,
  flowGain: 1,
  flowBias: Object.freeze([0, 0]) as unknown as [number, number],
});

/** Bounds a schedule must keep: wide enough for any experiment, narrow enough to stay well defined. */
export const PERTURBATION_LIMITS = {
  gain: [0, 3],
  turnBias: [-6, 6],
  drift: 0.5,
  spin: [-6, 6],
  flowNoise: [1, 50],
  flowBias: 0.5,
  episodes: 64,
  idChars: 80,
} as const;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const within = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;

/** Why a schedule cannot run, or nothing when it can. */
export function perturbationErrors(p: Perturbation): string[] {
  const errors: string[] = [];
  if (p.schema !== PERTURBATION_SCHEMA) errors.push(`not a ${PERTURBATION_SCHEMA}`);
  if (!Array.isArray(p.episodes) || p.episodes.length > PERTURBATION_LIMITS.episodes)
    return [...errors, `at most ${PERTURBATION_LIMITS.episodes} episodes`];
  const L = PERTURBATION_LIMITS;
  p.episodes.forEach((e, i) => {
    const at = `episode ${i}`;
    if (typeof e.id !== "string" || !e.id || e.id.length > L.idChars)
      errors.push(`${at}: an id is a short label`);
    if (!(PERTURBATION_CAUSES as readonly string[]).includes(e.cause))
      errors.push(`${at}: unknown cause`);
    if (!finite(e.from) || e.from < 0) errors.push(`${at}: from must be a time ≥ 0`);
    if (e.until !== null && (!finite(e.until) || e.until <= e.from))
      errors.push(`${at}: until must follow from, or be null`);
    for (const k of ["speedGain", "turnGain", "flowGain"] as const)
      if (e[k] !== undefined && !(finite(e[k]) && within(e[k], L.gain)))
        errors.push(`${at}: ${k} out of range`);
    if (
      e.turnBias !== undefined &&
      !(finite(e.turnBias) && within(e.turnBias, L.turnBias))
    )
      errors.push(`${at}: turnBias out of range`);
    if (e.spin !== undefined && !(finite(e.spin) && within(e.spin, L.spin)))
      errors.push(`${at}: spin out of range`);
    if (
      e.flowNoise !== undefined &&
      !(finite(e.flowNoise) && within(e.flowNoise, L.flowNoise))
    )
      errors.push(`${at}: flowNoise out of range`);
    for (const k of ["drift", "flowBias"] as const) {
      const v = e[k];
      if (v === undefined) continue;
      const max = k === "drift" ? L.drift : L.flowBias;
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        !v.every(finite) ||
        Math.hypot(...v) > max
      )
        errors.push(`${at}: ${k} must be two finite numbers within ${max} m/s`);
    }
  });
  return errors;
}

/** A checked, frozen copy of a schedule; throws on one that cannot run. */
export function checkedPerturbation(p: Perturbation): Readonly<Perturbation> {
  const errors = perturbationErrors(p);
  if (errors.length) throw new Error(`perturbation refused: ${errors.join("; ")}`);
  const copy = structuredClone(p);
  for (const e of copy.episodes) Object.freeze(e);
  return Object.freeze(copy);
}

const active = (e: PerturbationEpisode, t: number) =>
  t >= e.from && (e.until === null || t < e.until);

/** The perturbation in force at fly time `t`. */
export function perturbationAt(p: Readonly<Perturbation>, t: number): ActivePerturbation {
  const out: ActivePerturbation = {
    speedGain: 1,
    turnGain: 1,
    turnBias: 0,
    drift: [0, 0],
    spin: 0,
    flowNoise: 1,
    flowGain: 1,
    flowBias: [0, 0],
  };
  for (const e of p.episodes) {
    if (!active(e, t)) continue;
    if (e.speedGain !== undefined) out.speedGain *= e.speedGain;
    if (e.turnGain !== undefined) out.turnGain *= e.turnGain;
    if (e.turnBias !== undefined) out.turnBias += e.turnBias;
    if (e.drift) {
      out.drift[0] += e.drift[0];
      out.drift[1] += e.drift[1];
    }
    if (e.spin !== undefined) out.spin += e.spin;
    if (e.flowNoise !== undefined) out.flowNoise *= e.flowNoise;
    if (e.flowGain !== undefined) out.flowGain *= e.flowGain;
    if (e.flowBias) {
      out.flowBias[0] += e.flowBias[0];
      out.flowBias[1] += e.flowBias[1];
    }
  }
  return out;
}

/** World-frame drift as a 3-vector (m/s). */
export const driftVector = (a: ActivePerturbation): V3 => [a.drift[0], 0, a.drift[1]];
