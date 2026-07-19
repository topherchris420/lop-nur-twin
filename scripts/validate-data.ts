import {
  ALL_SEGMENTS,
  APRONS,
  CIRCUIT_MIN_CLEARANCE_M,
  CIRCUIT_WAYPOINTS,
  CINEMATIC_WAYPOINTS,
  FLATTEN_PADS,
  GRID_EASTING_ORIGIN,
  GRID_NORTHING_ORIGIN,
  RADAR_POS,
  RUNWAYS,
  RUNWAY_CENTER,
  SERVICE_ROUTE,
  SITE_SIZE,
  STRUCTURES,
  WINDSOCK_POS,
  segmentLength,
} from "../src/lib/layout";
import {
  CLIMATE_MONTHS,
  OFFSITE_CONTEXT,
  PUBLIC_SOURCES,
  SITE_PROFILE,
} from "../src/lib/siteData";
import { QUALITY_PROFILES } from "../src/lib/quality";
import { createCircuitCurve } from "../src/lib/flightPath";
import { terrainHeight } from "../src/lib/terrain";
import * as THREE from "three";

const errors: string[] = [];
const siteLimitM = SITE_SIZE / 2;

function check(condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function checkPoint(
  label: string,
  point: readonly number[],
  spatialIndexes: readonly number[],
): void {
  check(
    point.every(isFiniteNumber),
    `${label} must contain only finite coordinates`,
  );

  for (const index of spatialIndexes) {
    const coordinate = point[index];
    if (!isFiniteNumber(coordinate)) continue;
    check(
      Math.abs(coordinate) <= siteLimitM,
      `${label}[${index}] ${coordinate.toFixed(2)} m exceeds the site limit of ${siteLimitM.toFixed(2)} m`,
    );
  }
}

function checkPositive(label: string, values: readonly number[]): void {
  for (const [index, value] of values.entries()) {
    check(
      isFiniteNumber(value) && value > 0,
      `${label}[${index}] must be finite and positive`,
    );
  }
}

function checkFootprint(
  label: string,
  center: readonly [number, number],
  size: readonly [number, number],
  rotation = 0,
): void {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const halfX = (size[0] * cos + size[1] * sin) / 2;
  const halfZ = (size[0] * sin + size[1] * cos) / 2;
  check(
    Math.abs(center[0]) + halfX <= siteLimitM,
    `${label} exceeds the east/west scene boundary`,
  );
  check(
    Math.abs(center[1]) + halfZ <= siteLimitM,
    `${label} exceeds the north/south scene boundary`,
  );
}

function checkUniqueIds(
  label: string,
  items: readonly { id: string }[],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    check(item.id.trim().length > 0, `${label} contains an empty id`);
    check(!seen.has(item.id), `${label} id "${item.id}" is duplicated`);
    seen.add(item.id);
  }
}

check(
  isFiniteNumber(SITE_SIZE) && SITE_SIZE > 0,
  "SITE_SIZE must be finite and positive",
);
check(
  SITE_SIZE === SITE_PROFILE.worldExtentM,
  `SITE_SIZE (${SITE_SIZE}) must match SITE_PROFILE.worldExtentM (${SITE_PROFILE.worldExtentM})`,
);

checkUniqueIds("Public source", PUBLIC_SOURCES);
const sourceIds = new Set<string>(PUBLIC_SOURCES.map((source) => source.id));
for (const source of PUBLIC_SOURCES) {
  check(source.title.trim().length > 0, `Public source "${source.id}" must have a title`);
  check(source.publisher.trim().length > 0, `Public source "${source.id}" must have a publisher`);
  check(source.accessedOn.trim().length > 0, `Public source "${source.id}" must have an access date`);
  check(source.attribution.trim().length > 0, `Public source "${source.id}" must have attribution`);
  try {
    const url = new URL(source.url);
    check(url.protocol === "https:", `Public source "${source.id}" must use an HTTPS URL`);
  } catch {
    check(false, `Public source "${source.id}" has an invalid URL`);
  }
  if (source.dataUrl !== undefined) {
    try {
      const dataUrl = new URL(source.dataUrl);
      check(dataUrl.protocol === "https:", `Public source "${source.id}" data URL must use HTTPS`);
    } catch {
      check(false, `Public source "${source.id}" has an invalid data URL`);
    }
  }
}

