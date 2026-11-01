/**
 * The calibration report: every paradigm run on each controller, every
 * observation set beside what the simulated fly did.
 *
 * Each measurement below says how the simulated quantity is computed; it is
 * computed the way the published one was wherever the paper says how, and
 * otherwise the paradigm's `approximations` say what stands in. Everything is
 * seeded (`trialSeed`), so the report reproduces exactly, and both
 * controllers meet the same trials and flies. The trial counts are sized so
 * that a run takes minutes, not to match the experiments'.
 */
import { coordination, dutyFactor, stepPeriodS, type GaitParams } from "../gait.js";
import { FLY_VERSION } from "../fly.js";
import { PARAMS } from "../params.js";
import { wrapAngle } from "../units.js";
import {
  agreement,
  directionAgreement,
  meanEstimate,
  medianEstimate,
  proportionEstimate,
  type Agreement,
  type Estimate,
  type Spread,
} from "./compare.js";
import { summarizeEthograms } from "./ethogram.js";
import { dustedSeed, loomSeed, GF_FIT_TRIALS } from "./fit.js";
import { GROOMING_REFERENCE } from "./groomingReference.js";
import {
  OBSERVATIONS,
  PARADIGMS,
  VR14_RV,
  type Observation,
  type Role,
} from "./observations.js";
import {
  CENSI_2013,
  card2008Loom,
  chamberSession,
  fotowat2009Loom,
  LIU_2007,
  LIU_2007_RADIUS,
  loomingTrial,
  repeatedLooms,
  session,
  SOIBAM_2012,
  SOIBAM_2012_RADIUS,
  TAMMERO_2002,
  trialSeed,
  VAN_BREUGEL_2012,
  VB12_POST,
  vonReyn2014Loom,
  ZHANG_2020_CHAMBER,
  type Frame,
  type LoomingTrial,
  type Subject,
} from "./paradigms.js";
import { CIRCUIT, REDUCED_ORDER, V2, v2Subject } from "./subjects.js";
import { V2_MECHANISMS } from "../circuits/v2/controller.js";
import { roleFor } from "./roles.js";
import {
  HOLDOUT_SIZES,
  measureHoldoutFlight,
  measureLiddedLooms,
  measureLiddedWalking,
  type HoldoutSizes,
} from "./holdoutMeasure.js";

/** How many trials, flies or releases each paradigm runs per controller. */
export type Sizes = Record<
  | "loomsPerRv"
  | "fotowatPerLv"
  | "cardPerDirection"
  | "zacariasFlies"
  | "censiFlights"
  | "tammeroFlights"
  | "tunnelReleases"
  | "liuFlies"
  | "soibamFlies",
  number
> &
  HoldoutSizes;
export const SIZES: Sizes = {
  ...HOLDOUT_SIZES,
  loomsPerRv: GF_FIT_TRIALS,
  fotowatPerLv: 200,
  cardPerDirection: 100,
  zacariasFlies: 60,
  censiFlights: 150,
  tammeroFlights: 150,
  tunnelReleases: 400,
  liuFlies: 24,
  soibamFlies: 30,
};
const REPORT_SEED = 0x7ca1;

/** What one controller did, per observation id: an estimate, or null when it does not produce the quantity. */
export type Measured = Map<string, Estimate | null>;

const DEG = 180 / Math.PI;
const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d;
const median = (xs: readonly number[]) => medianEstimate(xs).value;

/** The least-squares slope of y on x. */
function slope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n,
    my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : null;
}
const intercept = (xs: readonly number[], ys: readonly number[]) => {
  const b = slope(xs, ys);
  if (b === null) return null;
  const n = xs.length;
  return ys.reduce((a, c) => a + c, 0) / n - (b * xs.reduce((a, c) => a + c, 0)) / n;
};
const value = (v: number | null): Estimate =>
  v === null || !Number.isFinite(v)
    ? { value: null, n: 0, interval: null }
    : { value: v, n: 1, interval: null };

// --- Escape --------------------------------------------------------------------

