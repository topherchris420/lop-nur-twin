/**
 * Grooming as a circuit model: Zhang, Guo & Simpson 2020's dust-driven
 * suppression hierarchy (Current Biology 30:988, STAR Methods), the model
 * that paper built on Seeds et al. 2014's.
 *
 * Dust sits on five body parts: the head, abdomen and wings, and the front
 * and hind pairs of legs. Each bout, every part's sensory activity is drawn
 * as |N(d, (d/5)²)| from its dust d, and the strongest wins (the
 * winner-take-all layer). A winning body part moves a share `dr` of its dust
 * to the legs that clean it (the front legs for the head, the hind legs for
 * the abdomen and wings); winning legs rub, discarding ten times that share
 * of theirs (the factor is the authors'). The bout lasts a time drawn from the gamma distribution the
 * authors fitted for its ethogram label. Because the head starts with the
 * most dust (its bristle count), the sequence runs from front to back as dust
 * comes off, without being scripted: a fly dusted only on its wings cleans
 * its wings, and fresh dust on the head sends it back to the head.
 *
 * What the authors' model leaves open, this one fills with one stated rule:
 * a dusted fly grooms at a decision only while the winning activity exceeds
 * `groomDriveDust` (fitted; see `params.ts`), and otherwise its other
 * behaviour runs. A clean fly carries no dust, and its spontaneous grooming
 * is the reduced-order controller's. The notum is not in the model: the
 * authors' ethograms have no thoracic label for dusted flies.
 *
 * The world deposits no dust: it is set when the fly is placed (a fly dusted
 * all over, as in the experiments), or added by `dust()`.
 */
import { GROOMING_REFERENCE } from "../calibration/groomingReference.js";
import type { GroomRoutine } from "../neural.js";
import type { ResolvedCircuitParams } from "./params.js";
import { BOUT_GAMMA } from "./params.js";
import { gamma, normal } from "./random.js";

export const GROOM_MODULES = ["head", "abdomen", "wings", "front", "hind"] as const;
/** A leg-rub bout discards this many times `dr` of the legs' dust (the authors' code). */
const LEG_RUB_FACTOR = GROOMING_REFERENCE.model.legRubRemovalFactor;
export type GroomModule = (typeof GROOM_MODULES)[number];

/** Each module's ethogram label in the authors' data: 1 front-leg rub … 5 wing cleaning. */
export const MODULE_LABEL: Readonly<Record<GroomModule, "1" | "2" | "3" | "4" | "5">> = {
  front: "1",
  head: "2",
  abdomen: "3",
  hind: "4",
  wings: "5",
};

export interface GroomingCircuitState {
  dust: Record<GroomModule, number>;
  /** The bout under way: which module, when it ends (s), and the routine the body shows. */
  bout: { module: GroomModule; until: number; routine: GroomRoutine } | null;
  /** The head's bouts alternate eyes and antennae, which the authors' data do not separate (a drawing choice). */
  headBouts: number;
  bouts: number;
  /** The winning activity at the last bout boundary. */
  drive: number;
}

export class GroomingCircuit {
  readonly state: GroomingCircuitState;
  private P: ResolvedCircuitParams;
  private rng: () => number;
  constructor(
    params: ResolvedCircuitParams,
    rng: () => number,
    dust: Partial<Record<GroomModule, number>> = {},
  ) {
    this.P = params;
    this.rng = rng;
    this.state = {
      dust: { head: 0, abdomen: 0, wings: 0, front: 0, hind: 0, ...dust },
      bout: null,
      headBouts: 0,
      bouts: 0,
      drive: 0,
    };
  }

  /** The dust a fly dusted all over carries, as the authors set it. */
  static allOver(P: ResolvedCircuitParams): Record<GroomModule, number> {
    return {
      head: P.dustHead,
      abdomen: P.dustAbdomen,
      wings: P.dustWings,
      front: P.dustLegPair,
      hind: P.dustLegPair,
    };
  }

  /** Add dust (from the world, or an experiment). */
  dust(add: Partial<Record<GroomModule, number>>): void {
    for (const m of GROOM_MODULES) this.state.dust[m] += Math.max(0, add[m] ?? 0);
  }

  get dusty(): boolean {
    return GROOM_MODULES.some((m) => this.state.dust[m] > 0);
  }

  /** The bout's routine as the body knows them. */
  private routine(m: GroomModule): GroomRoutine {
    switch (m) {
      case "head":
        return this.state.headBouts++ % 2 === 0 ? "eyes" : "antennae";
      case "abdomen":
        return "abdomen";
      case "wings":
        return "wings";
      case "front":
        return "front legs";
      case "hind":
        return "hind legs";
    }
  }

  /**
   * At a decision while the fly stands: the routine to groom now, or null to
   * let its other behaviour run. A bout under way runs to its end; then the
   * next bout is chosen, or none if no activity exceeds the drive threshold.
   */
  decide(t: number): GroomRoutine | null {
    const S = this.state,
      P = this.P;
    if (S.bout && t < S.bout.until) return S.bout.routine;
    S.bout = null;
    if (!this.dusty) return null;
    let winner: GroomModule = "head",
      best = -Infinity;
    for (const m of GROOM_MODULES) {
      const d = S.dust[m];
      const a = d > 0 ? Math.abs(d + d * P.activitySdOverDust * normal(this.rng)) : 0;
      if (a > best) {
        best = a;
        winner = m;
      }
    }
    S.drive = best;
    if (!(best > P.groomDriveDust)) return null;
    const dr = P.dustRemovalRate;
    const moved = S.dust[winner] * dr;
    if (winner === "front" || winner === "hind")
      S.dust[winner] = Math.max(0, S.dust[winner] - LEG_RUB_FACTOR * moved);
    else {
      S.dust[winner] -= moved;
      S.dust[winner === "head" ? "front" : "hind"] += moved;
    }
    const g = BOUT_GAMMA[MODULE_LABEL[winner]];
    S.bout = {
      module: winner,
      until: t + gamma(this.rng, g.shape, g.scaleS),
      routine: this.routine(winner),
    };
    S.bouts++;
    return S.bout.routine;
  }

  /** Grooming stops (the fly took off or walked away): the bout is dropped, the dust stays. */
  interruptBout(): void {
    this.state.bout = null;
  }
}
