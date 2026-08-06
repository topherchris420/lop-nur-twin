import {
  SITE_PROFILE,
  type Evidence,
  type EvidenceConfidence,
  type EvidenceStatus,
  type SourceId,
} from "./siteData";

export const SITE_SIZE = SITE_PROFILE.worldExtentM;

export interface TemporalDef {
  observedDate?: string;
}

export type SegmentKind = "runway" | "strip" | "taxiway" | "street" | "road";
/*
 * The declarations in this file that hold *data* rather than logic are written
 * as tables — one record per line, columns lining up — and are marked
 * `prettier-ignore` so the formatter leaves them that way. Exploding a
 * 60-structure array to ten lines per entry makes a geometry change unreadable
 * in review, which is the one thing the single-source-of-truth rule depends on.
 * Everything else in the file is formatted normally.
 */
// prettier-ignore
export interface SegmentDef extends TemporalDef { id: string; kind: SegmentKind; name: string; from: [number, number]; to: [number, number]; width: number }
// prettier-ignore
export interface ApronDef extends TemporalDef { id: string; name: string; center: [number, number]; size: [number, number]; rotation: number }
// prettier-ignore
export type StructureType = "tower" | "hangar-monolith" | "shelter-row" | "quonset" | "warehouse" | "hq" | "barracks" | "support" | "compound-walled" | "guardhouse" | "radome" | "fuel-tank" | "solar-array" | "water-tower" | "comms-shelter" | "transformer-yard" | "guard-tower" | "covered-walkway" | "sewage-treatment" | "aircraft-delta" | "aircraft-fighter" | "aircraft-j36" | "aircraft-jxds";
// prettier-ignore
export interface StructureDef extends TemporalDef { id: string; type: StructureType; name: string; position: [number, number]; rotation: number; size: [number, number, number]; modelBasis: string; description: string; evidence: Evidence }
export interface FlattenPad {
  center: [number, number];
  radius: number;
}
export interface Waypoint {
  position: [number, number, number];
  label: string;
}

/**
 * Coordinates use metres in a local east/south frame registered to WGS 84 / UTM
 * zone 45N: +x east, +z south, y up. The layout origin frames the triangular
 * site; the grid constants below anchor the modeled runway midpoint to the
 * public reference coordinate. This is a visualization, not an aeronautical chart.
 */
export const COMPOUND_ROT = 0.7679;
const COMPOUND_ORIGIN: [number, number] = [1018, 1410];
// prettier-ignore
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
// prettier-ignore
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];
// prettier-ignore
function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

// Measured from a public Sentinel-2 L2A scene; endpoint uncertainty is about 40 m.
// prettier-ignore
export const RUNWAYS: SegmentDef[] = [
  { id: "rwy-05-23", kind: "runway", name: "Main concrete runway 05/23", from: [-1006, 2711], to: [2591, -762], width: 60 },
];
RUNWAYS[0]!.observedDate = "2021-06-30";
export const RUNWAY_CENTER: [number, number] = [
  (RUNWAYS[0]!.from[0] + RUNWAYS[0]!.to[0]) / 2,
  (RUNWAYS[0]!.from[1] + RUNWAYS[0]!.to[1]) / 2,
];
export const GRID_EASTING_ORIGIN =
  SITE_PROFILE.localCrs.runwayCenterEastingM - RUNWAY_CENTER[0];
export const GRID_NORTHING_ORIGIN =
  SITE_PROFILE.localCrs.runwayCenterNorthingM + RUNWAY_CENTER[1];
// prettier-ignore
export const STRIPS: SegmentDef[] = [
  { id: "tri-west", kind: "strip", name: "West graded strip", from: [-2616, -2798], to: [-995, 2750], width: 42 },
  { id: "tri-north", kind: "strip", name: "North graded strip", from: [-2675, -2743], to: [2628, -748], width: 42 },
];
// prettier-ignore
export const TAXIWAYS: SegmentDef[] = [
  { id: "twy-stub", kind: "taxiway", name: "Runway connector", from: [692, 1072], to: compound(8, -205), width: 42 },
  { id: "twy-apron", kind: "taxiway", name: "Apron throat", from: compound(8, -205), to: compound(8, -118), width: 46 },
];

// prettier-ignore
const street = (id: string, name: string, a: [number, number], b: [number, number], width = 8): SegmentDef => ({ id, kind: "street", name, from: compound(...a), to: compound(...b), width });
// prettier-ignore
export const STREETS: SegmentDef[] = [
  street("st-west", "West perimeter", [-205, -72], [-205, 220], 9),
  street("st-north", "Hangar frontage", [-205, -20], [210, -20], 9),
  street("st-mid", "Central cross road", [-205, 72], [210, 72], 9),
  street("st-south", "South cross road", [-205, 188], [210, 188], 8),
  street("st-east", "East perimeter", [210, -112], [210, 228], 8),
  street("st-center", "Compound spine", [68, -24], [68, 228], 8),
  street("st-west-inner", "West inner road", [-74, -20], [-74, 188], 8),
  street("st-east-inner", "East inner road", [144, -20], [144, 188], 8),
  street("st-ne-loop", "North east service", [68, -102], [210, -102], 7),
  // Access to the 2025 build-out: crew blocks, south-east halls and fuel area.
  street("st-crew", "Crew block frontage", [-63, 245], [58, 245], 8),
  street("st-spine-ext", "South spine extension", [68, 228], [68, 262], 8),
  street("st-se-service", "South-east service", [120, 228], [185, 245], 7),
  street("st-fuel-access", "Fuel area access", [210, 130], [246, 130], 8),
];
for (const taxiway of TAXIWAYS) taxiway.observedDate = "2025-09-13";
// prettier-ignore
export const ROADS: SegmentDef[] = [
  { id: "road-access", kind: "road", name: "South access track", from: compound(68, 228), to: [1560, 3250], width: 8 },
  { id: "road-perim", kind: "road", name: "Perimeter patrol track", from: [1560, 3250], to: [-1100, 2820], width: 7 },
];
// prettier-ignore
export const APRONS: ApronDef[] = [
  { id: "apron-main", name: "Main hangar apron", center: compound(-30, -112), size: [285, 92], rotation: -COMPOUND_ROT },
  { id: "apron-west", name: "West service pad", center: compound(-158, -4), size: [105, 106], rotation: -COMPOUND_ROT },
  { id: "apron-center", name: "Operations hardstand", center: compound(53, 118), size: [112, 90], rotation: -COMPOUND_ROT },
];

