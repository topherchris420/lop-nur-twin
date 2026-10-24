/**
 * The digital fly's parameter table: each value with where it came from and
 * the range it may take. Three kinds, never mixed:
 *
 * - `flybody`: read from the FlyBody model or its code (Apache-2.0), or
 *   reported for that model in Vaxenburg et al. 2025. These are the model's
 *   own constants and its trained policies' figures, not measurements of a fly.
 * - `published`: reported for real Drosophila in the cited paper. The value
 *   here is the paper's figure or a stated round reading of it; the note says
 *   which.
 * - `model`: chosen for this reduced-order simulator. Not measured, not
 *   fitted; experiments may vary it within its range, and nothing may present
 *   it as biology.
 *
 * Every value has an inclusive range. FlyBody and published values are fixed:
 * their range is the value itself, and `resolveParams` refuses to override
 * them. A model value may be set anywhere in its range, and the note says why
 * the range ends where it does when that is not obvious; a model value whose
 * range is a single number is fixed too, and its note says what ties it.
 *
 * What the table covers: the rates, thresholds, gains, time constants, speeds
 * and sizes the behaviour is built on. It is not every number in the fly. The
 * body, its senses, the world queries and the controller also use fixed
 * constants written where they are used (turn durations and spreads, the
 * grooming start weights, steering gains, site scoring, ray fans, the drawn
 * attitude's drag and lean, contact tolerances); those are model choices too,
 * none fitted, and docs/DIGITAL_FLY.md lists each of them except numerical
 * tolerances. The inspection panel prints this table with each value's kind,
 * source and, where it can vary, range.
 */
export type ParamKind = "flybody" | "published" | "model";
/** A paper (by DOI) or a file of FlyBody's code at the pinned commit (by URL). */
export interface Citation {
  short: string;
  doi?: string;
  url?: string;
}
export interface Param {
  value: number;
  unit: string;
  kind: ParamKind;
  /** Inclusive bounds an override must lie in; both equal the value when it is fixed. */
  min: number;
  max: number;
  source?: Citation;
  note: string;
}

/** FlyBody's code at the commit `data/flybody.source.json` pins. */
const FLYBODY_TREE =
  "https://github.com/TuragaLab/flybody/blob/d015e9bfe441bd90ae431bac24c55cb74bdbce26/flybody";

