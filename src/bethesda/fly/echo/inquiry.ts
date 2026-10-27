/**
 * When the fly's predictions keep failing, it asks why. An inquiry sets
 * competing explanations side by side, each a copy of the belief the fly held
 * where the change began with one kind of freedom added, and re-weighs the
 * evidence since then under each:
 *
 * - `none`: nothing changed (the alarm was noise);
 * - `self`: its own gains or biases changed (legs or wings, whichever it was
 *   using), so the same commands now move it differently;
 * - `external`: something outside carries or turns it, whatever it commands,
 *   or (once its antennae have felt the air move) the wind has changed by
 *   more than it expected (`external:wind`);
 * - `both`: its body and its surroundings changed together;
 * - `sensor`: its own sense of motion became noisier;
 * - `nominal`: its body is back to the body it was born with;
 * - `recall:<id>`: a change it concluded once before has come back, with the
 *   beliefs that episode left it with (memory.ts).
 *
 * Each is scored by the predictive likelihood of the evidence (the Kalman
 * filter's marginal likelihood), which charges an explanation for freedom it
 * does not need: one that can fit anything spreads its predictions thin. The
 * explanations differ in what they predict when the fly stops, starts, turns
 * or walks faster, because a change in its own gains scales with what it
 * commands, while a push from outside does not; when the evidence cannot yet
 * tell them apart the fly may act to find out (a probe). The inquiry
 * concludes when one explanation's posterior passes `commitPosterior`, or
 * unresolved after `inquiryMaxPeriods`.
 *
 * The comparison is a computation over the fly's own predictions and senses.
 * It is never handed the experimenter's perturbation, its label or its cause.
 */
import { cloneBelief, feelAir, update, widen, assume, type Belief } from "./estimator.js";
import { BIASES, GAINS, INNATE, SELF, WIND, X, predictAir } from "./forward.js";
import {
  awayFromInnate,
  recallable,
  settledSelf,
  type Episode,
  type Explanation,
  type Period,
} from "./memory.js";
import { EP } from "./params.js";

/** How the self-model weighs explanations, by variant (adapter.ts). */
export type InquiryRule = "bayesian" | "best-fit" | "self-only" | "motion-gated";

export interface Candidate {
  id: string;
  explains: Explanation;
  /** The episode a recall hypothesis brings back. */
  recall: number | null;
  belief: Belief;
  noiseScale: number;
  logPrior: number;
  logLik: number;
  /** Minus the summed squared residual after fitting, in innate noise units: a score blind to uncertainty. */
  fit: number;
}

export interface Inquiry {
  noticed: number;
  /** Where the change is taken to have begun: the period, and its time. */
  fromPeriod: number;
  since: number;
  periods: number;
  /** Of those, the periods whose command moved the fly. */
  moving: number;
  candidates: Candidate[];
  probes: number;
  lastProbe: number;
  /** Sums over the evidence, for the episode record. */
  sums: {
    y: [number, number, number];
    predicted: [number, number, number];
    innovation: [number, number, number];
    nis: number;
    legCommand: number;
    turnCommand: number;
    kinds: Record<string, number>;
  };
}

const LEGS = [X.legGain, X.legTurnGain, X.legTurnBias] as const;
const WINGS = [X.wingGain, X.wingTurnGain, X.wingTurnBias] as const;

/** Widen the given self beliefs for a "the body changed" hypothesis. */
function freeSelf(b: Belief, which: readonly number[]): Belief {
  const gains = which.filter((i) => (GAINS as readonly number[]).includes(i));
  const biases = which.filter((i) => (BIASES as readonly number[]).includes(i));
  return widen(widen(b, gains, EP.changeGainSd), biases, EP.changeBiasSd);
}
function freeOutside(b: Belief): Belief {
  return widen(
    widen(b, [X.driftX, X.driftZ], EP.changeDriftSd),
    [X.spin],
    EP.changeSpinSd,
  );
}

/**
 * Open an inquiry from the history back to the change point: build the
 * explanations the rule allows and re-weigh every period since.
 */