const DEFAULT_STRUCTURE_EVIDENCE: Evidence = {
  status: "interpreted",
  confidence: "medium",
  sourceIds: ["sentinel-2-scene-2025", "sentinel-2-handbook"],
  observedOn: "2025-09-28",
  resolutionM: 10,
  method: "Footprint interpreted from public overhead imagery",
  uncertainty:
    "Names, functions, heights, and fine geometry are illustrative unless separately sourced.",
  note: "The modeled footprint is an interpretation, not a surveyed or official facility record.",
};

/**
 * Facilities whose construction is described in public 2025 reporting of
 * commercial satellite imagery (three fighter-sized hangars on the western
 * edge, a >300 ft main hangar, expanded fuel storage, new utility buildings,
 * resurfaced taxiways, and further building to the south-east). The reporting
 * establishes that a structure is there; its exact placement, size and
 * function here remain a modeled interpretation.
 */
const REPORTED_2025_EVIDENCE: Evidence = {
  status: "reported",
  confidence: "medium",
  sourceIds: ["twz-aircraft-2025", "nsj-airfield-2025", "npr-airfield-expansion"],
  observedOn: "2025-09-13",
  method: "Facility construction reported from analysis of commercial satellite imagery",
  uncertainty:
    "Reporting confirms the build-out; exact footprint, dimensions and internal function are modeled and not officially confirmed.",
  note: "Position and identity follow public reporting; the modeled geometry is illustrative, not a surveyed facility record.",
};

/**
 * Support buildings placed against the reported "new utility buildings"
 * build-out. A utility cluster is reported; whether any specific block is a
 * dormitory, pump house or shop is this model's interpretation.
 */
const UTILITY_INTERPRETED_EVIDENCE: Evidence = {
  status: "interpreted",
  confidence: "low",
  sourceIds: ["twz-aircraft-2025", "sentinel-2-scene-2025"],
  observedOn: "2025-09-28",
  resolutionM: 10,
  method: "Placed against reported new utility construction; specific use interpreted",
  uncertainty:
    "The reported utility build-out is real; this block's identity, size and exact position are interpreted.",
  note: "An interpreted support building, not a verified or officially designated facility.",
};

/**
 * Plausible operational infrastructure — power, water, comms, sensors,
 * security and sanitation — that a remote, high-security flight-test base of
 * this size requires. These are NOT resolved as specific features in the
 * cited 10 m public imagery; they complete the site as illustrative context.
 */
const OPERATIONAL_ILLUSTRATIVE_EVIDENCE: Evidence = {
  status: "illustrative",
  confidence: "low",
  sourceIds: ["sentinel-2-scene-2025"],
  method:
    "Plausible operational infrastructure for a base of this class; not resolved as a specific feature in the cited imagery",
  uncertainty:
    "Type, count and placement are illustrative and should not be read as observed facilities.",
  note: "Illustrative operational infrastructure added for completeness, not an observation of a specific structure on site.",
};

