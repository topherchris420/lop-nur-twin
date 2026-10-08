import { describe, expect, it } from "vitest";
import { damageArcRotation } from "./damageDirection";

/**
 * The heading `core/combat.ts` records for a hit: atan2(x, z) of the round's
 * travel, from the shooter at (sx, sz) to the player at the origin.
 */
function travelFrom(sx: number, sz: number): number {
  return Math.atan2(-sx, -sz);
}

/** Wrap to (-PI, PI] so a rotation of PI and -PI compare equal. */
function wrap(a: number): number {
  let d = a % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

// +x east, +z south: facing north is forward (0, -1).
const NORTH = [0, -1] as const;
const EAST = [1, 0] as const;

describe("damage arc direction", () => {
  it("points up at a shooter straight ahead, not down", () => {
    expect(damageArcRotation(travelFrom(0, -30), ...NORTH)).toBeCloseTo(0, 9);
  });

  it("points down at a shooter straight behind", () => {
    expect(Math.abs(wrap(damageArcRotation(travelFrom(0, 30), ...NORTH)))).toBeCloseTo(
      Math.PI,
      9,
    );
  });

  it("points right at a shooter on the right and left at one on the left", () => {
    expect(damageArcRotation(travelFrom(30, 0), ...NORTH)).toBeCloseTo(Math.PI / 2, 9);
    expect(damageArcRotation(travelFrom(-30, 0), ...NORTH)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("is relative to where the camera faces, not to north", () => {
    // Facing east, a shooter to the north is on the left, one ahead is ahead.
    expect(damageArcRotation(travelFrom(0, -30), ...EAST)).toBeCloseTo(-Math.PI / 2, 9);
    expect(damageArcRotation(travelFrom(30, 0), ...EAST)).toBeCloseTo(0, 9);
    expect(damageArcRotation(travelFrom(0, 30), ...EAST)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("agrees with a direct bearing at arbitrary headings", () => {
    for (let i = 0; i < 64; i += 1) {
      const camYaw = i * 0.37;
      const shooterYaw = i * 1.13 + 0.2;
      const f = [Math.sin(camYaw), Math.cos(camYaw)] as const;
      const s = [Math.sin(shooterYaw) * 25, Math.cos(shooterYaw) * 25] as const;
      // Clockwise from forward on screen: right = (-fz, fx) in x/z.
      const ahead = s[0] * f[0] + s[1] * f[1];
      const right = s[0] * -f[1] + s[1] * f[0];
      const expected = Math.atan2(right, ahead);
      expect(
        wrap(damageArcRotation(travelFrom(s[0], s[1]), f[0], f[1]) - expected),
      ).toBeCloseTo(0, 9);
    }
  });
});
