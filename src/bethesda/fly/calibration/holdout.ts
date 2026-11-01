/**
 * The 2026-11 held-out set: observations from papers the calibration had not
 * used, registered on 2026-11-01 and sealed in
 * `docs/benchmarks/fly-calibration/holdout-2026-11.json` before
 * circuit-informed/v2 was committed or run on any of their paradigms.
 *
 * Each is held out for every controller (`roles.ts`): nothing in any
 * controller was set from it. Every quote was copied from the paper's open
 * full text by a script and checked verbatim against it; no value is read off
 * a figure. The paradigms (`HOLDOUT_PARADIGMS`) say how each experiment is
 * rebuilt and how it differs, written before any controller ran them.
 *
 * Candidates left out, and why, are listed in the seal.
 */
import type { Citation } from "../params.js";
import type { Observation, Paradigm } from "./observations.js";

export const HOLDOUT_CITATIONS = {
  ferreira2020: {
    short: "Ferreira & Moita 2020, Nat Commun 11",
    doi: "10.1038/s41467-020-17856-4",
  },
  barrios2021: {
    short: "Barrios, Farias & Moita 2021, Curr Biol 31",
    doi: "10.1016/j.cub.2021.10.013",
  },
  jung2015: {
    short: "Jung, Hueston & Bhandawat 2015, eLife 4",
    doi: "10.7554/eLife.11092",
  },
  cruz2021: {
    short: "Cruz, Pérez & Chiappe 2021, Curr Biol 31",
    doi: "10.1016/j.cub.2021.08.041",
  },
  iyengar2012: {
    short: "Iyengar et al. 2012, J Neurogenet 26",
    doi: "10.3109/01677063.2012.729626",
  },
  stupski2024: {
    short: "Stupski & van Breugel 2024, Curr Biol 34",
    doi: "10.1016/j.cub.2024.07.009",
  },
  straw2011: {
    short: "Straw et al. 2011, J R Soc Interface 8",
    doi: "10.1098/rsif.2010.0230",
  },
  maya2026: { short: "Maya et al. 2026, J Exp Biol 229", doi: "10.1242/jeb.251675" },
  mongeau2017: {
    short: "Mongeau & Frye 2017, Curr Biol 27",
    doi: "10.1016/j.cub.2017.08.035",
  },
} as const satisfies Record<string, Citation>;
const H = HOLDOUT_CITATIONS;

