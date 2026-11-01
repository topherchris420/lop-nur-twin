/**
 * The 2026-11 held-out set's paradigms (`holdout.ts`, `HOLDOUT_PARADIGMS`),
 * rebuilt from the fly's own world primitives as `paradigms.ts` rebuilds the
 * earlier ones, and run through the same body, senses and gate.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { DigitalFly } from "../fly.js";
import { PARAMS } from "../params.js";
import { forward, type V3 } from "../units.js";
import {
  LIDDED,
  placeInDisc,
  record,
  trialSeed,
  ZACARIAS_2018,
  type Frame,
  type SessionSpec,
  type Subject,
} from "./paradigms.js";
import { StimulusWorld, loomTauAt, type Loom } from "./stimuli.js";
import { chamber, roundArena, tunnel } from "./worlds.js";

// --- Looms under a lid (Ferreira & Moita 2020; Barrios et al. 2021) -----------

export interface LoomTrainSpec {
  id: string;
  radiusM: number;
  heightM: number;
  exploreS: number;
  /** The gap after each loom's onset to the next (or to the period's end), drawn per fly. */
  gaps: (rng: () => number) => number[];
}

export const FERREIRA_2020: LoomTrainSpec = {
  id: "calibration-ferreira2020",
  radiusM: 0.034,
  heightM: 0.005,
  exploreS: 300,
  gaps: (rng) => Array.from({ length: 20 }, () => 10 + 10 * rng()),
};

export const BARRIOS_2021: LoomTrainSpec = {
  id: "calibration-barrios2021",
  radiusM: 0.008,
  heightM: 0.004,
  exploreS: 300,
  gaps: () => Array.from({ length: 60 }, () => 15),
};

/** The freezing classifier's bins (s) and sample rate (Hz). */
export const FREEZE_BIN_S = 0.5;
export const FREEZE_SAMPLE_HZ = 60;

export interface LoomTrain {
  /** Per 500 ms bin of the stimulation period: was the fly at rest at every sample? */
  freezing: boolean[];
  /** Per loom: the first bin after it ends, and the first bin that is not wholly before the next loom (or the period's end). */
  looms: { after: number; next: number }[];
}

/** A loom as the rebuilt Zacarias et al. paradigm shows it, aimed at the fly from its frontal half. */
function loomAt(
  fly: DigitalFly,
  geometry: () => number,
  onset: number,
  id: string,
): Loom {
  const Z = ZACARIAS_2018;
  const lv = Z.lOverVMs / 1000;
  const halfSizeM = 0.04;
  const tauStop = lv / Math.tan((Z.endDeg * Math.PI) / 360);
  const startDeg = (2 * Math.atan(lv / (tauStop + Z.expandS)) * 180) / Math.PI;
  const el = (Z.elevationDeg * Math.PI) / 180;
  const f = forward(
    fly.state.yaw + ((geometry() * 2 - 1) * Z.azimuthSpreadDeg * Math.PI) / 180,
  );
  const loom: Loom = {
    id,
    halfSizeM,
    speedMS: halfSizeM / lv,
    collisionT: 0,
    target: [fly.state.p[0], fly.state.p[1], fly.state.p[2]],
    from: [f[0] * Math.cos(el), Math.sin(el), f[2] * Math.cos(el)],
    startDeg,
    endDeg: Z.endDeg,
    holdS: Z.holdS,
  };
  loom.collisionT = onset + loomTauAt(loom, startDeg);
  return loom;
}

