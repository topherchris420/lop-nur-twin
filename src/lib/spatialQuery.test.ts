import { describe, expect, it } from "vitest";
import {
  footprintDistanceM,
  footprintCentroid,
  cardinalRelation,
  nearestSpatialSubject,
  pointToSegmentDistance,
  polygonsIntersect,
  runSpatialQuery,
  type SpatialQueryResponse,
  type SuccessfulSpatialQuery,
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

function successful(response: SpatialQueryResponse): SuccessfulSpatialQuery {
  if (!response.ok) throw new Error(response.errors.join("; "));
  return response;
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

  it("derives centroids, cardinal relations, and stable nearest ties", () => {
    expect(footprintCentroid(square(10, 20, 4))).toEqual([10, 20]);
    expect(cardinalRelation(square(0, 0, 2), square(0, -10, 2))).toBe("south-of");
    expect(nearestSpatialSubject("rwy-05-23")?.id).toBe("tri-north");
  });

  it("returns structured errors for forged runtime shapes", () => {
    expect(runSpatialQuery("bad" as never)).toMatchObject({ ok: false });
    expect(runSpatialQuery({ kinds: "aircraft" } as never)).toMatchObject({ ok: false });
    expect(
      runSpatialQuery({ includeUnknownHorizontalUncertainty: "yes" } as never),
    ).toMatchObject({ ok: false });
  });
});

describe("spatial query", () => {
  it("filters stable subjects by kind and evidence classification", () => {
    const response = successful(
      runSpatialQuery({
        kinds: ["aircraft"],
        evidenceClasses: ["reported"],
      }),
    );

    expect(response.results.map((result) => result.subject.id)).toEqual([
      "j36-prototype",
      "jxds-prototype",
    ]);
  });

  it("distinguishes direct observation from subjects without it", () => {
    const direct = successful(runSpatialQuery({ sourceSupport: "direct-observation" }));
    const without = successful(
      runSpatialQuery({ sourceSupport: "without-direct-observation" }),
    );

    expect(direct.results.map((result) => result.subject.id)).toEqual(["rwy-05-23"]);
    expect(without.results.some((result) => result.subject.id === "rwy-05-23")).toBe(
      false,
    );
  });

  it("never treats unknown horizontal uncertainty as zero", () => {
    const statedOnly = successful(
      runSpatialQuery({
        maximumStatedHorizontalUncertaintyM: 0,
      }),
    );
    const includingUnknown = successful(
      runSpatialQuery({
        maximumStatedHorizontalUncertaintyM: 0,
        includeUnknownHorizontalUncertainty: true,
      }),
    );

    expect(statedOnly.results).toEqual([]);
    expect(includingUnknown.results.length).toBeGreaterThan(0);
    expect(
      includingUnknown.results.every(
        (result) => result.subject.uncertainty?.horizontalMeters === undefined,
      ),
    ).toBe(true);
  });

  it("keeps established, not-yet-evidenced, and undated presence distinct", () => {
    const established = successful(
      runSpatialQuery({
        snapshotDate: "2021-06-30",
        presence: ["established"],
      }),
    );
    const future = successful(
      runSpatialQuery({
        snapshotDate: "2021-06-30",
        presence: ["not-yet-evidenced"],
      }),
    );
    const undated = successful(
      runSpatialQuery({
        snapshotDate: "2021-06-30",
        presence: ["undated"],
      }),
    );

    expect(established.results.map((result) => result.subject.id)).toEqual(["rwy-05-23"]);
    expect(future.results.some((result) => result.subject.id === "j36-prototype")).toBe(
      true,
    );
    expect(undated.results.some((result) => result.subject.id === "solar-field")).toBe(
      true,
    );
  });

  it("uses footprint proximity, excludes the anchor, and sorts by distance then id", () => {
    const response = successful(
      runSpatialQuery({
        anchorSubjectId: "rwy-05-23",
        maximumDistanceM: 500,
      }),
    );

    expect(response.results.some((result) => result.subject.id === "rwy-05-23")).toBe(
      false,
    );
    expect(response.results.slice(0, 3).map((result) => result.subject.id)).toEqual([
      "tri-north",
      "tri-west",
      "twy-stub",
    ]);
    for (let index = 1; index < response.results.length; index += 1) {
      expect(response.results[index]!.distanceM).toBeGreaterThanOrEqual(
        response.results[index - 1]!.distanceM!,
      );
    }
    expect(response.derivation).toMatch(/modeled footprint distance/i);
    expect(
      response.results.every((result) => result.anchor?.subjectId === "rwy-05-23"),
    ).toBe(true);
    expect(response.results[0]?.anchor?.uncertainty).toBeDefined();
  });

  it("returns structured errors for invalid criteria without coercion", () => {
    const invalid = [
      runSpatialQuery({ kinds: ["invalid" as "structure"] }),
      runSpatialQuery({ evidenceClasses: ["certain" as "observed"] }),
      runSpatialQuery({ sourceSupport: "trusted" as "any" }),
      runSpatialQuery({ maximumDistanceM: -1, anchorSubjectId: "rwy-05-23" }),
      runSpatialQuery({ maximumDistanceM: 10 }),
      runSpatialQuery({ anchorSubjectId: "does-not-exist", maximumDistanceM: 10 }),
      runSpatialQuery({ snapshotDate: "2025-02-30" }),
      runSpatialQuery({ presence: ["missing" as "undated"] }),
      runSpatialQuery({
        maximumStatedHorizontalUncertaintyM: Number.POSITIVE_INFINITY,
      }),
    ];

    expect(invalid.every((response) => !response.ok && response.errors.length > 0)).toBe(
      true,
    );
  });

  it("does not mutate criteria and returns byte-stable ordering", () => {
    const query = Object.freeze({
      kinds: Object.freeze(["structure", "aircraft"] as const),
      evidenceClasses: Object.freeze(["illustrative", "interpreted"] as const),
    });
    const first = successful(runSpatialQuery(query));
    const second = successful(runSpatialQuery(query));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.query).not.toBe(query);
    expect(first.query.kinds).toEqual(["aircraft", "structure"]);
    expect(first.query.evidenceClasses).toEqual(["interpreted", "illustrative"]);
  });
});