export function measureEscape(subject: Subject, out: Measured, Z: Sizes): void {
  const byRv = new Map<number, LoomingTrial[]>();
  for (const rv of VR14_RV)
    byRv.set(
      rv,
      Array.from({ length: Z.loomsPerRv }, (_, i) =>
        loomingTrial(subject, vonReyn2014Loom(rv), loomSeed(rv, i)),
      ),
    );
  const shares: number[] = [];
  for (const rv of VR14_RV) {
    const ts = byRv.get(rv)!;
    const jumps = ts.filter((t) => t.jumped);
    out.set(`escape.probability.${rv}`, proportionEstimate(jumps.length, ts.length));
    const short = jumps.filter((t) => t.short).length;
    if (rv === 8 || rv === 14 || rv === 40)
      out.set(`escape.short-mode.${rv}`, proportionEstimate(short, jumps.length));
    if (jumps.length) shares.push(short / jumps.length);
  }
  out.set(
    "escape.short-mode.trend",
    value(shares.length === VR14_RV.length ? slope(VR14_RV.map(Math.log), shares) : null),
  );
  const at8 = byRv.get(8)!.filter((t) => t.jumped);
  for (const mode of ["short", "long"] as const) {
    const ts = at8.filter((t) => t.short === (mode === "short"));
    out.set(
      `escape.before-contact.${mode}`,
      ts.length
        ? proportionEstimate(ts.filter((t) => t.jumpTtcS! > 0).length, ts.length)
        : null,
    );
    // Median takeoff time relative to contact (s, negative before), fitted against r/v as the paper does.
    const rvs: number[] = [],
      times: number[] = [];
    for (const rv of [8, 14, 40]) {
      const m = median(
        byRv
          .get(rv)!
          .filter((t) => t.jumped && t.short === (mode === "short"))
          .map((t) => -t.jumpTtcS!),
      );
      if (m !== null) {
        rvs.push(rv / 1000);
        times.push(m);
      }
    }
    const delta = rvs.length === 3 ? intercept(rvs, times) : null;
    out.set(`escape.delay.${mode}`, value(delta === null ? null : delta * 1000));
  }

  for (const lv of [10, 40]) {
    const ts = Array.from({ length: Z.fotowatPerLv }, (_, i) =>
      loomingTrial(subject, fotowat2009Loom(lv), trialSeed(REPORT_SEED, 2, lv, i)),
    ).filter((t) => t.jumped);
    const m = median(ts.map((t) => t.jumpTtcS!));
    out.set(
      `escape.takeoff-time.${lv}`,
      m === null ? null : { value: m, n: ts.length, interval: null },
    );
  }

  const away = (az: number) =>
    Array.from({ length: Z.cardPerDirection }, (_, i) =>
      loomingTrial(subject, card2008Loom(az), trialSeed(REPORT_SEED, 3, az, i)),
    )
      .filter((t) => t.jumped && t.awayDeg !== null)
      .map((t) => t.awayDeg!);
  out.set("escape.direction.side", meanEstimate(away(90)));
  const front = meanEstimate(away(0)).value,
    back = meanEstimate(away(180)).value;
  // +1 when threats from the front and from behind both send the fly away from them.
  out.set(
    "escape.direction.front-back",
    value(front === null || back === null ? null : front > 90 && back > 90 ? 1 : -1),
  );

  measureZacarias(subject, out, Z.zacariasFlies);
}

/** Zacarias et al. 2018's looms over walking flies, on the report's flies (the v2 fit reads it too). */
export function measureZacarias(subject: Subject, out: Measured, n: number): void {
  const flies = Array.from({ length: n }, (_, i) =>
    repeatedLooms(subject, trialSeed(REPORT_SEED, 4, i)),
  );
  const looms = flies.flatMap((f) => f.jumped);
  out.set(
    "escape.walking.jump",
    proportionEstimate(looms.filter(Boolean).length, looms.length),
  );
  out.set(
    "escape.walking.freeze",
    proportionEstimate(flies.filter((f) => f.freezingAtEnd).length, flies.length),
  );
  const perLoom = flies[0]!.jumped.map(
    (_, k) => flies.filter((f) => f.jumped[k]).length / flies.length,
  );
  out.set(
    "escape.walking.habituation",
    value(
      slope(
        perLoom.map((_, k) => k + 1),
        perLoom,
      ),
    ),
  );
}

// --- Grooming --------------------------------------------------------------------

export function measureGrooming(subject: Subject, out: Measured): void {
  const D = GROOMING_REFERENCE.conditions;
  const dusted = Array.from({ length: D.dusted.flies }, (_, i) =>
    chamberSession(subject, ZHANG_2020_CHAMBER, { dusted: true }, dustedSeed(i)),
  );
  const undusted = Array.from({ length: D.undusted.flies }, (_, i) =>
    chamberSession(
      subject,
      ZHANG_2020_CHAMBER,
      { dusted: false },
      trialSeed(REPORT_SEED, 5, i),
    ),
  );
  const hz = ZHANG_2020_CHAMBER.frameHz;
  const sd = summarizeEthograms(dusted, hz, 150),
    su = summarizeEthograms(undusted, hz, 150);
  const across = (a: { n: number; mean: number; sd: number }): Estimate => {
    const half = a.n > 1 ? (1.96 * a.sd) / Math.sqrt(a.n) : null;
    return {
      value: a.mean,
      n: a.n,
      interval: half === null ? null : { lo: a.mean - half, hi: a.mean + half },
    };
  };
  const runMedian = (d: { runs: number; median?: number }): Estimate | null =>
    d.median === undefined ? null : { value: d.median, n: d.runs, interval: null };
  const last = sd.intervals.count - 1;
  out.set("grooming.dusted.fraction", across(sd.grooming));
  out.set("grooming.dusted.anterior", across(sd.anterior));
  out.set("grooming.dusted.posterior", across(sd.posterior));
  out.set("grooming.dusted.walking", across(sd.timeFraction["6"]!));
  out.set("grooming.dusted.standing", across(sd.timeFraction["7"]!));
  out.set("grooming.dusted.anterior.first", across(sd.intervals.anterior[0]!));
  out.set("grooming.dusted.anterior.last", across(sd.intervals.anterior[last]!));
  out.set("grooming.dusted.posterior.first", across(sd.intervals.posterior[0]!));
  out.set("grooming.dusted.posterior.last", across(sd.intervals.posterior[last]!));
  out.set("grooming.dusted.episodes-per-minute", across(sd.episodes.perMinute));
  out.set("grooming.dusted.episode-duration", runMedian(sd.episodes.durationS));
  out.set("grooming.dusted.anterior-motif", runMedian(sd.motifs.anterior));
  out.set("grooming.dusted.posterior-motif", runMedian(sd.motifs.posterior));
  out.set("grooming.undusted.fraction", across(su.grooming));
  out.set("grooming.undusted.walking", across(su.timeFraction["6"]!));
  out.set("grooming.undusted.standing", across(su.timeFraction["7"]!));
  out.set("grooming.undusted.episodes-per-minute", across(su.episodes.perMinute));
  out.set("grooming.undusted.episode-duration", runMedian(su.episodes.durationS));
  // +1 when the mean first bout of the head comes before the abdomen's, and the abdomen's before the wings'.
  const first = (label: number) => {
    const ts = dusted
      .map((f) => f.indexOf(label))
      .filter((k) => k >= 0)
      .map((k) => k / hz);
    return ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null;
  };
  const head = first(2),
    abdomen = first(3),
    wings = first(5);
  out.set(
    "grooming.order",
    value(
      head === null || abdomen === null || wings === null
        ? null
        : head < abdomen && abdomen < wings
          ? 1
          : -1,
    ),
  );
}

