/**
 * The shared sensory model: what of one fly may reach another.
 *
 * Only what a real fly could see of another crosses: a body of a fly's size
 * at a place. The receiving fly's own eyes (senses.ts) turn it into an
 * angular size, an expansion rate and a bearing, with its own acuity, field
 * of view, occlusion by its own world's geometry, sensory noise and visual
 * latency, exactly as they treat any moving thing. Nothing about the sender
 * crosses: not its identity, mode, velocity, heading, controller, memories,
 * self-model or state, and not the receiver's own position. `percept` refuses
 * any field but the two below, as `fly_neural/sensory.py` refuses anything
 * the fly could not sense.
 *
 * The body is approximated as a sphere whose diameter is FlyBody's measured
 * body length (`SKELETON.measures.bodyLengthCm`): an engineering
 * approximation that ignores the wings' extent, the body's elongation and
 * any wingbeat flicker a real eye would see. It is named as such wherever it
 * is reported.
 */
import { SKELETON } from "../fly/skeleton.js";
import type { V3 } from "../fly/units.js";

/** Equivalent-sphere radius of a fly (m): half FlyBody's measured body length. */
export const FLY_EQUIVALENT_RADIUS_M = SKELETON.measures.bodyLengthCm / 100 / 2;

export const PERCEPT_APPROXIMATIONS = Object.freeze([
  "the other fly is seen as a sphere whose diameter is FlyBody's measured body length (no wings, no elongation, no wingbeat flicker)",
  "the other fly is seen, never touched: like every moving thing in a world (world.ts), it casts no contact, wind or odour",
  "it reaches the receiver only through the receiver's own eyes, which compute its angular size, expansion and bearing",
]);

/** The only thing that crosses the bridge. */
export interface ForeignPercept {
  /** Where the other fly's body is, in the receiver's world frame (m). */
  center: V3;
  /** Its equivalent-sphere radius (m). */
  radius: number;
}

const ALLOWED = new Set(["center", "radius"]);

/** Checks a percept, refusing every field a fly could not see. */
export function percept(raw: unknown): ForeignPercept {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("percept: not an object");
  for (const key of Object.keys(raw))
    if (!ALLOWED.has(key))
      throw new Error(`percept: ${key} is not something one fly can see of another`);
  const { center, radius } = raw as Record<string, unknown>;
  if (
    !Array.isArray(center) ||
    center.length !== 3 ||
    !center.every((v) => typeof v === "number" && Number.isFinite(v))
  )
    throw new Error("percept: center is not a finite 3-vector");
  if (typeof radius !== "number" || !(radius > 0 && radius < 0.05))
    throw new Error("percept: radius must be a fly's size (0 to 5 cm)");
  return { center: [center[0], center[1], center[2]] as V3, radius };
}
