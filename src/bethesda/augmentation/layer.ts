/**
 * The neural augmentation layer: research modules beside a fly's existing
 * controller, never in its place.
 *
 * `AugmentedAdapter` wraps an existing decision maker (the reduced-order
 * controller, ECHO, the organism, the circuit controller: any
 * `FlyNeuralAdapter`) and consults an `Advisor` alongside it. The wrapped
 * controller always decides first and remains authoritative. Three modes,
 * kept apart:
 *
 * - **observe** (the default): the advisor sees the sensable view of each
 *   decision (`AdvisorView`) and predicts; its predictions are scored against
 *   what the controller did. It controls nothing. The wrapper returns the
 *   controller's command untouched, presents the controller's descriptor and
 *   state, and so leaves the fly's state hash exactly as it would be without
 *   it (augmentation.test.ts steps both).
 * - **advise**: a validated advisor (`canAdvise`) also records bounded,
 *   timestamped recommendations: commands that passed the body's own gate at
 *   the moment they were made and expire after one decision period. Still
 *   nothing is applied; behaviour and state hash are unchanged.
 * - **experimental-hybrid**: on a disposable research subject only, with an
 *   explicit authorization naming it, a validated advisor may initiate the
 *   modes the authorization lists (for instance an escape). Everything else is
 *   the controller's. It is never a default, `refuseOriginal` refuses either
 *   original's id, and the wrapper's descriptor and state say that it is a
 *   hybrid.
 *
 * Failure falls back to the controller: an advisor that throws, returns
 * something malformed or non-finite, or proposes a command the gate refuses
 * is recorded and ignored; after `instabilityLimit` consecutive failures it is
 * switched off for the rest of the run. A wall-clock budget is checked too,
 * but in observe and advise modes it can only switch the advisor off (no
 * behaviour depends on it); in hybrid mode a budget switch-off is marked as
 * making the run not reproducible.
 *
 * An advisor sees only `AdvisorView`: what the fly senses (looming size,
 * expansion and direction; times to contact; light; odour; airflow; contact
 * with food) and its own motor program and reserve. Never the body's
 * position, velocity or heading, the world, the landing sites, the looming
 * thing's identity, kind or distance, or anything of the experimenter's.
 */
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  Mode,
  MotorCommand,
} from "../fly/neural.js";
import { validateCommand } from "../fly/neural.js";
import { refuseOriginal } from "../firstContact/originals.js";

export const AUGMENTATION_VERSION = "neural-augmentation/v1" as const;
export const AUGMENTATION_MODES = ["observe", "advise", "experimental-hybrid"] as const;
export type AugmentationMode = (typeof AUGMENTATION_MODES)[number];
export const DEFAULT_AUGMENTATION_MODE: AugmentationMode = "observe";

/** The sensable part of a decision's input: all an advisor may read. */
export interface AdvisorView {
  t: number;
  /** Proprioception: which motor program runs. */
  mode: Mode;
  looming: {
    sizeDeg: number;
    expansionDegS: number;
    bearing: number;
    elevation: number;
  } | null;
  ttcLeft: number;
  ttcRight: number;
  ttcFront: number;
  light: number;
  odour: number;
  airflow: number;
  airflowFrom: number | null;
  /** Tarsal taste: whether the feet stand on food. */
  onFood: boolean;
  /** Interoception: the reserve as a share of full. */
  reserve: number;
  /** Whether this is a decision or a fast-pathway sample between decisions. */
  pathway: "decision" | "fast";
}

export function advisorView(
  input: DecisionInput,
  pathway: AdvisorView["pathway"],
): AdvisorView {
  const f = input.frame;
  const l = f.looming;
  return {
    t: input.body.t,
    mode: input.body.mode,
    looming: l
      ? {
          sizeDeg: l.sizeDeg,
          expansionDegS: l.expansionDegS,
          bearing: l.bearing,
          elevation: l.elevation,
        }
      : null,
    ttcLeft: f.ttcLeft,
    ttcRight: f.ttcRight,
    ttcFront: f.ttcFront,
    light: f.light,
    odour: f.odour,
    airflow: f.airflow,
    airflowFrom: f.airflowFrom,
    onFood: input.body.onFood !== null,
    reserve: input.body.reserve,
    pathway,
  };
}

/** What an advisor predicts for one sample. */
export interface Prediction {
  /** The motor program it expects (observe) or would choose (advise, hybrid). */
  mode: Mode;
  /** For an escape: the heading relative to the fly's own (rad, + left), from what it sensed. */
  escapeBearing?: number;
  /** How sure it says it is, in [0, 1]. */
  confidence: number;
}