// --- Flight and landing ------------------------------------------------------------

const AIRBORNE = new Set(["flight", "land"]);
/** Tammero & Dickinson's and van Breugel & Dickinson's saccade threshold (deg/s). */
const SACCADE_DEG_S = 300;

interface Saccades {
  /** Seconds of valid flight samples. */
  seconds: number;
  count: number;
  /** Seconds within saccades. */
  inSaccade: number;
  amplitudesDeg: number[];
}

/**
 * Saccades from a tracked trajectory: headings of travel from successive
 * positions, valid while airborne and faster than `minSpeed`; a saccade is a
 * maximal run of valid samples turning faster than 300°/s.
 */
function saccades(
  flights: readonly (readonly Frame[])[],
  hz: number,
  minSpeed: number,
): Saccades {
  const s: Saccades = { seconds: 0, count: 0, inSaccade: 0, amplitudesDeg: [] };
  for (const f of flights) {
    let prevHeading: number | null = null,
      run = 0,
      turn = 0;
    const close = () => {
      if (run > 0) {
        s.count++;
        s.amplitudesDeg.push(Math.abs(turn) * DEG);
      }
      run = 0;
      turn = 0;
    };
    for (let k = 1; k < f.length; k++) {
      const a = f[k - 1]!,
        b = f[k]!;
      const dx = b.p[0] - a.p[0],
        dz = b.p[2] - a.p[2];
      const speed = Math.hypot(dx, dz) * hz;
      if (!AIRBORNE.has(a.mode) || !AIRBORNE.has(b.mode) || speed <= minSpeed) {
        close();
        prevHeading = null;
        continue;
      }
      const heading = Math.atan2(dx, dz);
      s.seconds += 1 / hz;
      if (prevHeading !== null) {
        const d = wrapAngle(heading - prevHeading);
        if (
          Math.abs(d) * hz * DEG > SACCADE_DEG_S &&
          (run === 0 || Math.sign(d) === Math.sign(turn))
        ) {
          run++;
          turn += d;
          s.inSaccade += 1 / hz;
        } else close();
      }
      prevHeading = heading;
    }
    close();
  }
  return s;
}

/** Saccades per second of flight faster than 5 cm/s in Censi et al.'s arena, on the report's flights (the v2 fit reads it too). */
export function censiRate(subject: Subject, flights: number): number | null {
  const censi = saccades(
    Array.from({ length: flights }, (_, i) =>
      session(subject, CENSI_2013, trialSeed(REPORT_SEED, 6, i)),
    ),
    CENSI_2013.frameHz,
    0.05,
  );
  return censi.seconds > 0 ? censi.count / censi.seconds : null;
}

