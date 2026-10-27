/** Behavioral ON/OFF filters, not identified neurons or a reconstructed antennal lobe.
 * Independent implementation of Álvarez-Salvado et al. 2018, eLife 7:e37815,
 * equations 8–13 and Table 1 ACF rows. https://doi.org/10.7554/eLife.37815
 * No author code/data copied. Motor integration below is an ECHO model choice. */
import type { DecisionInput, Mode, MotorCommand } from "../../fly/neural.js";
import { mulberry32 } from "../../../lib/noise.js";

export const OLFACTION_VERSION = "echo-olfactory-navigation/v1";
const DOI = "10.7554/eLife.37815, Table 1 ACF";
export const OLFACTION_PARAMS = {
  onTau: { value: 0.72, unit: "s", kind: "published", source: DOI },
  onAdaptTau: { value: 9.8, unit: "s", kind: "published", source: DOI },
  fastTau: { value: 0.62, unit: "s", kind: "published", source: DOI },
  slowTau: { value: 4.84, unit: "s", kind: "published", source: DOI },
  offAdaptTau: { value: 10.08, unit: "s", kind: "published", source: DOI },
  // ECHO's odour unit is not the paper's vinegar concentration: do not label this measured.
  halfSaturation: { value: 0.05, unit: "ECHO odour units", kind: "model" },
  maxInput: { value: 1e6, unit: "ECHO odour units, numerical guard", kind: "model" },
  substep: { value: 0.01, unit: "s, maximum integration interval", kind: "model" },
  windGain: { value: 4, unit: "rad/s", kind: "model" },
  speedOn: { value: 0.8, unit: "speed multiplier gain", kind: "model" },
  speedOff: { value: 1.4, unit: "speed multiplier gain", kind: "model" },
  searchHz: { value: 3, unit: "turns/s per OFF", kind: "model" },
  searchTurn: { value: 3, unit: "rad/s", kind: "model" },
  searchHold: { value: 0.3, unit: "s", kind: "model" },
  maxYaw: { value: 6, unit: "rad/s", kind: "model" },
  clearance: {
    value: 0.01,
    unit: "m, avoid overriding near-obstacle steering",
    kind: "model",
  },
  contactTime: {
    value: 0.3,
    unit: "s, avoid overriding collision avoidance",
    kind: "model",
  },
} as const;
const P = Object.fromEntries(
  Object.entries(OLFACTION_PARAMS).map(([k, p]) => [k, p.value]),
) as {
  [K in keyof typeof OLFACTION_PARAMS]: number;
};
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const relax = (x: number, target: number, dt: number, tau: number) =>
  target + (x - target) * Math.exp(-dt / tau);

/** Explicit sensory/interoceptive boundary. No location, heading, world, food ID or schedule. */
export interface OlfactoryView {
  odour: number;
  windFrom: number | null;
  reserve: number;
  hungerSeek: number;
  mode: Mode;
  edge: boolean;
  clearance: number;
  contactTime: number;
  walkMaxCmS: number;
}
export function olfactoryView({ body, frame, params }: DecisionInput): OlfactoryView {
  return {
    odour: frame.odour,
    windFrom: frame.airflowFrom,
    reserve: body.reserve,
    hungerSeek: params.hungerSeek,
    mode: body.mode,
    edge: body.edge,
    clearance: frame.clearance,
    contactTime: Math.min(frame.ttcFront, frame.ttcLeft, frame.ttcRight),
    walkMaxCmS: params.walkSpeedMaxCmS,
  };
}

