/**
 * The circuit models' parameters, each with where it came from, in the form
 * of the fly's own table (`params.ts`), with two more kinds:
 *
 * - `published`: a value a cited paper reports, for real flies or for the
 *   model the paper fitted to them (Ache et al. 2019's GF model constants
 *   are the latter, and say so).
 * - `imported`: read from data an importer wrote (`data/`), never typed here:
 *   the grooming model's constants come from Zhang, Guo & Simpson 2020's
 *   deposited code through `grooming-reference.json`.
 * - `fitted`: set by the calibration's documented fit (`calibration/fit.ts`)
 *   to the observations named in `fit`: the value is the one
 *   docs/benchmarks/fly-calibration/fit.json records, and a test holds it
 *   there. A comparison against those observations is a fit target, never a
 *   test.
 * - `model`: chosen here, not measured or fitted; the note says why.
 *
 * Published and imported values are fixed. Model and fitted values may be
 * overridden within their range by `resolveCircuitParams`.
 */
import { GROOMING_REFERENCE } from "../calibration/groomingReference.js";
import { CITATIONS as FLY_CITATIONS, type Citation } from "../params.js";

export type CircuitParamKind = "published" | "imported" | "fitted" | "model";
export interface CircuitParam {
  value: number;
  unit: string;
  kind: CircuitParamKind;
  min: number;
  max: number;
  source?: Citation;
  /** For a fitted value: the observations it was fitted to. */
  fit?: readonly string[];
  note: string;
}

export const CIRCUIT_CITATIONS = {
  ache2019: FLY_CITATIONS.ache2019,
  vonReyn2014: FLY_CITATIONS.vonReyn2014,
  klapoetke2017: FLY_CITATIONS.klapoetke2017,
  fotowat2009: {
    short: "Fotowat et al. 2009, J Neurophysiol 102:875",
    doi: "10.1152/jn.00073.2009",
  },
  zhang2020: {
    short: "Zhang, Guo & Simpson 2020, Curr Biol 30:988",
    doi: "10.1016/j.cub.2020.01.045",
  },
  seeds2014: FLY_CITATIONS.seeds2014,
} as const satisfies Record<string, Citation>;

const fixed = (
  value: number,
  unit: string,
  kind: "published" | "imported",
  note: string,
  source: Citation,
): CircuitParam => ({ value, unit, kind, min: value, max: value, source, note });

const model = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  note: string,
  source?: Citation,
): CircuitParam =>
  source
    ? { value, unit, kind: "model", min, max, source, note }
    : { value, unit, kind: "model", min, max, note };

const fitted = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  fit: readonly string[],
  note: string,
): CircuitParam => ({ value, unit, kind: "fitted", min, max, fit, note });

const A = CIRCUIT_CITATIONS.ache2019;
const G = GROOMING_REFERENCE.model;

