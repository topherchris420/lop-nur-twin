/**
 * The calibration paradigms: the published experiments, rebuilt as closely as
 * the simulator allows, run on any decision maker through the fly's own body,
 * senses and gate.
 *
 * Each paradigm names how it differs from the experiment it stands for
 * (`approximations`), because every comparison inherits those differences.
 * Runs are seeded: a trial's seed fixes the fly's streams and the stimulus's
 * draws, so a paradigm reproduces exactly and two controllers see the same
 * trials.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { arenaWorld, type ArenaSpec } from "../arena.js";
import { DigitalFly, type FlyStart } from "../fly.js";
import type { AdapterStreams, FlyNeuralAdapter, Mode } from "../neural.js";
import type { ControllerConfig } from "../params.js";
import { forward, type V3, wrapAngle, yawOf } from "../units.js";
import type { FlyWorld } from "../world.js";
import {
  StimulusWorld,
  loomSizeAt,
  loomTauAt,
  loomWindow,
  type Loom,
} from "./stimuli.js";
import { chamber, roundArena, tunnel } from "./worlds.js";

/** What a paradigm did to the fly before placing it. */
export interface Setting {
  /** Dusted all over, as in the grooming experiments. */
  dusted: boolean;
  /**
   * A lid covers the fly: a closed arena or chamber a few millimetres high.
   * Only circuit-informed/v2 reads it (its defensive choice); the simulator
   * renders no view of the lid, so this stands in for what the fly would see
   * overhead.
   */
  enclosed?: boolean;
}

/** A controller under calibration: how to build it for a fly with this seed, in this setting. */
export interface Subject {
  id: string;
  label: string;
  adapter: (
    seed: number,
    setting: Setting,
  ) => (rng: () => number, streams?: AdapterStreams) => FlyNeuralAdapter;
  /** Overrides of the fly's model parameters the subject runs with (none for the defaults). */
  config?: ControllerConfig;
}

const CLEAN: Setting = { dusted: false };
export const LIDDED: Setting = { dusted: false, enclosed: true };

/** A 32-bit seed for one trial of one paradigm, from labels (FNV-1a, then mixed). */
export function trialSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part >>> 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** Spontaneous takeoff, walking and grooming off: only the stimulus moves the fly. */
export const STILL: ControllerConfig = { takeoffHz: 0, walkStartHz: 0, groomHz: 0 };

const LOOM_ROOM: ArenaSpec = { size: [4, 2.5, 4], ambient: 0.6 };

export interface LoomingSpec {
  /** l/v of the approach (ms). */
  lOverVMs: number;
  /** Half-size of the object (m); with l/v it sets the speed. */
  halfSizeM: number;
  startDeg: number;
  endDeg: number;
  /** How long the stimulus holds at its end size (s). */
  holdS: number;
  /** Where it comes from, relative to the fly's heading (deg, + left), and above the horizon. */
  azimuthDeg: number;
  /** Each trial's azimuth is drawn uniformly within this of `azimuthDeg` (deg; 0 for none). */
  azimuthSpreadDeg: number;
  elevationDeg: number;
  /** Fly time at which the stimulus starts growing (s), after the fly has settled. */
  onsetS: number;
  /** How long after the stimulus ends the trial runs on (s). */
  afterS: number;
}

export interface LoomingTrial {
  seed: number;
  /** Did the fly jump while the stimulus showed (or within `afterS` after)? */
  jumped: boolean;
  /** Seconds before the would-be collision the jump left the ground (negative after it). */
  jumpTtcS: number | null;
  /** The stimulus's angular size when the fly committed to the takeoff and when it jumped (deg). */
  sizeAtCommitDeg: number | null;
  sizeAtJumpDeg: number | null;
  /** From commitment to the jump (s). */
  prepareS: number | null;
  short: boolean | null;
  /** The jump's horizontal direction relative to where the stimulus came from (deg, 180 = straight away). */
  awayDeg: number | null;
  refusals: number;
}

/** Von Reyn et al. 2014's looming disk (`PARADIGMS.vonReyn2014`) at r/v `rvMs`. */
export function vonReyn2014Loom(rvMs: number): LoomingSpec {
  return {
    lOverVMs: rvMs,
    halfSizeM: 0.04,
    startDeg: 15,
    endDeg: 90,
    holdS: 1,
    azimuthDeg: 0,
    azimuthSpreadDeg: 60,
    elevationDeg: 45,
    onsetS: 1,
    afterS: 0,
  };
}