export const HOLDOUT_PARADIGMS = {
  ferreira2020: {
    label: "Looms over a fly alone in a slanted arena",
    source: H.ferreira2020,
    experiment:
      "Mated Canton-S females, 4–6 days old, alone in an arena 68 mm across (flat centre 32 mm, 11° slanted wall) and 5 mm thick, filmed from above at 60 Hz: a 5 min baseline, then twenty 500 ms looms every 10–20 s from a 144 Hz monitor tilted 45° over the stage (a black circle, l/v 40 ms). Freezing is a 500 ms period with a median pixel change below 30 pixels in the fly's region.",
    rebuilt:
      "The fly at rest at a random point of a clear round arena 68 mm across and 5 mm high with a lid, spontaneous takeoff off and its other behaviour its own, 5 min of baseline, then 20 looms, each aimed at the fly from a direction drawn within ±90° of its heading, 45° up, growing from 9.2° to 78° over 450 ms (l/v 40 ms) and held 50 ms, as in the rebuilt Zacarias et al. paradigm, each followed by a gap drawn uniformly from 10–20 s; the stimulation period is the 20 looms and their gaps. A 500 ms bin is freezing when the fly is at rest (neither walking, grooming nor in the air) at every 60 Hz sample in it; the paper's pixel-change classifier counts any such stillness, so the reduced-order and v1 controllers' rest counts too. Per fly: the share of the period's bins freezing, and, of the looms after which the fly is freezing in the first bin after the loom ends, the share after which it is not freezing in some later bin before the next loom (an exit). Medians across flies.",
    approximations: [
      "The slanted wall is not modelled: the floor is flat to the 68 mm wall.",
      "The monitor tilted over the stage is not modelled; each loom comes from the fly's frontal half, 45° up, through a clear wall and lid, for the reasons given for Zacarias et al.'s paradigm.",
      "The number of single flies is not in the text; 60 are run, as for Zacarias et al.",
      "The paper reports the values with interquartile ranges but does not say they are medians; they are compared as medians across flies.",
      "An exit is read from the paper's 'the probability of stopping freezing, i.e., resuming movement, before the following stimulus presentation'; flies never freezing after a loom have no exit probability and are left out of that median.",
    ],
  },
  barrios2021: {
    label: "Sixty looms over a fly in a small arena",
    source: H.barrios2021,
    experiment:
      "Mated Canton-S males, 10–11 days old, alone in arenas 16 mm across with 4 mm to move above 1% agar; 60 looms over 15 min from a 240 Hz monitor tilted 45° over the stage, each 500 ms: expanding for 450 ms at l/v 40 ms to 78°, held 50 ms.",
    rebuilt:
      "The fly at rest at a random point of a clear round arena 16 mm across and 4 mm high with a lid, spontaneous takeoff off, 5 min to explore, then 60 looms 15 s apart, each aimed at the fly from a direction drawn within ±90° of its heading, 45° up, growing from 9.2° to 78° over 450 ms (l/v 40 ms) and held 50 ms, as in the rebuilt Zacarias et al. paradigm; the stimulation period is the 15 min from the first loom's onset. A 500 ms bin is freezing when the fly is at rest (neither walking, grooming nor in the air) at every 60 Hz sample in it; the paper's pixel-change classifier counts any such stillness, so the reduced-order and v1 controllers' rest counts too. Per fly the share of the period's bins freezing; the mean across flies.",
    approximations: [
      "Whether the flies had time to explore before the looms is not in the quoted text; 5 min is used, as in Zacarias et al. and Ferreira & Moita from the same laboratory.",
      "The spacing of the 60 looms within the 15 min is not stated; they are spaced evenly.",
      "The monitor tilted over the stage is not modelled; each loom comes from the fly's frontal half, 45° up, through a clear wall and lid, for the reasons given for Zacarias et al.'s paradigm.",
      "The freezing classifier is not quoted for this paper; Ferreira & Moita's 500 ms bins (same laboratory) are used.",
      "The number of flies behind the value is not stated next to it; 60 are run.",
    ],
  },
  jung2015: {
    label: "Runs and stops of a starved fly",
    source: H.jung2015,
    experiment:
      "Single starved (18–24 h) females in a ring 6.4 cm across and 3 mm high over a mesh floor with radial airflow (1.2 L/min in, 6 L/min out), 30 min to acclimatize, then 3 min without odour (the 'before' period), filmed at 30 frames/s. Below 0.5 mm/s a fly is at a stop, above 1 mm/s on a run, and in between it continues the previous one.",
    rebuilt:
      "The fly at rest at a random point of a round arena 6.4 cm across and 3 mm high with a lid, placed with a tenth of a full reserve (hungry), spontaneous takeoff off; 30 min unrecorded, then 3 min at 30 frames/s. Speed is the frame-to-frame displacement of the body's centre; runs and stops by the paper's thresholds and rule. Medians over all flies' stops and runs, and over runs of each run's mean speed.",
    approximations: [
      "The airflow and mesh floor are not modelled.",
      "Starvation: 18–24 h at the model's resting rate would empty the reserve (the model stores no fat), and an empty reserve stops voluntary movement, so the fly is placed with a tenth of a full reserve instead.",
      "Stops and runs cut by the start or end of the 3 min are kept as the period gives them; the paper does not say whether it dropped them.",
      "That the run speed is a median over runs of each run's speed is read from 'speed during runs (Figure 2F, median speed ...)'.",
      "60 flies are run, as in the paper.",
    ],
  },
  cruz2021: {
    label: "Walking in an arena with heated walls",
    source: H.cruz2021,
    experiment:
      "Wing-clipped Top Banana males, 2–4 days old, alone in a circular arena 90 mm across under a ceiling, with walls heated to 42 °C so that they do not follow the perimeter, tracked at 60 Hz. Activity is translational speed above 0.5 mm/s or angular speed above 20°/s for at least 166 ms; walking bouts are activity lasting at least 333 ms.",
    rebuilt:
      "The fly at rest at a random point of a round arena 90 mm across and 3 mm high with a lid, spontaneous takeoff off (clipped wings), 9.7 min at 60 Hz. Translational speed from frame-to-frame displacement, angular speed from the body's yaw; activity and walking bouts by the paper's thresholds. Per fly the share of time in walking bouts; the mean across flies.",
    approximations: [
      "The heated walls are not modelled, so the fly can follow the wall, which the heat prevents in the experiment.",
      "The ceiling's height is not in the quoted text; 3 mm is used.",
      "The session length is not stated per fly; 9.7 min is the quoted 441 min of walking over 54% of the time and 84 flies.",
      "Whether light and dark trials are pooled is not stated; the arena is lit.",
      "84 flies are run, as in the paper.",
    ],
  },
  iyengar2012: {
    label: "Fifteen minutes in a small dish",
    source: H.iyengar2012,
    experiment:
      "Four Canton-S males, 3–6 days old, together in a 35 mm petri dish over food with about 2 mm of headspace, filmed at 30 frames/s for 15 min starting within 10 s of introduction. A fly is moving when its speed exceeds 3 mm/s.",
    rebuilt:
      "One fly at rest at a random point of a round arena 35 mm across and 2 mm high with a lid, spontaneous takeoff off, recorded at 30 frames/s for 15 min from placement. Speed from frame-to-frame displacement; the share of frames above 3 mm/s, the median speed over moving frames pooled across flies, and the summed displacement, each averaged (the median pooled) across flies.",
    approximations: [
      "Each fly is alone; the paper's four males share a dish and may interact.",
      "The food under the flies is not modelled.",
      "That the median speed is over moving frames only is inferred from the figure legend quoted with it.",
      "40 flies are run, as in the paper.",
    ],
  },
  stupski2024: {
    label: "Free flight in a still-air wind tunnel",
    source: H.stupski2024,
    experiment:
      "Starved (6–8 h) Heisenberg-Canton-S females, 2–5 days old, in groups of 15, flying freely in a wind tunnel with a 1.0 × 0.5 × 0.5 m working section in still air, tracked at 100 Hz; a trajectory entering a trigger zone gets a stimulus or, in sham trials, none, and saccades from 0.9–3 s after the trigger are counted by a geometric detector, as a frequency per trajectory.",
    rebuilt:
      "One fly released in cruise at the centre of a closed box 1.0 × 0.5 × 0.5 m, with a reserve 7 h at the model's resting rate leaves (0.55 of full), recorded at 100 Hz; the sham trigger is the release. Saccades are counted from 0.9–3 s after it by the calibration's detector (runs of samples whose heading of travel turns faster than 300°/s, flight faster than 5 cm/s), in flights that stay airborne through the window; per flight the count over 2.1 s. Mean and SD across flights.",
    approximations: [
      "The trigger zone is not modelled; the release stands for the sham trigger.",
      "The paper's geometric saccade detector is replaced by the calibration's angular-velocity detector.",
      "Each fly flies alone; the paper's flies are in groups of 15.",
      "Starvation is the reserve the model's resting rate leaves after 7 h.",
      "The number of trajectories is not stated (648 saccades); 150 flights are run.",
    ],
  },
  straw2011: {
    label: "Free flight in a long arena",
    source: H.straw2011,
    experiment:
      "Twenty females released together into a 0.3 × 0.3 × 1.5 m arena whose long walls and floor carry a 5 cm checkerboard, tracked at 100 frames/s for 12 h; horizontal speed per frame, pooled over the frames of flight 5 cm or more from every surface, at high contrast.",
    rebuilt:
      "One fly released in cruise at the centre of a closed box 0.3 × 0.3 × 1.5 m (long axis horizontal), recorded at 100 Hz for one flight (to its first landing, at most 60 s). Horizontal speed from frame-to-frame displacement on frames 5 cm or more from every surface; the mean over frames pooled across flights.",
    approximations: [
      "The checkerboard is not modelled; the fly's speed does not depend on the contrast of what it sees.",
      "Each fly flies alone, and each flight is a fresh fly; the paper pools twenty flies over 12 h without identities.",
      "The SD is over frames, which are not independent, so no interval of the mean is formed from it; the comparison is against the spread.",
      "150 flights are run.",
    ],
  },
  maya2026: {
    label: "Passes through a chamber's centre",
    source: H.maya2026,
    experiment:
      "10–30 Canton-S females, 3–7 days old, free to fly in a chamber with food; four cameras at 16,000 frames/s film a cube 3.5 cm on a side at the chamber's centre, 10 cm from its floor and side walls; a flight event is a pass through that volume (typically 180–250 ms) and its speed the event's mean.",
    rebuilt:
      "One fly released in cruise at a random point of a closed box 23.5 cm on each side, recorded at 1000 Hz for one flight (to its first landing, at most 60 s). Each pass through the central 3.5 cm cube is an event; its speed the mean over its frames. Mean and SD across events.",
    approximations: [
      "The chamber's size is inferred from the cube's place, 10 cm from the floor and side walls: 23.5 cm on each side.",
      "The food is not modelled, and each fly flies alone.",
      "Frames are taken at 1000 Hz rather than 16,000 Hz; the event's mean speed is the same to well within the spread.",
      "Events from one flight are pooled as the paper pools events of unidentified flies; 3000 flights are run, since few flights cross the central cube.",
    ],
  },
  mongeau2017: {
    label: "Spontaneous saccades on a magnetic tether",
    source: H.mongeau2017,
    experiment:
      "Females 3–5 days old flying on a pin in a magnetic field, free to turn in yaw only, in a stationary random-patterned surround; yaw filmed at 160 frames/s. A saccade is detected where angular velocity exceeds four times the noise floor; its period is where angular velocity exceeds a quarter of its peak; saccades below 10° or above 180° are rejected.",
    rebuilt:
      "Free flight in the rebuilt Censi et al. arena, recorded at 160 Hz; the body's yaw from each frame. A saccade is a run of samples whose yaw rate exceeds 300°/s in one direction; its period the samples around its peak where the yaw rate exceeds a quarter of the peak; its amplitude the yaw change over the period. Saccades below 10° or above 180° are rejected. Medians over all saccades.",
    approximations: [
      "The fly flies freely, translating as well as turning; the paper's fly can only turn. Only yaw is compared.",
      "The simulated yaw has no measurement noise, and the paper does not give its noise floor's value, so detection uses Tammero & Dickinson's 300°/s.",
      "150 flights are run.",
    ],
  },
} as const satisfies Record<string, Paradigm>;

