/**
 * The 2026-11 held-out set measured as each paper measures it
 * (`HOLDOUT_PARADIGMS` says how, and how that differs).
 */
import { wrapAngle } from "../units.js";
import { meanEstimate, medianEstimate, type Estimate } from "./compare.js";
import {
  BARRIOS_2021,
  CRUZ,
  CRUZ_2021,
  FERREIRA_2020,
  IYENGAR_2012,
  IYENGAR_MOVING_MS,
  JUNG_2015,
  JUNG_RUN_MS,
  JUNG_STOP_MS,
  loomTrain,
  type LoomTrain,
  MAYA_2026,
  MAYA_CHAMBER_M,
  MAYA_CUBE_M,
  MONGEAU,
  MONGEAU_2017,
  STRAW_2011,
  STRAW_BOX,
  STRAW_CLEARANCE_M,
  STUPSKI_2024,
  STUPSKI_WINDOW_S,
  walkSession,
} from "./holdoutParadigms.js";
import { session, trialSeed, type Frame, type Subject } from "./paradigms.js";

const DEG = 180 / Math.PI;
const AIRBORNE = new Set(["flight", "land"]);

/** The report's seed (`report.ts`), with tags of the set's own. */
export const HOLDOUT_SEED = 0xb0d5;

export interface HoldoutSizes {
  ferreiraFlies: number;
  barriosFlies: number;
  jungFlies: number;
  cruzFlies: number;
  iyengarFlies: number;
  stupskiFlights: number;
  strawFlights: number;
  mayaFlights: number;
  mongeauFlights: number;
}

export const HOLDOUT_SIZES: HoldoutSizes = {
  ferreiraFlies: 60,
  barriosFlies: 60,
  jungFlies: 60,
  cruzFlies: 84,
  iyengarFlies: 40,
  stupskiFlights: 150,
  strawFlights: 150,
  mayaFlights: 3000,
  mongeauFlights: 150,
};

type Out = Map<string, Estimate | null>;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const orNull = (xs: readonly number[], f: (xs: readonly number[]) => Estimate) =>
  xs.length ? f(xs) : null;

/** Horizontal speed (m/s) from each frame to the next. */
function horizontalSpeeds(f: readonly Frame[], hz: number): number[] {
  const v: number[] = [];
  for (let k = 1; k < f.length; k++)
    v.push(Math.hypot(f[k]!.p[0] - f[k - 1]!.p[0], f[k]!.p[2] - f[k - 1]!.p[2]) * hz);
  return v;
}

/** Maximal runs of equal labels, as [label, start, length]. */
function runsOf<T>(xs: readonly T[]): [T, number, number][] {
  const out: [T, number, number][] = [];
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j < xs.length && xs[j] === xs[i]) j++;
    out.push([xs[i]!, i, j - i]);
    i = j;
  }
  return out;
}

/**
 * Of the looms after which the fly is freezing in the first bin after the
 * loom ends (an entry), the share after which some later bin before the next
 * loom is not freezing (an exit); null when there is no entry.
 */
export function freezeExitShare(train: LoomTrain): number | null {
  let entries = 0,
    left = 0;
  for (const l of train.looms) {
    if (!train.freezing[l.after]) continue;
    entries++;
    for (let b = l.after + 1; b < l.next; b++)
      if (!train.freezing[b]) {
        left++;
        break;
      }
  }
  return entries ? left / entries : null;
}

export function measureLiddedLooms(subject: Subject, out: Out, Z: HoldoutSizes): void {
  const ferreira = Array.from({ length: Z.ferreiraFlies }, (_, i) =>
    loomTrain(subject, FERREIRA_2020, trialSeed(HOLDOUT_SEED, 1, i)),
  );
  out.set(
    "escape.lidded.freeze-time.ferreira",
    medianEstimate(ferreira.map((f) => mean(f.freezing.map(Number)))),
  );
  const exits = ferreira.map(freezeExitShare).filter((x): x is number => x !== null);
  out.set("escape.lidded.freeze-exit.ferreira", orNull(exits, medianEstimate));

  const barrios = Array.from({ length: Z.barriosFlies }, (_, i) =>
    loomTrain(subject, BARRIOS_2021, trialSeed(HOLDOUT_SEED, 2, i)),
  );
  out.set(
    "escape.lidded.freeze-time.barrios",
    meanEstimate(barrios.map((f) => mean(f.freezing.map(Number)))),
  );
}

