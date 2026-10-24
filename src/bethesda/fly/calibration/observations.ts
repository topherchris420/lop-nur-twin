/**
 * What real flies were measured to do: the published observations the
 * calibration sets the simulated fly beside, each with the words its paper
 * reports it in.
 *
 * Every number here is in its source's text, quoted verbatim in `quote` (a
 * table or a text layer out of reading order gives the fragments, each
 * verbatim), or, for the grooming ethograms, computed from the deposited data
 * by the importer (`grooming-reference.json`). A value that is arithmetic on
 * quoted numbers says so in `derived`. Equation images and garbled glyphs are
 * restored in square brackets or in the symbols the paper prints; nothing else
 * is changed. No value is read off a figure.
 *
 * Each observation's role says what the comparison can show:
 *
 * - `held-out`: nothing in either controller was set from it, so agreement
 *   is evidence and disagreement a finding.
 * - `design`: a parameter both controllers use was taken from it (or from the
 *   same measurement), so agreement is by construction; it is shown so the
 *   construction can be checked.
 * - `fit`: the circuit-informed controller's fitted values were set to match
 *   it (`fit.ts`); for that controller it is a fit target, for the
 *   reduced-order one it is held out.
 */
import type { Citation } from "../params.js";
import { CITATIONS } from "../params.js";
import { CIRCUIT_CITATIONS } from "../circuits/params.js";
import type { Spread } from "./compare.js";
import { GROOMING_REFERENCE, type AcrossFlies } from "./groomingReference.js";

export const CALIBRATION_CITATIONS = {
  vonReyn2014: CITATIONS.vonReyn2014,
  fotowat2009: CIRCUIT_CITATIONS.fotowat2009,
  card2008: CITATIONS.card2008,
  zacarias2018: {
    short: "Zacarias et al. 2018, Nat Commun 9:3697",
    doi: "10.1038/s41467-018-05875-1",
  },
  zhang2020: CIRCUIT_CITATIONS.zhang2020,
  zhang2020data: {
    short: "Zhang, Guo & Simpson 2020, Mendeley Data V1",
    doi: GROOMING_REFERENCE.dataset.doi,
  },
  seeds2014: CITATIONS.seeds2014,
  censi2013: {
    short: "Censi et al. 2013, PLoS Comput Biol 9:e1002891",
    doi: "10.1371/journal.pcbi.1002891",
  },
  tammero2002a: CITATIONS.tammero2002a,
  vanBreugel2012: CITATIONS.vanBreugel2012,
  liu2007: {
    short: "Liu, Davis & Roman 2007, Genetics 175:1197",
    doi: "10.1534/genetics.106.068411",
  },
  soibam2012: {
    short: "Soibam et al. 2012, PLoS ONE 7:e46570",
    doi: "10.1371/journal.pone.0046570",
  },
  mendes2013: CITATIONS.mendes2013,
  deAngelis2019: {
    short: "DeAngelis, Zavatone-Veth & Clark 2019, eLife 8:e46409",
    doi: "10.7554/eLife.46409",
  },
} as const satisfies Record<string, Citation>;
const C = CALIBRATION_CITATIONS;

export type Behaviour = "escape" | "grooming" | "flight" | "landing" | "walking";
export type Role = "held-out" | "design" | "fit";

/**
 * A published experiment and how the calibration rebuilds it. The rebuilt
 * paradigm is run by `paradigms.ts`; `approximations` names every way it
 * differs from the experiment, because each comparison inherits them.
 */
export interface Paradigm {
  label: string;
  source: Citation;
  experiment: string;
  rebuilt: string;
  approximations: readonly string[];
}

