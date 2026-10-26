/**
 * Project ECHO's self-model: a computational model the digital fly keeps of
 * its own sensorimotor capabilities, which it tests against every period of
 * its own motion and revises when the evidence supports it.
 *
 * Each decision period runs one cycle:
 *
 * 1. observe: the self-motion sense reports how far the fly went and turned,
 *    and its antennae how the air goes by;
 * 2. estimate: the report is compared with what the fly predicted when it
 *    acted, and its beliefs about its body and surroundings (estimator.ts)
 *    move by what the error warrants; the antennae's reading moves its belief
 *    in the wind;
 * 3. doubt: it rescales how far it trusts its own sense, watches for errors
 *    that persist (a cumulative-sum detector, Page 1954) and, when they do,
 *    opens an inquiry into why (inquiry.ts);
 * 4. remember: periods go into a short-term history and concluded inquiries
 *    into episodic memory (memory.ts);
 * 5. act: the reduced-order controller's command is the fly's intention. The
 *    self-model makes it cautious when the fly is unsure of itself, may
 *    replace it with a probe that would tell explanations apart, and then
 *    compensates it by its beliefs (a weaker leg is asked for more), so that
 *    what happens is what was intended;
 * 6. predict: what the command should do over the next period, from the
 *    revised beliefs.
 *
 * It reads only `SelfModelView` (view.ts). It returns ordinary motor commands,
 * which the fly's gate checks like any other. It simulates no neurons and is
 * no claim about how a fly's nervous system does any of this: it is the
 * reafference principle (von Holst & Mittelstaedt 1950) and efference copy,
 * which flies do use in vision (Kim, Fitzgerald & Maimon 2015), built as
 * explicit Bayesian bookkeeping.
 */
import type { MotorCommand } from "../neural.js";
import {
  cloneBelief,
  diffuse,
  feelAir,
  update,
  spreads,
  widen,
  type Belief,
} from "./estimator.js";
import {
  BELIEF_NAMES,
  INNATE,
  N,
  WIND,
  X,
  predict,
  predictAir,
  rotated,
  type PeriodContext,
  type PeriodKind,
} from "./forward.js";
import { diag, sig } from "./linalg.js";
import {
  logBelief,
  remember,
  rememberEpisode,
  type BeliefChange,
  type Episode,
  type Explanation,
  type Period,
} from "./memory.js";
import {
  openInquiry,
  posterior,
  verdict,
  wantsProbe,
  weigh,
  type Inquiry,
  type InquiryRule,
} from "./inquiry.js";
import { detect, freshDetector, type Detector } from "./detector.js";
import { ECHO_VERSION, EP } from "./params.js";
import type { SelfModelView } from "./view.js";

export const ECHO_STATE = "echo-state/v2" as const;

/**
 * The self-model and its ablations. `reactive` has none at all (the
 * reduced-order controller alone, adapter.ts); the others switch off one
 * mechanism each, or replace the inquiry's weighing with a simpler rule.
 */
export const ECHO_VARIANTS = [
  "full",
  "reactive",
  "no_learning",
  "no_memory",
  "no_uncertainty",
  "naive_self",
  "motion_gated",
] as const;
export type EchoVariant = (typeof ECHO_VARIANTS)[number];

export const VARIANT_LABELS: Readonly<Record<EchoVariant, string>> = {
  full: "the full self-model",
  reactive: "no self-model (the reduced-order controller alone)",
  no_learning: "predictive learning disabled (beliefs never revised)",
  no_memory: "episodic memory disabled",
  no_uncertainty:
    "uncertainty estimation disabled (fixed trust in its sense, best-fit explanations, no caution or probes)",
  naive_self: "a self-only baseline (every unexplained change is its own)",
  motion_gated:
    "a motion-gated baseline (a change met while moving is its own, one met standing is the world's)",
};

const RULES: Record<Exclude<EchoVariant, "reactive">, InquiryRule> = {
  full: "bayesian",
  no_learning: "bayesian",
  no_memory: "bayesian",
  no_uncertainty: "best-fit",
  naive_self: "self-only",
  motion_gated: "motion-gated",
};