export function measureLiddedWalking(subject: Subject, out: Out, Z: HoldoutSizes): void {
  // Jung, Hueston & Bhandawat 2015: runs and stops with the paper's hysteresis.
  const stops: number[] = [],
    runs: number[] = [],
    runSpeeds: number[] = [];
  for (let i = 0; i < Z.jungFlies; i++) {
    const f = walkSession(subject, JUNG_2015, trialSeed(HOLDOUT_SEED, 3, i));
    const v = horizontalSpeeds(f, JUNG_2015.frameHz);
    const label: ("stop" | "run" | null)[] = [];
    let prev: "stop" | "run" | null = null;
    for (const x of v) {
      prev = x < JUNG_STOP_MS ? "stop" : x > JUNG_RUN_MS ? "run" : prev;
      label.push(prev);
    }
    for (const [l, start, n] of runsOf(label)) {
      if (l === null) continue;
      const s = n / JUNG_2015.frameHz;
      if (l === "stop") stops.push(s);
      else {
        runs.push(s);
        runSpeeds.push(mean(v.slice(start, start + n)));
      }
    }
  }
  out.set("walking.stop-median.jung", orNull(stops, medianEstimate));
  out.set("walking.run-median.jung", orNull(runs, medianEstimate));
  out.set("walking.run-speed.jung", orNull(runSpeeds, medianEstimate));

  // Cruz, Pérez & Chiappe 2021: activity, then walking bouts.
  const hz = CRUZ_2021.frameHz;
  // An activity bout lasts at least 166 ms, and a walking bout is one lasting at least 333 ms.
  const minWalking = Math.ceil(Math.max(CRUZ.activityS, CRUZ.walkingS) * hz - 1e-9);
  const shares: number[] = [];
  for (let i = 0; i < Z.cruzFlies; i++) {
    const f = walkSession(subject, CRUZ_2021, trialSeed(HOLDOUT_SEED, 4, i));
    const v = horizontalSpeeds(f, hz);
    const active = v.map((x, k) => {
      const turn = Math.abs(wrapAngle(f[k + 1]!.yaw - f[k]!.yaw)) * hz * DEG;
      return x > CRUZ.speedMS || turn > CRUZ.angularDegS;
    });
    let walking = 0;
    for (const [a, , n] of runsOf(active)) if (a && n >= minWalking) walking += n;
    shares.push(walking / v.length);
  }
  out.set("walking.walking-share.cruz", meanEstimate(shares));

  // Iyengar et al. 2012: moving faster than 3 mm/s, from placement.
  const moving: number[] = [],
    movingSpeeds: number[] = [],
    distances: number[] = [];
  for (let i = 0; i < Z.iyengarFlies; i++) {
    const f = walkSession(subject, IYENGAR_2012, trialSeed(HOLDOUT_SEED, 5, i));
    const v = horizontalSpeeds(f, IYENGAR_2012.frameHz);
    const fast = v.filter((x) => x > IYENGAR_MOVING_MS);
    moving.push(fast.length / v.length);
    movingSpeeds.push(...fast);
    distances.push(v.reduce((a, x) => a + x / IYENGAR_2012.frameHz, 0));
  }
  out.set("walking.moving.iyengar", meanEstimate(moving));
  out.set("walking.moving-speed.iyengar", orNull(movingSpeeds, medianEstimate));
  out.set("walking.distance.iyengar", meanEstimate(distances));
}

/** The calibration's saccade detector on one stretch of flight (`report.ts`). */
export type SaccadeCounter = (
  frames: readonly Frame[],
  hz: number,
  minSpeed: number,
) => number;

interface YawSaccade {
  amplitudeDeg: number;
  durationMs: number;
  peakDegS: number;
}

/** Mongeau & Frye's saccades on the body's yaw (`HOLDOUT_PARADIGMS.mongeau2017`). */
export function yawSaccades(f: readonly Frame[], hz: number): YawSaccade[] {
  const rate: (number | null)[] = [];
  for (let k = 1; k < f.length; k++)
    rate.push(
      AIRBORNE.has(f[k - 1]!.mode) && AIRBORNE.has(f[k]!.mode)
        ? wrapAngle(f[k]!.yaw - f[k - 1]!.yaw) * hz * DEG
        : null,
    );
  const out: YawSaccade[] = [];
  let k = 0;
  while (k < rate.length) {
    const r = rate[k];
    if (r === null || r === undefined || Math.abs(r) <= MONGEAU.detectDegS) {
      k++;
      continue;
    }
    const sign = Math.sign(r);
    let end = k;
    while (
      end < rate.length &&
      rate[end] !== null &&
      rate[end]! * sign > MONGEAU.detectDegS
    )
      end++;
    let peakAt = k;
    for (let j = k; j < end; j++) if (rate[j]! * sign > rate[peakAt]! * sign) peakAt = j;
    const peak = rate[peakAt]! * sign;
    let lo = peakAt,
      hi = peakAt;
    while (lo > 0 && rate[lo - 1] !== null && rate[lo - 1]! * sign > peak / 4) lo--;
    while (
      hi + 1 < rate.length &&
      rate[hi + 1] !== null &&
      rate[hi + 1]! * sign > peak / 4
    )
      hi++;
    let amplitude = 0;
    for (let j = lo; j <= hi; j++) amplitude += (rate[j]! * sign) / hz;
    if (amplitude >= MONGEAU.minDeg && amplitude <= MONGEAU.maxDeg)
      out.push({
        amplitudeDeg: amplitude,
        durationMs: ((hi - lo + 1) / hz) * 1000,
        peakDegS: peak,
      });
    k = Math.max(end, hi + 1);
  }
  return out;
}