export const CITATIONS = {
  flybody: {
    short: "Vaxenburg et al. 2025, Nature 643:1312",
    doi: "10.1038/s41586-025-09029-4",
  },
  flybodyFruitfly: {
    short: "FlyBody fruitfly.py at d015e9b",
    url: `${FLYBODY_TREE}/fruitfly/fruitfly.py`,
  },
  flybodyConstants: {
    short: "FlyBody tasks/constants.py at d015e9b",
    url: `${FLYBODY_TREE}/tasks/constants.py`,
  },
  mendes2013: { short: "Mendes et al. 2013, eLife 2:e00231", doi: "10.7554/eLife.00231" },
  tammero2002a: {
    short: "Tammero & Dickinson 2002, J Exp Biol 205:327",
    doi: "10.1242/jeb.205.3.327",
  },
  tammero2002b: {
    short: "Tammero & Dickinson 2002, J Exp Biol 205:2785",
    doi: "10.1242/jeb.205.18.2785",
  },
  vanBreugel2012: {
    short: "van Breugel & Dickinson 2012, J Exp Biol 215:1783",
    doi: "10.1242/jeb.066498",
  },
  card2008: {
    short: "Card & Dickinson 2008, Curr Biol 18:1300",
    doi: "10.1016/j.cub.2008.07.094",
  },
  vonReyn2014: {
    short: "von Reyn et al. 2014, Nat Neurosci 17:962",
    doi: "10.1038/nn.3741",
  },
  ache2019: {
    short: "Ache et al. 2019, Curr Biol 29:1073",
    doi: "10.1016/j.cub.2019.01.079",
  },
  seeds2014: { short: "Seeds et al. 2014, eLife 3:e02951", doi: "10.7554/eLife.02951" },
  engel1996: {
    short: "Engel & Wu 1996, J Neurosci 16:3486",
    doi: "10.1523/JNEUROSCI.16-10-03486.1996",
  },
  benzer1967: { short: "Benzer 1967, PNAS 58:1112", doi: "10.1073/pnas.58.3.1112" },
  klapoetke2017: {
    short: "Klapoetke et al. 2017, Nature 551:237",
    doi: "10.1038/nature24626",
  },
  seelig2015: {
    short: "Seelig & Jayaraman 2015, Nature 521:186",
    doi: "10.1038/nature14446",
  },
  lehmann1997: {
    short: "Lehmann & Dickinson 1997, J Exp Biol 200:1133",
    doi: "10.1242/jeb.200.7.1133",
  },
  warren2019: {
    short: "Warren, Giraldo & Dickinson 2019, J Exp Biol 222:jeb186148",
    doi: "10.1242/jeb.186148",
  },
  qi2015: { short: "Qi et al. 2015, Mol Brain 8:87", doi: "10.1186/s13041-015-0179-x" },
  yu2016: { short: "Yu et al. 2016, eLife 5:e15693", doi: "10.7554/eLife.15693" },
  meyerhof2024: {
    short: "Meyerhof et al. 2024, PNAS 121:e2400964121",
    doi: "10.1073/pnas.2400964121",
  },
  leitch2021: {
    short: "Leitch et al. 2021, PNAS 118:e2013342118",
    doi: "10.1073/pnas.2013342118",
  },
  giraldo2018: {
    short: "Giraldo et al. 2018, Curr Biol 28:2845",
    doi: "10.1016/j.cub.2018.07.002",
  },
  ofstad2011: {
    short: "Ofstad, Zuker & Reiser 2011, Nature 474:204",
    doi: "10.1038/nature10131",
  },
  corfas2019: {
    short: "Corfas, Sharma & Dickinson 2019, Curr Biol 29:1660",
    doi: "10.1016/j.cub.2019.03.004",
  },
  behbahani2021: {
    short: "Behbahani et al. 2021, Curr Biol 31:4398",
    doi: "10.1016/j.cub.2021.08.006",
  },
} as const satisfies Record<string, Citation>;

/** Where a citation links to: the DOI resolver, or the pinned code file. */
export function citationUrl(c: Citation): string {
  return c.doi ? `https://doi.org/${c.doi}` : (c.url ?? "");
}

/** A FlyBody or published value: fixed, so its range is the value itself. */
export const fixed = (
  value: number,
  unit: string,
  kind: "flybody" | "published",
  note: string,
  source?: Citation,
): Param =>
  source
    ? { value, unit, kind, min: value, max: value, source, note }
    : { value, unit, kind, min: value, max: value, note };

/** A model value and the inclusive range an experiment may set it in. */
export const model = (
  value: number,
  unit: string,
  [min, max]: readonly [number, number],
  note: string,
  source?: Citation,
): Param =>
  source
    ? { value, unit, kind: "model", min, max, source, note }
    : { value, unit, kind: "model", min, max, note };

/** Hazard rates are drawn once per 50 ms decision, so 20/s already means "at every decision". */
const RATE: readonly [number, number] = [0, 20];