export interface EchoEvent {
  t: number;
  kind: "noticed" | "concluded" | "probe";
  /** Noticed: where the change is taken to begin (s). */
  since?: number;
  explanation?: Explanation;
  candidate?: string;
  probability?: number;
  resolved?: boolean;
  probe?: "stop" | "walk";
}

export interface EchoState {
  schema: typeof ECHO_STATE;
  version: typeof ECHO_VERSION;
  variant: Exclude<EchoVariant, "reactive">;
  seed: number | null;
  fly: string;
  /** Decision periods observed, and when the last ended (s). */
  period: number;
  t: number;
  belief: Belief;
  /** How much noisier than its innate expectation the fly takes its sense to be (≥ 1). */
  noiseScale: number;
  /**
   * The fly's own estimate of its heading (rad, in its own frame): its sensed
   * turns added up, and held to the sky's compass when it sees the sun.
   */
  heading: number;
  /** The sun's direction in that frame, fixed at the first sight of it; null until then. */
  sun: number | null;
  /**
   * The air: whether the antennae have felt it move (from then on the fly
   * tracks the wind), whether the fly was aloft at the last period's end, how
   * many of the antennae's readings it has taken, the last of them, and how
   * fast it takes the wind to be changing (m/s per s, x and z in its frame).
   */
  wind: {
    felt: boolean;
    aloft: boolean;
    readings: number;
    last: WindReading | null;
    rate: [number, number];
    /** The air going by at the end of the last period, in its frame (m/s), its expected spread, and when. */
    air: { t: number; v: [number, number]; sd: number } | null;
  };
  nisWindow: number[];
  detector: Detector;
  inquiry: Inquiry | null;
  /** What the fly expects of the period under way: its context and the prediction. */
  pending: { context: PeriodContext; y: [number, number, number] } | null;
  /** The latest period's comparison, for inspection. */
  last: {
    t: number;
    kind: PeriodKind;
    predicted: [number, number, number];
    observed: [number, number, number];
    sd: [number, number, number];
    nis: number;
    learned: boolean;
  } | null;
  /** Flight commands, for whether the velocity tracker has settled: the horizontal speed and how many periods it has held. */
  flight: { speed: number; hover: boolean; held: number };
  probe: { kind: "stop" | "walk"; until: number } | null;
  caution: boolean;
  history: Period[];
  episodes: Episode[];
  nextEpisode: number;
  beliefs: BeliefChange[];
  events: EchoEvent[];
  /** How often the observed value fell inside the predicted central 50% and 90% (forward, left, turn). */
  calibration: { n: number; in50: number[]; in90: number[] };
  counts: {
    periods: number;
    learned: number;
    refused: number;
    inquiries: number;
    concluded: Record<Explanation, number>;
    unresolved: number;
    recalls: number;
    probes: number;
    cautious: number;
    compensated: number;
  };
}

/**
 * One reading of the antennae as the wind's rate is taken from it: standing
 * still or hovering, the air going by in the fly's frame; in cruise, the air
 * from ahead, at a heading and a commanded speed.
 */
export type WindReading =
  | { kind: "still" | "hover"; air: [number, number] }
  | { kind: "cruise"; ahead: number; heading: number; airSpeed: number };

const EVENTS_KEPT = 32;
/**
 * Flight periods teach only after the same command has held this long (10
 * periods, 0.5 s): six of the body's 80 ms velocity time constants, when the
 * tracker is within 0.2% of the command. A model choice of the self-model.
 */
const FLIGHT_SETTLED = 10;
const Z50 = 0.6745,
  Z90 = 1.6449;

/** How fast each belief is expected to wander unprompted (per √s). */
const PROCESS: readonly number[] = [
  EP.selfProcessSd,
  EP.selfProcessSd,
  EP.selfProcessSd,
  EP.selfProcessSd,
  EP.selfProcessSd,
  EP.selfProcessSd,
  EP.driftProcessSd,
  EP.driftProcessSd,
  EP.selfProcessSd,
  // The air changes with time whether or not a period teaches (`observe`).
  0,
  0,
];

