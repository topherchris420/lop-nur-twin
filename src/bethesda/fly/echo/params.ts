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

export const ECHO_VERSION = "echo-self-model/v3" as const;

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
  butlin2023: {
    short:
      "Butlin, Long et al. 2023, Consciousness in artificial intelligence, arXiv:2308.08708",
    doi: "10.48550/arXiv.2308.08708",
  },
  dehaene2001: {
    short: "Dehaene & Naccache 2001, Cognition 79:1",
    doi: "10.1016/S0010-0277(00)00123-2",
  },
  graziano2015: {
    short: "Graziano & Webb 2015, Front Psychol 6:500",
    doi: "10.3389/fpsyg.2015.00500",
  },
  fleming2014: {
    short: "Fleming & Lau 2014, Front Hum Neurosci 8:443",
    doi: "10.3389/fnhum.2014.00443",
  },
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
  // --- The workspace: one content at a time, broadcast (workspace.ts) ------------
  inquirySalience: model(
    1,
    "salience",
    [1, 1],
    "how much an open inquiry, the self-model asking why its predictions fail, bids for the workspace: the unit every other bid is set against",
  ),
  hazardSalience: model(
    3,
    "salience",
    [3, 3],
    "a surface ahead in flight, or any avoidance the controller intends: the fly's safety outranks everything, and nothing shields against it",
  ),
  touchSalience: model(
    1.5,
    "salience",
    [1.5, 1.5],
    "the legs at an edge or against a solid: the body met something, which outranks an inquiry and is never shielded against",
  ),
  airSalience: model(
    1.2,
    "salience",
    [1.2, 1.2],
    "a sudden change in the air going by (more than airSettleMS in a period): it outranks an inquiry, as a step in the wind is news, and is never shielded against",
  ),
  landSalience: model(
    1.3,
    "salience",
    [1.3, 1.3],
    "a landing the controller intends: time-critical, so it outranks an inquiry",
  ),
  foodSalience: model(
    0.5,
    "salience",
    [0.5, 0.5],
    "food the controller pursues (feeding, scenting or returning to it), plus the fly's hunger (one minus its reserve): a hungry fly's food outranks an inquiry",
  ),
  takeoffSalience: model(
    1.1,
    "salience",
    [1.1, 1.1],
    "a voluntary takeoff: just above an open inquiry, so that an urge to fly interrupts self-examination unless the fly controls its attention (attentionSchema.ts). A model choice that sets up the conflict ECHO-06 tests",
  ),
  groomSalience: model(
    0.7,
    "salience",
    [0.7, 0.7],
    "a grooming bout the controller intends: below an open inquiry",
  ),
  flightSalience: model(
    0.6,
    "salience",
    [0.6, 0.6],
    "cruising or hovering flight the controller intends",
  ),
  idleSalience: model(
    0.3,
    "salience",
    [0.3, 0.3],
    "walking or resting as the controller intends it: the least of the bids",
  ),
  igniteSalience: model(
    0.5,
    "salience",
    [0.5, 0.5],
    "a bid enters an empty workspace only at this salience or more: below it nothing is broadcast, and the controller acts alone",
  ),
  releaseSalience: model(
    0.25,
    "salience",
    [0.25, 0.25],
    "what holds the workspace lets go when its bid falls below this",
  ),
  workspaceMargin: model(
    0.05,
    "fraction",
    [0.05, 0.05],
    "a rival takes the workspace only when it outbids what holds it by more than this share: what holds it keeps it against an equal (ignition and sustain)",
  ),
  // --- The attention schema: a model of its own attention (attentionSchema.ts) --
  schemaTauS: model(
    60,
    "s",
    [60, 60],
    "the fly learns how often each kind of content takes its workspace, and how long each holds it, over about this long",
  ),
  schemaDwellS: model(
    2,
    "s",
    [2, 2],
    "how long the fly expects a content to hold its workspace before it has seen any: a guess its own experience replaces",
  ),
  shieldRisk: model(
    0.2,
    "probability",
    [0.2, 0.2],
    "the fly shields an inquiry when it expects, by its model of its own attention, at least this chance that a content it may hold off takes the workspace before the inquiry can finish",
  ),
  shieldMargin: model(
    1,
    "fraction",
    [1, 1],
    "while shielded, a rival it may hold off needs twice the inquiry's bid to take the workspace; hazards, touch and the air are never held off",
  ),
  // --- The second look: monitoring its own conclusions (metacognition) -----------
  checkPeriods: model(
    20,
    "periods",
    [20, 20],
    "before it commits to a conclusion the fly acts on it and weighs it again on this many fresh periods (1 s): it commits if the same claim still wins, revises if another does, and keeps asking if none does",
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
