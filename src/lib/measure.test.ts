import { describe, expect, it } from "vitest";
import {
  SNAP_TARGETS,
  bearingCardinal,
  distanceM,
  formatBearingDeg,
  formatDistanceM,
  gridBearingDeg,
  gridEastingNorthing,
  measurementSummary,
  pathTotalM,
  positionalStatement,
  snapWorldPoint,
  straightLineM,
  type MeasurePoint,
} from "./measure";
import {
  GRID_EASTING_ORIGIN,
  GRID_NORTHING_ORIGIN,
  RUNWAYS,
  RUNWAY_CENTER,
  SITE_SIZE,
  getStructure,
  segmentLength,
} from "./layout";
import { SITE_PROFILE } from "./siteData";

const point = (x: number, z: number, snappedTo: string | null = null): MeasurePoint => ({
  x,
  z,
  snappedTo,
});

/**
 * The measurement system is where the project's coordinate convention becomes a
 * published number, so these tests pin the convention itself rather than the
 * arithmetic. The convention is: `+x` east, `+z` south (north is `-z`), grid
 * bearings measured clockwise from grid north. Getting the sign of `z` wrong
 * produces bearings that are individually plausible and collectively mirrored,
 * which is the failure mode a screenshot cannot catch.
 */

describe("gridEastingNorthing", () => {
  it("maps the local origin onto the registered grid origin", () => {
    expect(gridEastingNorthing(0, 0)).toEqual({
      easting: GRID_EASTING_ORIGIN,
      northing: GRID_NORTHING_ORIGIN,
    });
  });

  it("puts the runway centre on the published EPSG:32645 reference", () => {
    const grid = gridEastingNorthing(RUNWAY_CENTER[0], RUNWAY_CENTER[1]);
    expect(grid.easting).toBeCloseTo(SITE_PROFILE.localCrs.runwayCenterEastingM, 6);
    expect(grid.northing).toBeCloseTo(SITE_PROFILE.localCrs.runwayCenterNorthingM, 6);
  });

  it("treats +x as east and -z as north", () => {
    const east = gridEastingNorthing(100, 0);
    const north = gridEastingNorthing(0, -100);
    expect(east.easting - GRID_EASTING_ORIGIN).toBe(100);
    expect(north.northing - GRID_NORTHING_ORIGIN).toBe(100);
  });
});

describe("gridBearingDeg", () => {
  it("measures clockwise from grid north", () => {
    const origin = point(0, 0);
    expect(gridBearingDeg(origin, point(0, -100))).toBeCloseTo(0, 6);
    expect(gridBearingDeg(origin, point(100, 0))).toBeCloseTo(90, 6);
    expect(gridBearingDeg(origin, point(0, 100))).toBeCloseTo(180, 6);
    expect(gridBearingDeg(origin, point(-100, 0))).toBeCloseTo(270, 6);
  });

  it("returns a bearing in [0, 360)", () => {
    expect(gridBearingDeg(point(0, 0), point(-1, -100))).toBeGreaterThanOrEqual(0);
    expect(gridBearingDeg(point(0, 0), point(-1, -100))).toBeLessThan(360);
  });

  it("agrees with the published runway grid bearing", () => {
    const runway = RUNWAYS[0]!;
    const bearing = gridBearingDeg(
      point(runway.from[0], runway.from[1]),
      point(runway.to[0], runway.to[1]),
    );
    // The profile publishes 46°; the modeled endpoints must produce it to the
    // nearest whole degree or the published figure is not the modeled one.
    expect(Math.round(bearing)).toBe(SITE_PROFILE.runway.modeledGridBearingDeg);
  });
});

describe("bearingCardinal", () => {
  it("maps the sixteen sectors", () => {
    expect(bearingCardinal(0)).toBe("N");
    expect(bearingCardinal(90)).toBe("E");
    expect(bearingCardinal(180)).toBe("S");
    expect(bearingCardinal(270)).toBe("W");
    expect(bearingCardinal(45)).toBe("NE");
    // 359.9 rounds into the next sector, which wraps back to north rather than
    // overflowing the sixteen-element table.
    expect(bearingCardinal(359.9)).toBe("N");
    expect(bearingCardinal(-90)).toBe("W");
  });
});

