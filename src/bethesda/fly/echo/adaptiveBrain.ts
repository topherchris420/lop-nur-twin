/**
 * ECHO's embodied plasticity: a bounded memory of how reliably its own walking
 * carries it forward, kept separately for a low and a normal energy reserve.
 *
 * It learns only from what the fly itself did and felt:
 *
 * - the walking command the controller actually issued (after the self-model
 *   acted on it), recorded at the decision;
 * - at the next decision, the self-motion sense's reading over the period just
 *   ended (selfMotion.ts: forward displacement and touch, as the fly feels them,
 *   noise included) and the body's own leg speed at both ends of the period.
 *
 * A period counts as evidence only if the body walked for all of it: a refused
 * command (the body's safe hold), a mode change, a reflex in between or a body
 * whose legs barely stepped all leave nothing to learn from, and are counted as
 * discarded, never as failures. Each period is credited at most once (its sample
 * time must move forward), so a restart or a repeated call cannot count it twice.
 *
 * It is a policy with three modes, held in its own state (and so in every
 * checkpoint):
 *
 * - `shadow`: it learns, and changes nothing. It also counts the decisions an
 *   active policy would have changed, so its effect can be judged first.
 * - `active`: once a context has enough evidence and the one-sided 95% Wilson
 *   lower bound of its failure rate exceeds one half, it scales the intended
 *   walking speed by 0.7, before the ECHO self-model acts on the intention (so
 *   the self-model predicts from what is really commanded). It never chooses a
 *   mode, a heading, a turn, a takeoff or a landing, and it cannot act on a
 *   reflex: the fast pathway and the body's command gate stay the original's.
 * - `disabled`: it neither learns nor acts; what it learned is kept.
 *
 * No random draws, no closures: plain data, so the snapshot holds all of it and a
 * restored fly continues exactly. Not a connectome, not a biological learning
 * rule, and no claim of awareness. Whether active mode helps is an empirical
 * question (docs/benchmarks/echo-plasticity/); it is not assumed.
 */
import type { DecisionInput, MotorCommand } from "../neural.js";

export const ADAPTIVE_BRAIN_VERSION = "echo-embodied-plasticity/v2" as const;

export const PLASTICITY_MODES = ["shadow", "active", "disabled"] as const;
export type PlasticityMode = (typeof PLASTICITY_MODES)[number];
export const isPlasticityMode = (v: unknown): v is PlasticityMode =>
  typeof v === "string" && (PLASTICITY_MODES as readonly string[]).includes(v);

export const PLASTICITY_PARAMS = Object.freeze({
  /** Detailed evidence kept for inspection. */
  recentKept: 48,
  /** Past this many periods in one context the counts halve: a recency-weighted estimate. */
  countCap: 1024,
  /** Valid walking periods (one per decision, 50 ms) in a context before it may act. */
  minEvidence: 40,
  /** One-sided 95% Wilson bound. Periods are autocorrelated, so the bound is nominal. */
  z: 1.645,
  /** Act only when the failure rate's lower bound exceeds this. */
  failureBound: 0.5,
  /** A period is effective when the body advanced at least this share of what its legs stepped. */
  progressShare: 0.4,
  /** Legs stepping less than this over a period (m) teach nothing. */
  minLegM: 0.0005,
  /** The one change active mode may make: the intended walking speed, times this. */
  cautiousScale: 0.7,
  /** The body's reserve share below which the low-energy context applies. */
  lowReserve: 0.35,
});

export type EnergyContext = "low" | "normal";
const CONTEXTS: readonly EnergyContext[] = ["low", "normal"];
const ADAPTED_REASON = "; learned cautious gait";
/** The body gate's limit on a reason (neural.ts LIMITS.reasonChars). */
const REASON_LIMIT = 500;

export interface WalkingEvidence {
  t: number;
  context: EnergyContext;
  effective: boolean;
  touched: boolean;
  /** Forward displacement the self-motion sense read over the period (m). */
  forwardM: number;
  /** What the legs stepped over the period (m): the mean of the leg speeds at its ends. */
  legsM: number;
}

interface Counts {
  succeeded: number;
  failed: number;
}

