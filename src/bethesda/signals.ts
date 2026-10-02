/**
 * Mast-arm signal rigs derived from mapped signal nodes.
 *
 * OSM puts a traffic-signal node on the carriageway, but Bethesda's signals
 * hang from mast arms reaching over the road from a corner pole (compare the
 * cited Woodmont/Bethesda Avenue photograph). Pole side and arm length are
 * inferred from the mapped road width; head count and spacing are illustrative.
 * The static geometry and the live lamps both read these rigs so they agree.
 */
import { buildingAt, distance, roadWays, signalPoints, type Point } from "./model";

export interface SignalRig {
  /** Index into `signalPoints`. */
  index: number;
  pole: Point;
  /** Heading of the arm, from pole toward the road centre. */
  angle: number;
  length: number;
  heads: Point[];
}
function wayAt(p: Point) {
  let best: { a: Point; b: Point; width: number } | undefined,
    d = Infinity;
  for (const w of roadWays)
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!,
        b = w.points[i]!;
      const q = Math.min(distance(a, p), distance(b, p));
      if (q < d) {
        d = q;
        best = { a, b, width: w.width };
      }
    }
  return best;
}
export const signalRigs: SignalRig[] = signalPoints.map((s, index) => {
  const way = wayAt(s.point);
  const length = way ? way.width / 2 + 1.4 : 5;
  const dx = way ? way.b.x - way.a.x : 1,
    dz = way ? way.b.z - way.a.z : 0,
    n = Math.hypot(dx, dz) || 1;
  // The perpendicular side that is not inside a footprint.
  let px = -dz / n,
    pz = dx / n;
  if (buildingAt({ x: s.point.x + px * length, z: s.point.z + pz * length })) {
    px = -px;
    pz = -pz;
  }
  const pole = { x: s.point.x + px * length, z: s.point.z + pz * length };
  const heads = [0.35, 0.7].map((t) => ({
    x: pole.x - px * length * t,
    z: pole.z - pz * length * t,
  }));
  return { index, pole, angle: Math.atan2(-px, -pz), length, heads };
});