export function measureHoldoutFlight(
  subject: Subject,
  out: Out,
  Z: HoldoutSizes,
  countSaccades: SaccadeCounter,
): void {
  // Stupski & van Breugel 2024: saccades 0.9–3 s after the release.
  const [w0, w1] = STUPSKI_WINDOW_S;
  const rates: number[] = [];
  for (let i = 0; i < Z.stupskiFlights; i++) {
    const f = session(subject, STUPSKI_2024, trialSeed(HOLDOUT_SEED, 6, i));
    const win = f.filter((x) => x.t >= w0 - 1e-9 && x.t <= w1 + 1e-9);
    const span = Math.round((w1 - w0) * STUPSKI_2024.frameHz) + 1;
    if (win.length < span || !win.every((x) => AIRBORNE.has(x.mode))) continue;
    rates.push(countSaccades(win, STUPSKI_2024.frameHz, 0.05) / (w1 - w0));
  }
  out.set("flight.saccade-rate.stupski", orNull(rates, meanEstimate));

  // Straw et al. 2011: horizontal speed 5 cm or more from every surface.
  const c = STRAW_CLEARANCE_M;
  const clear = (x: Frame) =>
    AIRBORNE.has(x.mode) &&
    Math.abs(x.p[0]) <= STRAW_BOX.halfX - c &&
    Math.abs(x.p[2]) <= STRAW_BOX.halfZ - c &&
    x.p[1] >= c &&
    x.p[1] <= STRAW_BOX.height - c;
  const speeds: number[] = [];
  for (let i = 0; i < Z.strawFlights; i++) {
    const f = session(subject, STRAW_2011, trialSeed(HOLDOUT_SEED, 7, i));
    for (let k = 1; k < f.length; k++)
      if (clear(f[k - 1]!) && clear(f[k]!))
        speeds.push(
          Math.hypot(f[k]!.p[0] - f[k - 1]!.p[0], f[k]!.p[2] - f[k - 1]!.p[2]) *
            STRAW_2011.frameHz,
        );
  }
  out.set("flight.speed.straw", orNull(speeds, meanEstimate));

  // Maya et al. 2026: passes through the central cube.
  const half = MAYA_CUBE_M / 2,
    cy = MAYA_CHAMBER_M / 2;
  const inCube = (x: Frame) =>
    AIRBORNE.has(x.mode) &&
    Math.abs(x.p[0]) <= half &&
    Math.abs(x.p[2]) <= half &&
    Math.abs(x.p[1] - cy) <= half;
  const events: number[] = [];
  for (let i = 0; i < Z.mayaFlights; i++) {
    const f = session(subject, MAYA_2026, trialSeed(HOLDOUT_SEED, 8, i));
    for (const [inside, start, n] of runsOf(f.map(inCube))) {
      if (!inside || n < 2) continue;
      let s = 0;
      for (let k = start + 1; k < start + n; k++)
        s += Math.hypot(
          f[k]!.p[0] - f[k - 1]!.p[0],
          f[k]!.p[1] - f[k - 1]!.p[1],
          f[k]!.p[2] - f[k - 1]!.p[2],
        );
      events.push((s / (n - 1)) * MAYA_2026.frameHz);
    }
  }
  out.set("flight.speed.maya", orNull(events, meanEstimate));

  // Mongeau & Frye 2017: spontaneous saccades on the body's yaw.
  const ys: YawSaccade[] = [];
  for (let i = 0; i < Z.mongeauFlights; i++)
    ys.push(
      ...yawSaccades(
        session(subject, MONGEAU_2017, trialSeed(HOLDOUT_SEED, 9, i)),
        MONGEAU_2017.frameHz,
      ),
    );
  out.set(
    "flight.saccade-amplitude.mongeau",
    orNull(
      ys.map((s) => s.amplitudeDeg),
      medianEstimate,
    ),
  );
  out.set(
    "flight.saccade-duration.mongeau",
    orNull(
      ys.map((s) => s.durationMs),
      medianEstimate,
    ),
  );
  out.set(
    "flight.saccade-peak.mongeau",
    orNull(
      ys.map((s) => s.peakDegS),
      medianEstimate,
    ),
  );
}