export const PARAMS = {
  // --- Body ---------------------------------------------------------------
  massMg: fixed(
    0.983,
    "mg",
    "flybody",
    "total body mass of the FlyBody model",
    CITATIONS.flybody,
  ),
  bodyPitchHoverDeg: fixed(
    47.5,
    "deg",
    "flybody",
    "thorax pitch at which the wing thrust axis (MJCF site hover_up_dir) is vertical: FlyBody's _BODY_PITCH_ANGLE",
    CITATIONS.flybodyConstants,
  ),
  wingbeatHz: fixed(
    218,
    "Hz",
    "flybody",
    "base wingbeat frequency, FlyBody _WING_PARAMS base_freq",
    CITATIONS.flybody,
  ),
  wingbeatRelRange: fixed(
    0.05,
    "fraction",
    "flybody",
    "relative wingbeat frequency range, FlyBody _WING_PARAMS rel_freq_range",
    CITATIONS.flybodyConstants,
  ),
  interommatidialDeg: fixed(
    4.6,
    "deg",
    "flybody",
    "inter-ommatidial angle used for FlyBody's eye model; objects smaller than this are below one ommatidium",
    CITATIONS.flybody,
  ),
  eyeFovDeg: fixed(
    150,
    "deg",
    "flybody",
    "field of view of each eye camera: FlyBody's walker sets eye_camera_fovy to 150° when it builds the fly (the MJCF itself declares 140°). Each eye is treated as a circular cone of this width around its camera axis",
    CITATIONS.flybodyFruitfly,
  ),
  standingCrouch: model(
    0.8,
    "fraction",
    [0.8, 0.8],
    "the thorax stands at this fraction of the height FlyBody's zero pose (every joint at 0, the MJCF's reference configuration, not a measured stance) puts it above the claw tips: 1.06 mm instead of 1.32 mm. A drawing choice, not fitted to FlyBody's walking policy or to a fly; it also sets the fly's clearance for contacts and touchdowns. Fixed, because the drawn legs are solved for it",
  ),

  // --- Walking --------------------------------------------------------------
  walkSpeedMinCmS: fixed(
    0.72,
    "cm/s",
    "published",
    "slowest walking speed in the reported range (7.2 mm/s)",
    CITATIONS.mendes2013,
  ),
  walkSpeedMaxCmS: fixed(
    4.0,
    "cm/s",
    "flybody",
    "fastest walking speed the FlyBody walking policy was trained to (0–4 cm/s)",
    CITATIONS.flybody,
  ),
  stepPeriodFloorMs: fixed(
    60,
    "ms",
    "published",
    "step period levels off near 60 ms at high speed (a reading of the reported curve)",
    CITATIONS.mendes2013,
  ),
  stanceLegsAt1: fixed(
    3.9,
    "legs",
    "flybody",
    "mean legs in stance at 1 cm/s",
    CITATIONS.flybody,
  ),
  stanceLegsAt4: fixed(
    3.1,
    "legs",
    "flybody",
    "mean legs in stance at 4 cm/s",
    CITATIONS.flybody,
  ),
  swingMs: model(
    30,
    "ms",
    [10, 60],
    "swing duration, held constant across speed as the cited study reports qualitatively; the value is set so the 60 ms period floor and the FlyBody duty factor at 4 cm/s agree. Within its range the step period stays between the 60 ms floor and 0.17 s at FlyBody's duty factors",
    CITATIONS.mendes2013,
  ),
  walkSpeedTauS: model(
    0.1,
    "s",
    [0, 1],
    "time constant of the walking speed's approach to its command (not fitted); 0 follows at once",
  ),

  // --- Flight ---------------------------------------------------------------
  cruiseCmS: fixed(
    30,
    "cm/s",
    "flybody",
    "straight-flight speed of the FlyBody flight policy",
    CITATIONS.flybody,
  ),
  saccadeMs: fixed(
    80,
    "ms",
    "published",
    "body saccade duration; the cited study reports turns of about 90° completed in under 100 ms",
    CITATIONS.tammero2002a,
  ),
  saccadeMeanDeg: fixed(
    90,
    "deg",
    "published",
    "typical saccade amplitude",
    CITATIONS.tammero2002a,
  ),
  saccadeSdDeg: model(
    25,
    "deg",
    [0, 90],
    "spread of saccade amplitudes around the mean (not fitted); amplitudes are clamped to 30–170°, so a wider spread only piles them at the limits",
  ),
  saccadeRefractoryS: model(
    0.15,
    "s",
    [0, 5],
    "least time between the end of one saccade and the next",
  ),
  spontaneousSaccadeHz: model(
    1.0,
    "1/s",
    RATE,
    "rate of spontaneous saccades in open space: straight segments punctuated by turns, rate not fitted",
  ),
  avoidTtcS: model(
    0.45,
    "s",
    [0, 2],
    "time to contact with a surface ahead below which the fly saccades away from the nearer side; visual expansion as the trigger is published, this threshold is not. 0 turns avoidance off; at 2 s the fly already turns from walls 60 cm away at cruise speed",
    CITATIONS.tammero2002b,
  ),
  clutterSlowM: model(
    1.0,
    "m",
    [0.05, 3],
    "clearance below which cruise speed is scaled down in proportion; slower flight in a cluttered visual landscape is published, the scale is not. Clearance is measured along a 3 m ray fan, so above 3 m every surface the fan sees would slow the fly",
    CITATIONS.tammero2002a,
  ),
  clutterSlowFloor: model(
    0.4,
    "fraction",
    [0.05, 1],
    "the least share of the cruise speed clutter slows the fly to (not fitted); 1 turns the slowing off",
  ),
  avoidSpeedShare: model(
    0.7,
    "fraction",
    [0, 1],
    "share of the cruise speed held through a saccade away from a surface ahead (not fitted)",
  ),
  altitudeGain: model(
    1.5,
    "1/s",
    [0.1, 5],
    "climb or sink rate per metre between the preferred cruise height and the height above the surface below (not fitted). The range ends at 5/s, a time constant of 0.2 s, still well above the 50 ms decision period and the 30 ms sensory latency",
  ),
  climbMaxMS: model(
    0.3,
    "m/s",
    [0.05, 1],
    "fastest climb or sink while holding the cruise height, and fastest sink away from the extent's ceiling (not fitted). At most 1 m/s, so with the cruise speed the command stays under the 1.5 m/s flight limit",
  ),
  velocityTauS: model(
    0.08,
    "s",
    [0, 2],
    "time constant of the reduced-order flight velocity tracker. The update is exponential, so any value is stable; 0 follows the command at once, within the acceleration limit",
  ),
  maxAccelG: model(
    1.5,
    "g",
    [0.1, 5],
    "acceleration limit of the reduced-order flight model. 0.1 g still reverses a 0.3 m/s cruise in about 0.6 s; 5 g still changes the speed by under 0.25 m/s per 5 ms step",
  ),
  approachTauS: model(
    0.25,
    "s",
    [0.05, 1],
    "landing approach keeps distance/speed near this value, so speed falls as the target expands; deceleration driven by expansion is published, the constant is not. below 0.05 s the approach is still faster than the 0.15 m/s touchdown speed 7.5 mm from the target, and at 1 s a 1 m approach already outlasts the default 5 s landing timeout",
    CITATIONS.vanBreugel2012,
  ),
  legExtensionDeg: fixed(
    60,
    "deg",
    "published",
    "retinal size of the landing target at which the legs extend",
    CITATIONS.vanBreugel2012,
  ),
  flightBoutMeanS: model(
    6,
    "s",
    [0.5, 60],
    "mean flight-bout length before a landing is sought (not fitted); each bout is drawn from an exponential and clamped to 1.5–20 s",
  ),
  hoverHz: model(0.15, "1/s", RATE, "rate of hovering pauses during cruise"),
  hoverMeanS: model(0.6, "s", [0.05, 5], "mean hover duration"),
  cruiseAltMinM: model(
    0.3,
    "m",
    [0.05, 10],
    "lowest preferred cruise height above the surface below; at most cruiseAltMaxM",
  ),
  cruiseAltMaxM: model(
    2.5,
    "m",
    [0.05, 10],
    "highest preferred cruise height above the surface below; a world's ceiling still caps it",
  ),
  landingSearchM: model(
    4,
    "m",
    [0.1, 12],
    "radius in which landing sites are considered; beyond 12 m a site would lie past the default visual range",
  ),
  landTimeoutS: model(
    5,
    "s",
    [0.5, 60],
    "a landing approach is abandoned when it has run this much longer than the approach law needs from the distance it began at (cruise speed down to `approachTauS`, then the slowing tail), so every site within `landingSearchM` can be reached",
  ),
  landRetryS: model(
    1.5,
    "s",
    [0, 60],
    "after an abandoned or aborted landing, flight continues this long before a new site is chosen",
  ),
  touchdownSpeedMS: model(
    0.15,
    "m/s",
    [0.01, 1.5],
    "contact with a walkable top slower than this is a landing; faster is a collision. At most the 1.5 m/s flight limit",
  ),
  contactKeep: model(
    0.3,
    "fraction",
    [0, 1],
    "share of its speed along a surface the airborne fly keeps when it first touches it (not fitted); 1 slides on at full speed, 0 stops dead",
  ),

  // --- Escape ---------------------------------------------------------------
  takeoffPrepMs: fixed(
    200,
    "ms",
    "published",
    "postural adjustment before a visually evoked takeoff, which also sets its direction away from the threat",
    CITATIONS.card2008,
  ),
  longModeSequenceMs: fixed(
    13.2,
    "ms",
    "published",
    "mean duration of a long-mode takeoff from the first wing motion to the loss of tarsal contact (the paper's µ ≈ 13.2 ms; short-mode ones last about 5.4 ms). The body raises the wings over this long before a long-mode jump",
    CITATIONS.vonReyn2014,
  ),
  shortModePrepMs: model(
    40,
    "ms",
    [10, 99],
    "a short-mode escape skips most of the preparation (the two modes are published; this duration is not). The gate allows no preparation under 10 ms, and the body treats any preparation under 100 ms as short-mode, so a longer one would not be a short escape",
    CITATIONS.vonReyn2014,
  ),
  gfVelocityGain: model(
    1 / 600,
    "per deg/s",
    [0, 0.05],
    "weight of angular expansion velocity (LC4-like term) in the giant-fiber proxy; the linear form is from the cited model, the weight is not fitted",
    CITATIONS.ache2019,
  ),
  gfSizeGain: model(
    1.0,
    "unitless",
    [0, 10],
    "peak weight of angular size (LPLC2-like Gaussian term) in the giant-fiber proxy",
    CITATIONS.ache2019,
  ),
  gfSizePeakDeg: model(
    60,
    "deg",
    [5, 180],
    "angular size at which the size term peaks (not fitted)",
  ),
  gfSizeWidthDeg: model(25, "deg", [1, 90], "width of the size term (not fitted)"),
  gfThreshold: model(
    1.0,
    "unitless",
    [0.05, 20],
    "giant-fiber proxy level that commits an escape; near 0 anything that moves would set it off",
  ),
  shortModeThreshold: model(
    1.6,
    "unitless",
    [0.05, 50],
    "proxy level above which the escape is short-mode (fast, less prepared)",
  ),
  habituationStep: model(
    0.22,
    "fraction",
    [0, 1],
    "fall in escape responsiveness after each evoked escape; habituation of the giant-fiber pathway is published, this size is not",
    CITATIONS.engel1996,
  ),
  habituationRecoveryS: model(
    30,
    "s",
    [0.1, 3600],
    "time constant of recovery from habituation (not fitted)",
  ),
  jumpSpeedCmS: model(
    40,
    "cm/s",
    [5, 150],
    "launch speed of the leg-driven jump that starts a takeoff; a visual approximation, not a measurement. At most the 1.5 m/s flight limit",
  ),
  jumpElevationDeg: model(
    50,
    "deg",
    [0, 90],
    "elevation of the jump above the horizontal, along the takeoff's heading (not fitted): 0 launches level, 90 straight up",
  ),

  // --- Perched behaviour ----------------------------------------------------
  groomHz: model(
    0.05,
    "1/s",
    RATE,
    "rate of spontaneous grooming bouts at rest (no dust is simulated)",
  ),
  groomPhaseS: model(
    1.6,
    "s",
    [0.1, 30],
    "mean length of one grooming subroutine, a body site or the leg rubbing after it",
  ),
  groomStopP: model(
    0.5,
    "probability",
    [0, 1],
    "chance a spontaneous grooming bout ends after a site (and the leg rubbing that follows it) instead of moving on to the next site back (not fitted). At 0 every bout runs on to the notum, the full anterior-to-posterior order flies show when dusted all over",
    CITATIONS.seeds2014,
  ),
  walkStartHz: model(0.25, "1/s", RATE, "rate of starting a walking bout at rest"),
  walkStopHz: model(0.35, "1/s", RATE, "rate of stopping while walking"),
  walkTurnHz: model(1.2, "1/s", RATE, "rate of walking turns"),
  takeoffHz: model(0.03, "1/s", RATE, "rate of voluntary takeoff from rest or walking"),
  activityFloor: model(
    0.2,
    "fraction",
    [0, 1],
    "the light level scales the rates of voluntary takeoff and walking and the phototaxis gain, but never below this share of full (not fitted); at 0 a fly in the dark never takes off or starts walking on its own",
  ),
  phototaxisGain: model(
    0.6,
    "rad/s per unit light contrast",
    [0, 6],
    "steering toward the brighter direction; positive phototaxis is published, the gain is not. Turn rates are capped at 6 rad/s walking and 3 rad/s flying anyway",
    CITATIONS.benzer1967,
  ),

  // --- Energy and feeding --------------------------------------------------
  flightPowerMw: model(
    0.196,
    "mW",
    [0.05, 0.5],
    "metabolic power in flight: the cited hovering flight cost, 664 W per kg of flight muscle (its Table 2), times its flight-muscle share of body mass, 0.30, and FlyBody's 0.983 mg. Derived from published figures, not measured on this fly",
    CITATIONS.lehmann1997,
  ),
  restPowerMw: model(
    0.025,
    "mW",
    [0.005, 0.1],
    "metabolic power at rest and feeding: the same paper's resting rate, 85 W per kg of flight muscle, scaled the same way. Derived",
    CITATIONS.lehmann1997,
  ),
  walkPowerMw: model(
    0.05,
    "mW",
    [0.025, 0.2],
    "metabolic power walking, grooming or preparing a takeoff: not measured in the sources used; twice the resting rate, a model choice",
  ),
  reserveJ: model(
    1.41,
    "J",
    [0.2, 5],
    "the carbohydrate reserve that powers flight, when full: two hours of flight at `flightPowerMw`, as the cited review says a well-fed fly can fly for about 2 h (citing Götz 1987; another paper says up to 3 h). Derived; the fat a fly also stores is not modelled, so the reserve is all the energy there is",
    CITATIONS.warren2019,
  ),
  startReserve: model(
    1,
    "fraction",
    [0, 1],
    "share of a full reserve a fly is placed with (not measured): full by default, in the arenas and the lab; the city's fly is placed at 0.6 (`CITY_START_RESERVE`), somewhat hungry, so that it forages",
  ),
  flightReserveFloor: model(
    0.05,
    "fraction",
    [0, 0.5],
    "below this share of a full reserve the fly no longer takes off on its own, though it still escapes (not fitted)",
  ),
  feedIntakeMw: model(
    2.25,
    "mW",
    [0.1, 10],
    "energy taken in while feeding: the cited meal of 0.21 µL of 100 mM sucrose by a 24-h starved fly (0.12 J at 16.5 J/mg) over the 52.8 s a 36-h starved fly spends feeding. Derived; the city's food is not sucrose of known strength",
    CITATIONS.qi2015,
  ),
  mealS: fixed(
    52.8,
    "s",
    "published",
    "mean duration of a feeding bout of 36-h starved flies on sucrose; a meal here lasts an exponential draw of this mean, and ends sooner when the reserve is full",
    CITATIONS.qi2015,
  ),
  starvedActivityGain: fixed(
    0.6,
    "fraction",
    "published",
    "a starved fly's locomotor activity rises about 60 %: the rates of spontaneous walking and takeoff are multiplied by 1 + this × hunger (hunger = 1 − reserve/full; the linear scaling is a model choice)",
    CITATIONS.yu2016,
  ),
  hungerSeek: model(
    0.2,
    "fraction",
    [0, 1],
    "hunger above which the fly is drawn by food odour, lands on food it finds and returns to food it remembers (not fitted)",
  ),
  odourDetect: model(
    0.01,
    "relative odour",
    [0.001, 1],
    "odour level the fly responds to; with the world's e^(−d/5 m) odour that is about 23 m from one patch (not fitted)",
  ),

  // --- Rest and shelter -----------------------------------------------------
  shadePreference: fixed(
    0.98,
    "preference index",
    "published",
    "flies' daytime sleep is nearly all in the shade (the cited control preference index, 0.98): when a flight bout ends, a site in shade is preferred over one in sun by this index, which weighs its score",
    CITATIONS.meyerhof2024,
  ),

  // --- Navigation and memory ------------------------------------------------
  exploreShare: model(
    0.3,
    "fraction",
    [0, 1],
    "share of a fly's spontaneous takeoffs that start a long flight to a new place rather than a short hop (not fitted)",
  ),
  dispersalCmS: fixed(
    100,
    "cm/s",
    "published",
    "speed of a long flight in open air: the preferred groundspeed of dispersing flies outdoors in still air, about 1 m/s (a model estimate in the cited release-recapture study). Clutter still slows the fly",
    CITATIONS.leitch2021,
  ),
  exploreDistanceM: model(
    60,
    "m",
    [1, 1000],
    "mean distance of a long flight's goal (an exponential draw, kept inside the fly's extent; not fitted)",
  ),
  compassNoiseDeg: model(
    3,
    "deg per √s",
    [0, 60],
    "drift of the fly's heading estimate with the sun in view, a celestial compass the cited flies hold for hours; without it (in shade, in a storm, indoors) the drift is ten times this (not fitted)",
    CITATIONS.giraldo2018,
  ),
  odometryNoise: model(
    0.1,
    "fraction",
    [0, 1],
    "error of the distance the fly integrates, per unit travelled (path integration is published for walking flies near food; its error is not)",
    CITATIONS.behbahani2021,
  ),
  placeMemoryS: model(
    7200,
    "s",
    [60, 86400],
    "how long a place is remembered: flies keep visual place memories for at least 2 hours (and headings for up to 2 h), so a remembered place is forgotten after this",
    CITATIONS.ofstad2011,
  ),
  landmarkRangeM: model(
    8,
    "m",
    [0.5, 12],
    "a remembered landmark (a post, pole or trunk) seen within this distance tells the fly where it is (not fitted); at most the visual range",
  ),
  localSearchS: model(
    120,
    "s",
    [0, 1800],
    "after leaving food still hungry, the fly keeps its walking near the food for this long (flies search locally for minutes after food; not fitted)",
    CITATIONS.corfas2019,
  ),
  localSearchM: model(
    0.045,
    "m",
    [0.005, 1],
    "the local search turns the fly back to the food once it is this far from it: about 15 body lengths, the cited mean excursion just after food",
    CITATIONS.behbahani2021,
  ),

  // --- Sensing and timing -------------------------------------------------
  visualLatencyMs: model(
    30,
    "ms",
    [0, 200],
    "delay from a visual sample to the decision that uses it (not fitted)",
  ),
  sensePeriodMs: model(
    10,
    "ms",
    [5, 50],
    "visual sampling period of the simulator; rounded to whole physics steps",
  ),
  decisionPeriodMs: model(
    50,
    "ms",
    [10, 500],
    "controller decision period (20 Hz); rounded to whole physics steps",
  ),
  physicsStepMs: model(
    5,
    "ms",
    [1, 10],
    "integration step of the reduced-order body (200 Hz); the clock counts whole microseconds and no step is shorter than 1 ms",
  ),
  visualRangeM: model(
    12,
    "m",
    [0.5, 50],
    "farthest distance the simulator evaluates objects at",
  ),
} as const satisfies Record<string, Param>;