export function measureFlight(subject: Subject, out: Measured, Z: Sizes): void {
  const flights = (spec: typeof CENSI_2013, n: number, tag: number) =>
    Array.from({ length: n }, (_, i) =>
      session(subject, spec, trialSeed(REPORT_SEED, tag, i)),
    );
  const censi = censiRate(subject, Z.censiFlights);
  out.set("flight.saccade-rate.censi", censi === null ? null : value(censi));
  const tammeroFlights = flights(TAMMERO_2002, Z.tammeroFlights, 7);
  const tammero = saccades(tammeroFlights, TAMMERO_2002.frameHz, 0);
  out.set(
    "flight.saccade-rate.tammero",
    tammero.seconds > 0 ? value(tammero.count / tammero.seconds) : null,
  );
  const speeds: number[] = [];
  for (const f of tammeroFlights)
    for (let k = 1; k < f.length; k++)
      if (AIRBORNE.has(f[k - 1]!.mode) && AIRBORNE.has(f[k]!.mode))
        speeds.push(
          Math.hypot(f[k]!.p[0] - f[k - 1]!.p[0], f[k]!.p[2] - f[k - 1]!.p[2]) *
            TAMMERO_2002.frameHz,
        );
  out.set("flight.speed", speeds.length ? meanEstimate(speeds) : null);

  const tunnel = Array.from({ length: Z.tunnelReleases }, (_, i) =>
    session(subject, VAN_BREUGEL_2012, trialSeed(REPORT_SEED, 8, i)),
  );
  const hz = VAN_BREUGEL_2012.frameHz;
  const vb = saccades(tunnel, hz, 0);
  out.set(
    "flight.saccade-amplitude",
    vb.amplitudesDeg.length ? meanEstimate(vb.amplitudesDeg) : null,
  );
  out.set(
    "flight.saccade-share",
    vb.seconds > 0 ? value(vb.inSaccade / vb.seconds) : null,
  );

  const post = VB12_POST;
  const rho = (p: readonly number[]) => Math.hypot(p[0]! - post.x, p[2]! - post.z);
  /** Distance from the post's surface (m). */
  const toPost = (p: readonly number[]) => {
    const radial = Math.max(0, rho(p) - post.r);
    return p[1]! <= post.h ? radial : Math.hypot(radial, p[1]! - post.h);
  };
  const postId = "post-0";
  const approach: number[] = [],
    flyby: number[] = [],
    touchdown: number[] = [],
    legs: number[] = [],
    avoid: number[] = [];
  let near = 0,
    landed = 0;
  for (const f of tunnel) {
    const closest = Math.min(...f.map((x) => toPost(x.p)));
    if (closest > 0.03) continue;
    near++;
    const end = f.findIndex((x) => x.perch === postId);
    const onPost = end >= 0;
    if (onPost) landed++;
    const stop = onPost ? end : f.length;
    // The speed where the trajectory last crossed 10 cm from the post before landing, or before its closest approach.
    const nearest = onPost ? end : f.findIndex((x) => toPost(x.p) === closest);
    let cross = -1;
    for (let k = 1; k <= nearest && k < f.length; k++)
      if (toPost(f[k - 1]!.p) > 0.1 && toPost(f[k]!.p) <= 0.1) cross = k;
    if (cross > 0) (onPost ? approach : flyby).push(f[cross]!.speed);
    if (onPost) {
      touchdown.push(f[end - 1]!.speed);
      // The landing target's retinal size (its 1.9 cm top) when the legs begin to extend.
      for (let k = end - 1; k > 0; k--)
        if (f[k]!.legs > 0 && f[k - 1]!.legs === 0 && f[k]!.target === postId) {
          const top = [post.x, post.h, post.z];
          const d = Math.hypot(
            f[k]!.p[0] - top[0]!,
            f[k]!.p[1] - top[1]!,
            f[k]!.p[2] - top[2]!,
          );
          legs.push(2 * Math.atan(post.r / d) * DEG);
          break;
        }
    } else {
      // A fly-by's first saccade near the post (within 10 cm) that turns it away: the post's angular width then.
      for (let k = 2; k < stop; k++) {
        const a = f[k - 2]!,
          b = f[k - 1]!,
          c = f[k]!;
        if (!AIRBORNE.has(a.mode) || !AIRBORNE.has(c.mode) || toPost(b.p) > 0.1) continue;
        const h1 = Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]),
          h2 = Math.atan2(c.p[0] - b.p[0], c.p[2] - b.p[2]);
        const rate = Math.abs(wrapAngle(h2 - h1)) * hz * DEG;
        const toward = Math.atan2(post.x - b.p[0], post.z - b.p[2]);
        if (
          rate > SACCADE_DEG_S &&
          Math.abs(wrapAngle(h2 - toward)) > Math.abs(wrapAngle(h1 - toward))
        ) {
          avoid.push(2 * Math.asin(Math.min(1, post.r / rho(b.p))) * DEG);
          break;
        }
      }
    }
  }
  out.set("landing.approach-speed", approach.length ? meanEstimate(approach) : null);
  out.set("landing.flyby-speed", flyby.length ? meanEstimate(flyby) : null);
  out.set("landing.share", near ? proportionEstimate(landed, near) : null);
  out.set("landing.leg-extension", legs.length ? meanEstimate(legs) : null);
  out.set("landing.touchdown-speed", touchdown.length ? meanEstimate(touchdown) : null);
  out.set("landing.avoidance-size", avoid.length ? meanEstimate(avoid) : null);
}

// --- Walking -------------------------------------------------------------------------

const radial = (f: Frame) => Math.hypot(f.p[0], f.p[2]);

/**
 * Liu, Davis & Roman 2007's open field on the report's flies, measured as the
 * report measures it (the v2 fit reads it too): `minutes` limits the sessions
 * to the first few minutes when the wall share is not needed.
 */
