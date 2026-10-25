/**
 * Project ECHO's self-model: its version and every number it is built on.
 *
 * Every value is a model choice for this simulator (`model` in the fly's own
 * classes, params.ts): not measured, not fitted, chosen while the self-model
 * was developed on the development conditions only (scenarios.ts) and frozen
 * before any evaluation condition was run. None is a property of Drosophila.
 * Experiments do not vary them; a change to any of them is a change to the
 * self-model and bumps ECHO_VERSION.
 */
import { model, type Param } from "../params.js";

export const ECHO_VERSION = "echo-self-model/v1" as const;

/** The literature the mechanisms follow, for what they borrow: never a claim that a fly works this way. */
export const ECHO_CITATIONS = {
  vonHolst1950: {
    short: "von Holst & Mittelstaedt 1950, Naturwissenschaften 37:464",
    doi: "10.1007/BF00622503",
  },
  kim2015: {
    short: "Kim, Fitzgerald & Maimon 2015, Nat Neurosci 18:1247",
    doi: "10.1038/nn.4083",
  },
  kalman1960: {
    short: "Kalman 1960, J Basic Eng 82:35",
    doi: "10.1115/1.3662552",
  },
  page1954: { short: "Page 1954, Biometrika 41:100", doi: "10.1093/biomet/41.1-2.100" },
} as const;

