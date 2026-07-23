import {
  AIRCRAFT_ANALYSIS_PROFILES,
  ALL_SEGMENTS,
  APRONS,
  CIRCUIT_AIRCRAFT_ID,
  CIRCUIT_MIN_CLEARANCE_M,
  CIRCUIT_ROUTE_ENTITY_ID,
  CIRCUIT_WAYPOINTS,
  CINEMATIC_WAYPOINTS,
  FLATTEN_PADS,
  GRID_EASTING_ORIGIN,
  GRID_NORTHING_ORIGIN,
  ENVIRONMENT_ENTITY_ID,
  MISSION_ENTITIES,
  MISSION_SITE_ID,
  PATROL_ENTITY_IDS,
  PERIMETER_PATROL_ROUTE,
  PERIMETER_ROUTE_ENTITY_ID,
  RADAR_ENTITY_ID,
  RADAR_POS,
  RUNWAYS,
  RUNWAY_CENTER,
  SITE_SIZE,
  STRUCTURES,
  TERRAIN_ENTITY_ID,
  TIMELINE_BOUNDS,
  WINDSOCK_POS,
  WINDSOCK_ENTITY_ID,
  getObservedYear,
  getVisibleDatedAdditionCount,
  isVisibleAtTimelineYear,
  segmentLength,
} from "../src/lib/layout";
import {
  CLIMATE_MONTHS,
  OFFSITE_CONTEXT,
  PUBLIC_SOURCES,
  SITE_PROFILE,
} from "../src/lib/siteData";
import { QUALITY_PROFILES } from "../src/lib/quality";
import {
  SNAP_TARGETS,
  distanceM,
  gridBearingDeg,
  gridEastingNorthing,
  snapWorldPoint,
  type MeasurePoint,
} from "../src/lib/measure";
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

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return daysInMonth !== undefined && Number.isInteger(day) && day >= 1 && day <= daysInMonth;
}

