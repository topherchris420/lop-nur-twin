import type { HitRegion } from "../core/types.js";

/**
 * The hit regions, stacked so that **consecutive boxes overlap**.
 *
 * Sized from the fractions of standing height a body actually occupies, then
 * deliberately grown until each box's top reaches past the next one's bottom.
 * Boxes that merely touch leave a seam at every joint — hips, ankles, the base
 * of the neck — and a round through a seam registers as world geometry, so a
 * centre-mass shot silently does nothing. Overlaps cost nothing: the raycast
 * returns the nearest hit, so the more specific box in front always wins.
 *
 * This is the one definition. `CharacterManager` builds every actor's colliders
 * from it, and the pilot's aim-point geometry (`pilot/hitGeometry.ts`) reads it
 * to know where a region *is* — it never builds, resizes or moves a collider.
 * It is a plain module with no runtime imports so the Vercel function can read
 * the same numbers when it describes a target's size to Jev.
 */

export interface RegionSpec {
  region: HitRegion;
  /** Fraction of stance height at the box centre. */
  centre: number;
  /** Half extents in metres. Not scaled by stance; only the centre moves. */
  half: readonly [number, number, number];
}

export const REGION_SPECS: readonly RegionSpec[] = [
  { region: "head", centre: 0.94, half: [0.145, 0.16, 0.15] },
  { region: "neck", centre: 0.862, half: [0.11, 0.08, 0.11] },
  { region: "chest", centre: 0.755, half: [0.26, 0.19, 0.18] },
  { region: "stomach", centre: 0.6, half: [0.24, 0.175, 0.165] },
  { region: "arm", centre: 0.73, half: [0.34, 0.2, 0.14] },
  { region: "leg", centre: 0.34, half: [0.22, 0.36, 0.16] },
  { region: "foot", centre: 0.085, half: [0.22, 0.16, 0.2] },
];