/** The innate belief: an unimpaired body in still surroundings, with the innate spreads; still air, without doubt. */
export function innateBelief(): Belief {
  return {
    x: INNATE.slice(),
    P: diag([
      EP.gainPriorSd ** 2,
      EP.gainPriorSd ** 2,
      EP.biasPriorSd ** 2,
      EP.gainPriorSd ** 2,
      EP.gainPriorSd ** 2,
      EP.biasPriorSd ** 2,
      EP.driftPriorSd ** 2,
      EP.driftPriorSd ** 2,
      EP.spinPriorSd ** 2,
      0,
      0,
    ]),
  };
}

/** The antennae's reading as the air's motion past the fly, forward and left (m/s), and its expected spread. */
function airReading(air: { speedMS: number; from: number }): { y: number[]; sd: number } {
  return {
    y: [-air.speedMS * Math.cos(air.from), -air.speedMS * Math.sin(air.from)],
    sd: EP.airSenseShare * air.speedMS + EP.airSenseFloorMS,
  };
}

export function initialEchoState(
  variant: Exclude<EchoVariant, "reactive">,
  seed: number | null,
  fly: string,
): EchoState {
  return {
    schema: ECHO_STATE,
    version: ECHO_VERSION,
    variant,
    seed,
    fly,
    period: 0,
    t: 0,
    belief: innateBelief(),
    noiseScale: 1,
    heading: 0,
    sun: null,
    wind: { felt: false, aloft: false, readings: 0, last: null, rate: [0, 0], air: null },
    nisWindow: [],
    detector: freshDetector(0),
    inquiry: null,
    pending: null,
    last: null,
    flight: { speed: 0, hover: false, held: 0 },
    probe: null,
    caution: false,
    history: [],
    episodes: [],
    nextEpisode: 1,
    beliefs: [],
    events: [],
    calibration: { n: 0, in50: [0, 0, 0], in90: [0, 0, 0] },
    counts: {
      periods: 0,
      learned: 0,
      refused: 0,
      inquiries: 0,
      concluded: { none: 0, self: 0, external: 0, both: 0, sensor: 0 },
      unresolved: 0,
      recalls: 0,
      probes: 0,
      cautious: 0,
      compensated: 0,
    },
  };
}

const ALL = new Set(Array.from({ length: N }, (_, i) => i));
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const PERCHED_STILL = new Set(["rest", "groom", "feed"]);

export class SelfModel {
  state: EchoState;
  private onEvent: ((e: EchoEvent) => void) | null;
  constructor(state: EchoState, onEvent: ((e: EchoEvent) => void) | null = null) {
    this.state = state;
    this.onEvent = onEvent;
  }

  get rule(): InquiryRule {
    return RULES[this.state.variant];
  }
  private get learns(): boolean {
    return this.state.variant !== "no_learning";
  }
  private get remembers(): boolean {
    return this.state.variant !== "no_memory";
  }
  private get doubts(): boolean {
    return this.state.variant !== "no_uncertainty";
  }

  private event(e: EchoEvent): void {
    const S = this.state;
    S.events.push(e);
    if (S.events.length > EVENTS_KEPT) S.events.splice(0, S.events.length - EVENTS_KEPT);
    this.onEvent?.(e);
  }

  /** A reflex took over during the period: what it does is not what was predicted, so the period teaches nothing. */
  interrupted(): void {
    if (this.state.pending) this.state.pending.context.learnable = false;
  }