interface Pending {
  /** Body time at the decision that issued the walk. */
  t: number;
  context: EnergyContext;
  /** The leg speed when the command was issued (cm/s). */
  legCmS: number;
  /** The walking speed the issued command asked for (cm/s). */
  commandedCmS: number;
}

export interface Adaptation {
  t: number;
  context: EnergyContext;
  fromCmS: number;
  toCmS: number;
  failureLower: number;
}

export interface AdaptiveBrainState {
  schema: typeof ADAPTIVE_BRAIN_VERSION;
  mode: PlasticityMode;
  contexts: Record<EnergyContext, Counts>;
  pending: Pending | null;
  /** The newest credited sample's time: a sample at or before it is never counted. */
  lastSampleT: number | null;
  recent: WalkingEvidence[];
  /** Periods credited as evidence. */
  samples: number;
  /** Periods that had an issued walk but taught nothing (refused, interrupted, not walking throughout, legs still, duplicate). */
  discarded: number;
  /** Decisions active mode changed. */
  adaptations: number;
  /** Decisions shadow mode would have changed, had it been active. */
  shadowWouldAdapt: number;
  lastAdaptation: Adaptation | null;
}

export interface ContextVerdict {
  /** Evidence periods held now (after any halving). */
  n: number;
  /** Posterior mean failure rate, Beta(1, 1) prior. */
  failure: number;
  /** One-sided 95% Wilson lower bound of the failure rate; 0 with no evidence. */
  failureLower: number;
  /** Whether active mode would act in this context now. */
  cautious: boolean;
}

export interface AdaptiveBrainStatus {
  version: typeof ADAPTIVE_BRAIN_VERSION;
  mode: PlasticityMode;
  samples: number;
  discarded: number;
  adaptations: number;
  shadowWouldAdapt: number;
  contexts: Record<EnergyContext, ContextVerdict>;
  lastAdaptation: Adaptation | null;
}

