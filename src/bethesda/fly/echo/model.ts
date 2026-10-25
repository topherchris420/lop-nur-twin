/** Project ECHO: a bounded, deterministic sensorimotor estimate, never world state.
 * All constants below are engineering model choices, not biological measurements.
 */
import { canonicalJson, sha256Json } from "../../../rain/sha256.js";
import { echoCheckpointErrors } from "./checkpoint.js";
import { MODES, type Mode } from "../neural.js";
import { wrapAngle } from "../units.js";

export const ECHO_VERSION = "fly-echo/v1" as const;
export const ECHO_LIMITS = { history: 32, window: 24, episodes: 32 } as const;
export const ECHO_VARIANTS = [
  "full",
  "disabled",
  "no_learning",
  "no_memory",
  "no_uncertainty",
  "reset_memory",
] as const;
export type EchoVariant = (typeof ECHO_VARIANTS)[number];
/** Idealized local visual odometry and proprioception. No absolute pose, world,
 * object identities, perturbation causes, capabilities, or future events.
 * This added sensor is a model assumption, not validated fly perception.
 */
export interface MotionObservation {
  tick: number;
  t: number;
  dt: number;
  forwardM: number;
  lateralM: number;
  verticalM: number;
  turnRad: number;
  reserve: number;
  mode: Mode;
  clear: boolean;
}
export interface MotorCopy {
  mode: Mode;
  walkSpeedCmS: number;
  yawRate: number;
  dt: number;
  stepS: number;
  walkTauS: number;
}
export type Attribution =
  | "insufficient excitation"
  | "unchanged"
  | "action response changed"
  | "external disturbance"
  | "mixed"
  | "unreliable observations";
interface Pair {
  x: number;
  y: number;
  turnX: number;
  turnY: number;
}
export interface EchoPrediction {
  tick: number;
  forwardM: number;
  turnRad: number;
  nominalCmS: number;
  turnRate: number;
  dt: number;
  sigmaCmS: number;
}
export interface EchoEpisode {
  version: typeof ECHO_VERSION;
  seed: number | null;
  simulator: string;
  tick: number;
  observation: MotionObservation;
  attempted: MotorCopy;
  prediction: EchoPrediction;
  errorCmS: number;
  before: number;
  after: number;
  turnGain: number;
  driftCmS: number;
  reliability: number;
}
export interface EchoState {
  tick: number;
  estimate: {
    positionM: [number, number, number];
    yaw: number;
    speedCmS: number;
    reserve: number;
    mode: Mode;
  };
  gain: number;
  turnGain: number;
  driftCmS: number;
  sigmaCmS: number;
  errorCmS: number | null;
  turnErrorRad: number | null;
  attribution: Attribution;
  failures: number;
  predictions: number;
  covered: number;
  recalled: number;
  adaptedActions: number;
  nominalEndCmS: number;
  pending: EchoPrediction | null;
  attempted: MotorCopy | null;
  window: Pair[];
  history: MotionObservation[];
  episodes: EchoEpisode[];
}
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const append = <T>(a: T[], v: T, n: number) => {
  a.push(v);
  if (a.length > n) a.shift();
};
const initial = (): EchoState => ({
  tick: 0,
  estimate: { positionM: [0, 0, 0], yaw: 0, speedCmS: 0, reserve: 1, mode: "rest" },
  gain: 1,
  turnGain: 1,
  driftCmS: 0,
  sigmaCmS: 0.2,
  errorCmS: null,
  turnErrorRad: null,
  attribution: "insufficient excitation",
  failures: 0,
  predictions: 0,
  covered: 0,
  recalled: 0,
  adaptedActions: 0,
  nominalEndCmS: 0,
  pending: null,
  attempted: null,
  window: [],
  history: [],
  episodes: [],
});

export class EchoModel {
  readonly variant: EchoVariant;
  readonly context: { seed: number | null; simulator: string };
  private value: EchoState = initial();
  constructor(
    variant: EchoVariant = "full",
    context: { seed: number | null; simulator: string } = {
      seed: null,
      simulator: "unknown",
    },
  ) {
    if (!ECHO_VARIANTS.includes(variant)) throw new Error("Unknown ECHO configuration");
    if (
      (context.seed !== null &&
        (!Number.isInteger(context.seed) ||
          context.seed < 0 ||
          context.seed > 0xffffffff)) ||
      typeof context.simulator !== "string" ||
      !context.simulator.length ||
      context.simulator.length > 80
    )
      throw new Error("Invalid ECHO provenance context");
    this.variant = variant;
    this.context = Object.freeze({ ...context });
  }
  /** Detached read: inspection cannot change learning. */
  inspect(): EchoState {
    return structuredClone(this.value);
  }
  /** Hash input includes pending predictions and all bounded memories. */
  get state(): EchoState {
    return this.inspect();
  }
  invalidate(): void {
    this.value.pending = null;
    this.value.attempted = null;
  }