  /** Steps 1–4: the period just ended, as the self-motion sense reports it. */
  observe(view: SelfModelView): void {
    const S = this.state;
    const pending = S.pending;
    S.pending = null;
    const sample = view.self;
    if (!pending || !sample) return;
    S.period++;
    S.counts.periods++;
    S.t = sample.t;
    const y: [number, number, number] = [sample.forward, sample.lateral, sample.turn];
    const context: PeriodContext = { ...pending.context, T: sample.dt };
    // What the body did must be what was predicted for: the motor program still running, nothing touched.
    const consistent =
      context.kind === "walk"
        ? view.mode === "walk"
        : context.kind === "still"
          ? PERCHED_STILL.has(view.mode)
          : context.kind === "flight"
            ? view.mode === "flight"
            : false;
    context.learnable = context.learnable && consistent && !sample.touched;
    // In cruise in wind the antennae tell which regime the wings were in: air
    // from ahead below their limit, at it, or none from ahead at all.
    if (context.wind && context.kind === "flight" && !context.hover)
      context.regime =
        view.air === null || Math.cos(view.air.from) <= 0
          ? "carried"
          : view.air.speedMS >= context.airMax * 0.99
            ? "limit"
            : "held";
    S.heading += sample.turn;
    // The sun holds the heading: its bearing tells where the fly faces in the frame its first sight fixed.
    if (view.compass !== null) {
      if (S.sun === null) S.sun = S.heading + view.compass;
      else S.heading = S.sun - view.compass;
    }
    // The air going by, and how much further than its wings held it the body
    // went in flight while its air velocity caught up with a change.
    const W = S.wind;
    const reading = view.air ? airReading(view.air) : null;
    const felt: [number, number] = reading
      ? rotated(reading.y, Math.cos(S.heading), Math.sin(S.heading))
      : [0, 0];
    const feltSd = reading ? reading.sd : EP.airQuietMS;
    const start =
      W.air && Math.abs(W.air.t - (sample.t - sample.dt)) < 1e-6 ? W.air : null;
    let settled = true;
    if (context.wind && context.kind === "flight") {
      if (start) {
        const tau = context.flightTau;
        context.airLag = [tau * (felt[0] - start.v[0]), tau * (felt[1] - start.v[1])];
        context.airLagSd = tau * Math.hypot(start.sd, feltSd);
        settled =
          Math.hypot(felt[0] - start.v[0], felt[1] - start.v[1]) <= EP.airSettleMS;
      } else context.learnable = false;
    }
    W.air = { t: sample.t, v: felt, sd: feltSd };
    // The air, once the antennae have felt it move: it changes as it will,
    // and the air at a surface is not the air aloft.
    const aloft = view.mode === "flight" || view.mode === "land";
    let windVar = 0;
    if (this.learns && (W.felt || view.air)) {
      windVar = !W.felt
        ? EP.windPriorSd ** 2
        : EP.windProcessSd ** 2 * sample.dt +
          (aloft !== W.aloft ? EP.windPriorSd ** 2 : 0);
      W.felt = true;
      S.belief = widen(S.belief, WIND, Math.sqrt(windVar));
    }
    W.aloft = aloft;
    const prior = this.learns ? diffuse(S.belief, sample.dt, PROCESS) : S.belief;
    let nis = 0;
    let z: [number, number, number] = [0, 0, 0];
    let predicted = predict(prior.x, context).y;
    let sd = predict(prior.x, context).sd;
    if (context.learnable) {
      const r = update(prior, context, y, S.noiseScale, this.learns ? null : ALL);
      predicted = r.update.prediction.y;
      sd = r.update.sd;
      if (r.update.ok) {
        nis = r.update.nis;
        z = [0, 1, 2].map((i) => r.update.innovation[i]! / r.update.sd[i]!) as typeof z;
        S.counts.learned++;
        S.belief = this.learns ? r.belief : prior;
        const c = S.calibration;
        c.n++;
        for (let i = 0; i < 3; i++) {
          const z = Math.abs(r.update.innovation[i]!) / r.update.sd[i]!;
          if (z <= Z50) c.in50[i]!++;
          if (z <= Z90) c.in90[i]!++;
        }
      } else S.counts.refused++;
    }
    // What the antennae felt at the period's end, against what they should have.
    let air: Period["air"] = null;
    if (this.learns && context.wind && context.learnable && settled && reading) {
      const legSpeed = view.legSpeedCmS / 100;
      const rows = predictAir(S.belief.x, context, S.heading, legSpeed);
      const y = reading.y.slice(0, rows.length);
      const sd = y.map(() => reading.sd);
      const r = feelAir(S.belief, rows, y, sd);
      if (rows.length && r.ok) {
        S.belief = r.belief;
        W.readings++;
        air = { y, sd, heading: S.heading, legSpeed };
      }
    }
    this.windRate(air, context, sample.dt);
    S.last = {
      t: sample.t,
      kind: context.kind,
      predicted: [predicted[0], predicted[1], predicted[2]],
      observed: y,
      sd: [sd[0], sd[1], sd[2]],
      nis,
      learned: context.learnable,
    };
    const period: Period = {
      k: S.period,
      t: sample.t,
      context,
      y,
      noiseScale: S.noiseScale,
      prior: cloneBelief(prior),
      predicted: [predicted[0], predicted[1], predicted[2]],
      sd: [sd[0], sd[1], sd[2]],
      nis,
      moving:
        (context.kind === "walk" && context.legCommand > 0) ||
        (context.kind === "flight" && context.airSpeed > 0),
      windVar,
      air,
    };
    remember(S.history, period);
    if (!context.learnable) return;
    this.doubt(nis);
    if (S.inquiry) {
      weigh(S.inquiry, period);
      this.consider(view);
      return;
    }
    // A change: errors larger than expected, or of one sign, for longer than chance allows.
    const from = detect(S.detector, S.period, nis, z);
    if (from !== null) {
      S.counts.inquiries++;
      // Earlier inquiries' conclusions settle into memory as the fly last held them.
      for (const e of S.episodes) if (e.settled === null) e.settled = S.belief.x.slice();
      S.inquiry = openInquiry(
        S.history,
        from,
        sample.t,
        { belief: S.belief, noiseScale: S.noiseScale },
        S.episodes,
        this.rule,
        this.remembers,
      );
      this.event({ t: sample.t, kind: "noticed", since: S.inquiry.since });
      this.consider(view);
    }
  }