export function freshPlasticityState(
  mode: PlasticityMode = "shadow",
): AdaptiveBrainState {
  return {
    schema: ADAPTIVE_BRAIN_VERSION,
    mode,
    contexts: {
      low: { succeeded: 0, failed: 0 },
      normal: { succeeded: 0, failed: 0 },
    },
    pending: null,
    lastSampleT: null,
    recent: [],
    samples: 0,
    discarded: 0,
    adaptations: 0,
    shadowWouldAdapt: 0,
    lastAdaptation: null,
  };
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** One-sided Wilson lower bound of a proportion. */
export function wilsonLower(
  failures: number,
  n: number,
  z = PLASTICITY_PARAMS.z,
): number {
  if (n <= 0) return 0;
  const p = failures / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export const contextOf = (reserve: number): EnergyContext =>
  reserve < PLASTICITY_PARAMS.lowReserve ? "low" : "normal";

/** A bounded, deterministic, serializable memory of walking consequences. */
export class EmbodiedPlasticity {
  readonly state: AdaptiveBrainState;

  constructor(mode: PlasticityMode = "shadow") {
    if (!isPlasticityMode(mode))
      throw new Error(`unknown plasticity mode ${String(mode)}`);
    this.state = freshPlasticityState(mode);
  }

  get mode(): PlasticityMode {
    return this.state.mode;
  }

  /** What a context's evidence says now. Pure. */
  verdict(context: EnergyContext): ContextVerdict {
    const c = this.state.contexts[context];
    const n = c.succeeded + c.failed;
    const failureLower = wilsonLower(c.failed, n);
    return {
      n,
      failure: (c.failed + 1) / (n + 2),
      failureLower,
      cautious:
        n >= PLASTICITY_PARAMS.minEvidence &&
        failureLower > PLASTICITY_PARAMS.failureBound,
    };
  }

  /**
   * Credit the walk issued at the previous decision with the period that just
   * ended, if the body really walked it. Called first at each decision.
   */
  observe(input: DecisionInput): void {
    const p = this.state.pending;
    this.state.pending = null;
    if (!p || this.state.mode === "disabled") return;
    const s = input.self;
    const b = input.body;
    if (
      !s ||
      !finite(s.t) ||
      !finite(s.dt) ||
      s.dt <= 0 ||
      !finite(s.forward) ||
      typeof s.touched !== "boolean" ||
      (this.state.lastSampleT !== null && s.t <= this.state.lastSampleT) ||
      s.t <= p.t ||
      b.mode !== "walk" ||
      b.modeT + 1e-9 < s.dt ||
      !finite(b.walkSpeed)
    ) {
      this.state.discarded++;
      return;
    }
    const legsM = ((p.legCmS + b.walkSpeed) / 2 / 100) * s.dt;
    if (legsM < PLASTICITY_PARAMS.minLegM) {
      this.state.discarded++;
      return;
    }
    const effective = !s.touched && s.forward >= PLASTICITY_PARAMS.progressShare * legsM;
    const counts = this.state.contexts[p.context];
    if (effective) counts.succeeded++;
    else counts.failed++;
    if (counts.succeeded + counts.failed >= PLASTICITY_PARAMS.countCap) {
      counts.succeeded = Math.floor(counts.succeeded / 2);
      counts.failed = Math.floor(counts.failed / 2);
    }
    this.state.lastSampleT = s.t;
    this.state.samples++;
    this.state.recent.push({
      t: s.t,
      context: p.context,
      effective,
      touched: s.touched,
      forwardM: s.forward,
      legsM,
    });
    if (this.state.recent.length > PLASTICITY_PARAMS.recentKept)
      this.state.recent.splice(
        0,
        this.state.recent.length - PLASTICITY_PARAMS.recentKept,
      );
  }

  /**
   * The intention before the self-model acts on it. Only an intended walk with
   * a positive speed, off an edge, may change, and only in active mode.
   */
  shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    const mode = this.state.mode;
    const speed = intention.walkSpeed;
    if (
      mode === "disabled" ||
      intention.mode !== "walk" ||
      input.body.edge ||
      !finite(speed) ||
      speed <= 0
    )
      return intention;
    const context = contextOf(input.body.reserve);
    const v = this.verdict(context);
    if (!v.cautious) return intention;
    if (mode === "shadow") {
      this.state.shadowWouldAdapt++;
      return intention;
    }
    const toCmS = speed * PLASTICITY_PARAMS.cautiousScale;
    this.state.adaptations++;
    this.state.lastAdaptation = {
      t: input.body.t,
      context,
      fromCmS: speed,
      toCmS,
      failureLower: v.failureLower,
    };
    const reason =
      intention.reason.length + ADAPTED_REASON.length <= REASON_LIMIT
        ? intention.reason + ADAPTED_REASON
        : intention.reason;
    return { ...intention, walkSpeed: toCmS, reason };
  }

  /** The command the decision returned: a walk becomes the trial the next period answers. */
  issued(command: MotorCommand, body: DecisionInput["body"]): void {
    this.state.pending = null;
    if (this.state.mode === "disabled") return;
    const speed = command.walkSpeed;
    if (
      command.mode !== "walk" ||
      !finite(speed) ||
      speed <= 0 ||
      !finite(body.walkSpeed)
    )
      return;
    this.state.pending = {
      t: body.t,
      context: contextOf(body.reserve),
      legCmS: body.walkSpeed,
      commandedCmS: speed,
    };
  }

  /** A reflex took over between decisions: the outstanding trial answers nothing. */
  interrupted(): void {
    if (this.state.pending) this.state.discarded++;
    this.state.pending = null;
  }

  /** For observers and the runner's log. Reads only. */
  status(): AdaptiveBrainStatus {
    const s = this.state;
    return {
      version: ADAPTIVE_BRAIN_VERSION,
      mode: s.mode,
      samples: s.samples,
      discarded: s.discarded,
      adaptations: s.adaptations,
      shadowWouldAdapt: s.shadowWouldAdapt,
      contexts: {
        low: this.verdict("low"),
        normal: this.verdict("normal"),
      },
      lastAdaptation: s.lastAdaptation ? { ...s.lastAdaptation } : null,
    };
  }
}

/** The contexts, for anything that lists them. */
export const ENERGY_CONTEXTS = CONTEXTS;