export class OlfactoryNavigation {
  readonly rng: () => number;
  readonly state = {
    version: OLFACTION_VERSION,
    adaptationOn: 0,
    adaptationOff: 0,
    on: 0,
    fast: 0,
    slow: 0,
    off: 0,
    turnRemaining: 0,
    turnSign: 1,
    searchTurns: 0,
    modulatedDecisions: 0,
    lastWindTurn: 0,
    lastSearchTurn: 0,
    lastSpeedScale: 1,
  };
  constructor(seed: number) {
    // Its own snapshot-compatible stream; never consumes ECHO or navigation draws.
    this.rng = mulberry32((seed ^ 0x6f6c6661) >>> 0);
  }
  sample(odour: number, dt: number): void {
    if (
      !Number.isFinite(odour) ||
      odour < 0 ||
      odour > P.maxInput ||
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > 1
    )
      throw new Error("invalid olfactory sample; no reset performed");
    const s = this.state;
    if (
      ![s.adaptationOn, s.adaptationOff].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= P.maxInput,
      ) ||
      ![s.on, s.fast, s.slow, s.off].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
    )
      throw new Error("invalid olfactory state; no reset performed");
    const n = Math.ceil(dt / P.substep),
      h = dt / n;
    for (let i = 0; i < n; i++) {
      // Midpoint adaptation, exponential low-pass steps. Bounded for bounded input.
      const aOn = relax(s.adaptationOn, odour, h / 2, P.onAdaptTau);
      const aOff = relax(s.adaptationOff, odour, h / 2, P.offAdaptTau);
      const cOn = odour / (odour + P.halfSaturation + aOn);
      const cOff = odour / (odour + P.halfSaturation + aOff);
      s.on = relax(s.on, cOn, h, P.onTau);
      s.fast = relax(s.fast, cOff, h, P.fastTau);
      s.slow = relax(s.slow, cOff, h, P.slowTau);
      s.off = Math.max(0, s.slow - s.fast);
      s.adaptationOn = relax(aOn, odour, h / 2, P.onAdaptTau);
      s.adaptationOff = relax(aOff, odour, h / 2, P.offAdaptTau);
    }
    s.turnRemaining = Math.max(0, s.turnRemaining - dt);
  }
  /** Called before physiology and ECHO act/expect. Never changes modes or forces a bout. */
  modulate(command: MotorCommand, view: OlfactoryView, dt: number): MotorCommand {
    const s = this.state;
    s.lastWindTurn = 0;
    s.lastSearchTurn = 0;
    s.lastSpeedScale = 1;
    if (
      command.mode !== "walk" ||
      view.mode !== "walk" ||
      view.edge ||
      view.clearance < P.clearance ||
      view.contactTime < P.contactTime
    )
      return command;
    const hunger =
      1 - view.reserve <= view.hungerSeek
        ? 0
        : clamp((1 - view.reserve - view.hungerSeek) / (1 - view.hungerSeek));
    if (hunger === 0 || (s.on === 0 && s.off === 0)) return command;
    const wind = view.windFrom === null ? 0 : P.windGain * s.on * Math.sin(view.windFrom);
    if (
      s.turnRemaining === 0 &&
      this.rng() < -Math.expm1(-P.searchHz * s.off * hunger * dt)
    ) {
      s.turnSign = this.rng() < 0.5 ? -1 : 1;
      s.turnRemaining = P.searchHold;
      s.searchTurns++;
    }
    const search = s.turnRemaining > 0 ? s.turnSign * P.searchTurn : 0;
    const speedScale = Math.max(0, 1 + hunger * (P.speedOn * s.on - P.speedOff * s.off));
    s.lastWindTurn = hunger * wind;
    s.lastSearchTurn = search;
    s.lastSpeedScale = speedScale;
    s.modulatedDecisions++;
    return {
      ...command,
      yawRate: clamp(
        (command.yawRate ?? 0) + hunger * wind + search,
        -P.maxYaw,
        P.maxYaw,
      ),
      ...(command.walkSpeed === undefined
        ? {}
        : {
            walkSpeed: clamp(command.walkSpeed * speedScale, 0, view.walkMaxCmS),
          }),
      reason: `${command.reason}; odor ON/OFF modulation`.slice(0, 500),
    };
  }
}
