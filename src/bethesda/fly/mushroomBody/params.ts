/**
 * The mushroom-body model's parameters, each with where it came from, in the
 * form of the circuit models' table (`circuits/params.ts`):
 *
 * - `published`: a value Bennett, Philippides & Nowotny 2021 report for their
 *   model (not a measurement of a fly), quoted in the note.
 * - `model`: chosen here, not measured or fitted; the note says why.
 *
 * Published values are fixed. Model values may be overridden within their
 * range by `resolveMushroomBodyParams`.
 */
import type { CircuitParam } from "../circuits/params.js";
import { CITATIONS as FLY_CITATIONS, type Citation } from "../params.js";

export const MUSHROOM_BODY_CITATIONS = {
  bennett2021: {
    short: "Bennett, Philippides & Nowotny 2021, Nat Commun 12:2569",
    doi: "10.1038/s41467-021-22592-4",
  },
  felsenberg2017: {
    short: "Felsenberg et al. 2017, Nature 544:240",
    doi: "10.1038/nature21716",
  },
  krashes2008: {
    short: "Krashes & Waddell 2008, J Neurosci 28:3103",
    doi: "10.1523/JNEUROSCI.5333-07.2008",
  },
  felsenberg2018: {
    short: "Felsenberg et al. 2018, Cell 175:709",
    doi: "10.1016/j.cell.2018.08.021",
  },
  vogt2014: {
    short: "Vogt et al. 2014, eLife 3:e02395",
    doi: "10.7554/eLife.02395",
  },
  ofstad2011: FLY_CITATIONS.ofstad2011,
} as const satisfies Record<string, Citation>;

const B = MUSHROOM_BODY_CITATIONS.bennett2021;

const published = (value: number, unit: string, note: string): CircuitParam => ({
  value,
  unit,
  kind: "published",
  min: value,
  max: value,
  source: B,
  note,
});

const model = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  note: string,
): CircuitParam => ({ value, unit, kind: "model", min, max, note });

export const MUSHROOM_BODY_PARAMS = {
  // --- Kenyon cells (Bennett et al. 2021, Methods: inputs and KC representation) ---
  kenyonCells: published(
    2000,
    "cells",
    'the paper\'s larger simulations: "we simulate 2000 KCs, where each KC is assigned to a cue with probability p = 0.05"',
  ),
  kcCoding: published(
    0.05,
    "probability",
    'the chance a Kenyon cell is assigned to a cue: "so that 5% of KCs, on average, are active for a given cue". Here a cue is a landmark',
  ),
  kcTotalHz: published(
    10,
    "Hz",
    'the KC population\'s summed rate for a cue: "we normalised the total KC firing rates for each cue, i, such that Σj kj = 10 Hz"',
  ),
  initialWeightMax: published(
    0.1,
    "weight",
    'every KC→MBON weight starts as a uniform draw below this: "initialised with w±i = 0.1ξ±i … where ξ±i is a uniform random variable in the range 0–1"',
  ),
  // --- Dopaminergic neurons (Bennett et al. 2021, Methods: DAN firing rates, eq. 14) ---
  kcDanWeight: published(
    1,
    "weight",
    "γ, each KC's fixed excitatory weight onto both DANs (wK = γ1): the value of the paper's Fig. 3e–g, the mixed-valence model's MBON and DAN rates",
  ),
  mbonDanWeight: published(
    1,
    "weight",
    '"We set wM = 1, such that the difference in DAN firing rates yields the RPE": each MBON\'s feedback onto the DANs',
  ),
  // --- Learning (this model's choices) ---
  learningRate: model(
    0.25,
    "per Hz²",
    [0.0125, 0.45],
    "η in the paper's mixed-valence rule Δw± = (η/2) k (d± − d∓) (eq. 8), which moves the net prediction 2η|k|² of the way to the reinforcement in one trial (until weights reach zero). A cue activates about 100 KCs at 0.1 Hz each, so |k|² ≈ 1 and one trial goes half way at 0.25. The paper uses η of 0.025 to 0.1 on codes of 10 KCs at 1 Hz (|k|² = 10). Here a meal stands for a whole training session, and one 2 min session pairing odour with sugar forms an appetitive memory that lasts for days (Krashes & Waddell 2008); the range ends below 0.5, where one trial would reach the reinforcement exactly and beyond which it would overshoot",
  ),
  mealReward: model(
    1,
    "reinforcement",
    [0.1, 2],
    "r+, the reinforcement of a meal (sugar under the feet), whatever its length; a fruitless return is a trial with none. The paper's reinforcements are of this order (means stepping by ±1)",
  ),
  approachThreshold: model(
    0.3,
    "net MBON rate (Hz)",
    [0, 1],
    "a hungry fly goes back to a remembered place only while its cue's net output m+ − m− exceeds this. Untrained cues sit near 0 (±0.04 from the initial weights). At the defaults one meal brings a cue to about 0.5, and each fruitless return halves it, so a place fed at once is given up after one fruitless return and a place fed at more than once after two (the prediction stays below the reward of 1, and two halvings bring it below 0.3); 0.3 keeps clear of the 0.25 that a single meal and a single return would otherwise land on",
  ),
} as const satisfies Record<string, CircuitParam>;

export type MushroomBodyParamName = keyof typeof MUSHROOM_BODY_PARAMS;
export type MushroomBodyConfig = Partial<Record<MushroomBodyParamName, number>>;
export type ResolvedMushroomBodyParams = Readonly<Record<MushroomBodyParamName, number>>;

/** The table's values with overrides of model values applied, each within its range; frozen. */
export function resolveMushroomBodyParams(
  config: MushroomBodyConfig = {},
): ResolvedMushroomBodyParams {
  for (const name of Object.keys(config))
    if (!Object.hasOwn(MUSHROOM_BODY_PARAMS, name))
      throw new Error(`unknown mushroom-body parameter ${name}`);
  const out = {} as Record<MushroomBodyParamName, number>;
  for (const name of Object.keys(MUSHROOM_BODY_PARAMS) as MushroomBodyParamName[]) {
    const p: CircuitParam = MUSHROOM_BODY_PARAMS[name];
    const v = config[name];
    if (v === undefined) out[name] = p.value;
    else {
      if (p.kind !== "model")
        throw new Error(`${name} is a ${p.kind} value and cannot be overridden`);
      if (typeof v !== "number" || !Number.isFinite(v))
        throw new Error(`${name} must be a finite number`);
      if (v < p.min || v > p.max)
        throw new Error(
          `${name} must be within [${p.min}, ${p.max}] ${p.unit}; got ${v}`,
        );
      out[name] = v;
    }
  }
  return Object.freeze(out);
}