/** A held-out validation of an advisor's predictions, as some study recorded it. */
export interface AdvisorValidation {
  /** Where the numbers come from: a result file and the commit that wrote it. */
  source: string;
  heldOut: boolean;
  /** Escape predictions against what happened. */
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
}

export interface Advisor {
  readonly id: string;
  /** Null until a study validates it. */
  readonly validation: AdvisorValidation | null;
  /** Deterministic in its inputs; may throw (the layer falls back). */
  predict(view: AdvisorView): Prediction | null;
}

/** The bar a validation must clear before an advisor may advise or join a hybrid (model choices). */
export const ADVICE_CRITERIA = Object.freeze({
  minHitRate: 0.8,
  maxFalseAlarmRate: 0.05,
  minEvents: 20,
});

export function canAdvise(v: AdvisorValidation | null): { ok: boolean; why: string } {
  if (!v) return { ok: false, why: "not validated" };
  if (!v.heldOut) return { ok: false, why: "validated on development data only" };
  const events = v.hits + v.misses;
  if (events < ADVICE_CRITERIA.minEvents)
    return {
      ok: false,
      why: `${events} escape events, fewer than ${ADVICE_CRITERIA.minEvents}`,
    };
  const hit = v.hits / events;
  const fa = v.falseAlarms / Math.max(1, v.falseAlarms + v.correctRejections);
  if (hit < ADVICE_CRITERIA.minHitRate)
    return {
      ok: false,
      why: `hit rate ${hit.toFixed(3)} below ${ADVICE_CRITERIA.minHitRate}`,
    };
  if (fa > ADVICE_CRITERIA.maxFalseAlarmRate)
    return {
      ok: false,
      why: `false-alarm rate ${fa.toFixed(3)} above ${ADVICE_CRITERIA.maxFalseAlarmRate}`,
    };
  return { ok: true, why: "validation clears the advice criteria" };
}

/** Required for experimental-hybrid: who allowed it, on which disposable subject, which modes. */
export interface HybridAuthorization {
  subject: string;
  by: string;
  purpose: string;
  /** The modes the advisor may initiate. */
  initiate: Mode[];
  scope: "disposable-research-subject";
}

export interface Recommendation {
  /** Fly time it was made, and when it lapses (one decision period later). */
  t: number;
  expires: number;
  command: MotorCommand;
}

export interface AugmentationRecord {
  version: typeof AUGMENTATION_VERSION;
  mode: AugmentationMode;
  advisor: string;
  decisions: number;
  fastSamples: number;
  predictions: number;
  /** Decisions where the predicted mode was the controller's. */
  agreed: number;
  /**
   * Escape onsets predicted against the controller's, per sample, over every
   * sample at which the fly was not already escaping or taking off.
   */
  escape: {
    hits: number;
    misses: number;
    falseAlarms: number;
    correctRejections: number;
  };
  /** Fly times of escape onsets: the controller's and the advisor's (at most `keep` × 32 each). */
  onsets: { controller: number[]; advisor: number[] };
  failures: {
    thrown: number;
    malformed: number;
    refusedByGate: number;
    overBudget: number;
  };
  /** The most recent recommendations (advise and hybrid), newest last. */
  recommendations: Recommendation[];
  recommended: number;
  /** Hybrid: commands the advisor initiated that the controller had not. */
  initiated: number;
  disabled: { t: number; why: string } | null;
  reproducible: boolean;
}

export interface AugmentationOptions {
  mode?: AugmentationMode;
  /** Required for experimental-hybrid. */
  authorization?: HybridAuthorization;
  /** The subject's id, checked against the originals in every mode. */
  subject: string;
  /** Consecutive failures before the advisor is switched off. */
  instabilityLimit?: number;
  /** Wall-clock budget per consultation (ms). */
  budgetMs?: number;
  /** How many recommendations to keep. */
  keep?: number;
  /** A clock for the budget; `performance.now` by default. */
  clock?: () => number;
}

const MALFORMED = Symbol("malformed");

function wellFormed(p: unknown): Prediction | null | typeof MALFORMED {
  if (p === null || p === undefined) return null;
  if (typeof p !== "object") return MALFORMED;
  const q = p as Record<string, unknown>;
  if (typeof q.mode !== "string") return MALFORMED;
  if (typeof q.confidence !== "number" || !(q.confidence >= 0 && q.confidence <= 1))
    return MALFORMED;
  if (
    q.escapeBearing !== undefined &&
    !(typeof q.escapeBearing === "number" && Number.isFinite(q.escapeBearing))
  )
    return MALFORMED;
  return {
    mode: q.mode as Mode,
    confidence: q.confidence,
    ...(q.escapeBearing !== undefined ? { escapeBearing: q.escapeBearing } : {}),
  };
}

