import { Color, MathUtils } from "three";
import { SITE_SEED, seededNoise2D } from "@/lib/noise";
import { gravelField, mottle, wadiMask } from "@/lib/terrain";

const pigment = seededNoise2D(SITE_SEED + 49);
// Lop Nur is a grey-khaki salt crust, not dune sand: the palette sits close
// to neutral so the warm sun and grade land it on pale khaki, and bladed
// ground stays a step darker than concrete so the two never converge.
const sand = new Color("#a69f90");
const gravel = new Color("#66615a");
const silt = new Color("#8f8070");
const salt = new Color("#dedbd2");
const wash = new Color("#847869");
const graded = new Color("#a8a194");
export const PLAIN_COLOR = new Color("#a49c8c");

/** Illustrative sediment colour in world metres. Ancient shore marks occupy
 * a narrow range of heights; a fold in the basin bends all three together.
 * The sample only shades the surface. The heightfield still owns its shape. */
export function lakebedColor(
  out: Color,
  x: number,
  z: number,
  height: number,
  flat: number,
) {
  const grain = mottle(x, z);
  const stones = gravelField(x, z);
  const channel = wadiMask(x, z);
  const fold = pigment((x + 0.34 * z) / 1650, (z - 0.34 * x) / 920);
  const drift = pigment((x - z * 0.44) / 430, (z + x * 0.44) / 83);
  const level = height * 0.29 + fold * 0.74 + grain * 0.045;
  const low = 1 - MathUtils.smoothstep(level, -0.7, 0.14);
  const shoreline = Math.min(
    Math.abs(level + 0.47),
    Math.abs(level + 0.07),
    Math.abs(level - 0.4),
  );
  const crust =
    (1 - MathUtils.smoothstep(shoreline, 0.025, 0.13)) * (0.72 + drift * 0.28);

  out.copy(sand).lerp(silt, 0.18 + 0.25 * MathUtils.smoothstep(level, 0, 0.85));
  out.lerp(gravel, Math.min(0.85, stones * 0.81 + (1 - low) * 0.1));
  out.multiplyScalar(0.94 + 0.19 * grain + 0.08 * drift);
  out.lerp(salt, (low * 0.39 + crust * 0.44) * (1 - stones * 0.85));
  out.lerp(wash, channel * 0.45);
  return out.lerp(graded, (1 - flat) * 0.81);
}