export function loomTrain(
  subject: Subject,
  spec: LoomTrainSpec,
  seed: number,
): LoomTrain {
  const world = new StimulusWorld(
    roundArena(spec.radiusM, spec.heightM, { clear: true, id: spec.id }),
  );
  const geometry = mulberry32(trialSeed(seed, 31));
  const q = placeInDisc(geometry, spec.radiusM * 0.9);
  const fly = new DigitalFly({
    seed: trialSeed(seed, 32),
    world,
    start: { p: [q.x, spec.heightM / 2, q.z], yaw: q.yaw },
    config: { takeoffHz: 0, ...subject.config },
    adapter: subject.adapter(trialSeed(seed, 33), LIDDED),
    logSize: 8,
  });
  const gaps = spec.gaps(geometry);
  const start = spec.exploreS;
  const onsets: number[] = [];
  let at = start;
  for (const g of gaps) {
    onsets.push(at);
    at += g;
  }
  const end = at;
  const step = 1 / FREEZE_SAMPLE_HZ;
  const perBin = Math.round(FREEZE_BIN_S * FREEZE_SAMPLE_HZ);
  while (fly.state.t < start - 1e-9) fly.advance(Math.min(0.05, start - fly.state.t));
  const freezing: boolean[] = [];
  let next = 0,
    still = true,
    k = 0;
  const total = Math.round((end - start) * FREEZE_SAMPLE_HZ);
  for (let s = 1; s <= total; s++) {
    const t = start + s * step;
    while (next < onsets.length && onsets[next]! < t - 1e-9) {
      const onset = onsets[next]!;
      if (fly.state.t < onset - 1e-9) fly.advance(onset - fly.state.t);
      world.looms.push(loomAt(fly, geometry, onset, `loom-${next + 1}`));
      next++;
    }
    if (t - fly.state.t > 1e-9) fly.advance(t - fly.state.t);
    if (fly.state.mode !== "rest") still = false;
    if (++k === perBin) {
      freezing.push(still);
      still = true;
      k = 0;
    }
  }
  const bin = (t: number) => (t - start) / FREEZE_BIN_S;
  const loomBins = onsets.map((o, i) => ({
    after: Math.ceil(bin(o + ZACARIAS_2018.expandS + ZACARIAS_2018.holdS) - 1e-9),
    next: Math.floor(bin(onsets[i + 1] ?? end) + 1e-9),
  }));
  return { freezing, looms: loomBins };
}

// --- Walking under a lid -------------------------------------------------------

/** A walking session that runs `settleS` unrecorded before it records. */
export interface WalkSpec extends SessionSpec {
  settleS: number;
}

export function walkSession(subject: Subject, spec: WalkSpec, seed: number): Frame[] {
  const geometry = mulberry32(trialSeed(seed, 21));
  const fly = new DigitalFly({
    seed: trialSeed(seed, 22),
    world: spec.world(),
    start: spec.start(geometry),
    config: { ...spec.config, ...subject.config },
    adapter: subject.adapter(trialSeed(seed, 23), LIDDED),
    logSize: 8,
  });
  while (fly.state.t < spec.settleS - 1e-9)
    fly.advance(Math.min(1, spec.settleS - fly.state.t));
  return record(fly, spec.durationS, spec.frameHz);
}

const disc = (radius: number, height: number) => (rng: () => number) => {
  const q = placeInDisc(rng, radius * 0.9);
  return { p: [q.x, height / 2, q.z] as V3, yaw: q.yaw };
};

/** A tenth of a full reserve: the model's stand-in for 18–24 h of starvation (`HOLDOUT_PARADIGMS.jung2015`). */
export const JUNG_START_RESERVE = 0.1;

export const JUNG_2015: WalkSpec = {
  world: () => roundArena(0.032, 0.003, { id: "calibration-jung2015" }),
  start: disc(0.032, 0.003),
  settleS: 1800,
  durationS: 180,
  frameHz: 30,
  config: { takeoffHz: 0, startReserve: JUNG_START_RESERVE },
  enclosed: true,
};
/** "If the instantaneous walking speed of a fly was lower than 0.5 mm/sec, then the fly was stationary ... faster than 1 mm/sec ... on a run." */
export const JUNG_STOP_MS = 0.0005;
export const JUNG_RUN_MS = 0.001;

/** 441 min of walking over 54% of the time and 84 flies (`HOLDOUT_PARADIGMS.cruz2021`). */
export const CRUZ_SESSION_S = Math.round(((441 / 0.54 / 84) * 60) / 6) * 6;