export const PARADIGMS = {
  vonReyn2014: {
    label: "Looming disk over a standing fly",
    source: C.vonReyn2014,
    experiment:
      "Single unrestrained control flies on a platform; a dark disk expanding from 15° to 90° at constant r/v (8, 14, 40, 70 or 140 ms), at 45° elevation with a frontward azimuth bias; one stimulus per fly; filmed at 6000 frames/s.",
    rebuilt:
      "A fly standing at rest in a lit, otherwise empty 4 × 2.5 × 4 m room, spontaneous takeoff, walking and grooming off, one looming stimulus aimed at it after 1 s: 15° → 90° at the published r/v, 45° elevation, azimuth drawn uniformly within ±60° of straight ahead, then held at 90° for 1 s. A trial ends when the hold does.",
    approximations: [
      "The paper reports the azimuth as '±60° for over 90% of flies'; here it is uniform within ±60°.",
      "The hold at 90° is not stated for the freely behaving flies; the paper's tethered experiments held 90° for 1 s, which is used here.",
      "The disk is shown as a sphere moved so that it subtends the disk's angle at every moment (`stimuli.ts`): the angular size and expansion are the published ones; the luminance change is not modelled.",
      "The platform and dome are not modelled; the fly stands on an open floor.",
    ],
  },
  fotowat2009: {
    label: "Looming square beside a standing fly",
    source: C.fotowat2009,
    experiment:
      "Wild-type flies at the tip of a funnel, a dark square approaching on a collision course on a monitor beside them (monocular in 65% of trials), l/|v| from 5 to 80 ms; filmed at 400 frames/s.",
    rebuilt:
      "As the looming-disk paradigm, with the stimulus at 90° azimuth and 0° elevation, growing from 5° to 150° at l/v 10 or 40 ms and held for 0.2 s.",
    approximations: [
      "The square on a flat monitor is shown as a disk-equivalent sphere; the published square grew until the projected collision, here it stops at 150°.",
      "The funnel is not modelled.",
    ],
  },
  card2008: {
    label: "Looming threat from the front, side or back",
    source: C.card2008,
    experiment:
      "Females on a 5 mm² platform; a real black disk of 70 mm radius falling toward them along a 50° path from the front, side or back; filmed at 5400 frames/s.",
    rebuilt:
      "As the looming-disk paradigm at r/v 40 ms, 10° → 90°, 45° elevation, from straight ahead, the side (90°) or straight behind (180°).",
    approximations: [
      "A constant-r/v loom stands for the falling disk, whose approach was not at constant speed.",
    ],
  },
  zacarias2018: {
    label: "Repeated looms over a walking fly",
    source: C.zacarias2018,
    experiment:
      "Single mated females in a covered arena 30 mm across and 4 mm high, 5 min to explore, then 20 looms over 5 min on a monitor angled above the arena: a disk of 1 cm at 25 cm/s (l/v 40 ms) expanding over 450 ms to 78°, held 50 ms.",
    rebuilt:
      "The fly in a clear round arena 30 mm across and 4 mm high with a lid, spontaneous takeoff off and its other behaviour its own, 5 min to explore, then 20 looms 15 s apart, each aimed at where it is from a direction drawn within ±90° of its heading, 45° up: 9.2° → 78° over 450 ms (l/v 40 ms), held 50 ms. A jump is a takeoff within 1 s of a loom's onset.",
    approximations: [
      "The schedule within the 5 min is not stated here; the looms are spaced evenly.",
      "The monitor angled above the arena is not modelled: the fly's eyes (FlyBody's two 150° cones) do not cover the zenith, and a fixed direction would often be hidden by the 4 mm wall from a fly walking along it, so each loom comes from the fly's frontal half, 45° up, through clear walls and lid.",
      "The 9.2° start is the size 450 ms before 78° at l/v 40 ms.",
      "The lid keeps the fly in the arena: it lands again after a jump.",
    ],
  },
  zhang2020: {
    label: "Dusted and undusted flies alone in a chamber",
    source: C.zhang2020,
    experiment: GROOMING_REFERENCE.paradigm,
    rebuilt:
      "The fly alone in a closed square chamber 15.6 mm across and 4 mm high, dusted all over (the grooming circuit's dust as the model's authors set it) or not, spontaneous takeoff off; its behaviour labelled at 30 Hz for 50 000 frames (1–5 grooming routines, 6 walking, 7 standing), as many flies as the data have, and the labels reduced by the same code as the recorded ethograms (`ethogram.ts`).",
    approximations: [
      "The chamber width is Seeds et al. 2014's (the same laboratory's 15.6 mm chambers); its height is a model choice.",
      "Real dust is not modelled: a dusted fly carries the grooming circuit's dust from the start, and the world adds none.",
      "The simulated label is the fly's own mode, not a classifier's reading of video; standing includes resting.",
      "The fly's notum cleaning, which the data have no label for, counts as back-leg rubbing.",
    ],
  },
  censi2013: {
    label: "Free flight in a 1 m-radius arena",
    source: C.censi2013,
    experiment:
      "88 flies tracked at 60 frames/s in a circular arena of 1 m radius with a retro-illuminated checkerboard wall; only samples with flight speed above 5 cm/s kept; saccades found by the authors' geometric detector.",
    rebuilt:
      "The fly released in cruise at the centre of a round arena of 1 m radius and 1 m height, 0.5 m up, heading drawn at random, and followed until it lands or for 60 s; many releases. Positions at 60 Hz; the heading of travel from successive positions; airborne samples faster than 5 cm/s kept; a saccade is a maximal run of samples turning one way faster than 300°/s.",
    approximations: [
      "The arena's height is not stated here; 1 m is a model choice.",
      "The authors' detectors (their Text S1) are not reproduced; 300°/s is Tammero & Dickinson's and van Breugel & Dickinson's threshold.",
      "The checkerboard wall is a plain lit wall: the fly's senses have no texture.",
      "The fly's preferred cruise height, a model value sized for the city (0.3–2.5 m), is set to 0.1–0.6 m for the arena, and its home range's ceiling sits 0.3 m above the lid, where the controller's rule of keeping 0.3 m below it holds the fly under the lid.",
    ],
  },
  tammero2002a: {
    label: "Free flight in a 1 m cylinder",
    source: C.tammero2002a,
    experiment:
      "Flies tracked at 30 frames/s in a translucent cylinder 1 m across and 0.6 m high lined with a random checkerboard.",
    rebuilt:
      "As the 1 m-radius arena, in a round arena 1 m across and 0.6 m high, the fly released 0.3 m up; positions at 30 Hz and every airborne sample kept.",
    approximations: [
      "The checkerboard lining is a plain lit wall: the fly's senses have no texture.",
      "The fly's preferred cruise height is set to 0.1–0.4 m for the arena, its home range's ceiling 0.3 m above the lid.",
    ],
  },
  vanBreugel2012: {
    label: "Landing on, or flying past, a post",
    source: C.vanBreugel2012,
    experiment:
      "Females in the still-air section (1.5 × 0.3 × 0.3 m) of a wind tunnel with a checkerboard floor and walls and a post 15 cm tall and 1.9 cm across in the centre; 3D tracking at 100 frames/s; landings and fly-bys among the trajectories coming within 3 cm of the post.",
    rebuilt:
      "The fly released in cruise at a random point of a closed 1.5 × 0.3 × 0.3 m tunnel (5–25 cm up, at least 10 cm from the post), heading drawn at random, and followed until it lands or for 10 s, positions at 100 Hz; a post 15 cm tall and 1.9 cm across stands in the centre. A trajectory counts when it comes within 3 cm of the post's surface; it is a landing if the fly touches down on the post. Speeds are the body's at the last crossing of 10 cm from the post before touching down (landings) or before the closest approach (fly-bys).",
    approximations: [
      "The simulated fly lands only on tops, so it lands on the post's 1.9 cm top; the real flies landed on its side as well. Its leg extension is set beside the retinal size of that top.",
      "The fly is released inside the section; the real flies entered it on their own.",
      "The checkerboard is a plain lit surface: the fly's senses have no texture.",
      "The fly's preferred cruise height is set to 0.05–0.25 m for the tunnel, its home range's ceiling 0.3 m above the lid.",
    ],
  },
  liu2007: {
    label: "Open field 9.1 cm across",
    source: C.liu2007,
    experiment:
      "Canton-S males alone in a clear circular arena 9.1 cm across and 0.7 cm high, positions every 100 ms for 10 min.",
    rebuilt:
      "The fly placed at rest at a random point of a round arena 9.1 cm across and 0.7 cm high with a lid, spontaneous takeoff off, positions every 100 ms for 3 min. Moving is the walking mode; the outermost third is the outer third of the area (r ≥ 0.8165 R).",
    approximations: [
      "The tracker's threshold for moving is not stated; the fly's walking mode stands for it.",
      "Whether the outermost third is by area is inferred from the paper's 'A fly moving about at random may be expected to spend ∼33% of the time within this outer region'.",
    ],
  },
  soibam2012: {
    label: "Circular arena of 4.2 cm radius",
    source: C.soibam2012,
    experiment:
      "Canton-S flies in a circular arena of 4.2 cm radius and 0.7 cm height, tracked at 30 frames/s; trajectories sampled every 1/6 s; turn angles from the central zone, more than 6 mm from the wall.",
    rebuilt:
      "The fly placed at rest at a random point of a round arena of 4.2 cm radius and 0.7 cm height with a lid, spontaneous takeoff off, positions every 1/6 s for 10 min; a turn angle is the change of direction between successive displacements that both lie in the central zone, a displacement under 0.1 mm counting as none.",
    approximations: [
      "The sampling interval and the three angles are equation images in the paper's text; they are read from those images.",
      "The minimum displacement that has a direction is not stated; 0.1 mm is a model choice.",
    ],
  },
  mendes2013: {
    label: "Leg coordination against walking speed",
    source: C.mendes2013,
    experiment:
      "Oregon R flies walking straight in a 7 × 40 mm glass tunnel, footprints imaged at 250 frames/s; frames classed by which legs are in stance.",
    rebuilt:
      "The body's gait (`gait.ts`) evaluated at 200 evenly spaced phases of its cycle at every 0.1 mm/s of each speed class within the body's walking range (7.2–40 mm/s): the share of instants in tripod coordination. The gait is the body's, so both controllers share it.",
    approximations: [
      "The real flies' speeds within each class are not stated; the speeds are spread evenly.",
      "Tripod is three legs in stance in the alternating triplets; the paper's classification of frames is not reproduced.",
    ],
  },
  deAngelis2019: {
    label: "Stance duration against walking speed",
    source: C.deAngelis2019,
    experiment:
      "Groups of wild-type females walking spontaneously in a 5 cm arena 2.5 mm high at 34 °C, filmed at 150 frames/s; stance durations fitted against forward speed by a power law.",
    rebuilt:
      "The body's stance duration (duty factor × step period, `gait.ts`) at 10, 20 and 30 mm/s set beside the paper's fitted law at those speeds.",
    approximations: [
      "The comparison is with the paper's fit (R² = 0.59), not with its data.",
    ],
  },
} as const satisfies Record<string, Paradigm>;
export type ParadigmId = keyof typeof PARADIGMS;

