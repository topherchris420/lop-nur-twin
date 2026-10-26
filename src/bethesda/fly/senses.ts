/**
 * What the digital fly senses, sampled at a fixed period and read by the
 * controller after a latency.
 *
 * Vision is the main channel and it is limited the way the FlyBody eye is:
 * each eye sees a cone around its camera axis (the axes of FlyBody's
 * `eye_left` and `eye_right` cameras; the width is `eyeFovDeg`, the 150°
 * FlyBody's walker gives those cameras, approximated as circular cones), and
 * an object narrower than one ommatidium (4.6°) is not detected. Glass is not
 * seen. Vision is computed in a level, heading-aligned frame, as if the head
 * stabilised gaze; FlyBody's head joints are not simulated.
 *
 * From vision the fly gets: for moving things, angular size and its rate of
 * change, combined into a giant-fiber proxy whose form follows Ache et al.
 * 2019 (a linear term in angular velocity, as carried by LC4, plus a Gaussian
 * term in angular size, as carried by LPLC2); for static surfaces, time to
 * contact along a fan of rays, split left/right; and a light level and
 * direction. From the antennae it gets one food-odour level and, in a world
 * with wind, the speed of the air moving past it and the bearing it comes
 * from: a reduced-order stand-in for the antennae's airflow sense, not a model
 * of Johnston's organ. Temperature, humidity and sound are not sensed at all;
 * these and the senses' other limits are listed as unsupported.
 *
 * Moving things are only seen: they loom and can trigger an escape, but the
 * fly's body never collides with them (world.ts).
 */
import { compose, forwardKinematics, rotate } from "./kinematics.js";
import { PARAMS, type ResolvedParams } from "./params.js";
import { SKELETON } from "./skeleton.js";
import {
  degToRad,
  forward,
  left,
  length,
  radToDeg,
  type V3,
  wrapAngle,
  yawOf,
} from "./units.js";
import type { FlyWorld, Landmark, Mover, Perch } from "./world.js";

/** What the fly cannot sense at all, or only in part: its smell is one food-odour level, its taste food or none. */
export const UNSUPPORTED_SENSES = [
  "olfaction beyond one food-odour level (no other odours, no plumes)",
  "taste beyond whether food is underfoot",
  "temperature",
  "humidity",
  "airflow beyond its speed and the bearing it comes from (no turbulence, no vertical air)",
  "sound",
] as const;

/**
 * Eye optical axes in the fly's level frame: azimuth (+ left) and elevation,
 * radians, from FlyBody's eye cameras; each eye's width is `eyeFovDeg`.
 */
export const EYES = (() => {
  const frames = forwardKinematics(SKELETON.bodies);
  return SKELETON.eyes.map((e) => {
    const head = frames.get(e.body)!;
    const cam = compose(head, { p: e.pos, q: e.quat });
    // A MuJoCo camera looks along its −z axis.
    const axis = rotate(cam.q, [0, 0, -1]);
    return {
      name: e.name,
      azimuth: Math.atan2(axis[1], axis[0]),
      elevation: Math.asin(Math.max(-1, Math.min(1, axis[2] / length(axis)))),
      halfFov: degToRad(PARAMS.eyeFovDeg.value / 2),
    };
  });
})();

