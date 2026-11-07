/**
 * Stimuli for the research eye's looming battery: spheres moving along
 * straight constant-speed segments past a fly perched at the centre of an
 * arena, with a contrast against the arena's walls.
 *
 * The vocabulary follows the earlier threat battery
 * (`fly-neural/fly_neural/threat.py`), re-implemented here, and adds a
 * glancing hit. Ground truth comes from the kinematics alone, never from
 * what any readout sees: a threat is a stimulus whose surface comes within
 * `COLLISION_MARGIN_M` of the fly; a harmless one keeps its surface at least
 * `HARMLESS_MIN_SURFACE_M` away; a design with anything in between is refused.
 */
import { arenaWorld } from "../fly/arena.js";
import type { V3 } from "../fly/units.js";
import type {
  FlyWorld,
  FoodPatch,
  Hit,
  Home,
  Landmark,
  LandingSite,
  LightSample,
  Mover,
  Perch,
  WorldInputs,
} from "../fly/world.js";
import { REFERENCE_REFLECTANCE, type VisionScene } from "./scene.js";

export const COLLISION_MARGIN_M = 0.01;
export const HARMLESS_MIN_SURFACE_M = 0.05;

export type StimulusKind =
  | "approach"
  | "accelerating"
  | "glancing"
  | "recede"
  | "stationary"
  | "approach_stop"
  | "lateral"
  | "zigzag"
  | "near_miss";

export interface StimulusSpec {
  kind: StimulusKind;
  /** Sphere radius (m). */
  radius: number;
  /** Weber contrast against the walls' mean reflectance: −0.9 dark … +1 bright; 0 is isoluminant. */
  contrast: number;
  /** Direction from the fly (deg; azimuth + to its left, elevation up). */
  azimuth_deg: number;
  elevation_deg: number;
  speed?: number;
  speed2?: number;
  distance?: number;
  duration_s?: number;
  stop_surface?: number;
  hold_s?: number;
  miss?: number;
  half_length?: number;
}

export interface Segment {
  t0: number;
  from: V3;
  to: V3;
  dur: number;
}

/** World direction at azimuth (+ to the fly's left) and elevation for a fly at heading `yaw`. */
export function direction(azDeg: number, elDeg: number, yaw: number): V3 {
  const a = (azDeg * Math.PI) / 180 + yaw,
    e = (elDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), -Math.cos(e) * Math.sin(a)];
}

const add = (p: V3, d: V3, k: number): V3 => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
];
const req = (s: StimulusSpec, key: keyof StimulusSpec): number => {
  const v = s[key];
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error(`a ${s.kind} stimulus needs a finite ${key}`);
  return v;
};

/** A stimulus as straight constant-speed legs (from, to, speed), for a fly at `p` facing `yaw`. */
export function legs(s: StimulusSpec, p: V3, yaw: number): [V3, V3, number][] {
  const d = direction(s.azimuth_deg, s.elevation_deg, yaw);
  const r = s.radius;
  // On the line of approach, its surface 5 mm into the fly.
  const end = add(p, d, Math.max(0, r - 0.005));
  // Horizontal, perpendicular to the line of approach.
  const az = (s.azimuth_deg * Math.PI) / 180 + yaw;
  const q: V3 = [Math.sin(az), 0, Math.cos(az)];
  switch (s.kind) {
    case "approach":
      return [[add(p, d, req(s, "distance")), end, req(s, "speed")]];
    case "accelerating": {
      const D = req(s, "distance");
      return [
        [add(p, d, D), add(p, d, D / 2), req(s, "speed")],
        [add(p, d, D / 2), end, req(s, "speed2")],
      ];
    }
    case "glancing": {
      // Its centre passes `miss` beside the fly, less than its radius: it still strikes.
      const off = req(s, "miss");
      if (off >= r) throw new Error("a glancing stimulus passes within its own radius");
      return [
        [
          add(add(p, d, req(s, "distance")), q, off),
          add(add(p, d, -0.3), q, off),
          req(s, "speed"),
        ],
      ];
    }
    case "recede":
      return [[add(p, d, r + 0.08), add(p, d, req(s, "distance")), req(s, "speed")]];
    case "stationary": {
      const a = add(p, d, req(s, "distance"));
      return [[a, [a[0] + 0.001, a[1], a[2]], 0.001 / req(s, "duration_s")]];
    }
    case "approach_stop": {
      const a = add(p, d, req(s, "distance")),
        stop = add(p, d, r + req(s, "stop_surface"));
      return [
        [a, stop, req(s, "speed")],
        [stop, [stop[0] + 0.001, stop[1], stop[2]], 0.001 / req(s, "hold_s")],
      ];
    }
    case "lateral": {
      const c = add(p, d, req(s, "miss")),
        L = req(s, "half_length");
      return [[add(c, q, -L), add(c, q, L), req(s, "speed")]];
    }
    case "zigzag": {
      const c = add(p, d, req(s, "miss")),
        L = req(s, "half_length");
      return [
        [add(c, q, -L), add(c, q, 0.5 * L), req(s, "speed")],
        [add(c, q, 0.5 * L), add(c, q, -0.5 * L), req(s, "speed")],
      ];
    }
    case "near_miss": {
      const off = req(s, "miss");
      return [
        [
          add(add(p, d, req(s, "distance")), q, off),
          add(add(p, d, -0.3), q, off),
          req(s, "speed"),
        ],
      ];
    }
  }
}