/** Fotowat et al. 2009's looming square beside the fly (`PARADIGMS.fotowat2009`). */
export function fotowat2009Loom(lvMs: number): LoomingSpec {
  return {
    lOverVMs: lvMs,
    halfSizeM: 0.04,
    startDeg: 5,
    endDeg: 150,
    holdS: 0.2,
    azimuthDeg: 90,
    azimuthSpreadDeg: 0,
    elevationDeg: 0,
    onsetS: 1,
    afterS: 0,
  };
}

/** Card & Dickinson 2008's threat from `azimuthDeg` (`PARADIGMS.card2008`). */
export function card2008Loom(azimuthDeg: number): LoomingSpec {
  return {
    lOverVMs: 40,
    halfSizeM: 0.04,
    startDeg: 10,
    endDeg: 90,
    holdS: 1,
    azimuthDeg,
    azimuthSpreadDeg: 0,
    elevationDeg: 45,
    onsetS: 1,
    afterS: 0,
  };
}

/**
 * One standing fly, one looming stimulus. The fly is placed at rest with its
 * spontaneous drives off and given `onsetS` to settle; the stimulus is aimed
 * at where it stands then. `observe`, if given, sees the fly after every 5 ms
 * step (the fit reads its controller's state through it).
 */
export function loomingTrial(
  subject: Subject,
  spec: LoomingSpec,
  seed: number,
  observe?: (fly: DigitalFly) => void,
): LoomingTrial {
  const world = new StimulusWorld(arenaWorld(LOOM_ROOM, "calibration-loom"));
  const geometry = mulberry32(trialSeed(seed, 1));
  const yaw = (geometry() * 2 - 1) * Math.PI;
  const azimuthDeg = spec.azimuthDeg + (geometry() * 2 - 1) * spec.azimuthSpreadDeg;
  const fly = new DigitalFly({
    seed: trialSeed(seed, 2),
    world,
    start: { p: [0, 0.5, 0], yaw },
    config: { ...STILL, ...subject.config },
    adapter: subject.adapter(trialSeed(seed, 3), CLEAN),
    logSize: 32,
  });
  const lv = spec.lOverVMs / 1000;
  const p0 = fly.state.p;
  const az = yaw + (azimuthDeg * Math.PI) / 180,
    el = (spec.elevationDeg * Math.PI) / 180;
  const f = forward(az);
  const from: V3 = [f[0] * Math.cos(el), Math.sin(el), f[2] * Math.cos(el)];
  const loom: Loom = {
    id: "loom",
    halfSizeM: spec.halfSizeM,
    speedMS: spec.halfSizeM / lv,
    collisionT: 0,
    target: [p0[0], p0[1], p0[2]],
    from,
    startDeg: spec.startDeg,
    endDeg: spec.endDeg,
    holdS: spec.holdS,
  };
  // Shift the approach so that it starts growing at the onset.
  const w0 = loomWindow(loom);
  loom.collisionT = spec.onsetS - w0.start;
  world.looms.push(loom);
  const window = loomWindow(loom);
  const end = window.end + spec.afterS;
  let committedAt: number | null = null,
    commitSize: number | null = null,
    jumpedAt: number | null = null,
    short: boolean | null = null,
    awayDeg: number | null = null;
  const stimBearing = yawOf(from[0], from[2]);
  // The takeoff's mode as the body last held it before leaving the ground.
  let pendingShort: boolean | null = null;
  for (let k = 0; fly.state.t < end && k < 1e6; k++) {
    const before = fly.state.mode;
    fly.advance(0.005);
    observe?.(fly);
    const s = fly.state;
    if (committedAt === null && (s.mode === "escape" || s.mode === "takeoff")) {
      committedAt = s.t;
      commitSize = loomSizeAt(loom, s.t);
    }
    if (s.takeoff) pendingShort = s.takeoff.short;
    if (
      jumpedAt === null &&
      (before === "escape" || before === "takeoff") &&
      s.mode === "flight"
    ) {
      jumpedAt = s.t;
      short = pendingShort;
      const heading = yawOf(s.v[0], s.v[2]);
      awayDeg = Math.abs((wrapAngle(heading - stimBearing) * 180) / Math.PI);
    }
  }
  const sizeAt = (t: number | null) => (t === null ? null : loomSizeAt(loom, t));
  const jumped = jumpedAt !== null && jumpedAt >= window.start;
  return {
    seed,
    jumped,
    jumpTtcS: jumped ? loom.collisionT - jumpedAt! : null,
    sizeAtCommitDeg: jumped ? commitSize : null,
    sizeAtJumpDeg: jumped ? sizeAt(jumpedAt) : null,
    prepareS: jumped && committedAt !== null ? jumpedAt! - committedAt : null,
    short: jumped ? short : null,
    awayDeg: jumped ? awayDeg : null,
    refusals: fly.state.counts.rejected,
  };
}