/** The words a value is reported in: a sentence, or (from a table or a jumbled text layer) fragments, each verbatim. */
export interface Quote {
  citation: Citation;
  where: string;
  quote: string | readonly string[];
}
/** A value computed by the grooming importer from the deposited ethograms. */
export interface DataRef {
  citation: Citation;
  data: string;
}

export interface Observation {
  id: string;
  behaviour: Behaviour;
  paradigm: ParadigmId;
  /** What was measured, in words. */
  measure: string;
  /** The reported value; null for a direction only. */
  value: number | null;
  unit: string;
  spread: Spread | null;
  /** Flies or trials the value is over, when the source says. */
  n: number | null;
  /** For a direction only: the sign the source reports for the trend. */
  sign?: 1 | -1;
  role: Role;
  /** When the value is arithmetic on quoted numbers: what arithmetic. */
  derived?: string;
  note?: string;
  source: Quote | DataRef;
}

// --- The grooming ethograms (computed from the deposited data) -------------

const DUSTED = GROOMING_REFERENCE.conditions.dusted;
const UNDUSTED = GROOMING_REFERENCE.conditions.undusted;
const DATA = (field: string): DataRef => ({
  citation: C.zhang2020data,
  data: `grooming-reference.json: ${field}`,
});
const sdOf = (a: AcrossFlies): Spread => ({ kind: "sd", value: a.sd });
const fractionObs = (
  id: string,
  condition: "dusted" | "undusted",
  measure: string,
  a: AcrossFlies,
  field: string,
  role: Role,
  note?: string,
): Observation => ({
  id,
  behaviour: "grooming",
  paradigm: "zhang2020",
  measure,
  value: a.mean,
  unit: "fraction of frames",
  spread: sdOf(a),
  n: a.n,
  role,
  ...(note ? { note } : {}),
  source: DATA(`conditions.${condition}.summary.${field}`),
});
const medianObs = (
  id: string,
  condition: "dusted" | "undusted",
  measure: string,
  d: { runs: number; median?: number; q25?: number; q75?: number },
  field: string,
): Observation => ({
  id,
  behaviour: "grooming",
  paradigm: "zhang2020",
  measure,
  value: d.median ?? null,
  unit: "s",
  spread:
    d.q25 !== undefined && d.q75 !== undefined
      ? { kind: "iqr", lo: d.q25, hi: d.q75 }
      : null,
  n: d.runs,
  role: "held-out",
  note: "A median of runs pooled over flies; n counts runs.",
  source: DATA(`conditions.${condition}.summary.${field}`),
});
const lastInterval = DUSTED.summary.intervals.count - 1;

