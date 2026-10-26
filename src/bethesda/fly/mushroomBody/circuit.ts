/**
 * A rate model of the mushroom body's associative learning: Bennett,
 * Philippides & Nowotny 2021's mixed-valence (MV) model, which learns a
 * reinforcement prediction for each cue by minimising the reinforcement
 * prediction error that its dopaminergic neurons compute. Here a cue is the
 * landmark a remembered food place is recognized by, and the prediction is
 * how much the place is worth going back to.
 *
 * The units, all rate units (a firing rate each, no spikes, no membrane):
 *
 * - Kenyon cells (KCs), `kenyonCells` of them. A cue activates each KC with
 *   probability `kcCoding`, as the paper assigns KCs to cues at random; like
 *   the paper it skips the computation upstream of the KCs. The assignment is
 *   drawn from the fly's own seed, so two flies code the same landmark with
 *   different cells. The active cells share one rate, scaled so the
 *   population sums to `kcTotalHz` (the paper's normalisation).
 * - The cue: of the up to three landmarks remembered with a place, the
 *   nearest (in the yard, the site's own pole). One landmark per cue keeps
 *   the paper's coding level (5% of KCs) and makes every trial move the
 *   prediction by the same share; a union of three would code 14% and learn
 *   at a third of the speed. That choice is this model's.
 * - Two output neurons (MBONs): M+ (approach) and M− (avoidance),
 *   m± = max(0, w±·k). The net prediction is m̂ = m+ − m−.
 * - Two dopaminergic neurons (DANs), the MV model's eq. 14:
 *   d± = max(0, ±r̂ ∓ wM·m̂ + γΣk), with r̂ the reinforcement. Their
 *   difference is twice the prediction error, r̂ − m̂.
 * - Plasticity at the KC→MBON synapses, eq. 8: Δw± = (η/2) k (d± − d∓),
 *   weights kept at or above zero ("synaptic weights cannot become
 *   negative").
 *
 * A trial is what the paper's trial is: a cue present, a reinforcement, one
 * update. A meal is a trial rewarded with `mealReward`; coming back to a
 * remembered place and finding neither its food nor its odour is a trial with
 * none, whose negative prediction error devalues the place: memory extinction
 * by an opposing memory, as Felsenberg et al. 2017 and 2018 found it in flies.
 * `blockOmission` blocks the DANs' output in those trials only, so nothing is
 * learned from a fruitless return (a lesion, not a condition of the fly).
 *
 * As a `PlaceValuation` (navigation.ts) it decides which remembered places
 * still draw a hungry fly back: those whose cue's m̂ exceeds
 * `approachThreshold`. A place remembered with no landmark in view gives the
 * circuit no cue; it keeps the bookkeeping's rule (two fruitless returns).
 *
 * Deterministic: its only draws are the initial weights and the KC
 * assignments, each from a stream seeded by the fly's seed.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { PLACE_MISSES, type Place, type PlaceValuation } from "../navigation.js";
import type { ResolvedMushroomBodyParams } from "./params.js";

/** One trial's activity, for inspection: the units' rates and what changed. */
export interface MushroomBodyTrial {
  /** This trial's number in the fly's life, from 1. */
  n: number;
  event: "meal" | "fruitless return";
  /** The landmark the trial's place is recognized by. */
  cue: string;
  /** KCs the cue activated, and each one's rate (Hz). */
  kcActive: number;
  kcHz: number;
  /** MBON and DAN rates (Hz) in the trial, before the update. */
  mPlus: number;
  mMinus: number;
  dPlus: number;
  dMinus: number;
  reinforcement: number;
  /** Net prediction m+ − m− before and after the update. */
  before: number;
  after: number;
  /** Whether the DANs' output was blocked, so no weight changed. */
  blocked: boolean;
}

/** What the circuit carries between trials; part of the fly's state hash. */
export interface MushroomBodyState {
  /** KC→M+ and KC→M− weights, one per KC. */
  wPlus: number[];
  wMinus: number[];
  trials: number;
  /** Of them, fruitless returns: trials with no reinforcement. */
  fruitless: number;
  last: MushroomBodyTrial | null;
}

/** The KCs a cue activates and the rate of each. */
export interface KenyonCode {
  cells: number[];
  hz: number;
}