/** Angle between two directions given as azimuth/elevation. */
function separation(az1: number, el1: number, az2: number, el2: number): number {
  const c =
    Math.sin(el1) * Math.sin(el2) + Math.cos(el1) * Math.cos(el2) * Math.cos(az1 - az2);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Is a direction (relative azimuth/elevation) inside either eye's field, allowing for angular radius? */
export function inVisualField(azimuth: number, elevation: number, radius = 0): boolean {
  return EYES.some(
    (e) => separation(azimuth, elevation, e.azimuth, e.elevation) <= e.halfFov + radius,
  );
}

export interface Looming {
  id: string;
  kind: Mover["kind"];
  distance: number;
  sizeDeg: number;
  expansionDegS: number;
  /** Relative to heading, + to the fly's left. */
  bearing: number;
  elevation: number;
  /** The giant-fiber proxy, before habituation. */
  drive: number;
}
export interface SenseFrame {
  t: number;
  /** Strongest looming object by giant-fiber proxy, if any is visible. */
  looming: Looming | null;
  visibleMovers: number;
  /** Time to contact (s) with static surfaces ahead-left, ahead-right and straight ahead; Infinity if none. */
  ttcLeft: number;
  ttcRight: number;
  ttcFront: number;
  /** Nearest visible static surface along the ray fan (m). */
  clearance: number;
  light: number;
  /** Relative bearing (+ left) and elevation of the dominant light, or null. */
  lightBearing: number | null;
  lightElevation: number | null;
  /** The surface under the fly and the fly's height above it. */
  below: Perch | null;
  altitude: number;
  /** Food odour at the antennae, relative units (the world's still-air proxy). */
  odour: number;
  /** Whether the fly is under an open sky (a world with a sun), sun or shade: the celestial compass. */
  sky: boolean;
  /**
   * Landmarks in view within `landmarkRangeM`: upright objects the fly can
   * recognize a place by, each with its bearing (+ left) and distance. Looked
   * for every `LANDMARK_EVERY` samples; the samples between repeat the list.
   */
  landmarks: readonly SeenLandmark[];
  /**
   * In flight under a sun: the bearing (+ left) of the nearest ground in
   * shade the eyes see within `landingSearchM` (shade is darker), or null.
   * Looked for with the landmarks; the samples between repeat it.
   */
  shadeBearing: number | null;
  /**
   * The air moving past the antennae (m/s, horizontal): the wind on a fly
   * that stands, its own air speed on one that flies. 0 in a world without
   * wind, which has no air to feel.
   */
  airflow: number;
  /** The relative bearing (+ left) the air comes from, or null below `AIRFLOW_BEARING_MS`. */
  airflowFrom: number | null;
}

export interface SeenLandmark {
  id: string;
  bearing: number;
  distance: number;
}

/** Below this airflow (m/s) the antennae give no bearing for it (a model choice). */
export const AIRFLOW_BEARING_MS = 0.05;

/** Landmarks are looked for every this many samples (10 Hz at the default 10 ms period). */
export const LANDMARK_EVERY = 10;
/** Shade is looked for on the ground at these shares of `landingSearchM`, nearer first... */
const SHADE_RINGS = [0.5, 1];
/** ...in these directions (deg, + left), the nearest to straight ahead first. */
const SHADE_DEG = [0, 45, -45, 90, -90, 135, -135, 180];

export interface SenseInput {
  t: number;
  p: V3;
  v: V3;
  yaw: number;
  flying: boolean;
  /** The air's velocity relative to the fly (m/s), in a world with wind only. */
  air?: V3;
}

const FAN_DEG = [-60, -30, -12, 0, 12, 30, 60];

/** Approximately normal noise from the seeded stream (Irwin–Hall, four uniforms). */
export function gauss(rng: () => number): number {
  return rng() + rng() + rng() + rng() - 2;
}

export class Senses {
  private sizes = new Map<string, number>();
  private lastT = -Infinity;
  private moverBuf: Mover[] = [];
  private landmarkBuf: Landmark[] = [];
  private seen: readonly SeenLandmark[] = Object.freeze([]);
  private shade: number | null = null;
  private samples = 0;
  private world: FlyWorld;
  private params: ResolvedParams;
  /** Relative noise on distances, angles and light; 0 is noiseless. */
  private noise: number;
  private rng: () => number;
  constructor(world: FlyWorld, params: ResolvedParams, noise: number, rng: () => number) {
    this.world = world;
    this.params = params;
    this.noise = noise;
    this.rng = rng;
  }

  /** A size, distance or level with relative noise. */
  private jitter(x: number): number {
    return this.noise > 0 ? x * (1 + this.noise * gauss(this.rng)) : x;
  }

  /**
   * A direction (rad) with additive noise of the same standard deviation in
   * radians whatever the direction: relative noise on an angle would leave
   * straight ahead noiseless and scatter a bearing behind the most.
   */
  private jitterAngle(a: number): number {
    return this.noise > 0 ? wrapAngle(a + this.noise * gauss(this.rng)) : a;
  }

  sample(s: SenseInput): SenseFrame {
    const P = this.params;
    const fwd = forward(s.yaw),
      lft = left(s.yaw);
    const range = P.visualRangeM;
    const acuity = degToRad(P.interommatidialDeg);
    const dt = s.t - this.lastT;
    // Moving things.
    const movers = this.moverBuf;
    movers.length = 0;
    this.world.movers(s.p, range, movers, s.t);
    const sizes = new Map<string, number>();
    let looming: Looming | null = null;
    let visible = 0;
    for (const m of movers) {
      const dx = m.center[0] - s.p[0],
        dy = m.center[1] - s.p[1],
        dz = m.center[2] - s.p[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= m.radius || d > range) continue;
      const angRadius = Math.asin(Math.min(1, m.radius / d));
      const size = 2 * angRadius;
      if (size < acuity) continue;
      const bearing = Math.atan2(dx * lft[0] + dz * lft[2], dx * fwd[0] + dz * fwd[2]);
      const elevation = Math.asin(dy / d);
      if (!inVisualField(bearing, elevation, angRadius)) continue;
      const dir: V3 = [dx / d, dy / d, dz / d];
      const blocker = this.world.raycast(s.p, dir, d - m.radius, true);
      if (blocker) continue;
      visible++;
      const sizeN = this.jitter(size);
      sizes.set(m.id, sizeN);
      const prev = this.sizes.get(m.id);
      const expansion =
        prev !== undefined && dt > 0 && dt < 0.1 ? (sizeN - prev) / dt : 0;
      const sizeDeg = radToDeg(sizeN),
        expansionDegS = radToDeg(expansion);
      const drive =
        P.gfVelocityGain * Math.max(0, expansionDegS) +
        P.gfSizeGain *
          Math.exp(-((sizeDeg - P.gfSizePeakDeg) ** 2) / (2 * P.gfSizeWidthDeg ** 2)) *
          (expansion > 0 ? 1 : 0);
      if (!looming || drive > looming.drive)
        looming = {
          id: m.id,
          kind: m.kind,
          distance: d,
          sizeDeg,
          expansionDegS,
          bearing,
          elevation,
          drive,
        };
    }
    this.sizes = sizes;
    this.lastT = s.t;
    // Static surfaces: a level fan ahead (and, in flight, a fan pitched down).
    let ttcLeft = Infinity,
      ttcRight = Infinity,
      ttcFront = Infinity,
      clearance = Infinity;
    const reach = s.flying ? 3 : 0.05;
    for (const elev of s.flying ? [0, -0.35] : [0]) {
      for (const deg of FAN_DEG) {
        const a = degToRad(deg);
        const ce = Math.cos(elev);
        const dir: V3 = [
          (fwd[0] * Math.cos(a) + lft[0] * Math.sin(a)) * ce,
          Math.sin(elev),
          (fwd[2] * Math.cos(a) + lft[2] * Math.sin(a)) * ce,
        ];
        const hit = this.world.raycast(s.p, dir, reach, true);
        if (!hit) continue;
        if (hit.normal[1] > 0.7 && elev < 0) continue; // the floor below is not an obstacle ahead
        const dist = this.jitter(hit.t);
        clearance = Math.min(clearance, dist);
        const closing = s.v[0] * dir[0] + s.v[1] * dir[1] + s.v[2] * dir[2];
        if (closing <= 1e-6) continue;
        const ttc = dist / closing;
        if (deg === 0) ttcFront = Math.min(ttcFront, ttc);
        else if (deg > 0) ttcLeft = Math.min(ttcLeft, ttc);
        else ttcRight = Math.min(ttcRight, ttc);
      }
    }
    // Light.
    const light = this.world.light(s.p);
    let lightBearing: number | null = null,
      lightElevation: number | null = null;
    if (light.toward) {
      const t = light.toward;
      lightBearing = this.jitterAngle(
        Math.atan2(t[0] * lft[0] + t[2] * lft[2], t[0] * fwd[0] + t[2] * fwd[2]),
      );
      lightElevation = Math.asin(Math.max(-1, Math.min(1, t[1])));
    }
    const below = this.world.perchAt(s.p[0], s.p[2], s.p[1]);
    // Felt only where there is air to feel, so a world without wind draws no noise for it.
    let airflow = 0,
      airflowFrom: number | null = null;
    if (s.air) {
      const speed = Math.hypot(s.air[0], s.air[2]);
      airflow = Math.max(0, this.jitter(speed));
      if (speed >= AIRFLOW_BEARING_MS)
        airflowFrom = this.jitterAngle(wrapAngle(yawOf(-s.air[0], -s.air[2]) - s.yaw));
    }
    if (this.samples++ % LANDMARK_EVERY === 0) {
      this.seen = this.lookForLandmarks(s, fwd, lft);
      this.shade =
        s.flying && light.sunlit !== undefined ? this.lookForShade(s, fwd, lft) : null;
    }
    return {
      t: s.t,
      looming,
      visibleMovers: visible,
      ttcLeft,
      ttcRight,
      ttcFront,
      clearance,
      light: Math.max(0, this.jitter(light.level)),
      lightBearing,
      lightElevation,
      below,
      altitude: below ? s.p[1] - below.y : Infinity,
      odour: Math.max(0, this.jitter(this.world.odour(s.p))),
      sky: light.sunlit !== undefined,
      landmarks: this.seen,
      shadeBearing: this.shade,
      airflow,
      airflowFrom,
    };
  }

  /**
   * The bearing of the nearest shaded ground point in an eye's field with a
   * clear line to it, on two rings round the fly, or null.
   */
  private lookForShade(s: SenseInput, fwd: V3, lft: V3): number | null {
    for (const ring of SHADE_RINGS) {
      const r = ring * this.params.landingSearchM;
      for (const deg of SHADE_DEG) {
        const a = degToRad(deg);
        const x = s.p[0] + (fwd[0] * Math.cos(a) + lft[0] * Math.sin(a)) * r,
          z = s.p[2] + (fwd[2] * Math.cos(a) + lft[2] * Math.sin(a)) * r;
        const top = this.world.perchAt(x, z, s.p[1]);
        if (!top) continue;
        const at: V3 = [x, top.y + 0.01, z];
        if (this.world.light(at).sunlit !== false) continue;
        const d: V3 = [at[0] - s.p[0], at[1] - s.p[1], at[2] - s.p[2]];
        const dist = Math.hypot(...d);
        if (dist < 1e-3) continue;
        if (!inVisualField(a, Math.asin(Math.max(-1, Math.min(1, d[1] / dist)))))
          continue;
        const hit = this.world.raycast(
          s.p,
          [d[0] / dist, d[1] / dist, d[2] / dist],
          dist,
          true,
        );
        if (hit && hit.t < dist - 0.05) continue;
        return this.jitterAngle(a);
      }
    }
    return null;
  }

  /**
   * The landmarks in an eye's field with a clear line to them (at half their
   * height, or eye level if lower), nearest first.
   */
  private lookForLandmarks(s: SenseInput, fwd: V3, lft: V3): readonly SeenLandmark[] {
    const range = Math.min(this.params.landmarkRangeM, this.params.visualRangeM);
    const all = this.landmarkBuf;
    all.length = 0;
    this.world.landmarks(s.p, range, all);
    const out: SeenLandmark[] = [];
    for (const l of all) {
      const at: V3 = [l.base[0], Math.max(l.base[1] + l.height / 2, s.p[1]), l.base[2]];
      const d: V3 = [at[0] - s.p[0], at[1] - s.p[1], at[2] - s.p[2]];
      const dist = Math.hypot(...d);
      if (dist < 1e-3 || dist > range) continue;
      const bearing = Math.atan2(
        d[0] * lft[0] + d[2] * lft[2],
        d[0] * fwd[0] + d[2] * fwd[2],
      );
      const elevation = Math.asin(Math.max(-1, Math.min(1, d[1] / dist)));
      if (!inVisualField(bearing, elevation)) continue;
      const hit = this.world.raycast(
        s.p,
        [d[0] / dist, d[1] / dist, d[2] / dist],
        dist,
        true,
      );
      // The landmark itself is what a clear line ends on.
      if (hit && hit.t < dist - 0.3 && hit.id !== l.id) continue;
      out.push({
        id: l.id,
        bearing: this.jitterAngle(bearing),
        distance: this.jitter(dist),
      });
    }
    out.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
    return Object.freeze(out.map((x) => Object.freeze(x)));
  }
}