function checkTemporal(
  label: string,
  item: { observedDate?: string },
  datedYears: number[],
): void {
  if (item.observedDate === undefined) return;
  check(
    isValidIsoCalendarDate(item.observedDate),
    `${label} observedDate '${item.observedDate}' must be a possible ISO calendar date (YYYY-MM-DD)`,
  );
  const year = getObservedYear(item);
  check(
    isFiniteNumber(year) && Number.isInteger(year),
    `${label} observedDate must derive a finite integer year`,
  );
  if (isFiniteNumber(year) && Number.isInteger(year)) datedYears.push(year);
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
const datedLayoutYears: number[] = [];
for (const segment of ALL_SEGMENTS) {
  checkTemporal(`Segment '${segment.id}'`, segment, datedLayoutYears);
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
  checkTemporal(`Apron '${apron.id}'`, apron, datedLayoutYears);
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
  checkTemporal(`Structure '${structure.id}'`, structure, datedLayoutYears);
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

check(
  Number.isInteger(TIMELINE_BOUNDS.minYear) && Number.isFinite(TIMELINE_BOUNDS.minYear),
  'Timeline minimum year must be a finite integer',
);
check(
  Number.isInteger(TIMELINE_BOUNDS.maxYear) && Number.isFinite(TIMELINE_BOUNDS.maxYear),
  'Timeline maximum year must be a finite integer',
);
check(
  TIMELINE_BOUNDS.minYear <= TIMELINE_BOUNDS.maxYear,
  'Timeline bounds must be ordered',
);
if (datedLayoutYears.length > 0) {
  check(
    TIMELINE_BOUNDS.minYear === Math.min(...datedLayoutYears),
    'Timeline minimum year must equal the earliest dated layout record',
  );
  check(
    TIMELINE_BOUNDS.maxYear === Math.max(...datedLayoutYears),
    'Timeline maximum year must equal the latest dated layout record',
  );
  check(
    getVisibleDatedAdditionCount(TIMELINE_BOUNDS.maxYear) === datedLayoutYears.length,
    'Latest timeline year must expose every dated layout addition',
  );
  check(
    getVisibleDatedAdditionCount(TIMELINE_BOUNDS.minYear - 1) === 0,
    'A year before the timeline must expose no dated additions',
  );
}
check(
  getObservedYear({ observedDate: '2025-09-13' }) === 2025,
  'getObservedYear must parse the leading ISO year',
);
check(getObservedYear({}) === undefined, 'getObservedYear must preserve unknown dates');
check(
  isVisibleAtTimelineYear({}, TIMELINE_BOUNDS.minYear - 100),
  'Undated layout records must remain visible at every timeline year',
);
check(
  !isVisibleAtTimelineYear({ observedDate: '2025-09-13' }, 2024) &&
    isVisibleAtTimelineYear({ observedDate: '2025-09-13' }, 2025),
  'Dated layout records must become visible in their observed year',
);

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

const missionEntityIds = new Set<string>();
for (const entity of MISSION_ENTITIES) {
  check(entity.id.trim().length > 0, "Mission entities must have stable IDs");
  check(
    !missionEntityIds.has(entity.id),
    `Mission entity id "${entity.id}" must be unique`,
  );
  missionEntityIds.add(entity.id);
  check(entity.label.trim().length > 0, `Mission entity "${entity.id}" must have a label`);
  check(
    entity.capabilities.length > 0,
    `Mission entity "${entity.id}" must declare at least one capability`,
  );
  check(
    new Set(entity.capabilities).size === entity.capabilities.length,
    `Mission entity "${entity.id}" capabilities must be unique`,
  );
  check(
    entity.taskableBehaviors.length > 0,
    `Mission entity "${entity.id}" must declare at least one taskable behavior`,
  );
  check(
    new Set(entity.taskableBehaviors.map((behavior) => behavior.id)).size ===
      entity.taskableBehaviors.length,
    `Mission entity "${entity.id}" behavior IDs must be unique`,
  );
  check(
    entity.observation.note.trim().length > 0,
    `Mission entity "${entity.id}" must explain its observation provenance`,
  );
  if (entity.observedDate !== undefined) {
    checkTemporal(`Mission entity ${entity.id}`, entity, []);
    check(
      entity.observation.observedDate === entity.observedDate,
      `Mission entity "${entity.id}" must preserve its layout observedDate`,
    );
  }
  if (
    entity.observation.timestampKind === "calendar-observation" ||
    entity.observation.timestampKind === "source-snapshot"
  ) {
    check(
      entity.observation.timestamp !== null &&
        isValidIsoCalendarDate(entity.observation.timestamp),
      `Mission entity "${entity.id}" must use an ISO timestamp for calendar/source observations`,
    );
  }
  if (entity.observation.timestampKind === "unknown") {
    check(
      entity.observation.timestamp === null,
      `Mission entity "${entity.id}" must represent unknown timestamps as null`,
    );
  }
  for (const sourceId of entity.observation.sourceIds) {
    check(
      sourceIds.has(sourceId),
      `Mission entity "${entity.id}" cites unknown source "${sourceId}"`,
    );
  }
}

for (const entity of MISSION_ENTITIES) {
  for (const relationship of entity.relationships) {
    check(
      missionEntityIds.has(relationship.targetId),
      `Mission entity "${entity.id}" relationship targets missing entity "${relationship.targetId}"`,
    );
  }
}

for (const item of [...ALL_SEGMENTS, ...APRONS, ...STRUCTURES]) {
  const entity = MISSION_ENTITIES.find((candidate) => candidate.id === item.id);
  check(entity !== undefined, `Layout record "${item.id}" must have a mission entity`);
  check(
    entity?.observedDate === item.observedDate,
    `Mission entity "${item.id}" must mirror the layout timeline date`,
  );
}

for (const id of [
  MISSION_SITE_ID,
  TERRAIN_ENTITY_ID,
  ENVIRONMENT_ENTITY_ID,
  PERIMETER_ROUTE_ENTITY_ID,
  CIRCUIT_ROUTE_ENTITY_ID,
  CIRCUIT_AIRCRAFT_ID,
  RADAR_ENTITY_ID,
  WINDSOCK_ENTITY_ID,
  ...PATROL_ENTITY_IDS,
]) {
  check(missionEntityIds.has(id), `Rendered mission object "${id}" must have an entity record`);
}
check(
  PATROL_ENTITY_IDS.length >=
    Math.max(...Object.values(QUALITY_PROFILES).map((profile) => profile.patrolVehicleCount)),
  "Mission registry must define enough patrol entities for the highest quality budget",
);

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
  check(
    Number.isInteger(profile.patrolVehicleCount) && profile.patrolVehicleCount >= 1,
    `Quality tier ${tier} patrol vehicle count must be a positive integer`,
  );
  check(
    typeof profile.patrolHeadlightLights === 'boolean',
    `Quality tier ${tier} patrol headlight-light flag must be boolean`,
  );
  checkPositive(`Quality tier ${tier} overlay refresh`, [profile.overlayRefreshHz]);
  check(
    Number.isInteger(profile.overlayRangeSamples) && profile.overlayRangeSamples >= 3,
    `Quality tier ${tier} overlay range samples must be an integer of at least 3`,
  );
  check(
    Number.isInteger(profile.overlayRadarSamples) && profile.overlayRadarSamples >= 2,
    `Quality tier ${tier} overlay radar samples must be an integer of at least 2`,
  );
  if (tier > 0) {
    const previous = QUALITY_PROFILES[(tier - 1) as 0 | 1 | 2];
    check(profile.terrainSegments >= previous.terrainSegments, `Quality tier ${tier} terrain density must not decrease`);
    check(profile.dustParticles >= previous.dustParticles, `Quality tier ${tier} dust count must not decrease`);
    check(profile.dprMax >= previous.dprMax, `Quality tier ${tier} DPR must not decrease`);
    check(profile.patrolVehicleCount >= previous.patrolVehicleCount, `Quality tier ${tier} patrol count must not decrease`);
    check(profile.overlayRefreshHz >= previous.overlayRefreshHz, `Quality tier ${tier} overlay refresh must not decrease`);
    check(profile.overlayRangeSamples >= previous.overlayRangeSamples, `Quality tier ${tier} overlay range samples must not decrease`);
    check(profile.overlayRadarSamples >= previous.overlayRadarSamples, `Quality tier ${tier} overlay radar samples must not decrease`);
    check(
      !previous.patrolHeadlightLights || profile.patrolHeadlightLights,
      `Quality tier ${tier} must not remove patrol headlight lights enabled by a lower tier`,
    );
  }
}

for (const [index, pad] of FLATTEN_PADS.entries()) {
  checkPoint(`Flatten pad ${index} center`, pad.center, [0, 1]);
  checkPositive(`Flatten pad ${index} radius`, [pad.radius]);
  checkFootprint(`Flatten pad ${index}`, pad.center, [pad.radius * 2, pad.radius * 2]);
}

check(
  PERIMETER_PATROL_ROUTE.length >= 4,
  'Perimeter patrol route must contain at least three vertices plus closure',
);
const patrolDistinctVertices = new Set<string>();
let patrolTotalLengthM = 0;
for (const [index, point] of PERIMETER_PATROL_ROUTE.entries()) {
  checkPoint(`Perimeter patrol route point ${index}`, point, [0, 1]);
  if (index < PERIMETER_PATROL_ROUTE.length - 1) {
    patrolDistinctVertices.add(`${point[0]},${point[1]}`);
  }
  if (index > 0) {
    const previous = PERIMETER_PATROL_ROUTE[index - 1];
    if (previous) {
      const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      check(
        isFiniteNumber(length) && length > 0,
        `Perimeter patrol route segment ${index - 1} must have non-zero finite length`,
      );
      patrolTotalLengthM += length;
    }
  }
}
check(
  patrolDistinctVertices.size >= 3,
  'Perimeter patrol route must contain at least three distinct vertices',
);
const patrolFirst = PERIMETER_PATROL_ROUTE[0];
const patrolLast = PERIMETER_PATROL_ROUTE[PERIMETER_PATROL_ROUTE.length - 1];
check(
  patrolFirst !== undefined &&
    patrolLast !== undefined &&
    patrolFirst[0] === patrolLast[0] &&
    patrolFirst[1] === patrolLast[1],
  'Perimeter patrol route must be explicitly closed',
);
check(
  isFiniteNumber(patrolTotalLengthM) && patrolTotalLengthM > 0,
  'Perimeter patrol route must have positive total length',
);

for (const [id, profile] of Object.entries(AIRCRAFT_ANALYSIS_PROFILES)) {
  check(profile.label.trim().length > 0, `Aircraft analysis profile '${id}' must have a label`);
  checkPositive(`Aircraft analysis profile '${id}' ranges`, [
    profile.scenarioRadiusM,
    profile.radarRangeM,
  ]);
  check(
    profile.scenarioRadiusM <= SITE_SIZE && profile.radarRangeM <= SITE_SIZE,
    `Aircraft analysis profile '${id}' ranges must remain within the modeled site scale`,
  );
  check(
    isFiniteNumber(profile.radarFovDeg) && profile.radarFovDeg > 0 && profile.radarFovDeg <= 360,
    `Aircraft analysis profile '${id}' radar FOV must be in (0, 360]`,
  );
  if (profile.altitudeM !== undefined) {
    check(
      isFiniteNumber(profile.altitudeM) && profile.altitudeM >= 0,
      `Aircraft analysis profile '${id}' altitude must be finite and non-negative`,
    );
  }
  check(
    /(illustrative|notional|hypothetical)/i.test(profile.disclaimer) &&
      /not operational/i.test(profile.disclaimer),
    `Aircraft analysis profile '${id}' disclaimer must mark values as illustrative/notional and not operational`,
  );
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

  // The measuring tool must reproduce the documented runway from the same
  // source layout it snaps to: length, grid bearing and grid registration.
  const p05: MeasurePoint = { x: runway.from[0], z: runway.from[1], snappedTo: null };
  const p23: MeasurePoint = { x: runway.to[0], z: runway.to[1], snappedTo: null };
  check(
    Math.abs(distanceM(p05, p23) - segmentLength(runway)) <= 1e-6,
    "Measurement distance must equal the runway segment length",
  );
  const measuredBearing = gridBearingDeg(p05, p23);
  check(
    Math.abs(measuredBearing - SITE_PROFILE.runway.modeledGridBearingDeg) <= 0.5,
    `Measured runway bearing ${measuredBearing.toFixed(2)} degrees must match the documented ${SITE_PROFILE.runway.modeledGridBearingDeg}`,
  );
  const snappedThreshold = snapWorldPoint(
    runway.from[0],
    runway.from[1],
    5,
    TIMELINE_BOUNDS.maxYear,
  );
  check(
    snappedThreshold !== null &&
      Math.abs(snappedThreshold.x - runway.from[0]) <= 1e-6 &&
      Math.abs(snappedThreshold.z - runway.from[1]) <= 1e-6,
    "A click at the runway 05 threshold must snap to the modeled vertex",
  );
  const centerGrid = gridEastingNorthing(RUNWAY_CENTER[0], RUNWAY_CENTER[1]);
  check(
    Math.abs(centerGrid.easting - SITE_PROFILE.localCrs.runwayCenterEastingM) <= 0.1 &&
      Math.abs(centerGrid.northing - SITE_PROFILE.localCrs.runwayCenterNorthingM) <= 0.1,
    "Measurement grid readout must register to the profile UTM coordinate",
  );
}

check(SNAP_TARGETS.length > 0, "Measurement snap targets must not be empty");
for (const target of SNAP_TARGETS) {
  check(
    target.label.trim().length > 0,
    `Snap target at ${target.x.toFixed(1)}, ${target.z.toFixed(1)} must have a label`,
  );
  checkPoint(`Snap target "${target.label}"`, [target.x, target.z], [0, 1]);
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
  `[validate:data] OK: ${ALL_SEGMENTS.length} segments, ${APRONS.length} aprons, ${STRUCTURES.length} structures, ${PUBLIC_SOURCES.length} sources, ${SNAP_TARGETS.length} snap targets`,
);