checkUniqueIds("Segment", ALL_SEGMENTS);
for (const segment of ALL_SEGMENTS) {
  checkPositive(`Segment "${segment.id}" width`, [segment.width]);
  checkPoint(`Segment "${segment.id}" start`, segment.from, [0, 1]);
  checkPoint(`Segment "${segment.id}" end`, segment.to, [0, 1]);
  const center: [number, number] = [
    (segment.from[0] + segment.to[0]) / 2,
    (segment.from[1] + segment.to[1]) / 2,
  ];
  const length = segmentLength(segment);
  const rotation = Math.atan2(
    segment.to[1] - segment.from[1],
    segment.to[0] - segment.from[0],
  );
  checkFootprint(`Segment "${segment.id}" footprint`, center, [length, segment.width], rotation);
  check(
    isFiniteNumber(length) && length > 0,
    `Segment "${segment.id}" must have a finite, positive length`,
  );
}

checkUniqueIds("Apron", APRONS);
for (const apron of APRONS) {
  checkPoint(`Apron "${apron.id}" center`, apron.center, [0, 1]);
  checkPositive(`Apron "${apron.id}" size`, apron.size);
  check(
    isFiniteNumber(apron.rotation),
    `Apron "${apron.id}" rotation must be finite`,
  );
  checkFootprint(`Apron "${apron.id}" footprint`, apron.center, apron.size, apron.rotation);
}

checkUniqueIds("Structure", STRUCTURES);
const segmentIds = new Set(ALL_SEGMENTS.map((segment) => segment.id));
for (const structure of STRUCTURES) {
  check(
    !segmentIds.has(structure.id),
    `Structure id "${structure.id}" collides with a segment id`,
  );
  checkPoint(
    `Structure "${structure.id}" position`,
    structure.position,
    [0, 1],
  );
  checkPositive(`Structure "${structure.id}" size`, structure.size);
  check(
    isFiniteNumber(structure.rotation),
    `Structure "${structure.id}" rotation must be finite`,
  );
  checkFootprint(
    `Structure "${structure.id}" footprint`,
    structure.position,
    [structure.size[0], structure.size[2]],
    structure.rotation,
  );

  const evidence = structure.evidence;
  check(evidence.note.trim().length > 0, `Structure "${structure.id}" must include an evidence note`);
  check(
    ["observed", "reported", "interpreted", "illustrative"].includes(evidence.status),
    `Structure "${structure.id}" has an invalid evidence status`,
  );
  check(
    ["low", "medium", "high"].includes(evidence.confidence),
    `Structure "${structure.id}" has an invalid evidence confidence`,
  );
  if (evidence.resolutionM !== undefined) {
    checkPositive(`Structure "${structure.id}" source resolution`, [evidence.resolutionM]);
  }
  check(
    evidence.sourceIds.length > 0,
    `Structure "${structure.id}" must cite at least one public source`,
  );
  for (const sourceId of evidence.sourceIds) {
    check(
      sourceIds.has(sourceId),
      `Structure "${structure.id}" cites unknown source "${sourceId}"`,
    );
  }
}

const catalogIds = new Map<string, string>();
for (const [catalog, items] of [
  ["segment", ALL_SEGMENTS],
  ["apron", APRONS],
  ["structure", STRUCTURES],
] as const) {
  for (const item of items) {
    const owner = catalogIds.get(item.id);
    check(owner === undefined, `${catalog} id "${item.id}" collides with ${owner ?? "another catalog"}`);
    catalogIds.set(item.id, catalog);
  }
}

check(CLIMATE_MONTHS.length === 12, "Climate catalog must contain exactly 12 months");
for (const climate of CLIMATE_MONTHS) {
  check(climate.month.trim().length > 0, "Every climate month must have a label");
  check(
    [
      climate.temperatureC,
      climate.relativeHumidityPct,
      climate.precipitationMmDay,
      climate.solarKwhM2Day,
      climate.windSpeedMps,
      climate.windDirectionDeg,
    ].every(isFiniteNumber),
    `Climate values for ${climate.month} must be finite`,
  );
  check(
    climate.windDirectionDeg >= 0 && climate.windDirectionDeg < 360,
    `Wind direction for ${climate.month} must be in [0, 360)`,
  );
}

for (const place of OFFSITE_CONTEXT) {
  check(
    place.distanceFromAirfieldKm * 1000 > SITE_SIZE,
    `Offsite context "${place.id}" must remain outside the rendered scene`,
  );
  for (const sourceId of place.sourceIds) {
    check(sourceIds.has(sourceId), `Offsite context "${place.id}" cites unknown source "${sourceId}"`);
  }
}