describe("distances", () => {
  it("measures planar distance", () => {
    expect(distanceM(point(0, 0), point(3, 4))).toBe(5);
  });

  it("sums a path and measures its straight line separately", () => {
    const path = [point(0, 0), point(100, 0), point(100, 100)];
    expect(pathTotalM(path)).toBe(200);
    expect(straightLineM(path)).toBeCloseTo(Math.hypot(100, 100), 6);
  });

  it("returns zero for a path with fewer than two points", () => {
    expect(pathTotalM([])).toBe(0);
    expect(pathTotalM([point(5, 5)])).toBe(0);
    expect(straightLineM([point(5, 5)])).toBe(0);
  });

  it("reproduces the published runway length from the modeled endpoints", () => {
    const runway = RUNWAYS[0]!;
    expect(Math.round(segmentLength(runway))).toBe(
      Math.round(
        distanceM(
          point(runway.from[0], runway.from[1]),
          point(runway.to[0], runway.to[1]),
        ),
      ),
    );
  });
});

describe("formatting", () => {
  it("switches units at a kilometre", () => {
    expect(formatDistanceM(842)).toBe("842 m");
    expect(formatDistanceM(999)).toBe("999 m");
    expect(formatDistanceM(1000)).toBe("1.00 km");
    expect(formatDistanceM(3600)).toBe("3.60 km");
  });

  it("prints an em dash rather than NaN", () => {
    expect(formatDistanceM(Number.NaN)).toBe("—");
    expect(formatDistanceM(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("zero-pads a bearing to three digits and names its sector", () => {
    expect(formatBearingDeg(46)).toBe("046° NE");
    expect(formatBearingDeg(0)).toBe("000° N");
    expect(formatBearingDeg(-90)).toBe("270° W");
  });

  it("chooses the unit after rounding, so 999.5 m reads as a kilometre", () => {
    expect(formatDistanceM(999.4)).toBe("999 m");
    expect(formatDistanceM(999.5)).toBe("1.00 km");
    expect(formatDistanceM(999.99)).toBe("1.00 km");
  });

  it("rounds a bearing before normalising it, so it never reads 360°", () => {
    expect(formatBearingDeg(359.4)).toBe("359° N");
    expect(formatBearingDeg(359.5)).toBe("000° N");
    expect(formatBearingDeg(359.99)).toBe("000° N");
    expect(formatBearingDeg(-0.4)).toBe("000° N");
    expect(formatBearingDeg(719.6)).toBe("000° N");
  });
});

describe("snapWorldPoint", () => {
  /** Now: the model's current state. */
  const now = null;

  it("locks onto the nearest modeled vertex inside the radius", () => {
    const snap = snapWorldPoint(RUNWAY_CENTER[0] + 5, RUNWAY_CENTER[1] + 5, 50, now);
    expect(snap?.label).toBe("Runway center");
  });

  it("returns null when nothing modeled is close enough", () => {
    expect(snapWorldPoint(SITE_SIZE * 10, SITE_SIZE * 10, 50, now)).toBeNull();
  });

  it("respects the evidence timeline", () => {
    // The runway is first publicly established by the June 2021 report, so in
    // the 2015 snapshot it is an outline, and outlines are not measured from.
    expect(
      snapWorldPoint(RUNWAY_CENTER[0], RUNWAY_CENTER[1], 50, "2015-07-24"),
    ).toBeNull();
    expect(
      snapWorldPoint(RUNWAY_CENTER[0], RUNWAY_CENTER[1], 50, "2021-06-30")?.label,
    ).toBe("Runway center");
  });

  it("respects the evidence mode", () => {
    // In observed mode the runway is the one piece of geometry admitted, so a
    // structure vertex must not be snappable even though it is in range.
    const structureTarget = SNAP_TARGETS.find(
      (target) => target.label === "Main assembly hangar",
    );
    expect(structureTarget).toBeDefined();
    const observed = snapWorldPoint(
      structureTarget!.x,
      structureTarget!.z,
      50,
      now,
      "observed",
    );
    expect(observed).toBeNull();
    const full = snapWorldPoint(
      structureTarget!.x,
      structureTarget!.z,
      50,
      now,
      "full-simulation",
    );
    expect(full?.label).toBe("Main assembly hangar");
  });

  it("builds its targets from the layout, not from a hand-written list", () => {
    expect(SNAP_TARGETS.length).toBeGreaterThan(50);
    expect(SNAP_TARGETS.every((target) => typeof target.source.id === "string")).toBe(
      true,
    );
  });
});

describe("measurementSummary", () => {
  it("states the frame and reports an empty path honestly", () => {
    const summary = measurementSummary([]);
    expect(summary).toContain(SITE_PROFILE.localCrs.code);
    expect(summary).toContain("No points placed.");
  });

  it("lists every vertex with its grid coordinate and snapped identity", () => {
    const summary = measurementSummary([point(0, 0, "Runway center"), point(100, -100)]);
    expect(summary).toContain("P1");
    expect(summary).toContain("P2");
    expect(summary).toContain("Runway center");
    expect(summary).toContain(`E ${GRID_EASTING_ORIGIN.toFixed(0)}`);
  });

  it("carries the caveat into anything pasted out of the tool", () => {
    const summary = measurementSummary([point(0, 0), point(500, 0)]);
    expect(summary).toContain("Not an aeronautical survey");
    expect(summary).toContain("Leg 1→2");
    expect(summary).toContain("Path total:");
  });

  it("states each endpoint's positional error from its own evidence, never a site-wide figure", () => {
    const runway = RUNWAYS[0]!;
    const threshold: MeasurePoint = {
      x: runway.from[0],
      z: runway.from[1],
      snappedTo: "Runway 05 threshold",
      subjectId: runway.id,
    };
    const hangar = getStructure("hangar-main")!;
    const building: MeasurePoint = {
      x: hangar.position[0],
      z: hangar.position[1],
      snappedTo: hangar.name,
      subjectId: hangar.id,
    };
    const free = point(123, 456);

    // The runway's thresholds are the one place a positional error is stated.
    expect(positionalStatement(threshold)).toContain(
      `±${SITE_PROFILE.runway.endpointUncertaintyM} m`,
    );
    // A building has only a resolution floor, and it is called one.
    expect(positionalStatement(building)).toMatch(
      /^positional error not stated; at least \d+ m/,
    );
    expect(positionalStatement(building)).not.toContain("±");
    expect(positionalStatement(free)).toContain("free point");

    const summary = measurementSummary([threshold, building, free]);
    expect(summary.match(/±/g)).toHaveLength(1);
    expect(summary).not.toContain("endpoints carry");
  });

  it("does not quote a subject's evidence for a point that is not on its vertex", () => {
    const hangar = getStructure("hangar-main")!;
    const moved: MeasurePoint = {
      x: hangar.position[0] + 5,
      z: hangar.position[1],
      snappedTo: hangar.name,
      subjectId: hangar.id,
    };
    expect(positionalStatement(moved)).toBe(
      "positional error not recorded with this point",
    );
    // A legacy point names its vertex but carries no subject.
    expect(positionalStatement(point(0, 0, "Runway center"))).toBe(
      "positional error not recorded with this point",
    );
  });

  it("records the timeline date and evidence mode when given them", () => {
    const summary = measurementSummary([point(0, 0)], {
      snapshotDate: "2021-06-30",
      evidenceMode: "observed",
    });
    expect(summary).toContain("Evidence timeline: 2021-06-30");
    expect(summary).toContain("Observed only");
  });

  it("is deterministic", () => {
    const path = [point(0, 0), point(120, -80), point(300, 40)];
    expect(measurementSummary(path)).toBe(measurementSummary(path));
  });
});