/** The legs as timed segments starting at `t0`. */
export function segments(s: StimulusSpec, p: V3, yaw: number, t0: number): Segment[] {
  const out: Segment[] = [];
  let t = t0;
  for (const [from, to, v] of legs(s, p, yaw)) {
    if (!(v > 0)) throw new Error("a stimulus moves at a positive speed");
    const dur = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / v;
    out.push({ t0: t, from, to, dur });
    t += dur;
  }
  return out;
}

/** Where the stimulus is at `t`, or null before it appears or after its last segment ends. */
export function positionAt(segs: readonly Segment[], t: number): V3 | null {
  if (!segs.length || t < segs[0]!.t0) return null;
  for (const g of segs) {
    if (t <= g.t0 + g.dur) {
      const u = g.dur <= 0 ? 1 : (t - g.t0) / g.dur;
      return add(
        g.from,
        [g.to[0] - g.from[0], g.to[1] - g.from[1], g.to[2] - g.from[2]],
        u,
      );
    }
  }
  return null;
}

export interface GroundTruth {
  threat: boolean;
  /** First time the surface is within the collision margin (threats only). */
  tCollision: number | null;
  tOn: number;
  tOff: number;
  minSurfaceM: number;
}

/** Ground truth from the kinematics on a 1 ms grid; refuses a stimulus in the excluded band. */
export function groundTruth(
  s: StimulusSpec,
  segs: readonly Segment[],
  p: V3,
): GroundTruth {
  const tOn = segs[0]!.t0;
  const last = segs[segs.length - 1]!;
  const tOff = last.t0 + last.dur;
  let min = Infinity,
    tCollision: number | null = null;
  const steps = Math.ceil((tOff - tOn) / 0.001);
  for (let k = 0; k <= steps; k++) {
    const t = Math.min(tOff, tOn + k * 0.001);
    const c = positionAt(segs, t)!;
    const surf = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) - s.radius;
    if (surf < min) min = surf;
    if (tCollision === null && surf <= COLLISION_MARGIN_M) tCollision = t;
  }
  const threat = tCollision !== null;
  if (!threat && min < HARMLESS_MIN_SURFACE_M)
    throw new Error(
      `a ${s.kind} stimulus is neither a threat nor harmless: closest surface ${min.toFixed(3)} m`,
    );
  return { threat, tCollision, tOn, tOff, minSurfaceM: min };
}

/** One stimulus shown in an arena. */
export interface StimulusTrial {
  spec: StimulusSpec;
  segments: Segment[];
  truth: GroundTruth;
}

/**
 * A world with one moving stimulus beside a static arena: every question but
 * `movers` is the arena's. The stimulus is seen, never touched, like every
 * mover; it stops being shown when its last segment ends (collision included:
 * it reaches the fly's surface and vanishes, as the earlier battery did).
 */
export class StimulusWorld implements FlyWorld, VisionScene {
  readonly id: string;
  readonly home: Home;
  readonly inputs: WorldInputs;
  readonly world: FlyWorld = this;
  readonly textureSeed: number;
  private readonly base: FlyWorld;
  private readonly trial: StimulusTrial;
  private readonly reflectance: number;
  constructor(base: FlyWorld, trial: StimulusTrial, textureSeed: number) {
    this.base = base;
    this.trial = trial;
    this.id = `${base.id}+stimulus`;
    this.home = base.home;
    this.inputs = base.inputs;
    this.textureSeed = textureSeed;
    this.reflectance = Math.max(0, REFERENCE_REFLECTANCE * (1 + trial.spec.contrast));
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.base.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.base.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.base.solid(p);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.base.movers(near, radius, out, t);
    const c = positionAt(this.trial.segments, t);
    if (!c) return;
    const r = this.trial.spec.radius;
    if (Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) > radius + r) return;
    out.push({ id: "stimulus", kind: "stimulus", center: c, radius: r });
  }
  moverReflectance(m: Mover): number {
    return m.id === "stimulus" ? this.reflectance : REFERENCE_REFLECTANCE;
  }
  light(p: V3): LightSample {
    return this.base.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.base.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.base.foodAt(p);
  }
  odour(p: V3): number {
    return this.base.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.base.landmarks(near, radius, out);
  }
}

/** The battery's arena: 8 × 4 × 8 m, as the earlier battery's, at a given ambient light. */
export function batteryArena(ambient: number): FlyWorld {
  return arenaWorld({ size: [8, 4, 8], ambient }, "research-vision-arena");
}