for (const tier of [0, 1, 2, 3] as const) {
  const profile = QUALITY_PROFILES[tier];
  checkPositive(`Quality tier ${tier} terrain segments`, [profile.terrainSegments]);
  checkPositive(`Quality tier ${tier} dust particles`, [profile.dustParticles]);
  if (tier > 0) {
    const previous = QUALITY_PROFILES[(tier - 1) as 0 | 1 | 2];
    check(profile.terrainSegments >= previous.terrainSegments, `Quality tier ${tier} terrain density must not decrease`);
    check(profile.dustParticles >= previous.dustParticles, `Quality tier ${tier} dust count must not decrease`);
    check(profile.dprMax >= previous.dprMax, `Quality tier ${tier} DPR must not decrease`);
  }
}

for (const [index, pad] of FLATTEN_PADS.entries()) {
  checkPoint(`Flatten pad ${index} center`, pad.center, [0, 1]);
  checkPositive(`Flatten pad ${index} radius`, [pad.radius]);
  checkFootprint(`Flatten pad ${index}`, pad.center, [pad.radius * 2, pad.radius * 2]);
}

for (const [index, point] of SERVICE_ROUTE.entries()) {
  checkPoint(`Service route point ${index}`, point, [0, 1]);
}
checkPoint("Radar position", RADAR_POS, [0, 1]);
checkPoint("Windsock position", WINDSOCK_POS, [0, 1]);

for (const waypoint of CINEMATIC_WAYPOINTS) {
  checkPoint(`Cinematic waypoint "${waypoint.label}"`, waypoint.position, [0, 2]);
  check(
    isFiniteNumber(waypoint.position[1]) && waypoint.position[1] >= 0,
    `Cinematic waypoint "${waypoint.label}" altitude must be finite and non-negative`,
  );
}

check(RUNWAYS.length === 1, "Exactly one modeled runway is expected");
const runway = RUNWAYS[0];
if (runway) {
  const lengthM = segmentLength(runway);
  const deltaEast = runway.to[0] - runway.from[0];
  const deltaNorth = -(runway.to[1] - runway.from[1]);
  const bearingDeg =
    ((Math.atan2(deltaEast, deltaNorth) * 180) / Math.PI + 360) % 360;

  check(
    Math.abs(lengthM - SITE_PROFILE.runway.modeledLengthM) <= 50,
    `Runway length ${lengthM.toFixed(1)} m must stay within 50 m of ${SITE_PROFILE.runway.modeledLengthM} m`,
  );
  check(
    Math.abs(bearingDeg - SITE_PROFILE.runway.modeledGridBearingDeg) <= 0.5,
    `Runway grid bearing ${bearingDeg.toFixed(2)} degrees must remain within 0.5 degrees of ${SITE_PROFILE.runway.modeledGridBearingDeg}`,
  );
  check(
    Math.abs(GRID_EASTING_ORIGIN + RUNWAY_CENTER[0] - SITE_PROFILE.localCrs.runwayCenterEastingM) <= 0.1,
    "Modeled runway center must register to the profile UTM easting",
  );
  check(
    Math.abs(GRID_NORTHING_ORIGIN - RUNWAY_CENTER[1] - SITE_PROFILE.localCrs.runwayCenterNorthingM) <= 0.1,
    "Modeled runway center must register to the profile UTM northing",
  );
}

check(
  CIRCUIT_WAYPOINTS.length >= 4,
  "Flight circuit must contain at least four waypoints",
);
for (const [index, waypoint] of CIRCUIT_WAYPOINTS.entries()) {
  check(
    waypoint.every(isFiniteNumber),
    `Circuit waypoint ${index} must contain only finite coordinates`,
  );
  check(
    isFiniteNumber(waypoint[1]) && waypoint[1] > 0,
    `Circuit waypoint ${index} must be airborne (altitude > 0 m)`,
  );
}

const circuit = createCircuitCurve();
const circuitPoint = new THREE.Vector3();
let minimumCircuitClearanceM = Number.POSITIVE_INFINITY;
for (let index = 0; index <= 20_000; index += 1) {
  circuit.getPointAt(index / 20_000, circuitPoint);
  minimumCircuitClearanceM = Math.min(
    minimumCircuitClearanceM,
    circuitPoint.y - terrainHeight(circuitPoint.x, circuitPoint.z),
  );
}
check(
  minimumCircuitClearanceM >= CIRCUIT_MIN_CLEARANCE_M,
  `Runtime flight spline clearance ${minimumCircuitClearanceM.toFixed(2)} m must remain at least ${CIRCUIT_MIN_CLEARANCE_M} m above terrain`,
);

if (errors.length > 0) {
  console.error(`[validate:data] ${errors.length} validation error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `[validate:data] OK: ${ALL_SEGMENTS.length} segments, ${APRONS.length} aprons, ${STRUCTURES.length} structures, ${PUBLIC_SOURCES.length} sources`,
);