const GROOMING: Observation[] = [
  fractionObs(
    "grooming.dusted.fraction",
    "dusted",
    "share of frames grooming (labels 1–5), dusted flies",
    DUSTED.summary.grooming,
    "grooming",
    "fit",
    "The circuit-informed controller's one grooming threshold is fitted to this mean.",
  ),
  fractionObs(
    "grooming.dusted.anterior",
    "dusted",
    "share of frames grooming the head or rubbing the front legs (labels 1–2), dusted flies",
    DUSTED.summary.anterior,
    "anterior",
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.posterior",
    "dusted",
    "share of frames grooming the abdomen or wings or rubbing the hind legs (labels 3–5), dusted flies",
    DUSTED.summary.posterior,
    "posterior",
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.walking",
    "dusted",
    "share of frames walking (label 6), dusted flies",
    DUSTED.summary.timeFraction["6"]!,
    'timeFraction["6"]',
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.standing",
    "dusted",
    "share of frames standing (label 7), dusted flies",
    DUSTED.summary.timeFraction["7"]!,
    'timeFraction["7"]',
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.anterior.first",
    "dusted",
    "anterior share in the first 150 s, dusted flies",
    DUSTED.summary.intervals.anterior[0]!,
    "intervals.anterior[0]",
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.anterior.last",
    "dusted",
    `anterior share in the ${lastInterval + 1}th 150 s window, dusted flies`,
    DUSTED.summary.intervals.anterior[lastInterval]!,
    `intervals.anterior[${lastInterval}]`,
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.posterior.first",
    "dusted",
    "posterior share in the first 150 s, dusted flies",
    DUSTED.summary.intervals.posterior[0]!,
    "intervals.posterior[0]",
    "held-out",
  ),
  fractionObs(
    "grooming.dusted.posterior.last",
    "dusted",
    `posterior share in the ${lastInterval + 1}th 150 s window, dusted flies`,
    DUSTED.summary.intervals.posterior[lastInterval]!,
    `intervals.posterior[${lastInterval}]`,
    "held-out",
  ),
  {
    id: "grooming.dusted.episodes-per-minute",
    behaviour: "grooming",
    paradigm: "zhang2020",
    measure: "grooming episodes (maximal runs of labels 1–5) per minute, dusted flies",
    value: DUSTED.summary.episodes.perMinute.mean,
    unit: "per min",
    spread: sdOf(DUSTED.summary.episodes.perMinute),
    n: DUSTED.summary.episodes.perMinute.n,
    role: "held-out",
    source: DATA("conditions.dusted.summary.episodes.perMinute"),
  },
  medianObs(
    "grooming.dusted.episode-duration",
    "dusted",
    "median duration of a grooming episode, dusted flies",
    DUSTED.summary.episodes.durationS,
    "episodes.durationS",
  ),
  medianObs(
    "grooming.dusted.anterior-motif",
    "dusted",
    "median duration of an anterior motif (a maximal run of labels 1–2), dusted flies",
    DUSTED.summary.motifs.anterior,
    "motifs.anterior",
  ),
  medianObs(
    "grooming.dusted.posterior-motif",
    "dusted",
    "median duration of a posterior motif (a maximal run of labels 3–5), dusted flies",
    DUSTED.summary.motifs.posterior,
    "motifs.posterior",
  ),
  fractionObs(
    "grooming.undusted.fraction",
    "undusted",
    "share of frames grooming (labels 1–5), undusted flies",
    UNDUSTED.summary.grooming,
    "grooming",
    "held-out",
  ),
  fractionObs(
    "grooming.undusted.walking",
    "undusted",
    "share of frames walking (label 6), undusted flies",
    UNDUSTED.summary.timeFraction["6"]!,
    'timeFraction["6"]',
    "held-out",
  ),
  fractionObs(
    "grooming.undusted.standing",
    "undusted",
    "share of frames standing (label 7), undusted flies",
    UNDUSTED.summary.timeFraction["7"]!,
    'timeFraction["7"]',
    "held-out",
  ),
  {
    id: "grooming.undusted.episodes-per-minute",
    behaviour: "grooming",
    paradigm: "zhang2020",
    measure: "grooming episodes per minute, undusted flies",
    value: UNDUSTED.summary.episodes.perMinute.mean,
    unit: "per min",
    spread: sdOf(UNDUSTED.summary.episodes.perMinute),
    n: UNDUSTED.summary.episodes.perMinute.n,
    role: "held-out",
    source: DATA("conditions.undusted.summary.episodes.perMinute"),
  },
  medianObs(
    "grooming.undusted.episode-duration",
    "undusted",
    "median duration of a grooming episode, undusted flies",
    UNDUSTED.summary.episodes.durationS,
    "episodes.durationS",
  ),
  {
    id: "grooming.order",
    behaviour: "grooming",
    paradigm: "zhang2020",
    measure:
      "dusted flies clean the head first, then the abdomen, then the wings (order of the mean time of each one's first bout)",
    value: null,
    unit: "",
    spread: null,
    n: null,
    sign: 1,
    role: "design",
    note: "The circuit's initial dust is the model's authors' bristle counts (head > abdomen > wings), which their model uses to produce this order.",
    source: {
      citation: C.seeds2014,
      where: "Results",
      quote:
        "The priority order for cleaning the different body parts is: eyes > antennae > abdomen > wings > thorax.",
    },
  },
];