  /**
   * How fast the wind is changing, from the antennae alone (never from the
   * beliefs, whose revisions it feeds): the change between two readings of
   * one kind in a row, smoothed over `windRateTauS`. Walking, or after any
   * break, it is taken as steady again.
   */
  private windRate(air: Period["air"], c: PeriodContext, dt: number): void {
    const W = this.state.wind;
    const kind =
      !air || c.kind === "walk"
        ? null
        : c.kind === "still"
          ? "still"
          : c.hover
            ? "hover"
            : "cruise";
    if (!air || kind === null) {
      W.last = null;
      W.rate = [0, 0];
      return;
    }
    const cosH = Math.cos(air.heading),
      sinH = Math.sin(air.heading);
    const reading: WindReading =
      kind === "cruise"
        ? { kind, ahead: air.y[0]!, heading: air.heading, airSpeed: c.airSpeed }
        : { kind, air: rotated(air.y, cosH, sinH) };
    const last = W.last;
    let raw: [number, number] | null = null;
    if (last?.kind === "cruise" && reading.kind === "cruise") {
      // Along the heading only, while the command and the heading hold.
      if (
        last.airSpeed === reading.airSpeed &&
        Math.abs(reading.heading - last.heading) < 0.05
      )
        raw = rotated([(reading.ahead - last.ahead) / dt, 0], cosH, sinH);
    } else if (last && last.kind === reading.kind && reading.kind !== "cruise") {
      const a = (last as { air: [number, number] }).air;
      raw = [(reading.air[0] - a[0]) / dt, (reading.air[1] - a[1]) / dt];
    }
    const k = dt / (dt + EP.windRateTauS);
    W.rate = raw
      ? [W.rate[0] + k * (raw[0] - W.rate[0]), W.rate[1] + k * (raw[1] - W.rate[1])]
      : [0, 0];
    W.last = reading;
  }

  /** How far the fly trusts its sense: widened when errors outrun their predicted spread, narrowed back when not. */
  private doubt(nis: number): void {
    const S = this.state;
    S.nisWindow.push(nis);
    if (S.nisWindow.length > EP.noiseWindow)
      S.nisWindow.splice(0, S.nisWindow.length - EP.noiseWindow);
    // Rescaling stops while an inquiry weighs whether the sense itself has changed.
    if (!this.doubts || S.inquiry || S.nisWindow.length < EP.noiseWindow) return;
    // Toward the scale at which errors are as large as predicted: mean NIS 3.
    const mean = S.nisWindow.reduce((a, b) => a + b, 0) / S.nisWindow.length;
    const ratio = Math.min(4, Math.max(0.25, mean / 3));
    S.noiseScale = Math.min(EP.noiseScaleMax, Math.max(1, S.noiseScale * ratio ** 0.025));
  }