export function openInquiry(
  history: readonly Period[],
  fromPeriod: number,
  now: number,
  base: { belief: Belief; noiseScale: number },
  episodes: readonly Episode[],
  rule: InquiryRule,
  recall: boolean,
): Inquiry {
  const start = history.findIndex((p) => p.k >= fromPeriod);
  const evidence = start < 0 ? [] : history.slice(start);
  const first = evidence[0];
  const prior = first ? cloneBelief(first.prior) : cloneBelief(base.belief);
  const scale = first ? first.noiseScale : base.noiseScale;
  // The body changed in the effector it was using since the change began, or both when it used both.
  const used = new Set(evidence.map((p) => p.context.kind));
  const effectors: number[] = [
    ...(used.has("walk") || used.has("still") || !used.has("flight") ? LEGS : []),
    ...(used.has("flight") ? WINGS : []),
  ];
  const c = (
    id: string,
    explains: Explanation,
    belief: Belief,
    weight: number,
    noiseScale = scale,
    recalled: number | null = null,
  ): Candidate => ({
    id,
    explains,
    recall: recalled,
    belief,
    noiseScale,
    logPrior: Math.log(weight),
    logLik: 0,
    fit: 0,
  });
  const memories = recall && rule !== "motion-gated" ? recallable(episodes, prior.x) : [];
  const innate = awayFromInnate(prior.x);
  const family = memories.length + (innate ? 1 : 0);
  // The self, outside and sensor explanations are equally likely a priori,
  // each family split among its specific forms (one gain, one bias, one kind
  // of push, or several at once); a body remembered, or the innate one, takes
  // half of the self family when there is one; nothing changed and both at
  // once take the rest.
  const selfShare = family ? 0.5 : 1;
  const pick = (kinds: readonly number[]) => effectors.filter((i) => kinds.includes(i));
  const speed = pick([X.legGain, X.wingGain]),
    turnGain = pick([X.legTurnGain, X.wingTurnGain]),
    turnBias = pick([X.legTurnBias, X.wingTurnBias]);
  const candidates: Candidate[] = [
    c("none", "none", cloneBelief(prior), 0.2),
    c("self:speed", "self", freeSelf(prior, speed), 0.05 * selfShare),
    c("self:turn-gain", "self", freeSelf(prior, turnGain), 0.05 * selfShare),
    c("self:turn-bias", "self", freeSelf(prior, turnBias), 0.05 * selfShare),
    c("self:body", "self", freeSelf(prior, effectors), 0.05 * selfShare),
  ];
  if (rule !== "self-only") {
    candidates.push(
      c(
        "external:drift",
        "external",
        widen(prior, [X.driftX, X.driftZ], EP.changeDriftSd),
        0.08,
      ),
      c("external:spin", "external", widen(prior, [X.spin], EP.changeSpinSd), 0.08),
      c("external:all", "external", freeOutside(prior), 0.04),
      // The wind, once the fly tracks it: it changed by more than it expected.
      ...(evidence.some((p) => p.context.wind)
        ? [c("external:wind", "external", widen(prior, WIND, EP.changeWindSd), 0.08)]
        : []),
      c("both", "both", freeOutside(freeSelf(prior, effectors)), 0.1),
      c("sensor", "sensor", cloneBelief(prior), 0.2, scale * EP.sensorFaultFactor),
    );
  }
  const memoryWeight = family ? (0.2 * (1 - selfShare)) / family : 0;
  if (innate)
    candidates.push(
      c("nominal", "self", assume(prior, SELF, INNATE, EP.recallSd), memoryWeight),
    );
  for (const e of memories) {
    const x = prior.x.slice();
    settledSelf(e).forEach((v, j) => (x[SELF[j]!] = v));
    candidates.push(
      c(
        `recall:${e.id}`,
        "self",
        assume(prior, SELF, x, EP.recallSd),
        memoryWeight,
        scale,
        e.id,
      ),
    );
  }
  const inquiry: Inquiry = {
    noticed: now,
    fromPeriod: first?.k ?? fromPeriod,
    since: first ? first.t - first.context.T : now,
    periods: 0,
    moving: 0,
    candidates,
    probes: 0,
    lastProbe: -1e9,
    sums: {
      y: [0, 0, 0],
      predicted: [0, 0, 0],
      innovation: [0, 0, 0],
      nis: 0,
      legCommand: 0,
      turnCommand: 0,
      kinds: {},
    },
  };
  for (const p of evidence) weigh(inquiry, p);
  return inquiry;
}