// --- Escape --------------------------------------------------------------------

const VR14_PROBABILITY =
  "probability of escape = 0.29, 0.56, 0.74, 0.84 and 0.85 for r/v = 8, 14, 40, 70 and 140 ms, respectively";
/** The legend reads "short-mode (cyan, n = 40, 28, 43 for r/v = 8, 14 and 40 ms) or long-mode takeoffs (blue, n = 68, 87 and 159)"; its text layer interleaves the figure's axis labels, so it is quoted in fragments. */
const VR14_COUNTS = [
  "for control flies using short-mode",
  "(cyan, n = 40, 28, 43 for r/v = 8, 14 and",
  "40 ms) or long-mode takeoffs (blue, n = 68,",
  "87 and 159)",
];
/** The r/v values of the looming-disk paradigm (ms). */
export const VR14_RV = [8, 14, 40, 70, 140] as const;
const VR14_ESCAPE_P = [0.29, 0.56, 0.74, 0.84, 0.85];
const VR14_SHORT: Record<8 | 14 | 40, [number, number]> = {
  8: [40, 108],
  14: [28, 115],
  40: [43, 202],
};

const ESCAPE: Observation[] = [
  ...VR14_RV.map((rv, i): Observation => ({
    id: `escape.probability.${rv}`,
    behaviour: "escape",
    paradigm: "vonReyn2014",
    measure: `share of flies taking off, r/v ${rv} ms`,
    value: VR14_ESCAPE_P[i]!,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    note: "The paper's own model imposed these probabilities rather than producing them ('To account for a decreased likelihood to elicit an escape at smaller r/v, we added in a response likelihood across r/v'). The flies tested per r/v are not stated.",
    source: {
      citation: C.vonReyn2014,
      where: "Online Methods, Modeling",
      quote: VR14_PROBABILITY,
    },
  })),
  ...([8, 14, 40] as const).map((rv): Observation => {
    const [k, n] = VR14_SHORT[rv];
    return {
      id: `escape.short-mode.${rv}`,
      behaviour: "escape",
      paradigm: "vonReyn2014",
      measure: `share of takeoffs in short mode, r/v ${rv} ms`,
      value: k / n,
      unit: "fraction",
      spread: { kind: "proportion", k, n },
      n,
      role: "fit",
      derived: `${k} short-mode and ${n - k} long-mode takeoffs: the legend's counts`,
      note: "The giant fiber's threshold median and spread are fitted to these three counts.",
      source: { citation: C.vonReyn2014, where: "Fig. 5a legend", quote: VR14_COUNTS },
    };
  }),
  {
    id: "escape.short-mode.trend",
    behaviour: "escape",
    paradigm: "vonReyn2014",
    measure: "the short-mode share falls as r/v rises (8 to 140 ms)",
    value: null,
    unit: "",
    spread: null,
    n: null,
    sign: -1,
    role: "held-out",
    note: "Only the shares at 8, 14 and 40 ms are fitted; 70 and 140 ms are not. The sign is of the least-squares slope of the share on ln(r/v).",
    source: {
      citation: C.vonReyn2014,
      where: "Fig. 1f legend",
      quote:
        "The fraction of flies choosing a short-mode takeoff was negatively correlated with log(r/v) (slope = −19.27 ms−1, R2 = 0.903; n = 108, 115, 202, 133 and 102 for r/v = 8, 14, 40, 70 and 140 ms, respectively)",
    },
  },
  {
    id: "escape.before-contact.short",
    behaviour: "escape",
    paradigm: "vonReyn2014",
    measure: "share of short-mode takeoffs before the projected contact, r/v 8 ms",
    value: 0.3,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    source: {
      citation: C.vonReyn2014,
      where: "Results",
      quote:
        "flies using a short escape were significantly more likely to survive (30% takeoff before TOC at r/v = 8 ms) than those employing a long escape or those with silenced GFs (6% and 0% takeoff before TOC at r/v = 8 ms, respectively",
    },
  },
  {
    id: "escape.before-contact.long",
    behaviour: "escape",
    paradigm: "vonReyn2014",
    measure: "share of long-mode takeoffs before the projected contact, r/v 8 ms",
    value: 0.06,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    source: {
      citation: C.vonReyn2014,
      where: "Results",
      quote:
        "flies using a short escape were significantly more likely to survive (30% takeoff before TOC at r/v = 8 ms) than those employing a long escape or those with silenced GFs (6% and 0% takeoff before TOC at r/v = 8 ms, respectively",
    },
  },
  ...(
    [
      ["short", 30.1],
      ["long", 45.7],
    ] as const
  ).map(([mode, ms]): Observation => ({
    id: `escape.delay.${mode}`,
    behaviour: "escape",
    paradigm: "vonReyn2014",
    measure: `neural delay to takeoff of ${mode}-mode escapes: the intercept δ of the median takeoff time against r/v (8, 14, 40 ms), Tttc = −α·(r/v) + δ`,
    value: ms,
    unit: "ms",
    spread: null,
    n: null,
    role: "held-out",
    note: "The GF-independent pathway's 28.6 ms delay to wing elevation (of GF-silenced flies) is a published parameter of the circuit model; the takeoff delays are not.",
    source: {
      citation: C.vonReyn2014,
      where: "Results; the fit is Online Methods eq. 3",
      quote: [
        "Short escapes, however, had a smaller neural delay to takeoff (30.1 ms) than long (45.7 ms) or GF-silenced (44.5 ms) escapes",
        "Tttc or Wttc = − α (r / v ) + δ",
      ],
    },
  })),
  ...(
    [
      [10, 0.002],
      [40, 0.075],
    ] as const
  ).map(([lv, before]): Observation => ({
    id: `escape.takeoff-time.${lv}`,
    behaviour: "escape",
    paradigm: "fotowat2009",
    measure: `median time of takeoff before the projected collision, l/v ${lv} ms`,
    value: before,
    unit: "s before collision",
    spread: null,
    n: null,
    role: "held-out",
    derived: `the paper's TO time of −${Math.round(before * 1000)} ms, relative to collision`,
    note: "The circuit's 49° wing-raise angle is this paper's; its 28.6 ms delay is von Reyn et al.'s, where this paper's fit has an intercept of 0 ms. The two papers' timings are compared here.",
    source: {
      citation: C.fotowat2009,
      where: "Results",
      quote: "TO times: −2 and −75 ms",
    },
  })),
  {
    id: "escape.direction.side",
    behaviour: "escape",
    paradigm: "card2008",
    measure:
      "angle between the jump and the direction the threat came from, threat from the side (180° = straight away)",
    value: 135,
    unit: "deg",
    spread: null,
    n: null,
    role: "held-out",
    derived:
      "halfway between straight away (180° from the threat) and straight forward (90° from a threat at the side)",
    source: {
      citation: C.card2008,
      where: "Results",
      quote:
        "In response to stimuli approaching from the side, however, flies jumped at an angle that was approximately halfway between directly away (α = θ + 180°) and directly forward (α = 0°)",
    },
  },
  {
    id: "escape.direction.front-back",
    behaviour: "escape",
    paradigm: "card2008",
    measure:
      "threats from the front send the fly backward and threats from behind send it forward",
    value: null,
    unit: "",
    spread: null,
    n: null,
    sign: 1,
    role: "design",
    note: "Both controllers jump away from the threat by construction (the 200 ms preparation that sets the direction is this paper's).",
    source: {
      citation: C.card2008,
      where: "Results",
      quote:
        "flies jumped backward in response to looming objects in front of them and jumped forward in response to looming objects behind them",
    },
  },
  {
    id: "escape.walking.jump",
    behaviour: "escape",
    paradigm: "zacarias2018",
    measure: "share of looms followed by a jump, walking flies",
    value: 384 / 6000,
    unit: "fraction",
    spread: { kind: "proportion", k: 384, n: 6000 },
    n: 6000,
    role: "held-out",
    source: {
      citation: C.zacarias2018,
      where: "Results",
      quote:
        "We found that looming stimuli only occasionally triggered escape jumps (6.4% of looming stimuli, 384/6000).",
    },
  },
  {
    id: "escape.walking.freeze",
    behaviour: "escape",
    paradigm: "zacarias2018",
    measure: "share of flies freezing by the end of the looms",
    value: 210 / 300,
    unit: "fraction",
    spread: { kind: "proportion", k: 210, n: 300 },
    n: 300,
    role: "held-out",
    note: "Neither controller has freezing: the fly stops only to rest or groom.",
    source: {
      citation: C.zacarias2018,
      where: "Results",
      quote:
        "By the end of the stimulation period, 70% (210/300) of flies were freezing compared to 12% (36/300) for the control stimulus",
    },
  },
  {
    id: "escape.walking.habituation",
    behaviour: "escape",
    paradigm: "zacarias2018",
    measure: "the share of flies jumping falls over the 20 looms",
    value: null,
    unit: "",
    spread: null,
    n: null,
    sign: -1,
    role: "held-out",
    note: "The sign is of the least-squares slope of the share jumping on the loom's number.",
    source: {
      citation: C.zacarias2018,
      where: "Results",
      quote:
        "the probability of jumping to repeated looming decreased over the course of the 20 stimulus presentations",
    },
  },
];