  /** An open inquiry: conclude it when the evidence allows, or ask for a probe. */
  private consider(view: SelfModelView): void {
    const S = this.state;
    const inq = S.inquiry!;
    const v = verdict(inq, this.rule);
    if (v.done) {
      this.conclude(inq, v.winner.id, v.probability, v.resolved, v.posterior);
      return;
    }
    if (
      this.doubts &&
      (view.mode === "walk" || view.mode === "rest") &&
      wantsProbe(inq, this.rule, S.t)
    ) {
      inq.probes++;
      inq.lastProbe = S.t;
      S.counts.probes++;
      const kind = view.mode === "walk" ? "stop" : "walk";
      S.probe = { kind, until: S.t + EP.probeS };
      this.event({ t: S.t, kind: "probe", probe: kind });
    }
  }

  private conclude(
    inq: Inquiry,
    id: string,
    probability: number,
    resolved: boolean,
    post: Record<string, number>,
  ): void {
    const S = this.state;
    const winner = inq.candidates.find((c) => c.id === id)!;
    const before = S.belief.x.slice();
    if (this.learns) {
      S.belief = cloneBelief(winner.belief);
      if (winner.explains === "sensor" && this.doubts)
        S.noiseScale = Math.min(EP.noiseScaleMax, winner.noiseScale);
    }
    const after = S.belief.x.slice();
    S.counts.concluded[winner.explains]++;
    if (!resolved) S.counts.unresolved++;
    if (winner.recall !== null) {
      S.counts.recalls++;
      const e = S.episodes.find((x) => x.id === winner.recall);
      if (e) e.recalled++;
    }
    const n = Math.max(1, inq.periods);
    const s = inq.sums;
    const mean3 = (v: readonly number[]): [number, number, number] => [
      sig(v[0]! / n),
      sig(v[1]! / n),
      sig(v[2]! / n),
    ];
    if (this.remembers)
      rememberEpisode(S.episodes, {
        id: S.nextEpisode++,
        simulation: { fly: S.fly, echo: S.version, seed: S.seed },
        noticed: inq.noticed,
        since: inq.since,
        concluded: S.t,
        period: S.period,
        observed: { periods: inq.periods, mean: mean3(s.y) },
        action: {
          kinds: {
            still: s.kinds.still ?? 0,
            walk: s.kinds.walk ?? 0,
            flight: s.kinds.flight ?? 0,
            other: s.kinds.other ?? 0,
          },
          legCommandCmS: sig(s.legCommand / n),
          turnCommand: sig(s.turnCommand / n),
        },
        predicted: { mean: mean3(s.predicted) },
        outcome: { meanInnovation: mean3(s.innovation), meanNis: sig(s.nis / n) },
        explanation: winner.explains,
        candidate: winner.id,
        resolved,
        posterior: Object.fromEntries(Object.entries(post).map(([k, v]) => [k, sig(v)])),
        before: before.map((v) => sig(v, 6)),
        after: after.map((v) => sig(v, 6)),
        settled: null,
        reliability: {
          posterior: sig(probability),
          spreads: spreads(S.belief).map((v) => sig(v)),
        },
        recalled: 0,
      });
    const why = `${winner.id === winner.explains ? winner.explains : `${winner.explains} (${winner.id})`}, p = ${probability.toFixed(2)}${resolved ? "" : ", unresolved"}`;
    for (let i = 0; i < N; i++) {
      // The wind is followed, not concluded, unless the conclusion is that it changed.
      if ((WIND as readonly number[]).includes(i) && winner.id !== "external:wind")
        continue;
      const moved = Math.abs(after[i]! - before[i]!);
      const visible =
        i === X.driftX || i === X.driftZ
          ? moved > 5e-4
          : i === X.windX || i === X.windZ
            ? moved > 0.05
            : moved > 0.02;
      if (visible)
        logBelief(S.beliefs, {
          t: S.t,
          what: BELIEF_NAMES[i]!,
          from: sig(before[i]!),
          to: sig(after[i]!),
          why,
        });
    }
    S.inquiry = null;
    S.detector = freshDetector(S.period + 1);
    S.nisWindow = [];
    this.event({
      t: S.t,
      kind: "concluded",
      explanation: winner.explains,
      candidate: winner.id,
      probability,
      resolved,
    });
  }