/** Each routine's ethogram label in the grooming data; notum cleaning, which they have no label for, counts as back-leg rubbing (both hind-leg movements). */
const ROUTINE_LABEL: Record<string, number> = {
  "front legs": 1,
  eyes: 2,
  antennae: 2,
  abdomen: 3,
  "hind legs": 4,
  notum: 4,
  wings: 5,
};

/** Zhang, Guo & Simpson 2020's chamber (`PARADIGMS.zhang2020`): 50 000 frames at 30 Hz. */
export const ZHANG_2020_CHAMBER: ChamberSpec = {
  widthM: 0.0156,
  heightM: 0.004,
  durationS: 50000 / 30,
  frameHz: 30,
};

export interface ChamberSpec {
  /** Inner width and height of the square chamber (m). */
  widthM: number;
  heightM: number;
  /** How long the fly is filmed, and at what rate (s, Hz). */
  durationS: number;
  frameHz: number;
}

/**
 * One fly alone in a closed chamber, dusted or not, filmed at `frameHz`: its
 * behaviour each frame as an ethogram label (1–5 grooming, 6 walking, 7
 * standing). It cannot fly in the chamber: spontaneous takeoff is off.
 */
export function chamberSession(
  subject: Subject,
  spec: ChamberSpec,
  setting: Setting,
  seed: number,
): Uint8Array {
  const world = chamber(spec.widthM, spec.heightM, "calibration-chamber");
  const geometry = mulberry32(trialSeed(seed, 11));
  const fly = new DigitalFly({
    seed: trialSeed(seed, 12),
    world,
    start: {
      p: [
        (geometry() - 0.5) * spec.widthM * 0.5,
        spec.heightM / 2,
        (geometry() - 0.5) * spec.widthM * 0.5,
      ],
      yaw: (geometry() * 2 - 1) * Math.PI,
    },
    config: { ...subject.config, takeoffHz: 0 },
    adapter: subject.adapter(trialSeed(seed, 13), { ...setting, enclosed: true }),
    logSize: 8,
  });
  const frames = Math.round(spec.durationS * spec.frameHz);
  const out = new Uint8Array(frames);
  for (let k = 0; k < frames; k++) {
    fly.advance(1 / spec.frameHz);
    const s = fly.state;
    out[k] =
      s.mode === "groom"
        ? (ROUTINE_LABEL[s.groom ?? ""] ?? 7)
        : s.mode === "rest"
          ? 7
          : 6;
  }
  return out;
}

// --- Recorded sessions: flight, landing, walking ---------------------------

/** The fly as a tracker would record it at one frame. */
export interface Frame {
  t: number;
  p: V3;
  mode: Mode;
  /** What it stands on, or null in the air. */
  perch: string | null;
  /** 0 tucked .. 1 extended. */
  legs: number;
  /** The landing target's id while one is set. */
  target: string | null;
  /** Speed (m/s) and horizontal heading of travel (rad) from the body's own velocity. */
  speed: number;
  /** The body's yaw (rad). */
  yaw: number;
}

/**
 * Run a fly for `durationS`, recording a frame every 1/`frameHz` s; with
 * `untilPerched`, stop at the first frame it stands on something (a flight
 * session records one flight).
 */
export function record(
  fly: DigitalFly,
  durationS: number,
  frameHz: number,
  untilPerched = false,
): Frame[] {
  const frames: Frame[] = [];
  const n = Math.round(durationS * frameHz);
  for (let k = 0; k < n; k++) {
    fly.advance(1 / frameHz);
    const s = fly.state;
    frames.push({
      t: s.t,
      p: [s.p[0], s.p[1], s.p[2]],
      mode: s.mode,
      perch: s.perch ? s.perch.id : null,
      legs: s.legs,
      target: s.target ? s.target.id : null,
      speed: Math.hypot(s.v[0], s.v[1], s.v[2]),
      yaw: s.yaw,
    });
    if (untilPerched && s.perch) break;
  }
  return frames;
}

