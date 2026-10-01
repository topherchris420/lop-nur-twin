/** Shared vertical placement from the attributed, offline bare-earth DTM crop. */
import grid from "./data/terrain.json" with { type: "json" };
import source from "./data/terrain-source.json" with { type: "json" };
import { geographic, type Point } from "./model";
export const TERRAIN_SOURCE = source;
export const TERRAIN_VERSION = source.snapshotSha256;
// A documented rendering datum, not a measured elevation at the local origin.
export const VERTICAL_OFFSET = 100;
export function elevationAt(p: Point): number {
  const { lat, lon } = geographic(p);
  const x = Math.max(
    0,
    Math.min(
      grid.width - 1,
      ((lon - grid.bbox[0]!) / (grid.bbox[2]! - grid.bbox[0]!)) * grid.width - 0.5,
    ),
  );
  const z = Math.max(
    0,
    Math.min(
      grid.height - 1,
      ((grid.bbox[3]! - lat) / (grid.bbox[3]! - grid.bbox[1]!)) * grid.height - 0.5,
    ),
  );
  const ix = Math.floor(x),
    iz = Math.floor(z),
    u = x - ix,
    v = z - iz;
  const sample = (a: number, b: number) =>
    grid.elevations[
      Math.min(grid.height - 1, b) * grid.width + Math.min(grid.width - 1, a)
    ]!;
  return (
    (sample(ix, iz) * (1 - u) + sample(ix + 1, iz) * u) * (1 - v) +
    (sample(ix, iz + 1) * (1 - u) + sample(ix + 1, iz + 1) * u) * v
  );
}
export const groundAt = (p: Point) => elevationAt(p) - VERTICAL_OFFSET;
export const minimumGround = Math.min(...grid.elevations) - VERTICAL_OFFSET;
