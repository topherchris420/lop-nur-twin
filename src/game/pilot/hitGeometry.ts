import { HUMAN_METRICS, type Stance } from "../core/types.js";
import { REGION_SPECS, type RegionSpec } from "../characters/hitboxSpecs.js";
import type { AimAction } from "./contract.js";

/**
 * Where an aim region is on a body, how big it looks, and how much of a
 * weapon's spread cone would fall on it.
 *
 * Everything here is *read* from the hitbox definition the colliders are built
 * from (`characters/hitboxSpecs.ts`); nothing here can make a box bigger. The
 * numbers serve three readers that must agree: the precision motor controller
 * (where to hold the crosshair), its fire gate (whether a round has a fair
 * chance), and the server's description of each enemy to Jev (how large it
 * looks against the current spread). The gate's estimate is an estimate — a
 * round the gate lets through is still resolved by the weapon runtime's real
 * spread draw and the collision world's real raycast.
 *
 * Shared with the Vercel function, so it imports siblings as `./x.js`.
 */

function spec(region: RegionSpec["region"]): RegionSpec {
  return REGION_SPECS.find((s) => s.region === region)!;
}

const HEAD = spec("head");
const CHEST = spec("chest");
const STOMACH = spec("stomach");

export interface AimRegionGeometry {
  /** Height of the aim point above the feet, metres. */
  heightM: number;
  /**
   * Radius of a disc around the aim point that lies inside the body's
   * hitboxes, metres. Conservative: a disc, not the boxes' full outline.
   */
  radiusM: number;
}

/** The aim point for a region on a body in a given stance. */
export function aimRegionGeometry(aim: AimAction, stance: Stance): AimRegionGeometry {
  const h = HUMAN_METRICS.colliderHeight[stance];
  const chestTop = CHEST.centre * h + CHEST.half[1];
  const chestMid = CHEST.centre * h;
  const stomachBottom = STOMACH.centre * h - STOMACH.half[1];
  switch (aim) {
    case "HEAD":
      return {
        heightM: HEAD.centre * h,
        radiusM: Math.min(HEAD.half[0], HEAD.half[1]),
      };
    case "UPPER_CHEST": {
      // A third of the way from the chest's centre to its top: above it is the
      // neck, which is also a hit, so the disc is limited by the chest's width
      // and by the distance down to the chest's centre line.
      const height = chestMid + CHEST.half[1] * 0.35;
      return {
        heightM: height,
        radiusM: Math.min(CHEST.half[0], CHEST.half[1] * 0.95),
      };
    }
    case "CENTER_MASS":
    default: {
      const height = (chestTop + stomachBottom) / 2;
      return {
        heightM: height,
        radiusM: Math.min(STOMACH.half[0], (chestTop - stomachBottom) / 2),
      };
    }
  }
}

/** Angular radius, degrees, of a disc of `radiusM` seen from `distanceM`. */
export function angularRadiusDeg(radiusM: number, distanceM: number): number {
  return (Math.atan2(radiusM, Math.max(0.05, distanceM)) * 180) / Math.PI;
}

/** Area of the intersection of two discs with radii `a`, `b` and centres `d` apart. */
function lensArea(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) {
    const r = Math.min(a, b);
    return Math.PI * r * r;
  }
  const a2 = a * a;
  const b2 = b * b;
  const alpha = Math.acos((d * d + a2 - b2) / (2 * d * a));
  const beta = Math.acos((d * d + b2 - a2) / (2 * d * b));
  return (
    a2 * alpha +
    b2 * beta -
    0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)))
  );
}

/**
 * Fraction of a round's possible directions that fall on a disc target.
 *
 * `WeaponRuntime.fireOne` draws a single round uniformly over a disc of the
 * spread's radius around the aim direction (`radius = sqrt(rand)`), so the
 * chance a round lands inside a target disc is the overlap of the two discs
 * over the spread disc's area — the small-angle geometry of the real draw, not
 * a tuned curve. With no spread it is 1 when the error is inside the target and
 * 0 when it is not.
 */
export function coneHitFraction(
  errorDeg: number,
  spreadDeg: number,
  targetRadiusDeg: number,
): number {
  const e = Math.abs(errorDeg);
  const r = Math.max(0, targetRadiusDeg);
  const s = Math.max(0, spreadDeg);
  if (s < 1e-4) return e <= r ? 1 : 0;
  return Math.min(1, lensArea(s, r, e) / (Math.PI * s * s));
}

/** A plain-language band for a fraction, for the question Jev reads. */
export function chanceBand(
  fraction: number,
): "very likely" | "likely" | "possible" | "unlikely" {
  if (fraction >= 0.8) return "very likely";
  if (fraction >= 0.45) return "likely";
  if (fraction >= 0.15) return "possible";
  return "unlikely";
}
