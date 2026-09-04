import { GRID_EASTING_ORIGIN, GRID_NORTHING_ORIGIN } from "./layout";

export interface LocalCoordinate {
  x: number;
  z: number;
}

export interface ProjectedCoordinate {
  easting: number;
  northing: number;
}

export interface GeographicCoordinate {
  longitude: number;
  latitude: number;
}

const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const UTM_SCALE = 0.9996;
const FALSE_EASTING = 500_000;
const FALSE_NORTHING = 0;
const ZONE_45_CENTRAL_MERIDIAN_DEG = 87;
const ZONE_45_WEST_BOUNDARY_DEG = 84;
const ZONE_45_EAST_BOUNDARY_DEG = 90;
const UTM_MIN_EASTING = 100_000;
const UTM_MAX_EASTING = 900_000;
const UTM_MIN_NORTHING = 0;
const UTM_MAX_NORTHING = 10_000_000;
const UTM_MIN_LATITUDE_DEG = 0;
const UTM_MAX_LATITUDE_DEG = 84;
const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_E4 = WGS84_E2 * WGS84_E2;
const WGS84_E6 = WGS84_E4 * WGS84_E2;
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const E1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
const CENTRAL_MERIDIAN_RAD = ZONE_45_CENTRAL_MERIDIAN_DEG * RAD_PER_DEG;
const MERIDIONAL_ARC_COEFFICIENT =
  WGS84_A * (1 - WGS84_E2 / 4 - (3 * WGS84_E4) / 64 - (5 * WGS84_E6) / 256);

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertLocalCoordinate(point: LocalCoordinate): void {
  assertFinite(point.x, "Local x");
  assertFinite(point.z, "Local z");
}

function assertProjectedCoordinate(point: ProjectedCoordinate): void {
  assertFinite(point.easting, "Projected easting");
  assertFinite(point.northing, "Projected northing");
  if (point.easting < UTM_MIN_EASTING || point.easting > UTM_MAX_EASTING) {
    throw new RangeError("Projected easting is outside UTM zone 45N bounds");
  }
  if (point.northing < UTM_MIN_NORTHING || point.northing > UTM_MAX_NORTHING) {
    throw new RangeError("Projected northing is outside UTM zone 45N bounds");
  }
}

function assertGeographicCoordinate(point: GeographicCoordinate): void {
  assertFinite(point.longitude, "Geographic longitude");
  assertFinite(point.latitude, "Geographic latitude");
  if (point.latitude < UTM_MIN_LATITUDE_DEG || point.latitude > UTM_MAX_LATITUDE_DEG) {
    throw new RangeError("Latitude is outside UTM zone 45N coverage");
  }
  if (
    point.longitude < ZONE_45_WEST_BOUNDARY_DEG ||
    point.longitude >= ZONE_45_EAST_BOUNDARY_DEG
  ) {
    throw new RangeError("Longitude is outside UTM zone 45N bounds");
  }
}

function latitudeToRadians(latitude: number): number {
  return latitude * RAD_PER_DEG;
}

function longitudeToRadians(longitude: number): number {
  return longitude * RAD_PER_DEG;
}

function meridionalArc(latitudeRad: number): number {
  return (
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E4) / 64 - (5 * WGS84_E6) / 256) * latitudeRad -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E4) / 32 + (45 * WGS84_E6) / 1024) *
        Math.sin(2 * latitudeRad) +
      ((15 * WGS84_E4) / 256 + (45 * WGS84_E6) / 1024) * Math.sin(4 * latitudeRad) -
      ((35 * WGS84_E6) / 3072) * Math.sin(6 * latitudeRad))
  );
}

function validateInverseResult(point: GeographicCoordinate): GeographicCoordinate {
  if (point.latitude < UTM_MIN_LATITUDE_DEG || point.latitude > UTM_MAX_LATITUDE_DEG) {
    throw new RangeError("Projected coordinate resolves outside UTM zone 45N coverage");
  }
  if (
    point.longitude < ZONE_45_WEST_BOUNDARY_DEG ||
    point.longitude >= ZONE_45_EAST_BOUNDARY_DEG
  ) {
    throw new RangeError("Projected coordinate resolves outside UTM zone 45N bounds");
  }
  return point;
}

export function localToProjected(point: LocalCoordinate): ProjectedCoordinate {
  assertLocalCoordinate(point);
  return {
    easting: GRID_EASTING_ORIGIN + point.x,
    northing: GRID_NORTHING_ORIGIN - point.z,
  };
}

export function projectedToLocal(point: ProjectedCoordinate): LocalCoordinate {
  assertProjectedCoordinate(point);
  return {
    x: point.easting - GRID_EASTING_ORIGIN,
    z: GRID_NORTHING_ORIGIN - point.northing,
  };
}

export function projectedToWgs84(point: ProjectedCoordinate): GeographicCoordinate {
  assertProjectedCoordinate(point);

  const x = (point.easting - FALSE_EASTING) / UTM_SCALE;
  const y = (point.northing - FALSE_NORTHING) / UTM_SCALE;
  const mu = y / MERIDIONAL_ARC_COEFFICIENT;

  const phi1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi1 * sinPhi1);
  const r1 =
    (WGS84_A * (1 - WGS84_E2)) /
    Math.pow(1 - WGS84_E2 * sinPhi1 * sinPhi1, 3 / 2);
  const t1 = tanPhi1 * tanPhi1;
  const c1 = WGS84_EP2 * cosPhi1 * cosPhi1;
  const d = x / n1;

  const latitudeRad =
    phi1 -
    (n1 * tanPhi1 * (d * d / 2 -
      ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_EP2) * d ** 4) / 24 +
      ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * WGS84_EP2 - 3 * c1 * c1) *
        d ** 6) /
        720)) /
      r1;

  const longitudeRad =
    CENTRAL_MERIDIAN_RAD +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * WGS84_EP2 + 24 * t1 * t1) *
        d ** 5) /
        120) /
      cosPhi1;

  return validateInverseResult({
    longitude: longitudeRad * DEG_PER_RAD,
    latitude: latitudeRad * DEG_PER_RAD,
  });
}

export function wgs84ToProjected(point: GeographicCoordinate): ProjectedCoordinate {
  assertGeographicCoordinate(point);

  const latitudeRad = latitudeToRadians(point.latitude);
  const longitudeRad = longitudeToRadians(point.longitude);
  const sinLatitude = Math.sin(latitudeRad);
  const cosLatitude = Math.cos(latitudeRad);
  const tanLatitude = Math.tan(latitudeRad);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLatitude * sinLatitude);
  const t = tanLatitude * tanLatitude;
  const c = WGS84_EP2 * cosLatitude * cosLatitude;
  const a = cosLatitude * (longitudeRad - CENTRAL_MERIDIAN_RAD);
  const m = meridionalArc(latitudeRad);

  const projected = {
    easting:
      FALSE_EASTING +
      UTM_SCALE *
        n *
        (a +
          ((1 - t + c) * a ** 3) / 6 +
          ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_EP2) * a ** 5) / 120),
    northing:
      FALSE_NORTHING +
      UTM_SCALE *
        (m +
          n *
            tanLatitude *
            (a * a / 2 +
              ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
              ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_EP2) * a ** 6) / 720)),
  };

  assertProjectedCoordinate(projected);
  return projected;
}

export function localToWgs84(point: LocalCoordinate): GeographicCoordinate {
  return projectedToWgs84(localToProjected(point));
}