  /** The leading explanations of an open inquiry, for inspection. */
  leading(): { id: string; explains: Explanation; p: number }[] {
    const inq = this.state.inquiry;
    if (!inq) return [];
    const p = posterior(inq, this.rule);
    return inq.candidates
      .map((c) => ({ id: c.id, explains: c.explains, p: p[c.id]! }))
      .sort((a, b) => b.p - a.p);
  }

  /** Whether the fly is unsure of the effector it is about to use, or of its sense. */
  private unsure(view: SelfModelView): boolean {
    const S = this.state;
    if (!this.doubts) return false;
    const airborne = view.mode === "flight" || view.mode === "land";
    const i = airborne ? X.wingGain : X.legGain;
    const sd = Math.sqrt(Math.max(0, S.belief.P[i * N + i]!));
    return (
      S.inquiry !== null || sd > EP.cautionGainSd || S.noiseScale >= EP.cautionNoiseScale
    );
  }

  /**
   * Steps 5–6: from the controller's intention to the command, and what the
   * command should do. Returns the intention as the self-model left it
   * (after caution and probes) and the compensated command.
   */
  act(
    intention: MotorCommand,
    view: SelfModelView,
  ): { intention: MotorCommand; command: MotorCommand } {
    const S = this.state;
    let intent: MotorCommand = { ...intention };
    if (intention.velocity) intent.velocity = [...intention.velocity];
    // A probe: an experiment of the fly's own, a stop or a short walk.
    if (S.probe && S.t >= S.probe.until) S.probe = null;
    if (S.probe) {
      if (S.probe.kind === "stop" && view.mode === "walk" && intent.mode === "walk")
        intent = {
          mode: "rest",
          reason: "probe: stop, to see whether the motion goes on without me",
        };
      else if (S.probe.kind === "walk" && view.mode === "rest" && intent.mode === "rest")
        intent = {
          mode: "walk",
          walkSpeed: EP.probeSpeedCmS,
          yawRate: 0,
          reason: "probe: a short straight walk, to see how my steps carry me",
        };
    }
    // Caution: slower, and no voluntary takeoff, while the fly doubts itself.
    S.caution = this.unsure(view);
    if (S.caution) {
      S.counts.cautious++;
      if (intent.mode === "walk" && intent.walkSpeed !== undefined)
        intent.walkSpeed *= EP.cautionShare;
      else if (intent.mode === "flight" && view.mode === "flight" && intent.velocity)
        intent.velocity = [
          intent.velocity[0] * EP.cautionShare,
          intent.velocity[1],
          intent.velocity[2] * EP.cautionShare,
        ];
      else if (
        intent.mode === "takeoff" &&
        (view.mode === "rest" || view.mode === "walk")
      )
        intent = {
          mode: "rest",
          reason: "caution: no voluntary takeoff while unsure of its own movement",
        };
    }
    const command = this.learns ? this.compensate(intent, view) : { ...intent };
    if (command.velocity) command.velocity = [...command.velocity];
    this.expect(command, view);
    return { intention: intent, command };
  }

  /** The command that, by the fly's beliefs, would do what it intends. */
  private compensate(intent: MotorCommand, view: SelfModelView): MotorCommand {
    const S = this.state;
    const x = S.belief.x;
    const floor = (g: number) => Math.max(EP.gainFloor, g);
    const cmd: MotorCommand = { ...intent };
    let changed = false;
    if (intent.mode === "walk") {
      if (intent.walkSpeed !== undefined) {
        cmd.walkSpeed = clamp(
          intent.walkSpeed / floor(x[X.legGain]!),
          0,
          view.schema.walkMaxCmS,
        );
        changed ||= cmd.walkSpeed !== intent.walkSpeed;
      }
      if (intent.yawRate !== undefined) {
        cmd.yawRate = clamp(
          (intent.yawRate - x[X.legTurnBias]! - x[X.spin]!) / floor(x[X.legTurnGain]!),
          -6,
          6,
        );
        changed ||= cmd.yawRate !== intent.yawRate;
      }
    } else if (intent.mode === "flight" && view.mode === "flight") {
      if (intent.velocity) {
        const g = floor(x[X.wingGain]!);
        let vx = intent.velocity[0] / g,
          vz = intent.velocity[2] / g;
        const vy = intent.velocity[1];
        const n = Math.hypot(vx, vy, vz);
        // Within the body's flight limit, horizontal speed given up first.
        if (n > 1.45) {
          const room = Math.sqrt(Math.max(0, 1.45 ** 2 - vy * vy)) / Math.hypot(vx, vz);
          vx *= room;
          vz *= room;
        }
        cmd.velocity = [vx, vy, vz];
        changed ||= vx !== intent.velocity[0] || vz !== intent.velocity[2];
      }
      const tg = floor(x[X.wingTurnGain]!);
      if (intent.yawRate !== undefined) {
        cmd.yawRate = clamp((intent.yawRate - x[X.wingTurnBias]!) / tg, -12, 12);
        changed ||= cmd.yawRate !== intent.yawRate;
      }
      if (intent.saccade !== undefined) {
        cmd.saccade = clamp(intent.saccade / tg, -Math.PI, Math.PI);
        changed ||= cmd.saccade !== intent.saccade;
      }
    }
    if (changed) S.counts.compensated++;
    return cmd;
  }