export function measureLiu(
  subject: Subject,
  out: Measured,
  flies: number,
  minutes = 10,
): void {
  const spec =
    minutes >= LIU_2007.durationS / 60
      ? LIU_2007
      : { ...LIU_2007, durationS: minutes * 60 };
  const liu = Array.from({ length: flies }, (_, i) =>
    session(subject, spec, trialSeed(REPORT_SEED, 9, i)),
  );
  const R = LIU_2007_RADIUS;
  if (spec === LIU_2007) {
    out.set(
      "walking.wall.liu",
      meanEstimate(
        liu.map(
          (f) => f.filter((x) => radial(x) >= R * Math.sqrt(2 / 3)).length / f.length,
        ),
      ),
    );
    out.set(
      "walking.centre-distance.liu",
      meanEstimate(liu.map((f) => f.reduce((a, x) => a + radial(x), 0) / f.length)),
    );
  }
  const perMinute = LIU_2007.frameHz * 60;
  for (const minute of [1, 2, 3]) {
    const moving: number[] = [],
      speed: number[] = [];
    for (const f of liu) {
      const w = f.slice((minute - 1) * perMinute, minute * perMinute);
      let walking = 0,
        path = 0;
      for (let k = 1; k < w.length; k++)
        if (w[k]!.mode === "walk") {
          walking++;
          path += Math.hypot(w[k]!.p[0] - w[k - 1]!.p[0], w[k]!.p[2] - w[k - 1]!.p[2]);
        }
      moving.push(walking / w.length);
      if (walking) speed.push(path / (walking / LIU_2007.frameHz));
    }
    out.set(`walking.moving.minute${minute}`, meanEstimate(moving));
    out.set(`walking.speed.minute${minute}`, speed.length ? meanEstimate(speed) : null);
  }
}

export function measureWalking(subject: Subject, out: Measured, Z: Sizes): void {
  measureLiu(subject, out, Z.liuFlies);
  const soibam = Array.from({ length: Z.soibamFlies }, (_, i) =>
    session(subject, SOIBAM_2012, trialSeed(REPORT_SEED, 10, i)),
  );
  const RS = SOIBAM_2012_RADIUS;
  out.set(
    "walking.wall.soibam",
    meanEstimate(
      soibam.map((f) => f.filter((x) => radial(x) >= RS - 0.006).length / f.length),
    ),
  );
  const turns: number[] = [];
  for (const f of soibam)
    for (let k = 2; k < f.length; k++) {
      const a = f[k - 2]!,
        b = f[k - 1]!,
        c = f[k]!;
      if ([a, b, c].some((x) => radial(x) >= RS - 0.006)) continue;
      const d1 = [b.p[0] - a.p[0], b.p[2] - a.p[2]],
        d2 = [c.p[0] - b.p[0], c.p[2] - b.p[2]];
      if (Math.hypot(d1[0]!, d1[1]!) < 1e-4 || Math.hypot(d2[0]!, d2[1]!) < 1e-4)
        continue;
      turns.push(
        Math.abs(wrapAngle(Math.atan2(d2[0]!, d2[1]!) - Math.atan2(d1[0]!, d1[1]!))) *
          DEG,
      );
    }
  for (const deg of [30, 60, 90])
    out.set(
      `walking.turns.${deg}`,
      turns.length
        ? proportionEstimate(turns.filter((t) => t < deg).length, turns.length)
        : null,
    );
}

/** The body's gait (shared by both controllers), set beside Mendes et al. and DeAngelis et al. */
function measureGait(out: Measured): void {
  const g: GaitParams = {
    stanceLegsAt1: PARAMS.stanceLegsAt1.value,
    stanceLegsAt4: PARAMS.stanceLegsAt4.value,
    swingMs: PARAMS.swingMs.value,
    stepPeriodFloorMs: PARAMS.stepPeriodFloorMs.value,
    walkSpeedMinCmS: PARAMS.walkSpeedMinCmS.value,
    walkSpeedMaxCmS: PARAMS.walkSpeedMaxCmS.value,
  };
  const lo = g.walkSpeedMinCmS * 10,
    hi = g.walkSpeedMaxCmS * 10;
  const classes = { slow: [lo, 19.9], medium: [20, 33.9], fast: [34, hi] } as const;
  for (const [cls, [a, b]] of Object.entries(classes)) {
    let tripod = 0,
      all = 0;
    for (let mm = a; mm <= b + 1e-9; mm = round(mm + 0.1, 1))
      for (let i = 0; i < 200; i++) {
        all++;
        if (coordination(i / 200, mm / 10, g) === "tripod") tripod++;
      }
    out.set(`walking.tripod.${cls}`, value(tripod / all));
  }
  for (const mm of [10, 20, 30])
    out.set(
      `walking.stance.${mm}`,
      value(dutyFactor(mm / 10, g) * stepPeriodS(mm / 10, g)),
    );
}

// --- The report ----------------------------------------------------------------------

export interface Comparison {
  observation: string;
  /** The controller (or "body" for what both share). */
  subject: string;
  role: Role;
  published: {
    value: number | null;
    unit: string;
    spread: Spread | null;
    n: number | null;
    sign?: 1 | -1;
  };
  simulated: Estimate | null;
  agreement: Agreement;
}

export interface CalibrationReport {
  schema: "fly-calibration-report/v2";
  flyVersion: string;
  subjects: { id: string; label: string }[];
  /** circuit-informed/v2 with one mechanism switched off each, its fitted values kept. */
  ablations: { id: string; label: string; without: string }[];
  sizes: Sizes;
  paradigms: typeof PARADIGMS;
  comparisons: Comparison[];
  /** Per subject: how many comparisons of each role fell in each class. */
  tally: Record<string, Record<Role, Partial<Record<Agreement, number>>>>;
}

const roundEstimate = (e: Estimate | null): Estimate | null =>
  e === null
    ? null
    : {
        value: e.value === null ? null : round(e.value),
        n: e.n,
        interval: e.interval
          ? { lo: round(e.interval.lo), hi: round(e.interval.hi) }
          : null,
      };