// --- Flight ------------------------------------------------------------------

const FLIGHT: Observation[] = [
  {
    id: "flight.saccade-rate.censi",
    behaviour: "flight",
    paradigm: "censi2013",
    measure: "saccades per second of flight faster than 5 cm/s",
    value: 1.37,
    unit: "per s",
    spread: null,
    n: 88,
    role: "held-out",
    note: "n counts flies. The fly's spontaneous saccade rate is a model value, not fitted.",
    source: {
      citation: C.censi2013,
      where: "Results, Event statistics",
      quote: [
        "We tracked 88 flies",
        "considered only the 4814 seconds of data in which the flight speed exceeded 5 centimeters per second",
        "We detected a total of 6613 saccades with this criterion, giving an average saccade rate of 1.37 saccades per second.",
      ],
    },
  },
  {
    id: "flight.saccade-rate.tammero",
    behaviour: "flight",
    paradigm: "tammero2002a",
    measure: "saccades per second of flight, textured cylinder",
    value: 1579 / 1020,
    unit: "per s",
    spread: null,
    n: 36,
    role: "held-out",
    derived: "1579 saccades in 1020 s of trajectories",
    note: "n counts trajectories.",
    source: {
      citation: C.tammero2002a,
      where: "Fig. 7 legend",
      quote:
        "textured background data represent 36 trajectories totaling 1020 s containing 1579 saccades",
    },
  },
  {
    id: "flight.speed",
    behaviour: "flight",
    paradigm: "tammero2002a",
    measure: "mean horizontal flight speed",
    value: 0.3,
    unit: "m/s",
    spread: null,
    n: null,
    role: "design",
    note: "The fly cruises at FlyBody's flight policy's 30 cm/s, the same speed.",
    source: {
      citation: C.tammero2002a,
      where: "Discussion",
      quote: "The mean horizontal flight speed measured in this study (30 cm s–1)",
    },
  },
  {
    id: "flight.saccade-amplitude",
    behaviour: "flight",
    paradigm: "vanBreugel2012",
    measure: "mean saccade amplitude",
    value: 40,
    unit: "deg",
    spread: { kind: "range", lo: 20, hi: 270 },
    n: null,
    role: "held-out",
    note: "The fly's saccade amplitude (90°) is Tammero & Dickinson's; this paper's distribution is log-normal ('a mean of 40 deg and scaling factor of 2.3 deg').",
    source: {
      citation: C.vanBreugel2012,
      where: "Results",
      quote:
        "ranged in amplitude from 20 to 270 deg (Fig. 3E), and are well described by a log-normal distribution with a mean of 40 deg and scaling factor of 2.3 deg",
    },
  },
  {
    id: "flight.saccade-share",
    behaviour: "flight",
    paradigm: "vanBreugel2012",
    measure: "share of flight time in saccades",
    value: 0.2,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    source: {
      citation: C.vanBreugel2012,
      where: "Results",
      quote:
        "Although these turns only comprise approximately 20% of the flight time (Fig. 3G)",
    },
  },
];