  /** Step 6: what the command should do over the coming period. */
  private expect(cmd: MotorCommand, view: SelfModelView): void {
    const S = this.state;
    const T = view.schema.decisionS,
      h = view.schema.stepS;
    const steps = Math.max(1, Math.round(T / h));
    const base: PeriodContext = {
      kind: "other",
      T,
      steps,
      h: T / steps,
      legSpeed0: 0,
      legCommand: 0,
      tau: view.schema.walkTauS,
      turnCommand: 0,
      airSpeed: 0,
      hover: false,
      airMax: view.schema.airMaxMS,
      wind: S.wind.felt,
      flightTau: view.schema.flightTauS,
      windRate: [S.wind.rate[0], S.wind.rate[1]],
      airLag: [0, 0],
      airLagSd: 0,
      regime: null,
      heading: S.heading,
      learnable: false,
    };
    // Flight: is the velocity tracker settled on the same command?
    const flying = cmd.mode === "flight" && view.mode === "flight";
    // The command sets the hover: the body hovers exactly while its commands say so.
    const hover = flying && cmd.hover === true;
    const speed =
      flying && cmd.velocity && !hover ? Math.hypot(cmd.velocity[0], cmd.velocity[2]) : 0;
    const F = S.flight;
    if (
      flying &&
      cmd.saccade === undefined &&
      F.hover === hover &&
      Math.abs(F.speed - speed) <= 0.02 * Math.max(speed, 0.01)
    )
      F.held++;
    else F.held = 0;
    F.speed = speed;
    F.hover = hover;
    let context: PeriodContext = base;
    if (cmd.mode === "walk" && (view.mode === "walk" || view.mode === "rest"))
      context = {
        ...base,
        kind: "walk",
        legSpeed0: view.mode === "walk" ? view.legSpeedCmS / 100 : 0,
        legCommand: view.edge ? 0 : (cmd.walkSpeed ?? view.legSpeedCmS) / 100,
        turnCommand: cmd.yawRate ?? 0,
        learnable: !view.edge,
      };
    else if (PERCHED_STILL.has(cmd.mode) && PERCHED_STILL.has(view.mode))
      context = { ...base, kind: "still", learnable: true };
    else if (flying)
      context = {
        ...base,
        kind: "flight",
        turnCommand: cmd.yawRate ?? 0,
        airSpeed: speed,
        hover,
        learnable:
          cmd.saccade === undefined &&
          (view.sub === "cruise" || view.sub === "hover") &&
          F.held >= FLIGHT_SETTLED &&
          Math.abs(cmd.yawRate ?? 0) <= 0.5,
      };
    S.pending = { context, y: predict(S.belief.x, context).y };
  }
}

/** The fly's capability as it believes it now: its top walking speed and how sure it is of it. */
export function believedCapability(s: EchoState, walkMaxCmS: number) {
  const sd = spreads(s.belief);
  return {
    walkMaxCmS: walkMaxCmS * Math.max(0, s.belief.x[X.legGain]!),
    legGain: s.belief.x[X.legGain]!,
    legGainSd: sd[X.legGain]!,
    wingGain: s.belief.x[X.wingGain]!,
    wingGainSd: sd[X.wingGain]!,
  };
}
