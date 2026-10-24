/**
 * Six-legged walking as phase oscillators.
 *
 * One clock advances by 1/period per second; each leg runs at a fixed phase
 * lag from it and is in stance for the first `duty` of its cycle. Two numbers
 * set by speed shape the gait:
 *
 * - The duty factor follows FlyBody's reported mean legs in stance (3.9 at
 *   1 cm/s, 3.1 at 4 cm/s; Vaxenburg et al. 2025), linear between them.
 * - Swing time is constant (Mendes et al. 2013 report it changes little with
 *   speed), so the period is swing / (1 − duty), floored at the ~60 ms they
 *   report at high speed.
 *
 * The phase lag between neighbouring legs moves from a third of a cycle
 * (tetrapod-like: diagonal pairs swing in turn) at slow speeds to half a cycle
 * (tripod: L1-R2-L3 against R1-L2-R3) at the fastest, so tripod coordination
 * becomes commoner with speed, as Mendes et al. found; the blend between the
 * two is a model choice, not a fit. Legs are numbered L1 L2 L3 R1 R2 R3.
 */
export const LEGS = [
  "T1_left",
  "T2_left",
  "T3_left",
  "T1_right",
  "T2_right",
  "T3_right",
] as const;
export type Leg = (typeof LEGS)[number];

export interface GaitParams {
  stanceLegsAt1: number;
  stanceLegsAt4: number;
  swingMs: number;
  stepPeriodFloorMs: number;
  walkSpeedMinCmS: number;
  walkSpeedMaxCmS: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function dutyFactor(speedCmS: number, g: GaitParams): number {
  const s = clamp01((speedCmS - 1) / 3);
  return (g.stanceLegsAt1 + (g.stanceLegsAt4 - g.stanceLegsAt1) * s) / 6;
}

export function stepPeriodS(speedCmS: number, g: GaitParams): number {
  const duty = dutyFactor(speedCmS, g);
  return Math.max(g.stepPeriodFloorMs, g.swingMs / (1 - duty)) / 1000;
}

/**
 * How fast the feet pass over the ground (cm/s): the walking speed plus the
 * turn rate (rad/s) times the feet's distance from the thorax's vertical axis.
 * The gait runs at this speed, so a fly turning on the spot steps round
 * instead of standing still.
 */
export function steppingSpeedCmS(
  walkSpeedCmS: number,
  yawRate: number,
  footRadiusCm: number,
): number {
  return Math.abs(walkSpeedCmS) + Math.abs(yawRate) * footRadiusCm;
}

/** Below this stepping speed (cm/s) the legs stand still. */
export const STEPPING_MIN_CMS = 0.05;

/** Stride length (cm): how far the body moves during one full step cycle. */
export function strideCm(speedCmS: number, g: GaitParams): number {
  return speedCmS * stepPeriodS(speedCmS, g);
}

/** Neighbour phase lag, a third (tetrapod) at the slowest speed to a half (tripod) at the fastest. */
export function phaseLag(speedCmS: number, g: GaitParams): number {
  const s = clamp01(
    (speedCmS - g.walkSpeedMinCmS) / (g.walkSpeedMaxCmS - g.walkSpeedMinCmS),
  );
  return 1 / 3 + (1 / 2 - 1 / 3) * s;
}

/**
 * Each leg's phase in [0, 1) for clock phase `clock`. The posterior leg leads
 * (a back-to-front metachronal wave), and each right leg leads its left
 * partner by `lag`: a larger offset reaches swing sooner.
 */
export function legPhases(clock: number, lag: number): number[] {
  return LEGS.map((_, i) => {
    const segment = i % 3; // 0 = T1, 2 = T3
    const side = i < 3 ? 0 : 1;
    // T3 carries the largest offset, so it crosses `duty` into swing first, then
    // T2, then T1: the wave runs back to front.
    const phase = clock + lag * segment + lag * side;
    return phase - Math.floor(phase);
  });
}

export function inStance(phase: number, duty: number): boolean {
  return phase < duty;
}

/** How many legs are planted at this clock phase. */
export function stanceCount(clock: number, speedCmS: number, g: GaitParams): number {
  const duty = dutyFactor(speedCmS, g);
  return legPhases(clock, phaseLag(speedCmS, g)).filter((p) => inStance(p, duty)).length;
}

/** "tripod" when exactly three legs are planted in the alternating triplets; otherwise by count. */
export function coordination(
  clock: number,
  speedCmS: number,
  g: GaitParams,
): "tripod" | "tetrapod" | "wave" | "other" {
  const duty = dutyFactor(speedCmS, g);
  const planted = legPhases(clock, phaseLag(speedCmS, g)).map((p) => inStance(p, duty));
  const n = planted.filter(Boolean).length;
  const a = [0, 2, 4],
    b = [1, 3, 5];
  if (n === 3 && (a.every((i) => planted[i]) || b.every((i) => planted[i])))
    return "tripod";
  if (n === 4) return "tetrapod";
  if (n === 5) return "wave";
  return "other";
}