/** 32-bit FNV-1a of a landmark's id: which cells it drives depends on it and on the fly's seed. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class MushroomBody implements PlaceValuation {
  readonly state: MushroomBodyState;
  private readonly P: ResolvedMushroomBodyParams;
  private readonly wiring: number;
  private readonly blockOmission: boolean;

  constructor(P: ResolvedMushroomBodyParams, seed: number, blockOmission = false) {
    this.P = P;
    this.wiring = (seed ^ 0x5be0cd19) >>> 0;
    this.blockOmission = blockOmission;
    const draw = mulberry32((seed ^ 0x9b05688c) >>> 0);
    const n = P.kenyonCells;
    const wPlus = new Array<number>(n),
      wMinus = new Array<number>(n);
    for (let j = 0; j < n; j++) wPlus[j] = P.initialWeightMax * draw();
    for (let j = 0; j < n; j++) wMinus[j] = P.initialWeightMax * draw();
    this.state = { wPlus, wMinus, trials: 0, fruitless: 0, last: null };
  }

  /** The KC population a cue activates. */
  code(cue: string): KenyonCode {
    const u = mulberry32((fnv1a(cue) ^ this.wiring) >>> 0);
    const cells: number[] = [];
    for (let j = 0; j < this.P.kenyonCells; j++) if (u() < this.P.kcCoding) cells.push(j);
    return { cells, hz: cells.length ? this.P.kcTotalHz / cells.length : 0 };
  }

  /** The two MBONs' rates for a KC code. */
  outputs(k: KenyonCode): { mPlus: number; mMinus: number } {
    const { wPlus, wMinus } = this.state;
    let plus = 0,
      minus = 0;
    for (const j of k.cells) {
      plus += wPlus[j]!;
      minus += wMinus[j]!;
    }
    return { mPlus: Math.max(0, plus * k.hz), mMinus: Math.max(0, minus * k.hz) };
  }

  /** The net prediction m+ − m− for a cue: what the circuit expects there. */
  predict(cue: string): number {
    const { mPlus, mMinus } = this.outputs(this.code(cue));
    return mPlus - mMinus;
  }

  /** One trial: the cue present, reinforcement `r`, one update of the KC→MBON weights. */
  trial(
    cue: string,
    r: number,
    event: MushroomBodyTrial["event"],
  ): MushroomBodyTrial | null {
    const k = this.code(cue);
    if (!k.cells.length) return null;
    const P = this.P,
      S = this.state;
    const { mPlus, mMinus } = this.outputs(k);
    const before = mPlus - mMinus;
    // γΣk: every KC drives both DANs, and the code sums to kcTotalHz.
    const kcDrive = P.kcDanWeight * k.hz * k.cells.length;
    const dPlus = Math.max(0, r - P.mbonDanWeight * before + kcDrive);
    const dMinus = Math.max(0, -r + P.mbonDanWeight * before + kcDrive);
    const blocked = this.blockOmission && event === "fruitless return";
    if (!blocked) {
      const step = (P.learningRate / 2) * k.hz * (dPlus - dMinus);
      for (const j of k.cells) {
        S.wPlus[j] = Math.max(0, S.wPlus[j]! + step);
        S.wMinus[j] = Math.max(0, S.wMinus[j]! - step);
      }
    }
    const after = this.outputs(k);
    S.trials++;
    if (event === "fruitless return") S.fruitless++;
    S.last = {
      n: S.trials,
      event,
      cue,
      kcActive: k.cells.length,
      kcHz: k.hz,
      mPlus,
      mMinus,
      dPlus,
      dMinus,
      reinforcement: r,
      before,
      after: after.mPlus - after.mMinus,
      blocked,
    };
    return S.last;
  }

  worth(place: Place): boolean {
    const cue = place.landmarks[0];
    return cue === undefined || this.predict(cue) > this.P.approachThreshold;
  }

  fed(place: Place): void {
    const cue = place.landmarks[0];
    if (cue !== undefined) this.trial(cue, this.P.mealReward, "meal");
  }

  missed(place: Place): boolean {
    const cue = place.landmarks[0];
    if (cue === undefined) return ++place.misses >= PLACE_MISSES;
    this.trial(cue, 0, "fruitless return");
    return false;
  }
}