export const HOLDOUT_OBSERVATIONS: readonly Observation[] = [
  {
    id: "escape.lidded.freeze-time.ferreira",
    behaviour: "escape",
    paradigm: "ferreira2020",
    measure:
      "share of the stimulation period freezing, flies alone (median across flies)",
    value: 0.7667,
    unit: "fraction",
    spread: { kind: "iqr", lo: 0.3975, hi: 0.9042 },
    n: null,
    role: "held-out",
    registered: "holdout-2026-11",
    derived: "76.67%, IQR 39.75–90.42%, as fractions",
    source: {
      citation: H.ferreira2020,
      where: "Results; Methods",
      quote: [
        "flies tested alone spent more time freezing, 76.67%, interquartile range (IQR) 39.75–90.42%, during the stimulation period",
        "After a 5-min baseline flies were exposed to twenty 500 ms looming presentations, every 10–20 s",
        "Experimental animals were mated females, tested only once when 4–6 days old. Wild-type flies used were Canton-S.",
        "We imaged unrestrained flies in 5 mm thick, 11° slanted polyacetal arenas with 68 mm diameter (central flat portion diameter 32 mm).",
        "Visual stimulation (20 500-ms looming stimuli, a black circle in a white background, with a virtual object length of 10 mm and speed 25 cm per s (l/v value of 40 ms) as in ref. 28) was presented on an Asus monitor running at 144 Hz, tilted 45° over the stage",
        "Videos were acquired using Bonsai45 at 60 Hz",
        "Freezing was classified as 500 ms periods with a median pixel change over that time period <30 pixels within the ROI.",
        "The proportion of time spent freezing was quantified as the proportion of 500 ms bins during which the fly was freezing.",
      ],
    },
  },
  {
    id: "escape.lidded.freeze-exit.ferreira",
    behaviour: "escape",
    paradigm: "ferreira2020",
    measure:
      "probability that a freezing fly resumes moving before the next loom, flies alone (median across flies)",
    value: 0.08,
    unit: "fraction",
    spread: { kind: "iqr", lo: 0, hi: 0.21 },
    n: null,
    role: "held-out",
    registered: "holdout-2026-11",
    source: {
      citation: H.ferreira2020,
      where: "Results; Methods",
      quote: [
        "an increase in the probability of stopping freezing, i.e., resuming movement, before the following stimulus presentation (individually tested flies: P(Fexit) = 0.08, IQR 0–0.21",
        "We calculated the proportion of freezing entries upon looming and exits between",
      ],
    },
  },
  {
    id: "escape.lidded.freeze-time.barrios",
    behaviour: "escape",
    paradigm: "barrios2021",
    measure: "share of 15 min of looms spent freezing (mean across flies)",
    value: 0.9653,
    unit: "fraction",
    spread: { kind: "sem", value: 0.0353 },
    n: null,
    role: "held-out",
    registered: "holdout-2026-11",
    derived: "96.53% ± 3.53% (mean ± SEM) as fractions",
    source: {
      citation: H.barrios2021,
      where: "Results; STAR Methods",
      quote: [
        "Loom-exposed animals froze 96.53% ± 3.53% (mean ± SEM) of the time during the stimulation period while control flies showed 36.6% ± 0.78% of freezing",
        "We exposed flies to 60 looms or control stimuli for 15 min.",
        "For starvation resistance and sugar measurements experiments 10 to 11 days-old mated CantonS males",
        "Testing arenas were composed of 50 small circular arenas (16 mm in diameter) that were cut in white acrylic 4 mm thick plates.",
        "the small arenas were filled with agar 1%, leaving 4 mm for the fly to move",
        "tilted at 45° over the stage running at 240 Hz refresh rate",
        "(l / v value of 40 ms)",
        "Each looming presentation lasted for 500 ms. The object expanded for 450 ms until it reached maximum size of 78° where it remained for 50 ms before disappearing.",
      ],
    },
  },
  {
    id: "walking.stop-median.jung",
    behaviour: "walking",
    paradigm: "jung2015",
    measure: "median stop duration, starved flies (pooled stops)",
    value: 0.67,
    unit: "s",
    spread: null,
    n: 725,
    role: "held-out",
    registered: "holdout-2026-11",
    source: {
      citation: H.jung2015,
      where: "Results; Figure 2 legend; Materials and methods",
      quote: [
        "In the absence of odor, median stop duration is 0.67 s interspersed with occasional long ( >10 s) stops.",
        "Black: before period (726 runs and 725 stops from 60 flies)",
        "If the instantaneous walking speed of a fly was lower than 0.5 mm/sec, then the fly was stationary or at a stop and if the speed was faster than 1 mm/sec, then the fly was moving or on a run. If the speed was in between those two thresholds, it was classified as a continuation of the previous run or stop.",
        "A single female fly was cold-anesthetized and placed in the behavioral arena. We usually waited for 30 min to give flies time to acclimatize to new environment.",
        "Flies were starved for 18",
        "A polypropylene ring (4) (6.4 cm in diameter and 3 mm in height) was machined to have 1 mm holes separated by 1.5 mm to allow radial air flow.",
        "Vacuum pulled 6 liters/min while the flow through the air tube was 1.2 liters/min.",
        "al consisted of 3 min of no odor (before), 3 min of odor (during) and 3 min of no odor periods (after).",
        "Behavior videos were acquired at a rate of 30 frames per second",
        "Control flies were either w1118, laboratory cultures of 200 wild caught Drosophila melanogaster used previously by other labs (Ofstad et al., 2011; Bhandawat, 2010) or Or42b+/- heterozygotes.",
      ],
    },
  },
  {
    id: "walking.run-median.jung",
    behaviour: "walking",
    paradigm: "jung2015",
    measure: "median run duration, starved flies (pooled runs)",
    value: 4.81,
    unit: "s",
    spread: null,
    n: 726,
    role: "held-out",
    registered: "holdout-2026-11",
    source: {
      citation: H.jung2015,
      where: "Results; Figure 2 legend",
      quote: [
        "In the absence of odor, median run duration is 4.81 s but runs frequently last >10 s",
        "Black: before period (726 runs and 725 stops from 60 flies)",
      ],
    },
  },
  {
    id: "walking.run-speed.jung",
    behaviour: "walking",
    paradigm: "jung2015",
    measure: "median speed during runs, starved flies",
    value: 0.0057,
    unit: "m/s",
    spread: null,
    n: 726,
    role: "held-out",
    registered: "holdout-2026-11",
    derived: "0.57 cm/s in m/s",
    source: {
      citation: H.jung2015,
      where: "Results; Figure 2 legend",
      quote: [
        "speed during runs (Figure 2F, median speed decreased from 0.57 cm/s to 0.18 cm/s)",
        "Black: before period (726 runs and 725 stops from 60 flies)",
      ],
    },
  },
  {
    id: "walking.walking-share.cruz",
    behaviour: "walking",
    paradigm: "cruz2021",
    measure: "share of time in walking bouts, walls heated (mean across flies)",
    value: 0.54,
    unit: "fraction",
    spread: null,
    n: 84,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The paper does not say whether its ± 17% is an SD or an SEM, so no interval is formed.",
    source: {
      citation: H.cruz2021,
      where: "STAR Methods",
      quote: [
        "84 flies, total number of walking segments = 64467, total time of spent walking = 441 minutes, percentage of time spent walking = 54 ± 17%",
        "Single flies walked freely in a 90mm circular arena with walls heated up to 42°C",
        "A heated wall prevents flies from following the perimeter of the arena",
        "at a frame rate of 60Hz",
        "Activity was defined as translational speed greater than 0.5mm/s, or angular speed greater than 20°/s for at least 166ms.",
        "Walking bouts were a subgroup of activity bouts in which a sequence of movement lasted for at least 333ms.",
        "Thus, in this study, we focused our analysis on male flies.",
        "Experiments were performed with 2-to-4-day old flies with clipped wings from eclosion.",
        "Drosophila: Top Banana wild type",
      ],
    },
  },
  {
    id: "walking.moving.iyengar",
    behaviour: "walking",
    paradigm: "iyengar2012",
    measure: "share of the first 15 min moving faster than 3 mm/s",
    value: 0.38,
    unit: "fraction",
    spread: null,
    n: 40,
    role: "held-out",
    registered: "holdout-2026-11",
    derived: "approximately 38% as a fraction",
    source: {
      citation: H.iyengar2012,
      where: "Results; Materials and methods",
      quote: [
        "We placed four males in a chamber and recorded their movements for 15 minutes.",
        "We measured the fraction of time moving with a criterion for fly movement when its velocity exceeded 3 mm/s, slightly more than their body-length per second. CS flies spent approximately 38% of the time moving",
        "n=40, 32, 24 flies for CS, Hk1 and parats1 respectively",
        "wild-type Canton-S (CS)",
        "Flies used for the locomotion and male-male interaction assays (Figures 2 - 4) were between 3 and 6 days old",
        "placed in a disposable 35 mm petri-dish",
        "leaving approximately 2 mm of headspace",
        "Videos were recorded at 640 x 480 resolution and at 30 frames-per-second.",
        "A 15 minute video recording session was started almost immediately after flies were introduced to the chamber (< 10 s), and the entire video was used for subsequent analysis.",
      ],
    },
  },
  {
    id: "walking.moving-speed.iyengar",
    behaviour: "walking",
    paradigm: "iyengar2012",
    measure: "median speed while moving faster than 3 mm/s",
    value: 0.00686,
    unit: "m/s",
    spread: null,
    n: 40,
    role: "held-out",
    registered: "holdout-2026-11",
    derived: "6.86 mm/s in m/s",
    source: {
      citation: H.iyengar2012,
      where: "Results; Figure 2 legend",
      quote: [
        "with median velocities of 6.86, 7.87, and 5.37 mm/s for CS, Hk1 and parats1 respectively",
        "(D) The cumulative distribution of fly velocities indicate the proportion of time a fly is moving (velocity > 3 mm/s), but is traveling slower than the corresponding velocity.",
        "n=40, 32, 24 flies for CS, Hk1 and parats1 respectively",
      ],
    },
  },
  {
    id: "walking.distance.iyengar",
    behaviour: "walking",
    paradigm: "iyengar2012",
    measure: "distance walked in the first 15 min (mean across flies)",
    value: 4.33,
    unit: "m",
    spread: null,
    n: 40,
    role: "held-out",
    registered: "holdout-2026-11",
    source: {
      citation: H.iyengar2012,
      where: "Results; Figure 2 legend",
      quote: [
        "Hk1 showed significantly increased total locomotion as compared to CS flies (mean travel distances over 15 min of 6.19 m vs 4.33 m",
        "n=40, 32, 24 flies for CS, Hk1 and parats1 respectively",
      ],
    },
  },
  {
    id: "flight.saccade-rate.stupski",
    behaviour: "flight",
    paradigm: "stupski2024",
    measure:
      "saccades per second 0.9–3 s after a sham trigger, still air (mean ± SD across trajectories)",
    value: 1.8,
    unit: "per s",
    spread: { kind: "sd", value: 0.95 },
    n: null,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The number of trajectories is not stated (648 saccades), so no interval of the mean is formed.",
    source: {
      citation: H.stupski2024,
      where: "Results; STAR Methods",
      quote: [
        "Wild-type flies typically had similar saccade frequencies regardless of which trigger event they received, and whether or not they were flying in laminar wind or still air (still air, flash: 1.9 ±1.0 Hz; laminar wind, flash: 1.9 ±1.1 Hz; still air, sham: 1.8 ±.95 Hz; laminar wind, sham: 2.1 ± 1.2 Hz).",
        "Data are reported in terms of means and standard deviations.",
        "still air sham n=648",
        "D. melanogaster- Wild type Dr. Michael Dickinson Heisenberg-CantonS",
        "Experimental flies (2–5 days old) were anesthetized at 4 °C on a cold plate, and 15 females were placed in an empty tube",
        "We then starved flies in their preparation tubes for 6–8 hours",
        "a custom-built wind tunnel with a 1.0×0.5×0.5 m3 working section",
        "at 100 Hz against uniform infrared illumination",
        "characterized properties of saccades identified from 0.9–3 s after the stimulus",
      ],
    },
  },
  {
    id: "flight.speed.straw",
    behaviour: "flight",
    paradigm: "straw2011",
    measure: "horizontal flight speed at high contrast (mean ± SD over frames)",
    value: 0.15,
    unit: "m/s",
    spread: { kind: "sd", value: 0.07 },
    n: null,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The SD is over frames, not flies; the text's 'Michelson contrast ≥ 1.6' is quoted as printed.",
    source: {
      citation: H.straw2011,
      where: "Results; Materials and methods",
      quote: [
        "when contrast was sufficiently high (Michelson contrast ≥ 1.6), flies regulated their speed to a mean speed of 0.15 m s−1 with a standard deviation of 0.07",
        "illuminated the long walls and floor of a 0.3 × 0.3 × 1.5 m arena with a regular checkerboard pattern (5 cm2) of varying contrast and fixed luminance (2 cd m−2)",
        "The test contrasts were cycled, with each contrast displayed for 5 min. Twenty females flies were released into the arena and tracked over 12 h.",
        "Horizontal flight speed was measured as the first derivative of position in the XY direction, and histograms were computed with each frame constituting a single sample.",
        "Because the identity of the flies could not be tracked for the duration of the experiment, the data contain pseudo-replication",
        "the results from three separate experimental days with 20 new flies tested on each day were each qualitatively similar to the pooled results shown, which include 1760 total seconds of flight in which tracked fly was 5 cm or greater from the nearest arena surface",
        "a five camera, six computer 100 fps system for tracking fruit flies in a 0.3 × 0.3 × 1.5 m arena",
      ],
    },
  },
  {
    id: "flight.speed.maya",
    behaviour: "flight",
    paradigm: "maya2026",
    measure:
      "flight speed of passes through the chamber's centre, lit (mean ± SD across events)",
    value: 0.1,
    unit: "m/s",
    spread: { kind: "sd", value: 0.04 },
    n: 322,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "Individuals were not identified, so events may repeat flies.",
    source: {
      citation: H.maya2026,
      where: "Table 1 and its legend; Materials and methods",
      quote: [
        "Nominal free-flight parameters of mosquitoes, fruit flies and honey bees in lit conditions Mosquito Fruit fly Honey bee",
        "Speed (m s−1) 0.19±0.06 0.10±0.04 7.5 (top speed outdoors)",
        "The table summarizes the mean parameters over 322 flight events of fruit flies (Drosophila melanogaster)",
        "Data are means±s.d.",
        "We used female Drosophila melanogaster Meigen 1830 fruit flies (Canton-S line), 3–7 days old",
        "For fruit flies, each experiment included 10–30 animals, free to fly in the experimental chamber.",
        "The joint filming volume of the cameras was equivalent to a cube of side length 3.5 cm, located at the center of the flight chamber, 10 cm from its floor and sidewalls.",
        "The frame rates used were 16,000 frames s−1 for the fruit flies",
        "The typical duration of the fruit flies flight events was 180–250 ms depending on the flight speed.",
      ],
    },
  },
  {
    id: "flight.saccade-amplitude.mongeau",
    behaviour: "flight",
    paradigm: "mongeau2017",
    measure: "spontaneous saccade amplitude, yaw-free tethered flight (median)",
    value: 56,
    unit: "deg",
    spread: null,
    n: 6852,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The paper does not say whether its ± is an SD or an SEM here, so no interval is formed.",
    source: {
      citation: H.mongeau2017,
      where: "Results; STAR Methods",
      quote: [
        "We next presented flies with a stationary, randomly-patterned visual landscape. We detected and analyzed 6,852 spontaneous saccades (n = 27 animals; median number of saccades per trial = 9).",
        "For these saccades, we measured a mean saccade duration of 101 ± 53 ms (median = 83 ms), a mean amplitude of 64 ± 34° (median = 56°), and a mean peak angular velocity of 976 ± 457 deg s−1 (median = 929 deg s−1).",
        "All experiments were performed with 3- to 5-day-old female flies.",
        "A wild-type Drosophila melanogaster Meigen strain was maintained at 25°C",
        "We video-recorded the angular position of the fly within the arena at 160 frames s−1",
        "We defined the threshold as four times the estimated noise floor.",
        "We defined the period of a saccade as the time when fly’s angular velocity was greater than one quarter of the peak amplitude",
        "We rejected saccades below 10° and above 180°",
      ],
    },
  },
  {
    id: "flight.saccade-duration.mongeau",
    behaviour: "flight",
    paradigm: "mongeau2017",
    measure: "spontaneous saccade duration, yaw-free tethered flight (median)",
    value: 83,
    unit: "ms",
    spread: null,
    n: 6852,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The paper does not say whether its ± is an SD or an SEM here, so no interval is formed.",
    source: {
      citation: H.mongeau2017,
      where: "Results",
      quote: [
        "For these saccades, we measured a mean saccade duration of 101 ± 53 ms (median = 83 ms)",
        "We detected and analyzed 6,852 spontaneous saccades (n = 27 animals; median number of saccades per trial = 9).",
      ],
    },
  },
  {
    id: "flight.saccade-peak.mongeau",
    behaviour: "flight",
    paradigm: "mongeau2017",
    measure: "spontaneous saccade peak yaw rate, yaw-free tethered flight (median)",
    value: 929,
    unit: "deg/s",
    spread: null,
    n: 6852,
    role: "held-out",
    registered: "holdout-2026-11",
    note: "The paper does not say whether its ± is an SD or an SEM here, so no interval is formed.",
    source: {
      citation: H.mongeau2017,
      where: "Results",
      quote: [
        "a mean peak angular velocity of 976 ± 457 deg s−1 (median = 929 deg s−1)",
        "We detected and analyzed 6,852 spontaneous saccades (n = 27 animals; median number of saccades per trial = 9).",
      ],
    },
  },
];

