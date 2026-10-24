/**
 * The stimuli the calibration paradigms show the fly, as movers of an arena
 * (`arena.ts`): seen through the fly's own senses, never touched.
 *
 * A looming stimulus in the published experiments is a dark disk on a screen
 * whose angular size grows as an object of half-size l approaching at speed v
 * would: θ(τ) = 2·atan(l / (v·τ)), τ the time left to collision. The fly's
 * senses see every mover as a sphere (θ = 2·asin(r/d)), so a sphere of radius
 * l moving at constant speed would grow faster than the disk at large sizes.
 * Here the sphere is put at the distance at which it subtends the disk's
 * angle, d(τ) = √(l² + v²τ²), along the stimulus's line of approach: the fly
 * sees exactly the published time course of size and expansion. The stimulus
 * stops growing at `endDeg` (held there for `holdS`) and is not shown before
 * it reaches `startDeg`.
 */
import type { V3 } from "../units.js";
import type {
  FlyWorld,
  FoodPatch,
  Hit,
  Landmark,
  LandingSite,
  LightSample,
  Mover,
  Perch,
} from "../world.js";

export interface Loom {
  id: string;
  /** Half-size l (m) and approach speed v (m/s): l/v in seconds is their ratio. */
  halfSizeM: number;
  speedMS: number;
  /** When it would reach the fly (s, fly time). */
  collisionT: number;
  /** Where it would hit: the fly's position when the stimulus was aimed. */
  target: V3;
  /** Unit direction from the target toward where the stimulus comes from. */
  from: V3;
  startDeg: number;
  endDeg: number;
  holdS: number;
}

/** The angular size (deg) of a loom τ seconds before collision. */
export function loomSizeDeg(l: Loom, tau: number): number {
  if (tau <= 0) return 180;
  return (2 * Math.atan(l.halfSizeM / (l.speedMS * tau)) * 180) / Math.PI;
}

/** τ (s) at which the loom subtends `deg`. */
export function loomTauAt(l: Loom, deg: number): number {
  return l.halfSizeM / (l.speedMS * Math.tan((deg * Math.PI) / 360));
}

/** When the loom appears, stops growing and disappears (fly time, s). */
export function loomWindow(l: Loom): { start: number; stop: number; end: number } {
  const start = l.collisionT - loomTauAt(l, l.startDeg);
  const stop = l.collisionT - loomTauAt(l, l.endDeg);
  return { start, stop, end: stop + l.holdS };
}

/** The angular size (deg) the loom shows at fly time `t`, held at its end size once it stops; null when not showing. */
export function loomSizeAt(l: Loom, t: number): number | null {
  const w = loomWindow(l);
  if (t < w.start || t > w.end) return null;
  return loomSizeDeg(l, l.collisionT - Math.min(t, w.stop));
}

/** The loom's sphere at fly time `t`, or null when it is not showing. */
export function loomSphere(l: Loom, t: number): Mover | null {
  const w = loomWindow(l);
  if (t < w.start || t > w.end) return null;
  const tau = Math.max(l.collisionT - Math.min(t, w.stop), 0);
  const d = Math.hypot(l.halfSizeM, l.speedMS * tau);
  return {
    id: l.id,
    kind: "stimulus",
    center: [
      l.target[0] + l.from[0] * d,
      l.target[1] + l.from[1] * d,
      l.target[2] + l.from[2] * d,
    ],
    radius: l.halfSizeM,
  };
}

/** A world with stimuli added to its movers; everything else is the inner world's. */
export class StimulusWorld implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: FlyWorld["inputs"];
  readonly looms: Loom[] = [];
  private inner: FlyWorld;
  constructor(inner: FlyWorld) {
    this.inner = inner;
    this.id = inner.id;
    this.home = inner.home;
    this.inputs = inner.inputs;
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.inner.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.inner.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.inner.solid(p);
  }
  light(p: V3): LightSample {
    return this.inner.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.inner.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.inner.foodAt(p);
  }
  odour(p: V3): number {
    return this.inner.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.inner.landmarks(near, radius, out);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.inner.movers(near, radius, out, t);
    for (const l of this.looms) {
      const m = loomSphere(l, t);
      if (!m) continue;
      const c = m.center;
      if (Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) <= radius + m.radius)
        out.push(m);
    }
  }
}