export const ECHO_PARAMS = {
  // --- What the fly believes about itself before any experience -------------
  gainPriorSd: model(
    0.05,
    "fraction",
    [0.05, 0.05],
    "spread of the innate belief in each movement gain (legs and wings, speed and turning) around 1: the body schema the fly starts with",
  ),
  biasPriorSd: model(
    0.05,
    "rad/s",
    [0.05, 0.05],
    "spread of the innate belief in a turning bias around 0",
  ),
  driftPriorSd: model(
    0.002,
    "m/s",
    [0.002, 0.002],
    "spread of the innate belief that nothing outside carries the fly (a drift of 0)",
  ),
  spinPriorSd: model(
    0.05,
    "rad/s",
    [0.05, 0.05],
    "spread of the innate belief that nothing outside turns the perched fly",
  ),
  // --- How beliefs are expected to change ------------------------------------
  selfProcessSd: model(
    0.001,
    "fraction per √s",
    [0.001, 0.001],
    "how fast the fly expects its own gains to wander unprompted: slowly, so a lasting change in the body is learned through an inquiry rather than smeared",
  ),
  driftProcessSd: model(
    0.0003,
    "m/s per √s",
    [0.0003, 0.0003],
    "how fast the fly expects outside drift to wander unprompted: slowly too, so a push is noticed and asked about rather than absorbed",
  ),
  // --- Noticing that the model is wrong ---------------------------------------
  cusumSlack: model(
    3,
    "NIS",
    [3, 3],
    "the cumulative-sum change detector (Page 1954) adds each period's normalized innovation squared less its expected value (3, for three observed components) less this slack",
  ),
  cusumAlarm: model(
    24,
    "NIS",
    [24, 24],
    "the detector's alarm level: a sustained error of two standard deviations in one component is noticed in about a second, a large one at once",
  ),
  signedSlack: model(
    0.5,
    "sd",
    [0.5, 0.5],
    "a second pair of detectors per component (Page's two-sided test) adds each period's standardized error less this slack, for errors small but consistent in sign",
  ),
  signedAlarm: model(
    8,
    "sd",
    [8, 8],
    "the signed detectors' alarm level: an error of one and a half standard deviations, always the same way, is noticed in about eight periods",
  ),
  // --- Asking why ---------------------------------------------------------------
  inquiryMinPeriods: model(
    8,
    "periods",
    [8, 8],
    "an inquiry into a noticed change weighs at least this many decision periods (0.4 s) of evidence before it may conclude",
  ),
  inquiryMaxPeriods: model(
    160,
    "periods",
    [160, 160],
    "an inquiry that has not reached its posterior threshold after this many periods (8 s) concludes as unresolved",
  ),
  commitPosterior: model(
    0.9,
    "probability",
    [0.9, 0.9],
    "the posterior an explanation needs before the fly revises its model by it",
  ),
  changeGainSd: model(
    0.5,
    "fraction",
    [0.5, 0.5],
    "how large a change in its own gains the fly considers when it asks whether it changed itself",
  ),
  changeBiasSd: model(
    1,
    "rad/s",
    [1, 1],
    "how large a change in its own turning bias the fly considers",
  ),
  changeDriftSd: model(
    0.015,
    "m/s",
    [0.015, 0.015],
    "how large an outside drift the fly considers when it asks whether something outside moves it",
  ),
  changeSpinSd: model(1, "rad/s", [1, 1], "how large an outside turn the fly considers"),
  confoundChi2: model(
    4,
    "χ²",
    [4, 4],
    'an explanation that fits the evidence no better than the best rival on the other side of the question "is it me?" (best-fit residuals within this) wins only on expectation; the fly probes before it concludes',
  ),
  sensorFaultFactor: model(
    4,
    "×",
    [4, 4],
    "how much noisier its own sense the fly considers when it asks whether the sense failed",
  ),
  recallSd: model(
    0.05,
    "fraction",
    [0.05, 0.05],
    "spread kept around a remembered episode's gains when the fly asks whether the same change has come back",
  ),
  // --- Doubting its own predictions ---------------------------------------------
  noiseWindow: model(
    40,
    "periods",
    [40, 40],
    "periods (2 s) over which the fly measures how well its predictions' spreads match its errors, to rescale its trust in its own sense",
  ),
  noiseScaleMax: model(
    10,
    "×",
    [10, 10],
    "largest factor by which the fly widens its expected sensory noise",
  ),
  // --- Acting on doubt -------------------------------------------------------------
  cautionGainSd: model(
    0.12,
    "fraction",
    [0.12, 0.12],
    "a fly less sure than this of its own leg or wing speed gain acts cautiously",
  ),
  cautionNoiseScale: model(
    3,
    "×",
    [3, 3],
    "a fly that has widened its expected sensory noise this far distrusts its sense and acts cautiously",
  ),
  cautionShare: model(
    0.6,
    "fraction",
    [0.6, 0.6],
    "a cautious fly walks and flies at most this share of the speed it intends, and takes off only to escape",
  ),
  probeS: model(
    0.6,
    "s",
    [0.6, 0.6],
    "how long a probe lasts: a stop while walking, or a short straight walk while standing, to tell apart explanations a stretch of one kind of movement cannot",
  ),
  probeSpeedCmS: model(2, "cm/s", [2, 2], "the walking speed of a probe walk"),
  probeAfterPeriods: model(
    20,
    "periods",
    [20, 20],
    "an inquiry still undecided after this many periods (1 s) asks for a probe",
  ),
  gainFloor: model(
    0.25,
    "fraction",
    [0.25, 0.25],
    "the lowest gain the fly ever believes it has: it never commands more than four times what it intends",
  ),
  // --- Remembering -----------------------------------------------------------------
  historyPeriods: model(
    80,
    "periods",
    [80, 80],
    "the short-term record of predictions and observations (4 s), from which an inquiry re-weighs the evidence back to where the change began",
  ),
  episodesKept: model(
    24,
    "episodes",
    [24, 24],
    "episodic records kept; when full, the least informative is forgotten first",
  ),
  recallDistance: model(
    0.15,
    "fraction",
    [0.15, 0.15],
    "two remembered self-episodes whose gains differ by less than this are the same experience, kept once",
  ),
  beliefLogSize: model(
    12,
    "entries",
    [12, 12],
    "recent revisions of belief kept for inspection",
  ),
} as const satisfies Record<string, Param>;

export type EchoParamName = keyof typeof ECHO_PARAMS;
/** The values, for reading: every one is fixed. */
export const EP: Readonly<Record<EchoParamName, number>> = Object.freeze(
  Object.fromEntries(Object.entries(ECHO_PARAMS).map(([k, p]) => [k, p.value])) as Record<
    EchoParamName,
    number
  >,
);