  observe(raw: MotionObservation): void {
    // Copy only the closed sensor vocabulary. Extra caller fields never enter memory.
    const o: MotionObservation = {
      tick: raw.tick,
      t: raw.t,
      dt: raw.dt,
      forwardM: raw.forwardM,
      lateralM: raw.lateralM,
      verticalM: raw.verticalM,
      turnRad: raw.turnRad,
      reserve: raw.reserve,
      mode: raw.mode,
      clear: raw.clear,
    };
    if (
      ![
        o.tick,
        o.t,
        o.dt,
        o.forwardM,
        o.lateralM,
        o.verticalM,
        o.turnRad,
        o.reserve,
      ].every(Number.isFinite) ||
      o.dt < 0 ||
      o.dt > 1 ||
      !Number.isSafeInteger(o.tick) ||
      o.tick < 0 ||
      o.t < 0 ||
      o.reserve < 0 ||
      o.reserve > 1 ||
      typeof o.clear !== "boolean" ||
      !MODES.includes(o.mode)
    )
      throw new Error("Invalid ECHO sensor sample");
    const s = this.value;
    if (o.tick < s.tick || (o.tick === s.tick && s.history.length > 0))
      throw new Error("ECHO observations must be ordered");
    s.tick = o.tick;
    const e = s.estimate,
      yaw = e.yaw + o.turnRad / 2;
    e.positionM[0] += Math.cos(yaw) * o.forwardM + Math.sin(yaw) * o.lateralM;
    e.positionM[1] += o.verticalM;
    e.positionM[2] += -Math.sin(yaw) * o.forwardM + Math.cos(yaw) * o.lateralM;
    e.yaw = wrapAngle(e.yaw + o.turnRad);
    e.speedCmS = o.dt > 0 ? (o.forwardM * 100) / o.dt : 0;
    e.reserve = o.reserve;
    e.mode = o.mode;
    append(s.history, o, ECHO_LIMITS.history);
    const p = s.pending,
      a = s.attempted;
    s.pending = null;
    if (!p || !a || o.mode !== "walk" || !o.clear || Math.abs(o.dt - p.dt) > 1e-6) return;
    const y = e.speedCmS;
    const error = ((o.forwardM - p.forwardM) * 100) / o.dt;
    s.errorCmS = error;
    s.turnErrorRad = wrapAngle(o.turnRad - p.turnRad);
    s.predictions++;
    if (Math.abs(error) <= 1.645 * p.sigmaCmS) s.covered++;
    s.failures =
      Math.abs(error) > Math.max(0.15, 2 * p.sigmaCmS)
        ? s.failures + 1
        : Math.max(0, s.failures - 1);
    append(
      s.window,
      { x: p.nominalCmS, y, turnX: p.turnRate, turnY: o.turnRad / o.dt },
      ECHO_LIMITS.window,
    );
    const before = s.gain;
    if (this.variant !== "no_learning" && this.variant !== "disabled") this.learn();
    if (this.variant !== "no_uncertainty") {
      s.sigmaCmS = Math.sqrt(0.9 * s.sigmaCmS ** 2 + 0.1 * error ** 2);
      s.sigmaCmS = clamp(s.sigmaCmS, 0.06, 4);
    }
    if (
      this.variant !== "no_memory" &&
      this.variant !== "disabled" &&
      Math.abs(s.gain - before) > 0.015
    ) {
      append(
        s.episodes,
        {
          version: ECHO_VERSION,
          seed: this.context.seed,
          simulator: this.context.simulator,
          tick: o.tick,
          observation: o,
          attempted: a,
          prediction: p,
          errorCmS: error,
          before,
          after: s.gain,
          turnGain: s.turnGain,
          driftCmS: s.driftCmS,
          reliability: 1 / (1 + s.sigmaCmS),
        },
        ECHO_LIMITS.episodes,
      );
    }
  }

  private learn(): void {
    const s = this.value,
      w = s.window,
      n = w.length;
    if (n < 8) return;
    const mx = w.reduce((a, p) => a + p.x, 0) / n;
    const my = w.reduce((a, p) => a + p.y, 0) / n;
    const xx = w.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const xy = w.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
    // Insufficient variation makes gain and external bias unidentifiable.
    if (xx / n < 0.025) {
      s.attribution = "insufficient excitation";
      return;
    }
    const gain = clamp(xy / xx, 0.2, 1.6),
      drift = clamp(my - gain * mx, -3, 3);
    const residual = Math.sqrt(
      w.reduce((a, p) => a + (p.y - gain * p.x - drift) ** 2, 0) / n,
    );
    if (residual > 0.6) {
      s.attribution = "unreliable observations";
      return;
    }
    if (this.variant !== "no_memory") {
      const remembered = [...s.episodes]
        .reverse()
        .find(
          (e) =>
            Math.abs(e.after - gain) < 0.04 &&
            Math.abs(e.driftCmS - drift) < 0.1 &&
            Math.abs(e.after - s.gain) > 0.12 &&
            e.tick < s.tick - 100,
        );
      if (remembered) {
        s.gain = remembered.after;
        s.recalled++;
      }
    }
    s.gain += 0.2 * (gain - s.gain);
    s.driftCmS += 0.2 * (drift - s.driftCmS);
    const tt = w.reduce((a, p) => a + p.turnX ** 2, 0);
    if (tt > 0.1)
      s.turnGain +=
        0.2 *
        (clamp(w.reduce((a, p) => a + p.turnX * p.turnY, 0) / tt, 0.2, 1.6) - s.turnGain);
    const body = Math.abs(s.gain - 1) > 0.15 || Math.abs(s.turnGain - 1) > 0.15;
    const environment = Math.abs(s.driftCmS) > 0.25;
    s.attribution =
      body && environment
        ? "mixed"
        : body
          ? "action response changed"
          : environment
            ? "external disturbance"
            : "unchanged";
  }

