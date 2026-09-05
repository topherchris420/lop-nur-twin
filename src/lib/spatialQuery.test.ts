import { describe, expect, it } from "vitest";
import {
  footprintDistanceM,
  pointToSegmentDistance,
  polygonsIntersect,
  type LocalRing,
} from "./spatialQuery";

function square(centerX: number, centerZ: number, size: number): LocalRing {
  const half = size / 2;
  return [
    [centerX - half, centerZ - half],
    [centerX + half, centerZ - half],
    [centerX + half, centerZ + half],
    [centerX - half, centerZ + half],
    [centerX - half, centerZ - half],
  ];
}

describe("spatial geometry primitives", () => {
  it("returns zero for touching, overlapping, and contained footprints", () => {
    expect(footprintDistanceM(square(0, 0, 10), square(10, 0, 10))).toBe(0);
    expect(footprintDistanceM(square(0, 0, 10), square(4, 0, 2))).toBe(0);
  });

  it("uses edge distance rather than center distance", () => {
    expect(footprintDistanceM(square(0, 0, 10), square(20, 0, 10))).toBeCloseTo(10);
  });

  it("treats boundary contact and overlap as polygon intersection", () => {
    expect(polygonsIntersect(square(0, 0, 10), square(10, 0, 10))).toBe(true);
    expect(polygonsIntersect(square(0, 0, 10), square(30, 0, 10))).toBe(false);
  });

  it("handles zero-length segments without NaN", () => {
    expect(pointToSegmentDistance([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it("rejects rings with fewer than four unique vertices", () => {
    const closedTriangle: LocalRing = [
      [0, 0],
      [10, 0],
      [0, 10],
      [0, 0],
    ];

    expect(() => polygonsIntersect(closedTriangle, square(0, 0, 10))).toThrow(
      /at least four vertices/,
    );
    expect(() => footprintDistanceM(closedTriangle, square(0, 0, 10))).toThrow(
      /at least four vertices/,
    );
  });
});