/** A recorded session: where and how the fly starts, and what it runs with. */
export interface SessionSpec {
  world: () => FlyWorld;
  start: (rng: () => number) => FlyStart;
  durationS: number;
  frameHz: number;
  /** The paradigm's overrides of the fly's model values (the subject's own still apply). */
  config: ControllerConfig;
  /** Stop when the fly first stands on something: one flight per session. */
  untilPerched?: boolean;
  /** A lid a few millimetres over the fly (`Setting.enclosed`). */
  enclosed?: boolean;
}

export function session(subject: Subject, spec: SessionSpec, seed: number): Frame[] {
  const geometry = mulberry32(trialSeed(seed, 21));
  const fly = new DigitalFly({
    seed: trialSeed(seed, 22),
    world: spec.world(),
    start: spec.start(geometry),
    config: { ...spec.config, ...subject.config },
    adapter: subject.adapter(trialSeed(seed, 23), spec.enclosed ? LIDDED : CLEAN),
    logSize: 8,
  });
  return record(fly, spec.durationS, spec.frameHz, spec.untilPerched === true);
}

/** A uniform point of a disc of `radius` (m) and a uniform heading. */
export function placeInDisc(
  rng: () => number,
  radius: number,
): { x: number; z: number; yaw: number } {
  const r = radius * Math.sqrt(rng()),
    a = 2 * Math.PI * rng();
  return { x: r * Math.cos(a), z: r * Math.sin(a), yaw: (rng() * 2 - 1) * Math.PI };
}

/** Censi et al. 2013 (`PARADIGMS.censi2013`). */
export const CENSI_2013: SessionSpec = {
  world: () => roundArena(1, 1, { id: "calibration-censi2013" }),
  start: (rng) => ({ p: [0, 0.5, 0], yaw: (rng() * 2 - 1) * Math.PI, mode: "flight" }),
  durationS: 60,
  frameHz: 60,
  config: { cruiseAltMinM: 0.1, cruiseAltMaxM: 0.6 },
  untilPerched: true,
};

/** Tammero & Dickinson 2002 (`PARADIGMS.tammero2002a`). */
export const TAMMERO_2002: SessionSpec = {
  world: () => roundArena(0.5, 0.6, { id: "calibration-tammero2002a" }),
  start: (rng) => ({ p: [0, 0.3, 0], yaw: (rng() * 2 - 1) * Math.PI, mode: "flight" }),
  durationS: 60,
  frameHz: 30,
  config: { cruiseAltMinM: 0.1, cruiseAltMaxM: 0.4 },
  untilPerched: true,
};

/** The post of van Breugel & Dickinson 2012 (`PARADIGMS.vanBreugel2012`). */
export const VB12_POST = { x: 0, z: 0, r: 0.0095, h: 0.15 } as const;
export const VAN_BREUGEL_2012: SessionSpec = {
  world: () => tunnel(1.5, 0.3, 0.3, [VB12_POST], "calibration-vanbreugel2012"),
  start: (rng) => {
    // Anywhere in the tunnel at least 10 cm from the post, heading anywhere.
    for (;;) {
      const p: V3 = [(rng() * 2 - 1) * 0.65, 0.05 + rng() * 0.2, (rng() * 2 - 1) * 0.12];
      const yaw = (rng() * 2 - 1) * Math.PI;
      if (Math.hypot(p[0] - VB12_POST.x, p[2] - VB12_POST.z) - VB12_POST.r >= 0.1)
        return { p, yaw, mode: "flight" as const };
    }
  },
  durationS: 10,
  frameHz: 100,
  config: { cruiseAltMinM: 0.05, cruiseAltMaxM: 0.25 },
  untilPerched: true,
};

/** Liu, Davis & Roman 2007 (`PARADIGMS.liu2007`): 10 min, as the experiment. */
export const LIU_2007_RADIUS = 0.0455;
export const LIU_2007: SessionSpec = {
  world: () => roundArena(LIU_2007_RADIUS, 0.007, { id: "calibration-liu2007" }),
  start: (rng) => {
    const q = placeInDisc(rng, LIU_2007_RADIUS * 0.9);
    return { p: [q.x, 0.0035, q.z], yaw: q.yaw };
  },
  durationS: 600,
  frameHz: 10,
  config: { takeoffHz: 0 },
  enclosed: true,
};