  /** Efference copy is delivered only after validateCommand accepts the action. */
  predict(a: MotorCopy): void {
    if (
      ![a.walkSpeedCmS, a.yawRate, a.dt, a.stepS, a.walkTauS].every(Number.isFinite) ||
      a.walkSpeedCmS < 0 ||
      a.walkSpeedCmS > 100 ||
      Math.abs(a.yawRate) > Math.PI * 4 ||
      a.dt < 0.001 ||
      a.dt > 1 ||
      a.stepS < 0.001 ||
      a.stepS > a.dt ||
      a.walkTauS < 0 ||
      a.walkTauS > 10 ||
      !MODES.includes(a.mode)
    )
      throw new Error("Invalid ECHO motor copy");
    const s = this.value;
    s.attempted = { ...a };
    if (a.mode !== "walk" || this.variant === "disabled") {
      s.pending = null;
      s.nominalEndCmS = 0;
      return;
    }
    let end = s.nominalEndCmS,
      sum = 0;
    const count = Math.round(a.dt / a.stepS);
    for (let k = 0; k < count; k++) {
      end += (a.walkSpeedCmS - end) * (1 - Math.exp(-a.stepS / a.walkTauS));
      sum += end;
    }
    const nominal = sum / count;
    s.nominalEndCmS = end;
    s.pending = {
      tick: s.tick,
      forwardM: ((nominal * s.gain + s.driftCmS) * a.dt) / 100,
      turnRad: a.yawRate * s.turnGain * a.dt,
      nominalCmS: nominal,
      turnRate: a.yawRate,
      dt: a.dt,
      sigmaCmS: this.variant === "no_uncertainty" ? 0.2 : s.sigmaCmS,
    };
  }

  /** Explicit bounded compensation; high residual uncertainty slows the action. */
  regulate(
    speed: number,
    turn: number,
    maximum: number,
  ): { speed: number; turn: number } {
    const s = this.value;
    if (this.variant === "disabled") return { speed, turn };
    const cautious =
      this.variant !== "no_uncertainty" && (s.sigmaCmS > 0.8 || s.failures >= 3);
    const target = cautious ? speed * 0.65 : speed;
    // Deliberate small motor probes provide identifiability when uncertainty is high.
    const probe = cautious ? (Math.floor(s.tick / 40) % 2 ? 0.1 : -0.1) : 0;
    const out = {
      speed: clamp((target - s.driftCmS) / s.gain + probe, 0, maximum),
      turn: clamp(turn / s.turnGain, -Math.PI * 4, Math.PI * 4),
    };
    if (Math.abs(out.speed - speed) > 0.01 || Math.abs(out.turn - turn) > 0.01)
      s.adaptedActions++;
    return out;
  }

  /** Experimental self-model checkpoint only; never a complete fly checkpoint. */
  checkpoint(): string {
    const body = {
      schema: ECHO_VERSION,
      variant: this.variant,
      context: this.context,
      state: this.inspect(),
    };
    return canonicalJson({ ...body, hash: sha256Json(body) });
  }
  static restore(text: string): EchoModel {
    if (text.length > 150_000) throw new Error("ECHO checkpoint too large");
    const raw = JSON.parse(text) as {
      schema: string;
      variant: EchoVariant;
      context: { seed: number | null; simulator: string };
      state: EchoState;
      hash: string;
    };
    const errors = echoCheckpointErrors(raw, ECHO_VERSION, ECHO_VARIANTS, ECHO_LIMITS);
    if (errors.length) throw new Error("Invalid ECHO checkpoint: " + errors[0]);
    const { hash, ...body } = raw;
    if (raw.schema !== ECHO_VERSION || sha256Json(body) !== hash)
      throw new Error("ECHO checkpoint version or digest mismatch");
    const model = new EchoModel(raw.variant, raw.context),
      s = raw.state;
    if (
      s.covered > s.predictions ||
      s.history.some((o) => o.tick > s.tick) ||
      s.episodes.some((e) => e.tick > s.tick)
    )
      throw new Error("Invalid ECHO checkpoint chronology");
    model.value = structuredClone(s);
    return model;
  }
}