// --- Landing -----------------------------------------------------------------

const LANDING: Observation[] = [
  {
    id: "landing.approach-speed",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "flight speed 10 cm from the post, landings",
    value: 0.37,
    unit: "m/s",
    spread: { kind: "sd", value: 0.13 },
    n: 177,
    role: "held-out",
    source: {
      citation: C.vanBreugel2012,
      where: "Table 2 (speed μ±σ, landings, all posts); speed defined in Results",
      quote: [
        "Flight speeds (measured at a distance of 10 cm from the post)",
        "1047 439 608 177 139 38",
        "0.32±0.12 0.31±0.13 0.34±0.12 0.37±0.13",
      ],
    },
  },
  {
    id: "landing.flyby-speed",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "flight speed 10 cm from the post, fly-bys",
    value: 0.32,
    unit: "m/s",
    spread: { kind: "sd", value: 0.12 },
    n: 1047,
    role: "held-out",
    source: {
      citation: C.vanBreugel2012,
      where: "Table 2 (speed μ±σ, fly-bys, all posts)",
      quote: [
        "Flight speeds (measured at a distance of 10 cm from the post)",
        "1047 439 608 177 139 38",
        "0.32±0.12",
      ],
    },
  },
  {
    id: "landing.share",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "share of trajectories coming within 3 cm of the post that land on it",
    value: 0.14,
    unit: "fraction",
    spread: null,
    n: 1224,
    role: "held-out",
    note: "The landing count behind the 14% is not stated with it, so no interval is formed.",
    source: {
      citation: C.vanBreugel2012,
      where: "Results, Landing behavior",
      quote:
        "Of all the trajectories in which a fly came to within 3 cm of the post, 14% landed on the post (n=1224).",
    },
  },
  {
    id: "landing.leg-extension",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "retinal size of the post when the legs extend",
    value: 61,
    unit: "deg",
    spread: { kind: "sd", value: 22 },
    n: 36,
    role: "design",
    note: "The fly extends its legs at 60°, this paper's figure.",
    source: {
      citation: C.vanBreugel2012,
      where: "Results",
      quote:
        "leg extension appears to be independent of flight speed, and unimodally distributed about retinal size (61±22 deg, n=36)",
    },
  },
  {
    id: "landing.touchdown-speed",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "speed at touchdown on the post",
    value: 0.071,
    unit: "m/s",
    spread: { kind: "sd", value: 0.032 },
    n: 30,
    role: "held-out",
    derived: "7.1 ± 3.2 cm/s in m/s",
    source: {
      citation: C.vanBreugel2012,
      where: "Results",
      quote:
        "After touchdown, the flies decelerated from an average of 7.1 cm s–1 (±3.2 cm s–1, n=30)",
    },
  },
  {
    id: "landing.avoidance-size",
    behaviour: "landing",
    paradigm: "vanBreugel2012",
    measure: "retinal size of the post at a fly-by's saccade away from it",
    value: 33,
    unit: "deg",
    spread: { kind: "sd", value: 17 },
    n: null,
    role: "held-out",
    note: "The fly avoids surfaces by time to contact, a model value; the n of these saccades is not stated with the mean.",
    source: {
      citation: C.vanBreugel2012,
      where: "Results",
      quote:
        "the non-landing flies tended to make aversive saccades when they were close to the post (Fig. 6B), at a mean retinal size of 33±17 deg (Fig. 6D)",
    },
  },
];

// --- Walking -----------------------------------------------------------------

const LIU_MINUTES = [
  [1, 0.82, "82.0 ± 0.3%", 0.92, "0.92 ± 0.09 cm/sec", "During the first minute"],
  [2, 0.652, "65.2 ± 5.4%", 0.81, "0.81 ± 0.20 cm/sec", "By the second minute"],
  [3, 0.507, "50.7 ± 5.4%", 0.88, "0.88 ± 0.34 cm/sec", "During the third minute"],
] as const;