export const CIRCUIT_PARAMS = {
  // --- The giant fiber's inputs (Ache et al. 2019, STAR Methods, eqs 3–7) ---
  lc4GainMvPerDegS: fixed(
    0.0002567,
    "mV per deg/s",
    "published",
    "C1: the LC4 (angular velocity) component, a line through the origin fitted to GF responses in LPLC2-silenced flies. The paper states no unit for C1; read with its figures (GF potential in mV, velocity in deg/s)",
    A,
  ),
  lc4DelayMs: fixed(19, "ms", "published", "δ1: the LC4 component's sensory delay", A),
  lplc2PeakMv: fixed(
    1.7,
    "mV",
    "published",
    "C2: height of the LPLC2 (angular size) component, a Gaussian in ln(size)",
    A,
  ),
  lplc2PeakDeg: fixed(
    42,
    "deg",
    "published",
    "C3: size at which the LPLC2 component peaks",
    A,
  ),
  lplc2WidthLn: fixed(
    0.52,
    "ln units",
    "published",
    "C4: width of the LPLC2 component's Gaussian in ln(size)",
    A,
  ),
  lplc2DelayMs: fixed(19, "ms", "published", "δ2: the LPLC2 component's delay", A),
  tonicBaseMv: fixed(
    -0.53,
    "mV",
    "published",
    "C5: the size-dependent tonic inhibition's level at large sizes. The extracted text drops the PDF's minus signs; the sign here is the one that gives the paper's hyperpolarization during the static 90° disk, with the sigmoid near zero for small sizes",
    A,
  ),
  tonicStepMv: fixed(
    0.59,
    "mV",
    "published",
    "C6: the tonic inhibition's sigmoid height",
    A,
  ),
  tonicMidDeg: fixed(66, "deg", "published", "C7: the tonic inhibition's midpoint", A),
  tonicSlopeDeg: fixed(
    11,
    "deg",
    "published",
    "C8: the tonic inhibition's slope; its sign is read as for C5",
    A,
  ),
  tonicDelayMs: fixed(37.5, "ms", "published", "δ3: the tonic inhibition's delay", A),
  lc4InhibitionMv: fixed(
    -0.52,
    "mV",
    "published",
    "C9: the small LC4-dependent inhibitory component, a Gaussian in size (negative: inhibitory)",
    A,
  ),
  lc4InhibitionPeakDeg: fixed(26, "deg", "published", "C10", A),
  lc4InhibitionWidthDeg: fixed(7.8, "deg", "published", "C11", A),
  lc4InhibitionDelayMs: fixed(
    11,
    "ms",
    "published",
    "δ4. The fly samples every 10 ms, so the component reads the size interpolated between samples",
    A,
  ),
  weightLplc2: fixed(1.45, "unitless", "published", "W_LPLC2, fitted by the paper", A),
  weightLc4: fixed(1.62, "unitless", "published", "W_LC4, fitted by the paper", A),
  weightTonic: fixed(2.27, "unitless", "published", "W_i1, adopted by the paper", A),
  weightLc4Inhibition: fixed(1, "unitless", "published", "W_i2, adopted by the paper", A),

  // --- The giant fiber's spike, and the two takeoff pathways --------------
  gfThresholdMv: fitted(
    3.73,
    "mV",
    [0.5, 10],
    ["escape.short-mode.8", "escape.short-mode.14", "escape.short-mode.40"],
    "median of the GF's spike threshold over the modelled membrane potential. Not reported; fitted with its spread to the short-mode fractions at r/v 8, 14 and 40 ms (von Reyn et al. 2014), which are therefore fit targets",
  ),
  gfThresholdLnSd: fitted(
    0.42,
    "ln units",
    [0, 2],
    ["escape.short-mode.8", "escape.short-mode.14", "escape.short-mode.40"],
    "trial-to-trial spread of the threshold, log-normal as von Reyn et al. 2014 found the GF pathway's angular threshold to be; fitted with the median",
  ),
  gfToJumpMs: model(
    10,
    "ms",
    [10, 10],
    "from a GF spike to the jump. Measured: leg extension 0.9 ms and flight 2.0 ms after the spike (von Reyn et al. 2014); the fly's gate allows no preparation under 10 ms, its sensory sample period, so the jump comes 10 ms after the sample that crossed the threshold. Fixed",
    CIRCUIT_CITATIONS.vonReyn2014,
  ),
  wingRaiseDeg: fixed(
    49,
    "deg",
    "published",
    "angular size from which the GF-independent pathway starts the long-mode wing raise (after `wingRaiseDelayMs`): the paper's 'WR occurred when the stimulus had reached 49° (SD = 4°)'. Von Reyn et al. 2014 give their pathway's angle only in a figure, so this paper's is used",
    CIRCUIT_CITATIONS.fotowat2009,
  ),
  wingRaiseDelayMs: fixed(
    28.6,
    "ms",
    "published",
    "delay from the size criterion to the wing raise: von Reyn et al. 2014's neural delay for the wing raise of GF-silenced flies, whose takeoffs are the GF-independent pathway's alone. Fotowat et al. 2009's fit across l/v instead has an intercept of 0 ms (SD 10 ms) at its 49°; the two papers disagree, and the calibration compares the model with both",
    CIRCUIT_CITATIONS.vonReyn2014,
  ),
  wingRaiseSdDeg: fixed(
    4,
    "deg",
    "published",
    "trial-to-trial SD of that angle, as the paper reports it",
    CIRCUIT_CITATIONS.fotowat2009,
  ),

  // --- Grooming (Zhang, Guo & Simpson 2020; Seeds et al. 2014) ------------
  dustHead: fixed(
    G.initialDust.head,
    "dust units",
    "imported",
    "initial dust on the head of a fly dusted all over: the head's mechanosensory bristle count, as the authors set it (each bristle gets the same dust)",
    CIRCUIT_CITATIONS.zhang2020,
  ),
  dustAbdomen: fixed(
    G.initialDust.abdomen,
    "dust units",
    "imported",
    "initial dust on the abdomen, as above",
    CIRCUIT_CITATIONS.zhang2020,
  ),
  dustWings: fixed(
    G.initialDust.wings,
    "dust units",
    "imported",
    "initial dust on the wings, as above",
    CIRCUIT_CITATIONS.zhang2020,
  ),
  dustLegPair: fixed(
    G.initialDust.eachLegPair,
    "dust units",
    "imported",
    "initial dust on each pair of legs, as above",
    CIRCUIT_CITATIONS.zhang2020,
  ),
  activitySdOverDust: fixed(
    G.activitySdOverDust,
    "fraction",
    "imported",
    "the sensory activity a body part's dust evokes is |N(d, (d × this)²)|",
    CIRCUIT_CITATIONS.zhang2020,
  ),
  dustRemovalRate: model(
    0.002,
    "fraction per bout",
    [0.002, G.dustRemovalRate],
    `share of the winning body part's dust a bout moves to its legs; a leg-rub bout discards ${G.legRubRemovalFactor} times this share of the legs' dust. The paper's text gives 0.2%, its deposited code ${G.dustRemovalRate * 100}%: the range spans the two and the text's value is used`,
    CIRCUIT_CITATIONS.zhang2020,
  ),
  groomDriveDust: fitted(
    484,
    "dust units",
    [1, 2000],
    ["grooming.dusted.fraction"],
    "a dusted fly grooms at a decision only while the winning sensory activity exceeds this; otherwise its other behaviour runs. The authors' model grooms without pause and does not say when a fly stops to walk or stand; this one threshold is fitted to the dusted flies' fraction of time grooming, which is therefore a fit target",
  ),
} as const satisfies Record<string, CircuitParam>;