const building = (
  id: string,
  type: StructureType,
  name: string,
  u: number,
  v: number,
  size: [number, number, number],
  rotation = COMPOUND_ROT,
  description = "Structure interpreted from public overhead imagery.",
  evidence: Evidence = DEFAULT_STRUCTURE_EVIDENCE,
): StructureDef => ({
  id,
  type,
  name,
  position: compound(u, v),
  rotation,
  size,
  modelBasis: "Illustrative footprint",
  description,
  evidence,
});
// prettier-ignore
const STRUCTURE_DEFS: StructureDef[] = [
  // North-west service group and dominant assembly hall.
  building("west-long", "warehouse", "West longitudinal workshop", -177, -7, [24, 8, 78]),
  building("west-core", "warehouse", "West central shop", -139, -14, [38, 10, 60]),
  building("west-link", "support", "West connector", -105, -19, [20, 7, 78]),
  building("hangar-main", "hangar-monolith", "Main assembly hangar", -36, -30, [126, 22, 78], COMPOUND_ROT, "Large white rectangular hall with shallow roof, long facade bands, and runway-facing apron."),

  // North-east isolated structures.
  building("north-shed", "quonset", "North arched shed", 146, -112, [48, 11, 24], COMPOUND_ROT + Math.PI / 2),
  building("north-utility", "warehouse", "North utility hall", 202, -112, [36, 9, 20], COMPOUND_ROT + Math.PI / 2),
  building("tower-main", "tower", "Central test tower", 75, -25, [22, 30, 22]),

  // East block: three long bars and attached technical spine.
  building("east-north", "warehouse", "East north laboratory", 164, 78, [54, 9, 25]),
  building("east-middle", "hq", "East technical block", 185, 130, [28, 12, 48]),
  building("east-middle-wing", "support", "East technical wing", 157, 130, [28, 7, 22]),
  building("east-south", "warehouse", "East south laboratory", 165, 178, [58, 9, 24]),

  // Central L-shaped operations complex, expressed as its visible wings.
  building("ops-north", "hq", "Operations north wing", 38, 91, [65, 10, 22]),
  building("ops-west", "support", "Operations west wing", 11, 126, [23, 9, 60]),
  building("ops-east", "support", "Operations east wing", 65, 134, [20, 8, 42]),
  building("ops-court", "compound-walled", "Operations courtyard", 42, 132, [48, 3.5, 42]),

  // West-central U-shaped service courts.
  building("court-west", "compound-walled", "West equipment court", -151, 128, [62, 4, 65]),
  building("court-west-core", "support", "West court plant", -151, 119, [20, 6, 17]),
  building("court-center", "compound-walled", "Central service court", -77, 125, [59, 4, 58]),
  building("court-center-north", "warehouse", "Central court north hall", -78, 97, [45, 7, 17]),
  building("court-center-east", "support", "Central court east annex", -50, 124, [14, 7, 38]),

  // Southern buildings and pads.
  building("south-west", "warehouse", "South west stores", -77, 210, [52, 8, 18]),
  building("south-west-small", "support", "South west utility", -78, 176, [29, 6, 14]),
  building("south-center", "warehouse", "South central hall", -22, 217, [48, 8, 18]),

  // Parked outside the main hangar on the central apron in the reported
  // September image. Wingspan is the ~50 ft the cited report measures off
  // that image; length follows its "slightly shorter than the J-36".
  building(
    "jxds-prototype",
    "aircraft-jxds",
    "J-XDS prototype (reported)",
    -60,
    -100,
    [15.2, 3, 17.5],
    COMPOUND_ROT - 0.72,
    "A dark tailless aircraft commonly called J-XDS in public reporting; the name and capabilities are not official.",
    {
      status: "reported",
      confidence: "medium",
      sourceIds: ["twz-aircraft-2025"],
      observedOn: "2025-09-13",
      method:
        "Identity and position reported from commercial satellite imagery; wingspan (~50 ft) taken from the measurement stated in that reporting, length inferred from its description as slightly shorter than the J-36; external shape massed from widely circulated photographs of the airframe",
      uncertainty:
        "Aircraft name and role are not official. The stated wingspan is a single third-party measurement off a satellite image; length is inferred, not measured. The parking spot is placed on the apron in front of the main hangar as described, not surveyed. The shape follows photographs whose provenance and authenticity cannot be verified, and captures only the gross lambda planform, twin exhausts and blended centrebody.",
      note: "The model is illustrative and should not be read as an authoritative aircraft identification.",
    },
  ),
  // Also parked outside the main hangar, in the reported August image.
  // ~65 ft span and ~62 ft length are the figures stated in that reporting,
  // which makes this airframe slightly wider than it is long.
  building(
    "j36-prototype",
    "aircraft-j36",
    "J-36 prototype (reported)",
    -85,
    -130,
    [19.8, 3, 18.9],
    COMPOUND_ROT - 0.65,
    "A large tailless aircraft commonly called J-36 in public reporting; the name and claimed capabilities are not official.",
    {
      status: "reported",
      confidence: "medium",
      sourceIds: ["twz-aircraft-2025"],
      observedOn: "2025-08-27",
      method:
        "Identity and position reported from commercial satellite imagery; wingspan (~65 ft) and length (~62 ft) taken from the measurements stated in that reporting; external shape massed from widely circulated photographs of the airframe",
      uncertainty:
        "Aircraft name and role are not official. The dimensions are third-party measurements off a single satellite image and carry at least a few feet of error; the parking spot is placed on the apron in front of the main hangar as described, not surveyed. The shape follows photographs whose provenance and authenticity cannot be verified, and captures only the gross planform, trijet exhaust arrangement and blended centrebody.",
      note: "The model is illustrative and should not be read as an authoritative aircraft identification.",
    },
  ),

  /* ---------------------------------------------------------------- */
  /* 2025 build-out reported from commercial satellite imagery.        */
  /* ---------------------------------------------------------------- */

  // Three fighter-sized hangars at the west end of the flight line.
  building(
    "west-fighter-shelters",
    "shelter-row",
    "Western fighter shelters",
    -155,
    -74,
    [66, 12, 26],
    COMPOUND_ROT,
    "A row of three fighter-sized hangars reported on the western edge of the flight line in mid-2025; the bay count matches public reporting, the geometry is modeled.",
    REPORTED_2025_EVIDENCE,
  ),
  // Single larger hangar added at the north-east end of the main apron.
  building(
    "ne-apron-hangar",
    "hangar-monolith",
    "North-east apron hangar",
    96,
    -74,
    [64, 15, 44],
    COMPOUND_ROT,
    "A hangar reported at the north-east end of the enlarged main apron; footprint and roof form are interpreted from public reporting.",
    REPORTED_2025_EVIDENCE,
  ),
  // Expanded fuel storage: bunded vertical tanks set apart to the east.
  building("fuel-tank-a", "fuel-tank", "Fuel tank A", 255, 130, [16, 11, 16], COMPOUND_ROT, "One of several bunded fuel tanks in the reported expanded fuel-storage area east of the compound.", REPORTED_2025_EVIDENCE),
  building("fuel-tank-b", "fuel-tank", "Fuel tank B", 255, 168, [16, 11, 16], COMPOUND_ROT, "One of several bunded fuel tanks in the reported expanded fuel-storage area east of the compound.", REPORTED_2025_EVIDENCE),
  building("fuel-tank-c", "fuel-tank", "Fuel tank C", 291, 149, [16, 11, 16], COMPOUND_ROT, "One of several bunded fuel tanks in the reported expanded fuel-storage area east of the compound.", REPORTED_2025_EVIDENCE),
  building("fuel-pumphouse", "support", "Fuel transfer building", 224, 149, [12, 5, 9], COMPOUND_ROT, "Small transfer/pump building serving the fuel-storage area; identity interpreted.", UTILITY_INTERPRETED_EVIDENCE),
  // Further construction reported to the immediate south-east.
  building("se-build-hall", "warehouse", "South-east new hall", 140, 250, [46, 8, 18], COMPOUND_ROT, "One of the additional buildings reported under construction immediately south-east of the compound in 2025.", REPORTED_2025_EVIDENCE),
  building("se-build-annex", "support", "South-east annex", 185, 242, [30, 6, 16], COMPOUND_ROT, "A smaller structure among the buildings reported under construction south-east of the compound in 2025.", REPORTED_2025_EVIDENCE),

  /* ---------------------------------------------------------------- */
  /* Interpreted new utility construction.                            */
  /* ---------------------------------------------------------------- */
  building("crew-block-a", "barracks", "Crew accommodation A", 35, 262, [46, 8, 16], COMPOUND_ROT, "A dormitory-style block interpreted from the reported new utility construction; specific use is not confirmed.", UTILITY_INTERPRETED_EVIDENCE),
  building("crew-block-b", "barracks", "Crew accommodation B", -40, 262, [46, 8, 16], COMPOUND_ROT, "A second dormitory-style block interpreted from the reported new utility construction; specific use is not confirmed.", UTILITY_INTERPRETED_EVIDENCE),

  /* ---------------------------------------------------------------- */
  /* Illustrative operational infrastructure (not resolved in the      */
  /* cited 10 m imagery) that completes a base of this class.          */
  /* ---------------------------------------------------------------- */
  building("solar-field", "solar-array", "Photovoltaic field", -70, 322, [86, 3, 60], COMPOUND_ROT, "A ground-mounted solar field. The site's very high summer insolation makes on-site PV plausible, but no array is resolved in the cited imagery.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("main-switchyard", "transformer-yard", "Main switchyard", -150, 285, [30, 6, 24], COMPOUND_ROT, "A fenced high-voltage switchyard distributing site power. Illustrative operational infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("water-tank-tower", "water-tower", "Elevated water tank", 150, 210, [10, 22, 10], COMPOUND_ROT, "An elevated water tank for domestic and fire supply. Illustrative operational infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("wastewater-plant", "sewage-treatment", "Wastewater plant", -190, 220, [40, 5, 40], COMPOUND_ROT, "A compact wastewater-treatment plant sited down the prevailing north-east wind. Illustrative operational infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("air-search-radome", "radome", "Air-search radome", 320, 10, [12, 10, 12], COMPOUND_ROT, "A protected air-search/precision-approach radome. Illustrative sensor infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("comms-shelter-main", "comms-shelter", "Communications shelter", 120, 25, [14, 5, 10], COMPOUND_ROT, "A hardened communications shelter with an antenna farm. Illustrative operational infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("gate-guardhouse", "guardhouse", "Main gate guardhouse", 78, 236, [4, 3, 4], COMPOUND_ROT, "A guardhouse and barrier at the compound's south access gate. Illustrative security infrastructure for a high-security site, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("guard-tower-nw", "guard-tower", "Perimeter tower (west)", -210, 120, [3, 9, 3], COMPOUND_ROT, "A perimeter observation tower. Illustrative security infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("guard-tower-se", "guard-tower", "Perimeter tower (south-east)", 315, 195, [3, 9, 3], COMPOUND_ROT, "A perimeter observation tower. Illustrative security infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
  building("ops-walkway", "covered-walkway", "Covered walkway", 0, 175, [4, 3, 40], COMPOUND_ROT, "A roofed pedestrian corridor between the operations complex and the crew blocks. Illustrative infrastructure, not a resolved feature.", OPERATIONAL_ILLUSTRATIVE_EVIDENCE),
];

// prettier-ignore
const STRUCTURE_OBSERVED_DATES: Readonly<Partial<Record<string, string>>> = {
  'jxds-prototype': '2025-09-13',
  'j36-prototype': '2025-08-27',
  'west-fighter-shelters': '2025-09-13',
  'ne-apron-hangar': '2025-09-13',
  'fuel-tank-a': '2025-09-13',
  'fuel-tank-b': '2025-09-13',
  'fuel-tank-c': '2025-09-13',
  'fuel-pumphouse': '2025-09-28',
  'se-build-hall': '2025-09-13',
  'se-build-annex': '2025-09-13',
  'crew-block-a': '2025-09-28',
  'crew-block-b': '2025-09-28',
};

export const STRUCTURES: StructureDef[] = STRUCTURE_DEFS.map((structure) => {
  const observedDate = STRUCTURE_OBSERVED_DATES[structure.id];
  return observedDate === undefined ? structure : { ...structure, observedDate };
});

/**
 * Apron viewpoint looking at the parked J-XDS. Currently unread — the FPS rig
 * drops the camera at its current position rather than spawning here — but
 * kept in step with the aircraft it points at.
 */
export const FPS_SPAWN = {
  position: compound(-39, -78),
  target: compound(-60, -100),
};

// prettier-ignore
export const FLATTEN_PADS: FlattenPad[] = [
  { center: COMPOUND_ORIGIN, radius: 430 },
  { center: [792, 975], radius: 300 },
];
// prettier-ignore
export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [-1006, 150, 2711], label: "Runway 05 threshold" },
  { position: [792, 195, 975], label: "Runway center" },
  { position: [770, 150, 1130], label: "Compound taxiway" },
  { position: [1138, 175, 1660], label: "Airfield compound" },
  { position: [970, 100, 1415], label: "Main assembly hall" },
  { position: [1060, 95, 1340], label: "Central tower" },
  { position: [2591, 185, -762], label: "Runway 23 threshold" },
  { position: [-2591, 240, -2711], label: "North-west apex" },
];
// prettier-ignore
export const ALL_SEGMENTS: SegmentDef[] = [...RUNWAYS, ...STRIPS, ...TAXIWAYS, ...STREETS, ...ROADS];

/* ------------------------------------------------------------------ */
/* Ground-level engagement zones (used by the first-person mode)       */
/* ------------------------------------------------------------------ */

export interface GroundZone {
  id: string;
  name: string;
  /** Centre in world metres. */
  position: [number, number];
  /** Usable radius for spawn scatter and objective capture, in metres. */
  radius: number;
  /** Which side of the compound this zone favours. */
  side: "north" | "south" | "neutral";
}

/**
 * Named places inside the compound, expressed in the same compound frame as
 * every structure. Ground modes derive spawns and objectives from these rather
 * than hard-coding world coordinates, so moving a building in `STRUCTURES`
 * moves the fight with it.
 */
// prettier-ignore
export const GROUND_ZONES: readonly GroundZone[] = [
  { id: "main-apron", name: "Main Apron", position: compound(-30, -128), radius: 46, side: "neutral" },
  { id: "flight-line", name: "Flight Line", position: compound(-88, -118), radius: 30, side: "north" },
  { id: "ne-apron", name: "North-East Apron", position: compound(96, -112), radius: 34, side: "north" },
  { id: "fighter-shelters", name: "Fighter Shelters", position: compound(-155, -50), radius: 30, side: "north" },
  { id: "hangar-front", name: "Assembly Hangar", position: compound(-36, 18), radius: 30, side: "neutral" },
  { id: "tower-yard", name: "Tower Yard", position: compound(75, 8), radius: 26, side: "neutral" },
  { id: "ops-complex", name: "Operations Complex", position: compound(38, 128), radius: 34, side: "south" },
  { id: "west-courts", name: "West Service Courts", position: compound(-114, 128), radius: 40, side: "south" },
  { id: "east-labs", name: "East Laboratories", position: compound(178, 128), radius: 34, side: "neutral" },
  { id: "fuel-farm", name: "Fuel Farm", position: compound(262, 148), radius: 40, side: "neutral" },
  { id: "crew-blocks", name: "Crew Blocks", position: compound(-2, 262), radius: 40, side: "south" },
  { id: "se-construction", name: "South-East Construction", position: compound(160, 248), radius: 32, side: "south" },
  { id: "switchyard", name: "Switchyard", position: compound(-150, 285), radius: 24, side: "south" },
  { id: "solar-field", name: "Photovoltaic Field", position: compound(-70, 322), radius: 40, side: "south" },
];

export function getGroundZone(id: string): GroundZone | undefined {
  return GROUND_ZONES.find((zone) => zone.id === id);
}

/**
 * A good establishing viewpoint for the ground mode: standing on the main
 * apron, looking north-west along the flight line at the parked airframes and
 * the assembly hangar behind them.
 */
export const GROUND_OVERLOOK: { position: [number, number]; target: [number, number] } = {
  position: compound(52, -152),
  target: compound(-78, -108),
};

/** Parse a validated ISO date's leading year without constructing a Date. */
export function getObservedYear(item: TemporalDef): number | undefined {
  const date = item.observedDate;
  if (
    date === undefined ||
    date.length !== 10 ||
    date.charCodeAt(4) !== 45 ||
    date.charCodeAt(7) !== 45
  ) {
    return undefined;
  }
  let year = 0;
  for (let index = 0; index < 4; index += 1) {
    const digit = date.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return undefined;
    year = year * 10 + digit;
  }
  return year;
}

export function isVisibleAtTimelineYear(item: TemporalDef, year: number): boolean {
  const observedYear = getObservedYear(item);
  return observedYear === undefined || year >= observedYear;
}

const TEMPORAL_LAYOUT_RECORDS: readonly TemporalDef[] = [
  ...ALL_SEGMENTS,
  ...APRONS,
  ...STRUCTURES,
];
const DATED_LAYOUT_RECORDS = TEMPORAL_LAYOUT_RECORDS.filter(
  (record) => getObservedYear(record) !== undefined,
);
const DATED_LAYOUT_YEARS = DATED_LAYOUT_RECORDS.map((record) => getObservedYear(record)!);
const TIMELINE_FALLBACK_YEAR = 2025;

export const TIMELINE_BOUNDS: Readonly<{ minYear: number; maxYear: number }> =
  Object.freeze({
    minYear:
      DATED_LAYOUT_YEARS.length > 0
        ? Math.min(...DATED_LAYOUT_YEARS)
        : TIMELINE_FALLBACK_YEAR,
    maxYear:
      DATED_LAYOUT_YEARS.length > 0
        ? Math.max(...DATED_LAYOUT_YEARS)
        : TIMELINE_FALLBACK_YEAR,
  });

export function getVisibleDatedAdditionCount(year: number): number {
  let count = 0;
  for (const record of DATED_LAYOUT_RECORDS) {
    if (isVisibleAtTimelineYear(record, year)) count += 1;
  }
  return count;
}

// prettier-ignore
export function segmentLength(seg: SegmentDef): number { return Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
// prettier-ignore
export function segmentAngle(seg: SegmentDef): number { return Math.atan2(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
// prettier-ignore
export function segmentCenter(seg: SegmentDef): [number, number] { return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2]; }
const STRUCTURE_INDEX = new Map(STRUCTURES.map((structure) => [structure.id, structure]));
// prettier-ignore
export function getStructure(id: string): StructureDef | undefined { return STRUCTURE_INDEX.get(id); }
// prettier-ignore
export function isAircraft(type: StructureType): boolean { return type.startsWith("aircraft-"); }
// prettier-ignore
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower", "hangar-monolith": "Hangars", "shelter-row": "Hangars", quonset: "Hangars", warehouse: "Storage", hq: "Support Buildings", barracks: "Support Buildings", support: "Support Buildings", "compound-walled": "Walled Yards", guardhouse: "Support Buildings", radome: "Sensors", "fuel-tank": "Fuel Farm", "solar-array": "Power & Utilities", "water-tower": "Power & Utilities", "comms-shelter": "Sensors", "transformer-yard": "Power & Utilities", "guard-tower": "Security", "covered-walkway": "Support Buildings", "sewage-treatment": "Power & Utilities", "aircraft-delta": "Aircraft", "aircraft-fighter": "Aircraft", "aircraft-j36": "Aircraft", "aircraft-jxds": "Aircraft",
};

export interface AircraftAnalysisProfile {
  label: string;
  scenarioRadiusM: number;
  radarRangeM: number;
  radarFovDeg: number;
  altitudeM?: number;
  disclaimer: string;
}

export const CIRCUIT_AIRCRAFT_ID = "circuit-aircraft-demonstrator";

const NOTIONAL_ANALYSIS_DISCLAIMER =
  "Illustrative local scenario geometry only; not operational data or a verified aircraft-performance claim.";

export const AIRCRAFT_ANALYSIS_PROFILES = {
  "aircraft-delta": {
    label: "Tailless demonstrator",
    scenarioRadiusM: 900,
    radarRangeM: 600,
    radarFovDeg: 75,
    disclaimer: NOTIONAL_ANALYSIS_DISCLAIMER,
  },
  "aircraft-fighter": {
    label: "Fighter demonstrator",
    scenarioRadiusM: 800,
    radarRangeM: 550,
    radarFovDeg: 65,
    disclaimer: NOTIONAL_ANALYSIS_DISCLAIMER,
  },
  "aircraft-j36": {
    label: "J-36 (reported) — notional scenario",
    scenarioRadiusM: 1_200,
    radarRangeM: 800,
    radarFovDeg: 70,
    disclaimer: NOTIONAL_ANALYSIS_DISCLAIMER,
  },
  "aircraft-jxds": {
    label: "J-XDS (reported) — notional scenario",
    scenarioRadiusM: 1_000,
    radarRangeM: 700,
    radarFovDeg: 80,
    disclaimer: NOTIONAL_ANALYSIS_DISCLAIMER,
  },
  [CIRCUIT_AIRCRAFT_ID]: {
    label: "Resident circuit demonstrator",
    scenarioRadiusM: 1_400,
    radarRangeM: 900,
    radarFovDeg: 85,
    altitudeM: 80,
    disclaimer: NOTIONAL_ANALYSIS_DISCLAIMER,
  },
} as const satisfies Readonly<Record<string, AircraftAnalysisProfile>>;

export function getAircraftAnalysisProfile(
  id: string,
): AircraftAnalysisProfile | undefined {
  if (id === CIRCUIT_AIRCRAFT_ID) return AIRCRAFT_ANALYSIS_PROFILES[CIRCUIT_AIRCRAFT_ID];
  const structure = getStructure(id);
  if (!structure || !isAircraft(structure.type)) return undefined;
  return AIRCRAFT_ANALYSIS_PROFILES[
    structure.type as keyof typeof AIRCRAFT_ANALYSIS_PROFILES
  ];
}

/* ------------------------------------------------------------------ */
/* Dynamic props (animated scene dressing — see LivingScene.tsx).       */
/* Positions still live here so layout.ts stays the single source of    */
/* truth; the components only read them.                                */
/* ------------------------------------------------------------------ */

/** Windsock beside the apron and a slow-rotating air-search radar east of it. */
export const WINDSOCK_POS: [number, number] = compound(206, -26);
export const RADAR_POS: [number, number] = compound(300, 74);

/** Closed patrol loop following the modeled compound perimeter streets. */
export const PERIMETER_PATROL_ROUTE: readonly (readonly [number, number])[] = (() => {
  const north = STREETS.find((segment) => segment.id === "st-north")!;
  const south = STREETS.find((segment) => segment.id === "st-south")!;
  return [north.from, north.to, south.to, south.from, north.from];
})();

/**
 * Flight circuit for the resident demonstrator: a low high-speed pass up
 * runway 05→23, a climb-out, and a downwind teardrop on the open (north-west)
 * side back onto final. Derived from the runway threshold coordinates so the
 * pattern always tracks the runway. `[x, y, z]`, closed loop.
 */
export const CIRCUIT_WAYPOINTS: [number, number, number][] = (() => {
  const rwy = RUNWAYS[0]!;
  const A: [number, number] = rwy.from; // 05 threshold (SW)
  const B: [number, number] = rwy.to; // 23 end (NE)
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const u: [number, number] = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
  const nw: [number, number] = [u[1], -u[0]]; // perpendicular, toward open desert
  const p = (
    base: [number, number],
    along: number,
    side: number,
    y: number,
  ): [number, number, number] => [
    base[0] + u[0] * along + nw[0] * side,
    y,
    base[1] + u[1] * along + nw[1] * side,
  ];
  const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  return [
    p(A, -650, 0, 180),
    p(A, -180, 0, 80),
    p(A, 60, 0, 80),
    p(mid, 0, 0, 80),
    p(B, -40, 0, 80),
    p(B, 500, 0, 220),
    p(B, 250, 700, 310),
    p(mid, 0, 1000, 330),
    p(A, -150, 900, 280),
  ];
})();
export const CIRCUIT_MIN_CLEARANCE_M = 45;

/* ------------------------------------------------------------------ */
/* Mission entities                                                    */
/* ------------------------------------------------------------------ */

export type MissionEntityKind =
  | "site"
  | "terrain"
  | "environment"
  | "pavement"
  | "structure"
  | "aircraft"
  | "vehicle"
  | "sensor"
  | "route";

export type MissionCapability =
  | "selectable"
  | "camera-focus"
  | "timeline-visibility"
  | "analysis-envelope"
  | "surface-support"
  | "route-sampling"
  | "deterministic-motion"
  | "night-signaling"
  | "environment-sensing"
  | "telemetry-position"
  | "scenario-context";

export type MissionTaskId =
  | "inspect"
  | "focus-camera"
  | "apply-timeline"
  | "analyze-envelope"
  | "provide-surface"
  | "sample-route"
  | "fly-circuit"
  | "patrol-perimeter"
  | "freeze-at-seeded-phase"
  | "signal-at-night"
  | "indicate-wind"
  | "rotate-illustrative-scan"
  | "track-live-position"
  | "apply-climatology";

export type MissionRelationshipKind =
  "part-of" | "follows-route" | "supported-by" | "derived-from";

export type MissionTimestampKind =
  | "calendar-observation"
  | "source-snapshot"
  | "climatology-window"
  | "simulation-clock"
  | "live-feed"
  | "unknown";

export interface MissionObservation {
  /** Timestamp of the best available source or simulation clock; null means unknown. */
  timestamp: string | null;
  timestampKind: MissionTimestampKind;
  /** Asset-visibility date. Undefined values intentionally remain timeless in the UI. */
  observedDate?: string;
  /** Evidence/source metadata, kept distinct from asset visibility. */
  evidenceObservedOn?: string;
  status: EvidenceStatus | "simulated" | "unknown";
  confidence: EvidenceConfidence | "unknown";
  sourceIds: readonly SourceId[];
  note: string;
}

export interface MissionRelationship {
  kind: MissionRelationshipKind;
  targetId: string;
}

export interface TaskableBehaviorDef {
  id: MissionTaskId;
  label: string;
  execution: "discrete" | "reactive" | "simulation-clock";
}

export interface MissionEntityDef extends TemporalDef {
  id: string;
  kind: MissionEntityKind;
  label: string;
  observation: MissionObservation;
  capabilities: readonly MissionCapability[];
  relationships: readonly MissionRelationship[];
  taskableBehaviors: readonly TaskableBehaviorDef[];
}

export const MISSION_SITE_ID = "site-lop-nur-airfield";
export const TERRAIN_ENTITY_ID = "terrain-site-surface";
export const ENVIRONMENT_ENTITY_ID = "environment-climatology";
export const PERIMETER_ROUTE_ENTITY_ID = "route-perimeter-patrol";
export const CIRCUIT_ROUTE_ENTITY_ID = "route-resident-circuit";
export const RADAR_ENTITY_ID = "sensor-illustrative-radar";
export const WINDSOCK_ENTITY_ID = "sensor-windsock";
export const PATROL_ENTITY_IDS = [
  "patrol-vehicle-01",
  "patrol-vehicle-02",
  "patrol-vehicle-03",
] as const;

const TASK_INSPECT: TaskableBehaviorDef = {
  id: "inspect",
  label: "Inspect entity record",
  execution: "discrete",
};
const TASK_FOCUS: TaskableBehaviorDef = {
  id: "focus-camera",
  label: "Focus camera",
  execution: "discrete",
};
const TASK_TIMELINE: TaskableBehaviorDef = {
  id: "apply-timeline",
  label: "Apply temporal visibility",
  execution: "reactive",
};
const TASK_ANALYZE: TaskableBehaviorDef = {
  id: "analyze-envelope",
  label: "Draw notional analysis envelope",
  execution: "reactive",
};
const PART_OF_SITE: readonly MissionRelationship[] = [
  { kind: "part-of", targetId: MISSION_SITE_ID },
];

function structureObservation(structure: StructureDef): MissionObservation {
  const timestamp = structure.observedDate ?? structure.evidence.observedOn ?? null;
  return {
    timestamp,
    timestampKind:
      structure.observedDate !== undefined
        ? "calendar-observation"
        : structure.evidence.observedOn !== undefined
          ? "source-snapshot"
          : "unknown",
    observedDate: structure.observedDate,
    evidenceObservedOn: structure.evidence.observedOn,
    status: structure.evidence.status,
    confidence: structure.evidence.confidence,
    sourceIds: structure.evidence.sourceIds,
    note: structure.evidence.note,
  };
}

function pavementObservation(item: SegmentDef | ApronDef): MissionObservation {
  const dated = item.observedDate !== undefined;
  const isRunway = "kind" in item && item.kind === "runway";
  const isTaxiway = "kind" in item && item.kind === "taxiway";
  const sourceIds: readonly SourceId[] = isRunway
    ? ["npr-airfield-expansion"]
    : isTaxiway
      ? ["twz-aircraft-2025", "nsj-airfield-2025"]
      : ["sentinel-2-scene-2025"];
  const evidenceObservedOn = item.observedDate ?? "2025-09-28";
  return {
    timestamp: evidenceObservedOn,
    timestampKind: dated ? "calendar-observation" : "source-snapshot",
    observedDate: item.observedDate,
    evidenceObservedOn,
    status: dated ? "reported" : "illustrative",
    confidence: dated ? "medium" : "low",
    sourceIds,
    note: dated
      ? "Timeline visibility follows the cited public observation; exact geometry remains modeled."
      : "The source snapshot timestamps this illustrative layout record, not its construction; construction date remains unknown.",
  };
}

function simulatedObservation(note: string): MissionObservation {
  return {
    timestamp: "scene-clock",
    timestampKind: "simulation-clock",
    status: "simulated",
    confidence: "unknown",
    sourceIds: [],
    note,
  };
}

const PAVEMENT_MISSION_ENTITIES: MissionEntityDef[] = [
  ...ALL_SEGMENTS.map((segment): MissionEntityDef => ({
    id: segment.id,
    kind: "pavement",
    label: segment.name,
    observedDate: segment.observedDate,
    observation: pavementObservation(segment),
    capabilities: ["timeline-visibility", "surface-support"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      TASK_TIMELINE,
      { id: "provide-surface", label: "Provide modeled surface", execution: "reactive" },
    ],
  })),
  ...APRONS.map((apron): MissionEntityDef => ({
    id: apron.id,
    kind: "pavement",
    label: apron.name,
    observedDate: apron.observedDate,
    observation: pavementObservation(apron),
    capabilities: ["timeline-visibility", "surface-support"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      TASK_TIMELINE,
      { id: "provide-surface", label: "Provide modeled surface", execution: "reactive" },
    ],
  })),
];

const STRUCTURE_MISSION_ENTITIES: MissionEntityDef[] = STRUCTURES.map(
  (structure): MissionEntityDef => {
    const aircraft = isAircraft(structure.type);
    return {
      id: structure.id,
      kind: aircraft ? "aircraft" : "structure",
      label: structure.name,
      observedDate: structure.observedDate,
      observation: structureObservation(structure),
      capabilities: aircraft
        ? ["selectable", "camera-focus", "timeline-visibility", "analysis-envelope"]
        : ["selectable", "camera-focus", "timeline-visibility"],
      relationships: PART_OF_SITE,
      taskableBehaviors: aircraft
        ? [TASK_INSPECT, TASK_FOCUS, TASK_TIMELINE, TASK_ANALYZE]
        : [TASK_INSPECT, TASK_FOCUS, TASK_TIMELINE],
    };
  },
);

const PATROL_MISSION_ENTITIES: MissionEntityDef[] = PATROL_ENTITY_IDS.map(
  (id, index): MissionEntityDef => ({
    id,
    kind: "vehicle",
    label: `Perimeter patrol ${index + 1}`,
    observation: simulatedObservation(
      "Illustrative seeded patrol asset; phase, direction, and speed are deterministic scenario values.",
    ),
    capabilities: ["deterministic-motion", "route-sampling", "night-signaling"],
    relationships: [
      { kind: "part-of", targetId: MISSION_SITE_ID },
      { kind: "follows-route", targetId: PERIMETER_ROUTE_ENTITY_ID },
    ],
    taskableBehaviors: [
      {
        id: "patrol-perimeter",
        label: "Patrol perimeter",
        execution: "simulation-clock",
      },
      {
        id: "freeze-at-seeded-phase",
        label: "Freeze at seeded phase",
        execution: "reactive",
      },
      { id: "signal-at-night", label: "Signal at night", execution: "reactive" },
    ],
  }),
);

export const MISSION_ENTITIES: readonly MissionEntityDef[] = Object.freeze([
  {
    id: MISSION_SITE_ID,
    kind: "site",
    label: SITE_PROFILE.name,
    observation: {
      timestamp: "2025-09-28",
      timestampKind: "source-snapshot",
      evidenceObservedOn: "2025-09-28",
      status: "interpreted",
      confidence: "medium",
      sourceIds: ["sentinel-2-scene-2025", "npr-airfield-expansion"],
      note: "Local mission frame derived from public reporting and imagery; not an official site record.",
    },
    capabilities: ["scenario-context"],
    relationships: [],
    taskableBehaviors: [TASK_INSPECT],
  },
  {
    id: TERRAIN_ENTITY_ID,
    kind: "terrain",
    label: "Deterministic terrain surface",
    observation: {
      timestamp: null,
      timestampKind: "unknown",
      status: "interpreted",
      confidence: "low",
      sourceIds: ["copernicus-dem"],
      note: "Deterministic terrain proxy informed by the cited DEM source; no runtime terrain download or surveyed timestamp.",
    },
    capabilities: ["surface-support", "scenario-context"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      {
        id: "provide-surface",
        label: "Provide deterministic terrain",
        execution: "reactive",
      },
    ],
  },
  {
    id: ENVIRONMENT_ENTITY_ID,
    kind: "environment",
    label: "Monthly climatology environment",
    observation: {
      timestamp: "2001-2020",
      timestampKind: "climatology-window",
      status: "observed",
      confidence: "medium",
      sourceIds: ["nasa-power-climatology"],
      note: "Monthly climatological means, not live weather or a historical condition for a specific day.",
    },
    capabilities: ["scenario-context", "environment-sensing"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      {
        id: "apply-climatology",
        label: "Apply climatology month",
        execution: "discrete",
      },
    ],
  },
  {
    id: PERIMETER_ROUTE_ENTITY_ID,
    kind: "route",
    label: "Perimeter patrol route",
    observation: simulatedObservation(
      "Illustrative closed route derived from layout coordinates; not a surveyed security route.",
    ),
    capabilities: ["route-sampling", "scenario-context"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      {
        id: "sample-route",
        label: "Sample closed patrol route",
        execution: "simulation-clock",
      },
    ],
  },
  {
    id: CIRCUIT_ROUTE_ENTITY_ID,
    kind: "route",
    label: "Resident demonstrator circuit",
    observation: simulatedObservation(
      "Illustrative circuit derived from the modeled runway; not a published procedure.",
    ),
    capabilities: ["route-sampling", "scenario-context"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      {
        id: "sample-route",
        label: "Sample flight circuit",
        execution: "simulation-clock",
      },
    ],
  },
  ...PAVEMENT_MISSION_ENTITIES,
  ...STRUCTURE_MISSION_ENTITIES,
  ...PATROL_MISSION_ENTITIES,
  {
    id: CIRCUIT_AIRCRAFT_ID,
    kind: "aircraft",
    label: "Resident circuit demonstrator",
    observation: simulatedObservation(
      "Illustrative procedural aircraft following the deterministic resident circuit.",
    ),
    capabilities: [
      "selectable",
      "analysis-envelope",
      "deterministic-motion",
      "route-sampling",
    ],
    relationships: [
      { kind: "part-of", targetId: MISSION_SITE_ID },
      { kind: "follows-route", targetId: CIRCUIT_ROUTE_ENTITY_ID },
    ],
    taskableBehaviors: [
      { id: "fly-circuit", label: "Fly resident circuit", execution: "simulation-clock" },
      {
        id: "freeze-at-seeded-phase",
        label: "Freeze at deterministic origin",
        execution: "reactive",
      },
      TASK_ANALYZE,
    ],
  },
  {
    id: RADAR_ENTITY_ID,
    kind: "sensor",
    label: "Illustrative rotating radar prop",
    observation: simulatedObservation(
      "Illustrative scene sensor with no asserted detection or performance data.",
    ),
    capabilities: ["environment-sensing", "deterministic-motion"],
    relationships: PART_OF_SITE,
    taskableBehaviors: [
      {
        id: "rotate-illustrative-scan",
        label: "Rotate illustrative scan",
        execution: "simulation-clock",
      },
    ],
  },
  {
    id: WINDSOCK_ENTITY_ID,
    kind: "sensor",
    label: "Climatology windsock",
    observation: simulatedObservation(
      "Procedural indicator driven by monthly climatology, not live measured wind.",
    ),
    capabilities: ["environment-sensing", "deterministic-motion"],
    relationships: [
      { kind: "part-of", targetId: MISSION_SITE_ID },
      { kind: "derived-from", targetId: ENVIRONMENT_ENTITY_ID },
    ],
    taskableBehaviors: [
      { id: "indicate-wind", label: "Indicate climatology wind", execution: "reactive" },
    ],
  },
]);

const MISSION_ENTITY_INDEX = new Map<string, MissionEntityDef>(
  MISSION_ENTITIES.map((entity) => [entity.id, entity]),
);

export function getMissionEntity(id: string): MissionEntityDef | undefined {
  return MISSION_ENTITY_INDEX.get(id);
}

export function canTaskMissionEntity(id: string, taskId: MissionTaskId): boolean {
  const entity = getMissionEntity(id);
  return entity?.taskableBehaviors.some((behavior) => behavior.id === taskId) ?? false;
}