/** Candidates gathered for the set and left out, with the reason; recorded in the seal. */
export const HOLDOUT_EXCLUDED: readonly { candidate: string; reason: string }[] = [
  {
    candidate: "ferreira2020 groups of 2 and 5",
    reason: "the simulator runs one fly per arena",
  },
  {
    candidate: "barrios2021-small-arena-control-immobility",
    reason: "the control stimulus is not described in the text",
  },
  {
    candidate: "gibson2015-single-fly-shadow-freeze",
    reason: "an overhead paddle's shadow: the simulator has no such stimulus",
  },
  {
    candidate: "kajtor2025-shadow-stop-probability",
    reason: "a red screen sliding over tunnels: the simulator has no such stimulus",
  },
  { candidate: "valente2007-*", reason: "one fly" },
  {
    candidate: "katsov2017-*",
    reason:
      "the value pools datasets, arenas and grouped flies without saying which give it",
  },
  {
    candidate: "cruz2021-saccade-time-share",
    reason: "an unsupervised segmentation the calibration cannot rebuild",
  },
  {
    candidate: "devries2012-*",
    reason: "the loom's parameters are in a supplement that was not retrieved",
  },
  {
    candidate: "chai2025-flypez-takeoff-*",
    reason:
      "the counts are of takeoffs whose sequence was measured, so the shares are only lower bounds",
  },
  {
    candidate: "mongeau2017-spontaneous-saccade-rate",
    reason:
      "the rate of a fly that can only turn depends on the tether; amplitude, duration and peak rate are kinematics of each saccade",
  },
  {
    candidate: "stupski2024-free-flight-saccade-rate-laminar-wind",
    reason: "the simulator has no wind",
  },
  {
    candidate: "maya2026-darkness-*",
    reason: "the simulator cannot switch the light off",
  },
];