export const CRUZ_2021: WalkSpec = {
  world: () => roundArena(0.045, 0.003, { id: "calibration-cruz2021" }),
  start: disc(0.045, 0.003),
  settleS: 0,
  durationS: CRUZ_SESSION_S,
  frameHz: 60,
  config: { takeoffHz: 0 },
  enclosed: true,
};
/** "translational speed greater than 0.5mm/s, or angular speed greater than 20°/s for at least 166ms"; walking bouts "lasted for at least 333ms". */
export const CRUZ = {
  speedMS: 0.0005,
  angularDegS: 20,
  activityS: 0.166,
  walkingS: 0.333,
};

export const IYENGAR_2012: WalkSpec = {
  world: () => roundArena(0.0175, 0.002, { id: "calibration-iyengar2012" }),
  start: disc(0.0175, 0.002),
  settleS: 0,
  durationS: 900,
  frameHz: 30,
  config: { takeoffHz: 0 },
  enclosed: true,
};
/** "a criterion for fly movement when its velocity exceeded 3 mm/s". */
export const IYENGAR_MOVING_MS = 0.003;

// --- Free flight ---------------------------------------------------------------

const released = (p: V3) => (rng: () => number) => ({
  p,
  yaw: (rng() * 2 - 1) * Math.PI,
  mode: "flight" as const,
});

/** The reserve the model's resting rate leaves after 7 h, the middle of 6–8 h (`HOLDOUT_PARADIGMS.stupski2024`). */
export const STUPSKI_START_RESERVE =
  Math.round(
    (1 - (7 * 3600 * PARAMS.restPowerMw.value) / 1000 / PARAMS.reserveJ.value) * 1000,
  ) / 1000;

export const STUPSKI_2024: SessionSpec = {
  world: () => tunnel(1.0, 0.5, 0.5, [], "calibration-stupski2024"),
  start: released([0, 0.25, 0]),
  durationS: 3,
  frameHz: 100,
  config: { cruiseAltMinM: 0.1, cruiseAltMaxM: 0.4, startReserve: STUPSKI_START_RESERVE },
  untilPerched: true,
};
/** "saccades identified from 0.9–3 s after the stimulus". */
export const STUPSKI_WINDOW_S = [0.9, 3] as const;

export const STRAW_2011: SessionSpec = {
  world: () => tunnel(1.5, 0.3, 0.3, [], "calibration-straw2011"),
  start: released([0, 0.15, 0]),
  durationS: 60,
  frameHz: 100,
  config: { cruiseAltMinM: 0.05, cruiseAltMaxM: 0.25 },
  untilPerched: true,
};
/** "1760 total seconds of flight in which tracked fly was 5 cm or greater from the nearest arena surface". */
export const STRAW_CLEARANCE_M = 0.05;
export const STRAW_BOX = { halfX: 0.75, halfZ: 0.15, height: 0.3 };

/** The chamber: the 3.5 cm cube at its centre, 10 cm from its floor and side walls. */
export const MAYA_CHAMBER_M = 0.235;
export const MAYA_CUBE_M = 0.035;
export const MAYA_2026: SessionSpec = {
  world: () => chamber(MAYA_CHAMBER_M, MAYA_CHAMBER_M, "calibration-maya2026"),
  start: (rng) => ({
    p: [
      (rng() - 0.5) * (MAYA_CHAMBER_M - 0.04),
      0.03 + rng() * (MAYA_CHAMBER_M - 0.06),
      (rng() - 0.5) * (MAYA_CHAMBER_M - 0.04),
    ],
    yaw: (rng() * 2 - 1) * Math.PI,
    mode: "flight",
  }),
  durationS: 60,
  frameHz: 1000,
  config: { cruiseAltMinM: 0.05, cruiseAltMaxM: 0.2 },
  untilPerched: true,
};

/** Free flight in the rebuilt Censi et al. arena, at Mongeau & Frye's 160 frames/s. */
export const MONGEAU_2017: SessionSpec = {
  world: () => roundArena(1, 1, { id: "calibration-mongeau2017" }),
  start: released([0, 0.5, 0]),
  durationS: 60,
  frameHz: 160,
  config: { cruiseAltMinM: 0.1, cruiseAltMaxM: 0.6 },
  untilPerched: true,
};
/** "We rejected saccades below 10° and above 180°"; detection at Tammero & Dickinson's 300°/s. */
export const MONGEAU = { detectDegS: 300, minDeg: 10, maxDeg: 180 };
