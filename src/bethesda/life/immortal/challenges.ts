/** Procedural research worlds use the existing yard geometry and sensory path.
 * All changes are experimenter inputs; no schedule or labels reach a controller. */
import { mulberry32 } from "../../../lib/noise.js";
import { FoodYard, yardSpec, type FoodNow } from "../individuality.js";
import {
  PrimitiveWorld,
  type Hit,
  type Perch,
  type LandingSite,
  type Landmark,
  type LightSample,
} from "../../fly/world.js";
import type { V3 } from "../../fly/units.js";

export interface Challenge {
  layout: number;
  light: number;
  windMS: number;
  windPhase: number;
}
export const QUIET_CHALLENGE: Readonly<Challenge> = {
  layout: 0,
  light: 1,
  windMS: 0,
  windPhase: 0,
};
export function validateChallenge(c: Challenge): void {
  if (
    !c ||
    !Number.isInteger(c.layout) ||
    c.layout < 0 ||
    c.layout > 8 ||
    !Number.isFinite(c.light) ||
    c.light < 0.1 ||
    c.light > 2 ||
    !Number.isFinite(c.windMS) ||
    c.windMS < 0 ||
    c.windMS > 0.5 ||
    !Number.isFinite(c.windPhase) ||
    Math.abs(c.windPhase) > Math.PI * 2
  )
    throw new Error("invalid research challenge");
}
/** Development and evaluation domains never overlap in layout or wind/light ranges. */
export function proceduralChallenge(
  seed: number,
  domain: "development" | "held-out",
): Challenge {
  const u = mulberry32(seed);
  return domain === "development"
    ? {
        layout: 1 + Math.floor(u() * 3),
        light: 0.7 + 0.3 * u(),
        windMS: 0.04 * u(),
        windPhase: u() * Math.PI,
      }
    : {
        layout: 4 + Math.floor(u() * 4),
        light: 0.2 + 0.3 * u(),
        windMS: 0.06 + 0.08 * u(),
        windPhase: Math.PI + u() * Math.PI,
      };
}

export class ChallengeYard extends FoodYard {
  challenge: Challenge = { ...QUIET_CHALLENGE };
  private geometry = new PrimitiveWorld(yardSpec(null));
  configure(challenge: Challenge): void {
    validateChallenge(challenge);
    this.challenge = { ...challenge };
    this.rebuild();
  }
  override place(food: FoodNow | null): void {
    super.place(food);
    this.rebuild();
  }
  private rebuild(): void {
    const spec = yardSpec(this.food),
      n = this.challenge.layout;
    // Distinct, off-centre obstacles. Their positions are model choices in a research yard.
    for (let i = 0; i < n; i++) {
      const angle = ((i + 0.35) * 2 * Math.PI) / Math.max(1, n);
      spec.cylinders!.push({
        kind: "pole",
        id: `challenge-${i}`,
        x: 2.5 * Math.cos(angle),
        z: 2.5 * Math.sin(angle),
        r: 0.15,
        y0: 0,
        y1: 1.2,
      });
    }
    this.geometry = new PrimitiveWorld(spec);
  }
  override perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.geometry.perchAt(x, z, maxY);
  }
  override raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.geometry.raycast(origin, dir, maxT, visible);
  }
  override solid(p: V3): boolean {
    return this.geometry.solid(p);
  }
  override landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.geometry.landingSites(near, radius, out);
  }
  override landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.geometry.landmarks(near, radius, out);
  }
  override light(p: V3): LightSample {
    const light = this.geometry.light(p);
    return { ...light, level: light.level * this.challenge.light };
  }
  wind(_p: V3, t: number): V3 {
    const c = this.challenge;
    return [
      c.windMS * Math.sin(t / 17 + c.windPhase),
      0,
      c.windMS * Math.cos(t / 23 + c.windPhase),
    ];
  }
}