/** Re-weigh one period under every explanation. */
export function weigh(inquiry: Inquiry, p: Period): void {
  const ctx = p.context;
  const s = inquiry.sums;
  s.kinds[ctx.kind] = (s.kinds[ctx.kind] ?? 0) + 1;
  // The air changed over every period after the first, whose doubt is in the explanations' starting belief.
  if (p.windVar > 0 && p.k > inquiry.fromPeriod)
    for (const c of inquiry.candidates)
      c.belief = widen(c.belief, WIND, Math.sqrt(p.windVar));
  if (!ctx.learnable) return;
  inquiry.periods++;
  if (p.moving) inquiry.moving++;
  for (let i = 0; i < 3; i++) {
    s.y[i]! += p.y[i]!;
    s.predicted[i]! += p.predicted[i]!;
    s.innovation[i]! += p.y[i]! - p.predicted[i]!;
  }
  s.nis += p.nis;
  s.legCommand += ctx.legCommand * 100;
  s.turnCommand += ctx.turnCommand;
  for (const c of inquiry.candidates) {
    const r = update(c.belief, ctx, p.y, c.noiseScale, null);
    if (!r.update.ok) continue;
    c.belief = r.belief;
    c.logLik += r.update.logLik;
    const sd = r.update.prediction.sd;
    c.fit -= r.update.residual.reduce((a, v, i) => a + (v / sd[i]!) ** 2, 0);
    if (p.air) {
      const rows = predictAir(c.belief.x, ctx, p.air.heading, p.air.legSpeed);
      const a = feelAir(c.belief, rows, p.air.y.slice(0, rows.length), p.air.sd);
      if (a.ok) {
        c.belief = a.belief;
        c.logLik += a.logLik;
      }
    }
  }
}

/** Each explanation's posterior probability under the rule. */
export function posterior(inquiry: Inquiry, rule: InquiryRule): Record<string, number> {
  const cs = inquiry.candidates;
  const out: Record<string, number> = {};
  if (rule === "best-fit" || rule === "motion-gated") {
    const best = winnerOf(inquiry, rule);
    for (const c of cs) out[c.id] = c === best ? 1 : 0;
    return out;
  }
  const lp = cs.map((c) => c.logPrior + c.logLik);
  const max = Math.max(...lp);
  const w = lp.map((v) => Math.exp(v - max));
  const total = w.reduce((a, b) => a + b, 0);
  cs.forEach((c, i) => (out[c.id] = w[i]! / total));
  return out;
}

function winnerOf(inquiry: Inquiry, rule: InquiryRule): Candidate {
  const cs = inquiry.candidates;
  if (rule === "motion-gated") {
    // The simpler sensorimotor rule: a change met while moving is the body's, one met standing is the world's.
    const id = inquiry.moving * 2 >= inquiry.periods ? "self:body" : "external:all";
    return cs.find((c) => c.id === id) ?? cs[0]!;
  }
  if (rule === "best-fit")
    return cs.reduce((best, c) => (c.fit > best.fit ? c : best), cs[0]!);
  const p = posterior(inquiry, rule);
  return cs.reduce((best, c) => (p[c.id]! > p[best.id]! ? c : best), cs[0]!);
}

export type Verdict =
  | { done: false; leading: Candidate; probability: number }
  | {
      done: true;
      winner: Candidate;
      probability: number;
      resolved: boolean;
      posterior: Record<string, number>;
    };

/** Whether the inquiry may conclude now, and with what. */
/**
 * Whether two explanations, fitted to the evidence, now make the same claim:
 * the same kind of cause and the same beliefs to within half the recall
 * distance (gains and biases), 2 mm/s (drift), 10 cm/s (the wind) and the
 * same trust in the sense.
 * A remembered "back to normal" and the innate body, or "my speed changed"
 * and "my body changed" when only the speed did, end as one claim; their
 * posteriors are added rather than left to split.
 */