/** Soibam et al. 2012 (`PARADIGMS.soibam2012`). */
export const SOIBAM_2012_RADIUS = 0.042;
export const SOIBAM_2012: SessionSpec = {
  world: () => roundArena(SOIBAM_2012_RADIUS, 0.007, { id: "calibration-soibam2012" }),
  start: (rng) => {
    const q = placeInDisc(rng, SOIBAM_2012_RADIUS * 0.9);
    return { p: [q.x, 0.0035, q.z], yaw: q.yaw };
  },
  durationS: 600,
  frameHz: 6,
  config: { takeoffHz: 0 },
  enclosed: true,
};

/** Zacarias et al. 2018's looms over a walking fly (`PARADIGMS.zacarias2018`). */
export const ZACARIAS_2018 = {
  radiusM: 0.015,
  heightM: 0.004,
  exploreS: 300,
  looms: 20,
  everyS: 15,
  lOverVMs: 40,
  /** "Object expanded during 450 ms until it reached maximum size of 78° where it remained for 50 ms." */
  expandS: 0.45,
  endDeg: 78,
  holdS: 0.05,
  /** Each loom comes from within this of the fly's heading at its onset (deg), this far up. */
  azimuthSpreadDeg: 90,
  elevationDeg: 45,
  /** A takeoff within this long of a loom's onset is its jump. */
  windowS: 1,
  /** "speed and motion tracking data were averaged into 500 ms bins": freezing at the end is judged over the last bin. */
  freezeBinS: 0.5,
} as const;

export interface RepeatedLooms {
  /** Per loom: did the fly take off within the window after its onset? */
  jumped: boolean[];
  /**
   * Was the fly immobile, neither walking nor grooming, through the last
   * `freezeBinS` of the stimulation period? The paper's classifier counts any
   * such immobility as freezing, whatever caused it.
   */
  freezingAtEnd: boolean;
}

export function repeatedLooms(subject: Subject, seed: number): RepeatedLooms {
  const Z = ZACARIAS_2018;
  const world = new StimulusWorld(
    roundArena(Z.radiusM, Z.heightM, { clear: true, id: "calibration-zacarias2018" }),
  );
  const geometry = mulberry32(trialSeed(seed, 31));
  const q = placeInDisc(geometry, Z.radiusM * 0.9);
  const fly = new DigitalFly({
    seed: trialSeed(seed, 32),
    world,
    start: { p: [q.x, Z.heightM / 2, q.z], yaw: q.yaw },
    config: { takeoffHz: 0, ...subject.config },
    adapter: subject.adapter(trialSeed(seed, 33), LIDDED),
    logSize: 8,
  });
  const lv = Z.lOverVMs / 1000;
  const halfSizeM = 0.04;
  const tauStop = lv / Math.tan((Z.endDeg * Math.PI) / 360);
  const startDeg = (2 * Math.atan(lv / (tauStop + Z.expandS)) * 180) / Math.PI;
  const el = (Z.elevationDeg * Math.PI) / 180;
  const jumped: boolean[] = [];
  for (let i = 0; i < Z.looms; i++) {
    const onset = Z.exploreS + i * Z.everyS;
    while (fly.state.t < onset - 1e-9) fly.advance(Math.min(0.005, onset - fly.state.t));
    const f = forward(
      fly.state.yaw + ((geometry() * 2 - 1) * Z.azimuthSpreadDeg * Math.PI) / 180,
    );
    const from: V3 = [f[0] * Math.cos(el), Math.sin(el), f[2] * Math.cos(el)];
    const loom: Loom = {
      id: `loom-${i + 1}`,
      halfSizeM,
      speedMS: halfSizeM / lv,
      collisionT: 0,
      target: [fly.state.p[0], fly.state.p[1], fly.state.p[2]],
      from,
      startDeg,
      endDeg: Z.endDeg,
      holdS: Z.holdS,
    };
    loom.collisionT = onset + loomTauAt(loom, startDeg);
    world.looms.push(loom);
    let jump = false;
    while (fly.state.t < onset + Z.windowS - 1e-9) {
      const before = fly.state.mode;
      fly.advance(0.005);
      if ((before === "escape" || before === "takeoff") && fly.state.mode === "flight")
        jump = true;
    }
    jumped.push(jump);
  }
  // On to the end of the stimulation period: 20 looms over 5 min.
  const end = Z.exploreS + Z.looms * Z.everyS;
  let still = true;
  while (fly.state.t < end - 1e-9) {
    fly.advance(Math.min(0.005, end - fly.state.t));
    if (fly.state.t > end - Z.freezeBinS - 1e-9 && fly.state.mode !== "rest")
      still = false;
  }
  return { jumped, freezingAtEnd: still };
}