export type CircuitParamName = keyof typeof CIRCUIT_PARAMS;
export type CircuitConfig = Partial<Record<CircuitParamName, number>>;
export type ResolvedCircuitParams = Readonly<Record<CircuitParamName, number>>;

/** The table's values with overrides of model and fitted values applied, each within its range; frozen. */
export function resolveCircuitParams(config: CircuitConfig = {}): ResolvedCircuitParams {
  for (const name of Object.keys(config))
    if (!Object.hasOwn(CIRCUIT_PARAMS, name))
      throw new Error(`unknown circuit parameter ${name}`);
  const out = {} as Record<CircuitParamName, number>;
  for (const name of Object.keys(CIRCUIT_PARAMS) as CircuitParamName[]) {
    const p: CircuitParam = CIRCUIT_PARAMS[name];
    const v = config[name];
    if (v === undefined) out[name] = p.value;
    else {
      if (p.kind !== "model" && p.kind !== "fitted")
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

/** Bout lengths (s) a grooming routine's bouts are drawn from: a gamma distribution, per ethogram label. */
export const BOUT_GAMMA = Object.fromEntries(
  Object.entries(G.boutLengthGamma).map(([label, g]) => [
    label,
    { shape: g.shape, scaleS: g.scaleFrames / GROOMING_REFERENCE.frameHz },
  ]),
) as Readonly<Record<"1" | "2" | "3" | "4" | "5", { shape: number; scaleS: number }>>;
