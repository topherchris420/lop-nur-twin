import { describe, expect, it } from "vitest";
import { gpsTo3DCanvas } from "./flightData";
import { localToWgs84 } from "./geospatial";
import { RUNWAY_CENTER } from "./layout";
import { SITE_PROFILE } from "./siteData";
import { terrainHeight } from "./terrain";

const FEET_PER_METRE = 1 / 0.3048;

describe("gpsTo3DCanvas", () => {
  it("places a position on the scene's UTM grid, not a north-up lat/lon offset", () => {
    // Local points several kilometres from the runway centre, taken out to
    // WGS84 and back. The grid is turned ~1.5° from true north here, which a
    // flat lat/lon offset got wrong by tens of metres at this range.
    for (const point of [
      { x: RUNWAY_CENTER[0], z: RUNWAY_CENTER[1] },
      { x: 3000, z: -3000 },
      { x: -3000, z: 3000 },
      { x: 20_000, z: 15_000 },
    ]) {
      const { latitude, longitude } = localToWgs84(point);
      const [x, , z] = gpsTo3DCanvas(latitude, longitude, 0);
      expect(x).toBeCloseTo(point.x, 2);
      expect(z).toBeCloseTo(point.z, 2);
    }
  });

  it("registers the published reference coordinate to the modeled runway centre", () => {
    const [x, , z] = gpsTo3DCanvas(
      SITE_PROFILE.referenceCoordinate.latitude,
      SITE_PROFILE.referenceCoordinate.longitude,
      0,
    );
    expect(Math.hypot(x - RUNWAY_CENTER[0], z - RUNWAY_CENTER[1])).toBeLessThan(1);
  });

  it("measures height above the site datum, not above sea level", () => {
    const { latitude, longitude } = localToWgs84({ x: 0, z: 0 });
    const datumM = SITE_PROFILE.terrainDatum.elevationM;
    const [, y] = gpsTo3DCanvas(latitude, longitude, (datumM + 1000) * FEET_PER_METRE);
    expect(y).toBeCloseTo(1000, 6);
  });

  it("sets an aircraft reported at or below the site on the ground", () => {
    const { latitude, longitude } = localToWgs84({ x: 500, z: 500 });
    const ground = terrainHeight(500, 500);
    for (const altitude of [
      0,
      1000,
      (SITE_PROFILE.terrainDatum.elevationM - 50) * FEET_PER_METRE,
      null,
    ]) {
      const [x, y, z] = gpsTo3DCanvas(latitude, longitude, altitude);
      expect(y).toBeCloseTo(terrainHeight(x, z), 6);
      expect(y).toBeCloseTo(ground, 3);
    }
  });

  it("places traffic east of zone 45N's 90°E edge instead of throwing", () => {
    // The feed covers 150 nm around the site, which reaches ~92.5°E.
    const [x, y, z] = gpsTo3DCanvas(40.77, 92.3, 35_000);
    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
    expect(x).toBeGreaterThan(200_000);
  });
});
