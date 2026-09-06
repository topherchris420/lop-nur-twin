import { describe, expect, it } from "vitest";
import { RUNWAY_CENTER } from "./layout";
import { SITE_PROFILE } from "./siteData";
import {
  localToProjected,
  localToWgs84,
  projectedToLocal,
  projectedToWgs84,
  wgs84ToProjected,
} from "./geospatial";

describe("geospatial transforms", () => {
  it("registers the modeled runway center to the published UTM coordinate", () => {
    expect(localToProjected({ x: RUNWAY_CENTER[0], z: RUNWAY_CENTER[1] })).toEqual({
      easting: SITE_PROFILE.localCrs.runwayCenterEastingM,
      northing: SITE_PROFILE.localCrs.runwayCenterNorthingM,
    });
  });

  it("maps the published UTM reference back to the published WGS84 reference", () => {
    const geographic = projectedToWgs84({
      easting: SITE_PROFILE.localCrs.runwayCenterEastingM,
      northing: SITE_PROFILE.localCrs.runwayCenterNorthingM,
    });
    expect(geographic.latitude).toBeCloseTo(SITE_PROFILE.referenceCoordinate.latitude, 5);
    expect(geographic.longitude).toBeCloseTo(
      SITE_PROFILE.referenceCoordinate.longitude,
      5,
    );
  });

  it("round-trips representative local and geographic coordinates", () => {
    for (const point of [
      { x: 0, z: 0 },
      { x: -3400, z: 3400 },
      { x: 3400, z: -3400 },
    ]) {
      const roundTrip = projectedToLocal(localToProjected(point));
      expect(roundTrip.x).toBeCloseTo(point.x, 8);
      expect(roundTrip.z).toBeCloseTo(point.z, 8);
      const geographic = localToWgs84(point);
      const projected = wgs84ToProjected(geographic);
      const expected = localToProjected(point);
      expect(projected.easting).toBeCloseTo(expected.easting, 3);
      expect(projected.northing).toBeCloseTo(expected.northing, 3);
    }
  });

  it("rejects non-finite and out-of-zone inputs", () => {
    expect(() => localToProjected({ x: Number.NaN, z: 0 })).toThrow(TypeError);
    expect(() => projectedToWgs84({ easting: -1, northing: 0 })).toThrow(RangeError);
    expect(() => wgs84ToProjected({ longitude: 0, latitude: 95 })).toThrow(RangeError);
  });
});