const WALKING: Observation[] = [
  {
    id: "walking.wall.liu",
    behaviour: "walking",
    paradigm: "liu2007",
    measure: "share of time in the outermost third of the arena",
    value: 0.9,
    unit: "fraction",
    spread: null,
    n: 24,
    role: "held-out",
    note: "n counts flies (Canton-S males).",
    source: {
      citation: C.liu2007,
      where: "Results",
      quote: [
        "A fly moving about at random may be expected to spend ∼33% of the time within this outer region. Wild-type Canton-S flies spend ∼90% of the time within the outermost zone of the arena and average ∼4 cm from the center.",
      ],
    },
  },
  {
    id: "walking.centre-distance.liu",
    behaviour: "walking",
    paradigm: "liu2007",
    measure: "mean distance from the arena's centre",
    value: 0.04,
    unit: "m",
    spread: null,
    n: 24,
    role: "held-out",
    derived: "∼4 cm in m",
    source: {
      citation: C.liu2007,
      where: "Results",
      quote:
        "Wild-type Canton-S flies spend ∼90% of the time within the outermost zone of the arena and average ∼4 cm from the center.",
    },
  },
  ...LIU_MINUTES.flatMap(
    ([minute, moving, movingQ, speed, speedQ, lead]): Observation[] => [
      {
        id: `walking.moving.minute${minute}`,
        behaviour: "walking",
        paradigm: "liu2007",
        measure: `share of minute ${minute} spent moving`,
        value: moving,
        unit: "fraction",
        spread: null,
        n: 24,
        role: "held-out",
        note: "The paper does not say whether ± is an SD or an SEM, so no interval is formed.",
        source: {
          citation: C.liu2007,
          where: "Results",
          quote: [lead, `Canton-S, ${movingQ}`],
        },
      },
      {
        id: `walking.speed.minute${minute}`,
        behaviour: "walking",
        paradigm: "liu2007",
        measure: `speed while moving in minute ${minute}`,
        value: speed / 100,
        unit: "m/s",
        spread: null,
        n: 24,
        role: "held-out",
        derived: "cm/s in m/s",
        note: "Path length over time active; the paper does not say whether ± is an SD or an SEM.",
        source: {
          citation: C.liu2007,
          where: "Results",
          quote: [lead, `Canton-S, ${speedQ}`],
        },
      },
    ],
  ),
  {
    id: "walking.wall.soibam",
    behaviour: "walking",
    paradigm: "soibam2012",
    measure: "share of time within 6 mm of the wall",
    value: 0.9,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    note: "The paper says 'over 90%': a lower bound.",
    source: {
      citation: C.soibam2012,
      where: "Results",
      quote:
        "flies spent over 90% of the duration of the trajectory within 6 mm from the edge",
    },
  },
  ...(
    [
      [30, 0.6],
      [60, 0.72],
      [90, 0.8],
    ] as const
  ).map(([deg, share]): Observation => ({
    id: `walking.turns.${deg}`,
    behaviour: "walking",
    paradigm: "soibam2012",
    measure: `share of turn angles (between displacements 1/6 s apart, central zone) smaller than ${deg}°`,
    value: share,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    source: {
      citation: C.soibam2012,
      where: "Results",
      quote:
        "Our analysis also shows that 60%, 72% and 80% of a fly's movement were restricted to turn angles smaller than [30°], [60°], and [90°], respectively.",
    },
  })),
  ...(
    [
      ["slow", "≤19.9 mm/s", 0.3137],
      ["medium", "20–33.9 mm/s", 0.5163],
      ["fast", "≥34 mm/s", 0.6498],
    ] as const
  ).map(([cls, range, share]): Observation => ({
    id: `walking.tripod.${cls}`,
    behaviour: "walking",
    paradigm: "mendes2013",
    measure: `share of frames in tripod coordination, ${cls} walking (${range})`,
    value: share,
    unit: "fraction",
    spread: null,
    n: null,
    role: "held-out",
    derived: "percent of frames as a fraction",
    note: "The gait's tripod coordination rising with speed is built in from this paper's finding; its amount is not fitted.",
    source: {
      citation: C.mendes2013,
      where: "Table 1",
      quote: [
        "Slow [≤19.9 mm/s] | Medium [20–33.9 mm/s] | Fast [≥34 mm/s]",
        "Tripod | 31.37 | Tripod | 51.63 | Tripod | 64.98",
      ],
    },
  })),
  ...([10, 20, 30] as const).map((mm): Observation => ({
    id: `walking.stance.${mm}`,
    behaviour: "walking",
    paradigm: "deAngelis2019",
    measure: `stance duration at ${mm} mm/s, from the paper's fitted law τ = a·(v/1 mm/s)^b`,
    value: 0.9328 * mm ** -1.025,
    unit: "s",
    spread: null,
    n: null,
    role: "held-out",
    derived: `a = 932.8 ms and b = −1.025 evaluated at ${mm} mm/s`,
    source: {
      citation: C.deAngelis2019,
      where: "Materials and methods, eq. 1",
      quote:
        "giving a=932.8 ms and b= –1.025 with a coefficient of determination of R2=0.59",
    },
  })),
];

export const OBSERVATIONS: readonly Observation[] = Object.freeze([
  ...ESCAPE,
  ...GROOMING,
  ...FLIGHT,
  ...LANDING,
  ...WALKING,
]);

export function observation(id: string): Observation {
  const o = OBSERVATIONS.find((x) => x.id === id);
  if (!o) throw new Error(`no observation ${id}`);
  return o;
}