function compare(o: Observation, subject: string, e: Estimate | null): Comparison {
  const role = roleFor(o, subject);
  const sim = e?.value ?? null;
  return {
    observation: o.id,
    subject,
    role,
    published: {
      value: o.value,
      unit: o.unit,
      spread: o.spread,
      n: o.n,
      ...(o.sign ? { sign: o.sign } : {}),
    },
    simulated: roundEstimate(e),
    agreement:
      o.value === null
        ? directionAgreement(sim, o.sign ?? 1)
        : agreement(sim, o.value, o.spread, o.n),
  };
}

/** The calibration's saccade detector on one stretch of flight. */
export const saccadeCount = (frames: readonly Frame[], hz: number, minSpeed: number) =>
  saccades([frames], hz, minSpeed).count;

/** The 2026-11 held-out set (`holdout.ts`), measured as its papers measure it. */
export function measureHoldout(subject: Subject, out: Measured, Z: Sizes): void {
  measureLiddedLooms(subject, out, Z);
  measureLiddedWalking(subject, out, Z);
  measureHoldoutFlight(subject, out, Z, saccadeCount);
}

/** The ablations: v2 with each mechanism switched off in turn. */
export const ABLATIONS = V2_MECHANISMS.map((m) => ({
  without: m,
  subject: v2Subject({ without: [m] }),
}));

export function calibrationReport(
  log: (line: string) => void = () => {},
  sizes: Sizes = SIZES,
): CalibrationReport {
  const subjects = [REDUCED_ORDER, CIRCUIT, V2];
  const everyone = [...subjects, ...ABLATIONS.map((a) => a.subject)];
  const comparisons: Comparison[] = [];
  const body: Measured = new Map();
  measureGait(body);
  const perSubject = new Map<string, Measured>();
  for (const s of everyone) {
    const m: Measured = new Map();
    log(`${s.label}: escape`);
    measureEscape(s, m, sizes);
    log(`${s.label}: grooming`);
    measureGrooming(s, m);
    log(`${s.label}: flight and landing`);
    measureFlight(s, m, sizes);
    log(`${s.label}: walking`);
    measureWalking(s, m, sizes);
    measureHoldout(s, m, sizes);
    perSubject.set(s.id, m);
  }
  for (const o of OBSERVATIONS) {
    if (body.has(o.id)) {
      comparisons.push(compare(o, "body", body.get(o.id)!));
      continue;
    }
    for (const s of everyone) {
      const m = perSubject.get(s.id)!;
      if (!m.has(o.id)) throw new Error(`${s.id} measured nothing for ${o.id}`);
      comparisons.push(compare(o, s.id, m.get(o.id)!));
    }
  }
  const tally: CalibrationReport["tally"] = {};
  for (const c of comparisons) {
    const t = (tally[c.subject] ??= {
      "held-out": {},
      design: {},
      fit: {},
      development: {},
    });
    t[c.role][c.agreement] = (t[c.role][c.agreement] ?? 0) + 1;
  }
  return {
    schema: "fly-calibration-report/v2",
    flyVersion: FLY_VERSION,
    subjects: subjects.map((s) => ({ id: s.id, label: s.label })),
    ablations: ABLATIONS.map((a) => ({
      id: a.subject.id,
      label: a.subject.label,
      without: a.without,
    })),
    sizes,
    paradigms: PARADIGMS,
    comparisons,
    tally,
  };
}

// --- The README ----------------------------------------------------------------------

const sig = (x: number) => {
  if (x === 0) return "0";
  const a = Math.abs(x);
  return a >= 1000 ? x.toFixed(0) : a >= 1 ? x.toPrecision(3) : x.toPrecision(2);
};
function spreadText(s: Spread | null): string {
  if (!s) return "";
  switch (s.kind) {
    case "sd":
      return ` ± ${sig(s.value)} SD`;
    case "sem":
      return ` ± ${sig(s.value)} SEM`;
    case "ci95":
      return ` (95% CI ${sig(s.lo)}–${sig(s.hi)})`;
    case "range":
      return ` (range ${sig(s.lo)}–${sig(s.hi)})`;
    case "iqr":
      return ` (IQR ${sig(s.lo)}–${sig(s.hi)})`;
    case "proportion":
      return ` (${s.k}/${s.n})`;
  }
}
function publishedText(c: Comparison): string {
  const p = c.published;
  if (p.value === null) return p.sign === -1 ? "falls" : "holds";
  return `${sig(p.value)}${spreadText(p.spread)}${p.n !== null && p.spread?.kind !== "proportion" ? `, n ${p.n}` : ""}`;
}
function simulatedText(c: Comparison | undefined): string {
  if (!c) return "";
  const e = c.simulated;
  if (!e || e.value === null) return "—";
  if (c.published.value === null) return c.agreement === "agrees" ? "yes" : "no";
  const i = e.interval ? ` (${sig(e.interval.lo)}–${sig(e.interval.hi)})` : "";
  return `${sig(e.value)}${i}`;
}
const VERDICT: Record<Agreement, string> = {
  inside: "inside",
  "within-spread": "within spread",
  outside: "**outside**",
  "no-interval": "no interval",
  agrees: "agrees",
  disagrees: "**disagrees**",
  "not-produced": "**not produced**",
};
const quoteText = (o: Observation) => {
  const s = o.source;
  if ("data" in s) return `${s.citation.short}, ${s.data}`;
  const q = Array.isArray(s.quote)
    ? s.quote.map((x) => `"${x}"`).join(" … ")
    : `"${s.quote}"`;
  return `${s.citation.short} (${s.where}): ${q}`;
};
const BEHAVIOURS = [
  ["escape", "Escape"],
  ["grooming", "Grooming"],
  ["flight", "Flight"],
  ["landing", "Landing"],
  ["walking", "Walking"],
] as const;

