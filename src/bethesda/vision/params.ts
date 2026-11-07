/**
 * Every number the research compound eye uses, with its class and source.
 *
 * `published` values are taken from a cited paper or from FlyBody (through
 * the fly's own parameters); `model` values are this project's choices, each
 * named as one. The research eye is versioned on its own (`VISION_VERSION`):
 * it is not part of the fly's simulation, so it changes neither the fly's
 * source digest nor `FLY_VERSION`, and nothing in production imports it
 * (`src/bethesda/firstContact/isolation.test.ts`).
 */
import { CITATIONS, PARAMS, type Citation } from "../fly/params.js";

/** Bump on any change to what the eye computes; results name the version that made them. */
export const VISION_VERSION = "research-compound-eye/1";

export const VISION_CITATIONS = {
  hassenstein1956: {
    short: "Hassenstein & Reichardt 1956, Z Naturforsch B 11:513",
    doi: "10.1515/znb-1956-9-1004",
  },
  maisak2013: {
    short: "Maisak et al. 2013, Nature 500:212",
    doi: "10.1038/nature12320",
  },
  drews2020: {
    short: "Drews et al. 2020, Curr Biol 30:209",
    doi: "10.1016/j.cub.2019.10.035",
  },
  schnell2010: {
    short: "Schnell et al. 2010, J Neurophysiol 103:1646",
    doi: "10.1152/jn.00950.2009",
  },
  klapoetke2017: CITATIONS.klapoetke2017,
  ache2019: CITATIONS.ache2019,
  card2008: CITATIONS.card2008,
} as const satisfies Record<string, Citation>;

export type VisionParamKind = "published" | "model";
export interface VisionParam {
  value: number;
  unit: string;
  kind: VisionParamKind;
  source?: Citation;
  note: string;
}

const published = (
  value: number,
  unit: string,
  source: Citation,
  note: string,
): VisionParam => ({ value, unit, kind: "published", source, note });
const model = (
  value: number,
  unit: string,
  note: string,
  source?: Citation,
): VisionParam => ({ value, unit, kind: "model", note, ...(source ? { source } : {}) });

export const VISION_PARAMS = {
  interommatidialDeg: published(
    PARAMS.interommatidialDeg.value,
    "deg",
    CITATIONS.flybody,
    "spacing of the ommatidial lattice: the fly's own inter-ommatidial angle (FlyBody's eye model)",
  ),
  eyeFovDeg: published(
    PARAMS.eyeFovDeg.value,
    "deg",
    CITATIONS.flybodyFruitfly,
    "width of each eye's field, around FlyBody's eye-camera axes, as the fly's senses use it",
  ),
  acceptanceDeg: model(
    PARAMS.interommatidialDeg.value,
    "deg",
    "full width at half maximum of each ommatidium's Gaussian acceptance; set equal to the spacing (a model choice of the right order, not a measured value)",
  ),
  adaptationS: model(
    0.25,
    "s",
    "time constant of each photoreceptor's luminance adaptation; its output is Weber contrast against that running mean, so static scenes fade and a step in illumination is a transient (not fitted)",
  ),
  luminanceFloor: model(
    1e-3,
    "relative luminance",
    "added to the adapted luminance before dividing, so darkness gives no division by zero",
  ),
  photonNoise: model(
    0.01,
    "relative",
    "standard deviation of multiplicative noise on each luminance sample (not fitted)",
  ),
  emdDelayS: model(
    0.08,
    "s",
    "time constant of the first-order low-pass in each Hassenstein–Reichardt arm; a detector so built prefers drifting gratings near 1/(2π·τ) ≈ 2 Hz, the order of the low-hertz optimum reported for Drosophila T4/T5 and HS cells (Maisak et al. 2013; Schnell et al. 2010). Chosen, not fitted",
    VISION_CITATIONS.hassenstein1956,
  ),
  contrastNormalization: model(
    0.05,
    "contrast²",
    "semi-saturation of the divisive normalization of each detector's output by local contrast energy; flies' motion detectors compress contrast this way (Drews et al. 2020), this value is ours",
    VISION_CITATIONS.drews2020,
  ),
  lplc2SpacingDeg: model(
    15,
    "deg",
    "spacing of the looming units' receptive-field centres on each eye's lattice (a model choice)",
  ),
  lplc2SigmaDeg: model(
    12,
    "deg",
    "Gaussian width of each looming unit's receptive-field weighting, truncated at 2.5σ; LPLC2's receptive fields are tens of degrees wide (Klapoetke et al. 2017), this width is ours",
    VISION_CITATIONS.klapoetke2017,
  ),
  lplc2Opponency: model(
    1,
    "unitless",
    "weight of inward motion's inhibition against outward motion's excitation in each of a looming unit's four cardinal branches (radial motion opponency, Klapoetke et al. 2017); balanced, not fitted",
    VISION_CITATIONS.klapoetke2017,
  ),
  loomingFloor: model(
    0.05,
    "share of the escape threshold",
    "below this share of the escape threshold the eye reports that nothing looms (the frame's looming is null), so noise alone is not a looming thing",
  ),
} as const satisfies Record<string, VisionParam>;

export type VisionParamName = keyof typeof VISION_PARAMS;