export type ParamName = keyof typeof PARAMS;

/** A controller configuration: overrides of `model` parameters only. */
export type ControllerConfig = Partial<Record<ParamName, number>>;

/** Resolved values, frozen so nothing that reads them can change them. */
export type ResolvedParams = Readonly<Record<ParamName, number>>;

/**
 * The table's values with `config`'s overrides applied. Overrides may change
 * model parameters only, each within its range; FlyBody and published values
 * are fixed. The result is frozen.
 */
export function resolveParams(config: ControllerConfig = {}): ResolvedParams {
  for (const name of Object.keys(config))
    if (!Object.hasOwn(PARAMS, name)) throw new Error(`unknown parameter ${name}`);
  const out = {} as Record<ParamName, number>;
  for (const name of Object.keys(PARAMS) as ParamName[]) {
    const param: Param = PARAMS[name];
    const override = config[name];
    if (override === undefined) out[name] = param.value;
    else {
      if (param.kind !== "model")
        throw new Error(`${name} is a ${param.kind} value and cannot be overridden`);
      if (typeof override !== "number" || !Number.isFinite(override))
        throw new Error(`${name} must be a finite number`);
      if (override < param.min || override > param.max)
        throw new Error(
          param.min === param.max
            ? `${name} is fixed at ${param.value} ${param.unit}`
            : `${name} must be within [${param.min}, ${param.max}] ${param.unit}; got ${override}`,
        );
      out[name] = override;
    }
  }
  if (out.cruiseAltMinM > out.cruiseAltMaxM)
    throw new Error(
      `cruiseAltMinM (${out.cruiseAltMinM} m) must not exceed cruiseAltMaxM (${out.cruiseAltMaxM} m)`,
    );
  return Object.freeze(out);
}