const ROLES = ["held-out", "fit", "design", "development"] as const;
const SHORT: Record<string, string> = {
  "reduced-order-fsm/v1": "reduced-order",
  "circuit-informed/v1": "v1",
  "circuit-informed/v2": "v2",
};

function tallyRows(r: CalibrationReport, subjects: readonly string[]): string[] {
  const rows: string[] = [
    "| controller | role | inside | within spread | outside | no interval | agrees | disagrees | not produced |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const subject of subjects) {
    const roles = r.tally[subject];
    if (!roles) continue;
    for (const role of ROLES) {
      const t = roles[role];
      if (!Object.keys(t).length) continue;
      const k = (a: Agreement) => t[a] ?? 0;
      rows.push(
        `| ${subject} | ${role} | ${k("inside")} | ${k("within-spread")} | ${k("outside")} | ${k("no-interval")} | ${k("agrees")} | ${k("disagrees")} | ${k("not-produced")} |`,
      );
    }
  }
  return rows;
}

/** The report as a README: generated, never edited by hand. */
export function renderReadme(
  r: CalibrationReport,
  fit: unknown,
  commit: string,
  sealLine = "",
): string {
  const [ro, ci, v2] = r.subjects;
  const ids = r.subjects.map((s) => s.id);
  const by = (id: string, subject: string) =>
    r.comparisons.find((c) => c.observation === id && c.subject === subject);
  const roleText = (cs: Comparison[]) => {
    const roles = cs.map((c) => c.role);
    return roles.every((x) => x === roles[0])
      ? roles[0]!
      : cs.map((c) => `${c.role} (${SHORT[c.subject] ?? c.subject})`).join(", ");
  };
  const lines: string[] = [];
  lines.push(
    "# Digital fly calibration",
    "",
    `Generated by \`node scripts/run-ts.mjs scripts/fly-calibration.ts\` from ${commit} (${r.flyVersion}); do not edit. It sets the digital fly beside published recordings of real *Drosophila*: every observation in \`src/bethesda/fly/calibration/observations.ts\` and the 2026-11 held-out set in \`holdout.ts\`, each paradigm rebuilt by \`paradigms.ts\` or \`holdoutParadigms.ts\` and run by \`report.ts\` on three controllers: the reduced-order one (${ro!.label}), the circuit-informed one (${ci!.label}) and its successor (${v2!.label}), which adds five behavioural mechanisms, each also switched off in turn (ablations). It describes a simulator, never flies: each comparison inherits its paradigm's approximations, listed below.`,
    "",
    "How to read a row. *Role*, per controller (`roles.ts`): **held-out** (nothing in that controller was set from it; for the 2026-11 set, it was registered and sealed before circuit-informed/v2 was committed or run on its paradigms, and v2 was never run on it before this report), **design** (a parameter came from it, so agreement is by construction), **fit** (a fitted value of that controller was set to match it) or **development** (circuit-informed/v2 only: seen while v2 was built, so agreement is not evidence for v2). *Verdict*: **inside** the 95% interval of the published central value, **within spread** of the published flies (± 1 SD, the IQR or the range), **outside** both, **no interval** when the paper gives no spread to judge by (compare the numbers), **agrees**/**disagrees** for a reported direction, **not produced** when the simulated fly does not show the behaviour at all. Simulated intervals are 95% intervals of the estimate (normal for means, Wilson for proportions).",
    "",
    "## Tally",
    "",
    ...tallyRows(r, [...ids, "body"]),
  );

  const table = (obs: readonly Observation[]) => {
    lines.push(
      `| observation | unit | published | ${ro!.id} | verdict | ${ci!.id} | verdict | ${v2!.id} | verdict | role |`,
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const o of obs) {
      const body = by(o.id, "body");
      if (body) {
        lines.push(
          `| ${o.measure} | ${o.unit} | ${publishedText(body)} | ${simulatedText(body)} (the body, shared) | ${VERDICT[body.agreement]} | | | | | ${body.role} |`,
        );
        continue;
      }
      const cs = ids.map((s) => by(o.id, s)!);
      lines.push(
        `| ${o.measure} | ${o.unit} | ${publishedText(cs[0]!)} | ${cs
          .map((c) => `${simulatedText(c)} | ${VERDICT[c.agreement]}`)
          .join(" | ")} | ${roleText(cs)} |`,
      );
    }
    lines.push("", "Sources:", "");
    for (const o of obs) {
      const extra = [o.derived ? `Derived: ${o.derived}.` : "", o.note ?? ""]
        .filter(Boolean)
        .join(" ");
      lines.push(`- \`${o.id}\`: ${quoteText(o)}${extra ? ` ${extra}` : ""}`);
    }
  };

  const held = OBSERVATIONS.filter((o) => o.registered);
  if (held.length) {
    lines.push(
      "",
      "## The 2026-11 held-out set",
      "",
      "Registered from papers the calibration had not used, and sealed (`holdout-2026-11.json` beside this file, with its disclosure of the order of work) before circuit-informed/v2 was committed or run on any of their paradigms. Nothing in any controller was set from these, and v2 was run on their paradigms for the first time for this report. They are the test of whether v2's mechanisms generalize beyond the observations they were developed on." +
        (sealLine ? ` ${sealLine}` : ""),
    );
    lines.push(
      "",
      "The metrics and acceptance rules declared in the seal: the primary count is the observations with a published interval on which the estimate is inside it or within the flies' spread; the secondary metric is the median absolute relative error over observations without one (an observation not produced counting as 1).",
      "",
      "| controller | inside or within spread | outside | not produced (with an interval) | median relative error (no interval) |",
      "|---|---|---|---|---|",
    );
    for (const s of [...ids, ...r.ablations.map((a) => a.id)]) {
      const cs = held.map((o) => by(o.id, s)).filter((c): c is Comparison => !!c);
      // Every reported spread gives an interval (compare.ts), so "with an interval" is "with a spread".
      const withInterval = cs.filter((c) => c.published.spread !== null);
      const good = withInterval.filter(
        (c) => c.agreement === "inside" || c.agreement === "within-spread",
      ).length;
      const outside = withInterval.filter((c) => c.agreement === "outside").length;
      const missing = withInterval.filter((c) => c.agreement === "not-produced").length;
      const errors = cs
        .filter((c) => c.published.spread === null && c.published.value !== null)
        .map((c) =>
          c.simulated?.value === null || c.simulated?.value === undefined
            ? 1
            : Math.abs(c.simulated.value - c.published.value!) /
              Math.abs(c.published.value!),
        )
        .sort((a, b) => a - b);
      const med = errors.length
        ? errors.length % 2
          ? errors[(errors.length - 1) / 2]!
          : (errors[errors.length / 2 - 1]! + errors[errors.length / 2]!) / 2
        : null;
      lines.push(
        `| ${s} | ${good} of ${withInterval.length} | ${outside} | ${missing} | ${med === null ? "" : med.toFixed(2)} |`,
      );
    }
    for (const [behaviour, title] of BEHAVIOURS) {
      const obs = held.filter((o) => o.behaviour === behaviour);
      if (!obs.length) continue;
      lines.push("", `### ${title}`, "");
      table(obs);
    }
  }

  lines.push(
    "",
    "## Earlier observations",
    "",
    "Registered before 2026-11. For the reduced-order and v1 controllers they keep their roles; for circuit-informed/v2 they are development or fit observations.",
  );
  for (const [behaviour, title] of BEHAVIOURS) {
    const obs = OBSERVATIONS.filter((o) => o.behaviour === behaviour && !o.registered);
    if (!obs.length) continue;
    lines.push("", `### ${title}`, "");
    table(obs);
  }

  if (r.ablations.length) {
    lines.push(
      "",
      "## Ablations",
      "",
      "Circuit-informed/v2 with one mechanism switched off at a time, its other values (fitted ones included) kept, on the same seeds. An ablation shows what that mechanism contributes to the fitted controller, not what a controller built without it could reach. Where a mechanism is off, v2 falls back to the reduced-order controller's rule for it.",
      "",
      ...tallyRows(r, [v2!.id, ...r.ablations.map((a) => a.id)]),
      "",
      `| observation | role for v2 | published | v2 | ${r.ablations.map((a) => `without ${a.without}`).join(" | ")} |`,
      `|---|---|---|---|${r.ablations.map(() => "---").join("|")}|`,
    );
    for (const o of OBSERVATIONS) {
      const base = by(o.id, v2!.id);
      if (!base) continue;
      const cell = (c: Comparison | undefined) =>
        c ? `${simulatedText(c)} (${VERDICT[c.agreement]})` : "";
      lines.push(
        `| ${o.measure} | ${base.role} | ${publishedText(base)} | ${cell(base)} | ${r.ablations
          .map((a) => cell(by(o.id, a.id)))
          .join(" | ")} |`,
      );
    }
  }

  lines.push("", "## Paradigms", "");
  for (const [id, p] of Object.entries(r.paradigms)) {
    lines.push(
      `### ${p.label} (\`${id}\`, ${p.source.short})`,
      "",
      `Experiment: ${p.experiment}`,
      "",
      `Rebuilt: ${p.rebuilt}`,
      "",
      "Approximations:",
      "",
      ...p.approximations.map((a) => `- ${a}`),
      "",
    );
  }
  lines.push(
    "## Fit",
    "",
    "The fitted values of the circuit-informed controllers come from `fit.json` beside this file (`calibration/fit.ts` for v1's three, `calibration/fitV2.ts` for v2's seven; `--fit`), which records the method, the grid or bisection steps and the result:",
    "",
    "```json",
    JSON.stringify(fit, null, 2),
    "```",
    "",
    `Run sizes per controller: ${Object.entries(r.sizes)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}.`,
    "",
  );
  return lines.join("\n");
}
