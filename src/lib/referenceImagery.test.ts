import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  REFERENCE_SCENES,
  RUNWAY_WINDOW,
  SITE_WINDOW,
  getReferenceScene,
  localToProjected,
  projectedToLocal,
  projectedWindow,
  registrationInstructions,
  registrationReport,
  sceneAttribution,
  sceneSourceUrl,
} from "./referenceImagery";
import { GRID_EASTING_ORIGIN, GRID_NORTHING_ORIGIN, SITE_SIZE } from "./layout";
import { PUBLIC_SOURCES, SITE_PROFILE } from "./siteData";

/**
 * Registration is the one place a sign error would be invisible and fatal: an
 * overlay mirrored north-for-south looks almost right and is completely wrong.
 * The transform tests exist for that, and the rest guard the promise that
 * nothing is fetched, bundled or redistributed.
 */

describe("the projected transform", () => {
  it("moves north as z decreases", () => {
    // `+z` is south in this project's local frame. Getting the sign backwards
    // mirrors an overlay in a way that still lines up on the runway.
    const [, northAtOrigin] = localToProjected(0, 0);
    const [, northAtSouth] = localToProjected(0, 100);
    expect(northAtSouth).toBeLessThan(northAtOrigin);
    expect(northAtOrigin - northAtSouth).toBe(100);
  });

  it("moves east as x increases", () => {
    const [eastAtOrigin] = localToProjected(0, 0);
    const [eastAtEast] = localToProjected(250, 0);
    expect(eastAtEast - eastAtOrigin).toBe(250);
  });

  it("is registered to the published runway-centre coordinate", () => {
    expect(localToProjected(0, 0)).toEqual([GRID_EASTING_ORIGIN, GRID_NORTHING_ORIGIN]);
  });

  it("round-trips exactly", () => {
    for (const point of [
      [0, 0],
      [1018, 1410],
      [-2616, -2798],
      [2591, -762],
    ] as const) {
      const [easting, northing] = localToProjected(point[0], point[1]);
      const [x, z] = projectedToLocal(easting, northing);
      expect(x).toBeCloseTo(point[0], 9);
      expect(z).toBeCloseTo(point[1], 9);
    }
  });
});

describe("projected windows", () => {
  it("covers the modeled site, centred on the layout origin", () => {
    expect(SITE_WINDOW.halfExtentM).toBe(SITE_SIZE / 2);
    expect(SITE_WINDOW.centerLocal).toEqual([0, 0]);
    expect(SITE_WINDOW.maxEastingM - SITE_WINDOW.minEastingM).toBeCloseTo(SITE_SIZE, 6);
    expect(SITE_WINDOW.maxNorthingM - SITE_WINDOW.minNorthingM).toBeCloseTo(SITE_SIZE, 6);
  });

  it("names the projected frame every modeled metre lives in", () => {
    expect(SITE_WINDOW.crs).toBe(SITE_PROFILE.localCrs.code);
    expect(RUNWAY_WINDOW.crs).toBe(SITE_PROFILE.localCrs.code);
  });

  it("rounds to a tenth of a metre, because registration is good to ±40 m", () => {
    // More digits than the reference coordinate supports would be theatre.
    const window = projectedWindow(1234.56789, [1.23456, -9.87654]);
    for (const value of [
      window.minEastingM,
      window.maxEastingM,
      window.minNorthingM,
      window.maxNorthingM,
    ]) {
      expect(Math.round(value * 10)).toBeCloseTo(value * 10, 9);
    }
  });

  it("puts the runway window on the runway, not on the layout origin", () => {
    expect(RUNWAY_WINDOW.centerLocal).not.toEqual([0, 0]);
    expect(RUNWAY_WINDOW.halfExtentM).toBeLessThan(SITE_WINDOW.halfExtentM);
  });
});

describe("cited scenes", () => {
  it("only names sources already in the public register", () => {
    const known = new Set(PUBLIC_SOURCES.map((source) => source.id));
    for (const scene of REFERENCE_SCENES) {
      expect(known.has(scene.sourceId), scene.id).toBe(true);
      expect(sceneSourceUrl(scene)).toBeDefined();
      expect(sceneAttribution(scene)).not.toBe("Attribution unavailable.");
    }
  });

  it("states the resolution the publisher states", () => {
    for (const scene of REFERENCE_SCENES) {
      expect(scene.resolutionM).toBeGreaterThan(0);
    }
  });

  it("resolves by id and rejects an unknown one", () => {
    expect(getReferenceScene("sentinel-2-site")?.id).toBe("sentinel-2-site");
    expect(getReferenceScene("not-a-scene")).toBeUndefined();
  });

  it("tells a reviewer to retrieve the scene themselves", () => {
    for (const scene of REFERENCE_SCENES) {
      const steps = registrationInstructions(scene);
      expect(steps[0]).toMatch(/retrieve the scene yourself/);
      expect(steps.join(" ")).toContain(String(scene.window.minEastingM));
      expect(steps.join(" ")).toContain(String(scene.window.maxNorthingM));
    }
  });
});

describe("registrationReport", () => {
  const scene = REFERENCE_SCENES[0]!;

  it("reports the ground each pixel is worth", () => {
    const extent = scene.window.halfExtentM * 2;
    const report = registrationReport(680, 680, scene);
    expect(report.metresPerPixel).toBeCloseTo(extent / 680, 6);
    expect(report.nativePixels).toBe(Math.ceil(extent / scene.resolutionM));
  });

  it("knows when a crop is coarser than the scene it came from", () => {
    expect(registrationReport(64, 64, scene).atNativeResolution).toBe(false);
    expect(registrationReport(4096, 4096, scene).atNativeResolution).toBe(true);
  });

  it("notices a non-square crop, which the square window would stretch", () => {
    expect(registrationReport(800, 400, scene).square).toBe(false);
    expect(registrationReport(800, 800, scene).square).toBe(true);
  });

  it("inherits the reference coordinate's uncertainty and says so", () => {
    const report = registrationReport(680, 680, scene);
    expect(report.registrationUncertaintyM).toBe(
      SITE_PROFILE.runway.endpointUncertaintyM,
    );
    const caveats = report.caveats.join(" ");
    expect(caveats).toContain("never uploaded");
    expect(caveats).toMatch(
      /does not establish height, function, interior use or activity/,
    );
  });

  it("survives a degenerate image rather than dividing by zero", () => {
    expect(Number.isFinite(registrationReport(0, 0, scene).metresPerPixel)).toBe(true);
  });
});

describe("what a supplied file may be", () => {
  it("accepts raster formats only — never SVG, which can carry script", () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(ACCEPTED_IMAGE_TYPES).not.toContain("image/svg+xml");
  });

  it("bounds the size a browser will decode", () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(0);
    expect(MAX_IMAGE_BYTES).toBeLessThanOrEqual(32_000_000);
  });
});