export function sameClaim(a: Candidate, b: Candidate): boolean {
  if (a.explains !== b.explains) return false;
  if (Math.abs(Math.log(a.noiseScale / b.noiseScale)) > 0.1) return false;
  const x = a.belief.x,
    y = b.belief.x;
  const tol = EP.recallDistance / 2;
  for (const i of [...GAINS, ...BIASES, X.spin])
    if (Math.abs(x[i]! - y[i]!) >= tol) return false;
  return (
    Math.abs(x[X.driftX]! - y[X.driftX]!) < 0.002 &&
    Math.abs(x[X.driftZ]! - y[X.driftZ]!) < 0.002 &&
    Math.abs(x[X.windX]! - y[X.windX]!) < 0.1 &&
    Math.abs(x[X.windZ]! - y[X.windZ]!) < 0.1
  );
}

/** The posterior of every explanation making the same claim as `c`. */
export const claimMass = (inquiry: Inquiry, c: Candidate, p: Record<string, number>) =>
  inquiry.candidates.reduce((sum, o) => sum + (sameClaim(c, o) ? p[o.id]! : 0), 0);

export function verdict(inquiry: Inquiry, rule: InquiryRule): Verdict {
  const p = posterior(inquiry, rule);
  const leading = winnerOf(inquiry, rule);
  const probability =
    rule === "bayesian" || rule === "self-only"
      ? claimMass(inquiry, leading, p)
      : p[leading.id]!;
  const enough =
    inquiry.periods >= EP.inquiryMinPeriods && !confounded(inquiry, leading, p);
  // The rules blind to uncertainty conclude as soon as the minimum evidence is in.
  const sure =
    rule === "best-fit" || rule === "motion-gated"
      ? true
      : probability >= EP.commitPosterior;
  if (enough && sure)
    return { done: true, winner: leading, probability, resolved: true, posterior: p };
  if (inquiry.periods >= EP.inquiryMaxPeriods)
    return { done: true, winner: leading, probability, resolved: false, posterior: p };
  return { done: false, leading, probability };
}

/**
 * Whether the leading explanation wins only on its prior: the best rival on
 * the other side of the question "is it me?" fits the evidence as well (their
 * best-fit residuals within `confoundChi2`), so concluding now would rest on
 * expectation, not on evidence. Until the probes are spent, the fly keeps
 * asking instead.
 */
export function confounded(
  inquiry: Inquiry,
  leading: Candidate,
  p: Record<string, number>,
): boolean {
  if (inquiry.probes >= 2) return false;
  const own = leading.explains === "self";
  const outside = leading.explains === "external" || leading.explains === "both";
  if (!own && !outside) return false;
  const rivals = inquiry.candidates.filter((c) =>
    own ? c.explains === "external" || c.explains === "both" : c.explains === "self",
  );
  if (!rivals.length) return false;
  const best = rivals.reduce((a, b) => (b.fit > a.fit ? b : a));
  return leading.fit - best.fit < EP.confoundChi2 && (p[best.id] ?? 0) > 1e-6;
}

/**
 * Whether the evidence calls for a probe: the inquiry has run a while, is
 * undecided, and its two leading explanations disagree about whether the
 * change is the fly's own, which a stop or a start would show.
 */
export function wantsProbe(inquiry: Inquiry, rule: InquiryRule, t: number): boolean {
  if (rule !== "bayesian") return false;
  if (inquiry.periods < EP.probeAfterPeriods || inquiry.probes >= 2) return false;
  if (t - inquiry.lastProbe < EP.probeS + 0.5) return false;
  const p = posterior(inquiry, rule);
  const ranked = [...inquiry.candidates].sort((a, b) => p[b.id]! - p[a.id]!);
  const a = ranked[0];
  // The runner-up is the best explanation that makes another claim.
  const b = a ? ranked.find((c) => !sameClaim(a, c)) : undefined;
  if (!a || !b) return false;
  if (confounded(inquiry, a, p)) return true;
  if (claimMass(inquiry, a, p) >= EP.commitPosterior) return false;
  const own = (c: Candidate) => c.explains === "self";
  const outside = (c: Candidate) => c.explains === "external" || c.explains === "both";
  return (own(a) && outside(b)) || (outside(a) && own(b));
}
