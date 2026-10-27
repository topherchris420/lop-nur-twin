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

export const ECHO_VERSION = "echo-self-model/v2" as const;

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
  windPriorSd: model(
    1,
    "m/s",
    [1, 1],
    "spread of the fly's belief in the air's velocity when its antennae first feel the air move, and again each time it leaves a surface for the air or the air for a surface: the air aloft is not the air at a surface. About the wind a fly meets near the ground in the city's breeze (2.5 m/s at 10 m, weather.ts, is 0.7 to 1.4 m/s between 0.25 and 2 m)",
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
  windProcessSd: model(
    0.3,
    "m/s per √s",
    [0.3, 0.3],
    "how fast the fly expects the air to change unprompted, once it has felt it move: quickly, as a gust in a breeze near the ground does (half a metre per second over two or three seconds, weather.ts), so the wind is followed rather than asked about",
  ),
  // --- Feeling the air ---------------------------------------------------------
  airSenseShare: model(
    0.01,
    "fraction",
    [0.01, 0.01],
    "how far the fly expects its antennae's reading of the air going by to stray, as a share of the reading, in each direction: little, since the body's antennae report the air as it is unless the fly is given sensory noise (senses.ts); a model choice, not a measured precision",
  ),
  airSenseFloorMS: model(
    0.005,
    "m/s",
    [0.005, 0.005],
    "and how far at least, however slow the air",
  ),
  airQuietMS: model(
    0.05,
    "m/s",
    [0.05, 0.05],
    "below this the antennae give no bearing for the air (senses.ts), and the fly takes the air going by as none, give or take this much",
  ),
  airSettleMS: model(
    0.1,
    "m/s",
    [0.1, 0.1],
    "a change in the air going by of more than this over one period in flight says the wings were still catching up with a step in the wind (into or out of a building's lee), so the antennae's reading at its end says little about the wind and revises nothing: twice what a gust's rise changes it by (about 1 m/s per second, weather.ts)",
  ),
  windRateTauS: model(
    0.25,
    "s",
    [0.25, 0.25],
    "the fly takes how fast the wind is changing from the change between its antennae's readings in a row, smoothed over this long, so that a noisy reading is not taken for a gust; a gust rises over one to three seconds (weather.ts)",
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
  changeWindSd: model(
    1,
    "m/s",
    [1, 1],
    "how large a change in the air the fly considers when it asks whether the wind now moves it differently",
  ),
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