export class AugmentedAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  readonly advisor: Advisor;
  readonly mode: AugmentationMode;
  private readonly authorization: HybridAuthorization | null;
  private readonly instabilityLimit: number;
  private readonly budgetMs: number;
  private readonly keep: number;
  private readonly clock: () => number;
  private consecutive = 0;
  private readonly rec: AugmentationRecord;

  constructor(inner: FlyNeuralAdapter, advisor: Advisor, o: AugmentationOptions) {
    refuseOriginal(o.subject, "augmented subject");
    const mode = o.mode ?? DEFAULT_AUGMENTATION_MODE;
    if (!(AUGMENTATION_MODES as readonly string[]).includes(mode))
      throw new Error(`augmentation: unknown mode ${String(mode)}`);
    if (mode !== "observe") {
      const gate = canAdvise(advisor.validation);
      if (!gate.ok)
        throw new Error(`augmentation: ${advisor.id} may not ${mode}: ${gate.why}`);
    }
    if (mode === "experimental-hybrid") {
      const a = o.authorization;
      if (!a)
        throw new Error(
          "augmentation: experimental-hybrid needs an explicit authorization",
        );
      if (a.scope !== "disposable-research-subject")
        throw new Error(
          "augmentation: a hybrid runs on a disposable research subject only",
        );
      if (a.subject !== o.subject)
        throw new Error("augmentation: the authorization names another subject");
      if (!a.by.trim() || !a.purpose.trim())
        throw new Error("augmentation: an authorization says who and why");
      if (!o.subject.startsWith("research-"))
        throw new Error(
          "augmentation: hybrid subjects are research subjects (research-…)",
        );
      if (!a.initiate.length)
        throw new Error("augmentation: a hybrid lists what the advisor may initiate");
    }
    this.inner = inner;
    this.advisor = advisor;
    this.mode = mode;
    this.authorization = o.authorization ?? null;
    this.instabilityLimit = o.instabilityLimit ?? 5;
    this.budgetMs = o.budgetMs ?? 5;
    this.keep = o.keep ?? 32;
    this.clock = o.clock ?? (() => performance.now());
    // Observe and advise wear the controller's own descriptor: the body behaves exactly as it would without the layer.
    this.descriptor =
      mode === "experimental-hybrid"
        ? {
            ...inner.descriptor,
            id: `${AUGMENTATION_VERSION} hybrid (${advisor.id} may initiate ${this.authorization!.initiate.join(", ")}) over ${inner.descriptor.id}`,
            label: `${inner.descriptor.label} with an experimental hybrid`,
          }
        : inner.descriptor;
    this.rec = {
      version: AUGMENTATION_VERSION,
      mode,
      advisor: advisor.id,
      decisions: 0,
      fastSamples: 0,
      predictions: 0,
      agreed: 0,
      escape: { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 },
      onsets: { controller: [], advisor: [] },
      failures: { thrown: 0, malformed: 0, refusedByGate: 0, overBudget: 0 },
      recommendations: [],
      recommended: 0,
      initiated: 0,
      disabled: null,
      reproducible: true,
    };
  }

  /**
   * The controller's state, exactly, so the fly's state hash is untouched in
   * observe and advise. A hybrid's state also holds what decides its future:
   * how many commands it initiated and whether its advisor is off.
   */
  get state(): unknown {
    const inner = (this.inner as { state?: unknown }).state ?? null;
    if (this.mode !== "experimental-hybrid") return inner;
    return {
      inner,
      hybrid: { initiated: this.rec.initiated, disabled: this.rec.disabled },
    };
  }

  /** What the layer recorded: a copy, never the live record. */
  get record(): AugmentationRecord {
    return structuredClone(this.rec);
  }

  start(body: BodySnapshot): void {
    this.inner.start?.(body);
  }

  private fail(t: number, kind: keyof AugmentationRecord["failures"]) {
    this.rec.failures[kind]++;
    if (++this.consecutive >= this.instabilityLimit && !this.rec.disabled)
      this.rec.disabled = {
        t,
        why: `${this.consecutive} consecutive failures (last: ${kind})`,
      };
  }

  private consult(
    input: DecisionInput,
    pathway: AdvisorView["pathway"],
  ): Prediction | null {
    if (this.rec.disabled) return null;
    const t0 = this.clock();
    let raw: unknown;
    try {
      raw = this.advisor.predict(advisorView(input, pathway));
    } catch {
      this.fail(input.body.t, "thrown");
      return null;
    }
    if (this.clock() - t0 > this.budgetMs) {
      this.rec.failures.overBudget++;
      if (!this.rec.disabled) {
        this.rec.disabled = {
          t: input.body.t,
          why: `over the ${this.budgetMs} ms budget`,
        };
        if (this.mode === "experimental-hybrid") this.rec.reproducible = false;
      }
      return null;
    }
    const p = wellFormed(raw);
    if (p === MALFORMED) {
      this.fail(input.body.t, "malformed");
      return null;
    }
    this.consecutive = 0;
    if (p) this.rec.predictions++;
    return p;
  }

  private score(
    input: DecisionInput,
    p: Prediction | null,
    actual: MotorCommand | null,
    decision: boolean,
  ) {
    if (decision && p && actual && p.mode === actual.mode) this.rec.agreed++;
    const predicted = p?.mode === "escape";
    const cap = this.keep * 32;
    // An advisor's escape is recorded whenever it is made, also once the fly is
    // already escaping: a prediction later than the controller's onset must
    // still be matchable by `onsetAgreement`. (Before this was fixed, such
    // predictions were dropped; docs/FIRST_CONTACT.md discloses the run that
    // measured with it.)
    if (predicted && this.rec.onsets.advisor.length < cap)
      this.rec.onsets.advisor.push(input.body.t);
    const m = input.body.mode;
    // An escape or takeoff already under way is no controller onset, and no
    // sample for the per-sample tally.
    if (m === "escape" || m === "takeoff") return;
    const escaped = actual?.mode === "escape";
    const e = this.rec.escape;
    if (predicted && escaped) e.hits++;
    else if (!predicted && escaped) e.misses++;
    else if (predicted && !escaped) e.falseAlarms++;
    else e.correctRejections++;
    if (escaped && this.rec.onsets.controller.length < cap)
      this.rec.onsets.controller.push(input.body.t);
  }

  /** The command the advisor would give, if it passes the gate now. */
  private proposal(p: Prediction, input: DecisionInput): MotorCommand | null {
    const body = input.body;
    let cmd: MotorCommand;
    if (p.mode === "escape")
      cmd = {
        mode: "escape",
        heading: body.yaw + (p.escapeBearing ?? Math.PI),
        prepare: 0.05,
        reason: `advised by ${this.advisor.id} (confidence ${p.confidence.toFixed(2)})`,
      };
    else if (p.mode === "rest" || p.mode === "groom")
      cmd = { mode: p.mode, reason: `advised by ${this.advisor.id}` };
    else return null;
    const v = validateCommand(cmd, body, input.params);
    if (!v.ok) {
      // The body's own rules refusing a proposal (an escape while airborne) is not a malfunction.
      this.rec.failures.refusedByGate++;
      return null;
    }
    return v.command;
  }

  private remember(t: number, command: MotorCommand, period: number) {
    this.rec.recommended++;
    this.rec.recommendations.push({ t, expires: t + period, command });
    if (this.rec.recommendations.length > this.keep)
      this.rec.recommendations.splice(0, this.rec.recommendations.length - this.keep);
  }

  private act(
    input: DecisionInput,
    own: MotorCommand | null,
    pathway: AdvisorView["pathway"],
  ): MotorCommand | null {
    const p = this.consult(input, pathway);
    this.score(input, p, own, pathway === "decision");
    if (!p || this.mode === "observe") return own;
    const proposal = p.mode === own?.mode ? null : this.proposal(p, input);
    if (!proposal) return own;
    this.remember(input.body.t, proposal, input.params.decisionPeriodMs / 1000);
    if (
      this.mode === "experimental-hybrid" &&
      this.authorization!.initiate.includes(proposal.mode) &&
      own?.mode !== "escape"
    ) {
      this.rec.initiated++;
      return proposal;
    }
    return own;
  }

  decide(input: DecisionInput): MotorCommand {
    this.rec.decisions++;
    const own = this.inner.decide(input);
    return this.act(input, own, "decision") ?? own;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    this.rec.fastSamples++;
    const own = this.inner.interrupt?.(input) ?? null;
    return this.act(input, own, "fast");
  }
}

/**
 * Event-level agreement of escape onsets: a controller onset is a hit when
 * the advisor predicted an onset within `windowS` of it (each prediction
 * matched once); unmatched predictions are false alarms.
 */
export function onsetAgreement(
  onsets: AugmentationRecord["onsets"],
  windowS = 0.1,
): { hits: number; misses: number; falseAlarms: number } {
  const used = new Set<number>();
  let hits = 0;
  for (const t of onsets.controller) {
    let best = -1,
      bestD = Infinity;
    onsets.advisor.forEach((a, i) => {
      const d = Math.abs(a - t);
      if (!used.has(i) && d <= windowS && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      hits++;
    }
  }
  return {
    hits,
    misses: onsets.controller.length - hits,
    falseAlarms: onsets.advisor.length - used.size,
  };
}
