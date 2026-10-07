import { SITE_PROFILE, type Evidence } from "./siteData";

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
export function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

/*
 * Pavement evidence, declared the way structure evidence is, so the ledger has
 * one derivation for every layout subject and nothing else decides a pavement's
 * classification. The runway is dated by the 2021 report that describes it and
 * the taxiways by the 2025 reporting of resurfaced taxiways. Everything else on
 * the ground — strips, streets, roads, aprons — is illustrative layout drawn
 * against the pinned scene, with no date of any kind.
 */
const PAVEMENT_GEOMETRY_CAVEAT =
  "Timeline visibility follows a cited public observation; the modeled centreline, width and endpoints are interpreted from imagery and are not surveyed.";
const RUNWAY_EVIDENCE: Evidence = {
  status: "reported",
  confidence: "medium",
  sourceIds: ["npr-airfield-expansion"],
  observedOn: "2021-06-30",
  uncertainty: PAVEMENT_GEOMETRY_CAVEAT,
  note: "Timeline visibility follows the cited public observation; exact geometry remains modeled.",
};
const TAXIWAY_EVIDENCE: Evidence = {
  status: "reported",
  confidence: "medium",
  sourceIds: ["twz-aircraft-2025", "nsj-airfield-2025"],
  observedOn: "2025-09-13",
  uncertainty: PAVEMENT_GEOMETRY_CAVEAT,
  note: "Timeline visibility follows the cited public observation; exact geometry remains modeled.",
};
const ILLUSTRATIVE_PAVEMENT_EVIDENCE: Evidence = {
  status: "illustrative",
  confidence: "low",
  sourceIds: ["sentinel-2-scene-2025"],
  uncertainty:
    "Illustrative pavement geometry. Its construction date is unknown and no cited source resolves it.",
  note: "The source snapshot timestamps this illustrative layout record, not its construction; construction date remains unknown.",
};

/** The evidence a pavement record carries: by kind for segments, illustrative for aprons. */
export function pavementEvidence(item: SegmentDef | ApronDef): Evidence {
  if (!("kind" in item)) return ILLUSTRATIVE_PAVEMENT_EVIDENCE;
  if (item.kind === "runway") return RUNWAY_EVIDENCE;
  if (item.kind === "taxiway") return TAXIWAY_EVIDENCE;
  return ILLUSTRATIVE_PAVEMENT_EVIDENCE;
}

// Measured from a public Sentinel-2 L2A scene; endpoint uncertainty is about 40 m.
// prettier-ignore
export const RUNWAYS: SegmentDef[] = [
  { id: "rwy-05-23", kind: "runway", name: "Main concrete runway 05/23", from: [-1006, 2711], to: [2591, -762], width: 60 },
];
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
  sourceIds: ["sentinel-2-scene-2025"],
  // The handbook states the 10 m ground sample distance the footprint floor is
  // derived from. It documents the method; the scene is the evidence.
  methodSourceIds: ["sentinel-2-handbook"],
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
 *
 * The 2021 NPR report is deliberately not cited here. It describes the
 * airfield as it stood in 2021 and is cited for the runway and the site; it
 * cannot describe hangars first seen in imagery four years after it was
 * published, and citing it made those hangars look publicly reported in 2021.
 */
const REPORTED_2025_EVIDENCE: Evidence = {
  status: "reported",
  confidence: "medium",
  sourceIds: ["twz-aircraft-2025", "nsj-airfield-2025"],
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

/**
 * A structure's date is the date of the observation its evidence rests on —
 * the scene it was traced from, or the imagery the cited reporting describes —
 * and it is derived here rather than listed, so the timeline cannot disagree
 * with the evidence block beside it.
 *
 * It used to be a hand-kept table covering twelve structures. The other
 * twenty-three, traced from the same 2025-09-28 scene, carried no date, so the
 * timeline drew them in 2021 on no cited evidence at all. The date bounds when
 * a structure existed *by*; it is never a construction date.
 *
 * Illustrative content has no date of any kind: it has never been observed
 * anywhere, so it has nothing to be dated by.
 */
export const STRUCTURES: StructureDef[] = STRUCTURE_DEFS.map((structure) => {
  const observedDate =
    structure.evidence.status === "illustrative"
      ? undefined
      : structure.evidence.observedOn;
  return observedDate === undefined ? structure : { ...structure, observedDate };
});

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

// A pavement is dated, like a structure, by the observation its evidence rests
// on. Illustrative pavement has no date of any kind.
for (const item of [...ALL_SEGMENTS, ...APRONS]) {
  const evidence = pavementEvidence(item);
  if (evidence.status !== "illustrative" && evidence.observedOn !== undefined) {
    item.observedDate = evidence.observedOn;
  }
}

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

/**
 * The calendar years the dated layout records span. The scene no longer draws
 * by year — it draws by evidence-timeline date (`drawState.ts`) — but the
 * release manifest publishes this span, and links made when the timeline was a
 * year slider (`?year=`) are mapped through it.
 */
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

// prettier-ignore
export function segmentLength(seg: SegmentDef): number { return Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
// prettier-ignore
export function segmentAngle(seg: SegmentDef): number { return Math.atan2(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
// prettier-ignore
export function segmentCenter(seg: SegmentDef): [number, number] { return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2]; }

/**
 * Footprint corners in site metres, placed exactly as the scene places them.
 * A structure is a group with `rotation.y = rotation`, which takes a local
 * (x, z) to (x·cos r + z·sin r, −x·sin r + z·cos r); an apron is a plane laid
 * with euler [−π/2, 0, −rotation], which is the same yaw with the opposite
 * sign. The two conventions differ, so nothing outside this file re-derives
 * either: the spatial catalog once applied the apron's to every structure and
 * exported each rotated building as its mirror image.
 */
function yawedRectangle(
  center: readonly [number, number],
  width: number,
  depth: number,
  yaw: number,
): [number, number][] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return (
    [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ] as const
  ).map(([x, z]): [number, number] => [
    center[0] + x * cos + z * sin,
    center[1] - x * sin + z * cos,
  ]);
}
// prettier-ignore
export function structureCorners(def: StructureDef): [number, number][] { return yawedRectangle(def.position, def.size[0], def.size[2], def.rotation); }
// prettier-ignore
export function apronCorners(def: ApronDef): [number, number][] { return yawedRectangle(def.center, def.size[0], def.size[1], -def.rotation); }
const STRUCTURE_INDEX = new Map(STRUCTURES.map((structure) => [structure.id, structure]));
// prettier-ignore
export function getStructure(id: string): StructureDef | undefined { return STRUCTURE_INDEX.get(id); }
// prettier-ignore
export function isAircraft(type: StructureType): boolean { return type.startsWith("aircraft-"); }
// prettier-ignore
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower", "hangar-monolith": "Hangars", "shelter-row": "Hangars", quonset: "Hangars", warehouse: "Storage", hq: "Support Buildings", barracks: "Support Buildings", support: "Support Buildings", "compound-walled": "Walled Yards", guardhouse: "Support Buildings", radome: "Sensors", "fuel-tank": "Fuel Farm", "solar-array": "Power & Utilities", "water-tower": "Power & Utilities", "comms-shelter": "Sensors", "transformer-yard": "Power & Utilities", "guard-tower": "Security", "covered-walkway": "Support Buildings", "sewage-treatment": "Power & Utilities", "aircraft-delta": "Aircraft", "aircraft-fighter": "Aircraft", "aircraft-j36": "Aircraft", "aircraft-jxds": "Aircraft",
};

export const CIRCUIT_AIRCRAFT_ID = "circuit-aircraft-demonstrator";

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
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the evidence ledger may make a claim about: the site, its
 * terrain and climatology, every pavement and structure, and the illustrative
 * scenario elements that move. This is a registry of *what exists in the
 * model*, nothing more. It carries no classification, confidence or source —
 * those are claims, and claims live in exactly one place, the ledger in
 * `evidence.ts`. An earlier version of this registry kept its own status field,
 * and it disagreed with the ledger about the climatology (observed here,
 * reported there); the field is gone so the disagreement cannot come back.
 */
export type SiteSubjectKind =
  | "site"
  | "terrain"
  | "environment"
  | "pavement"
  | "structure"
  | "aircraft"
  | "vehicle"
  | "sensor"
  | "route";

/** How one subject relates to another. Shown by the claim inspector. */
export type SiteSubjectRelationshipKind = "part-of" | "follows-route" | "derived-from";

export interface SiteSubjectRelationship {
  kind: SiteSubjectRelationshipKind;
  targetId: string;
}

export interface SiteSubjectDef extends TemporalDef {
  id: string;
  kind: SiteSubjectKind;
  label: string;
  relationships: readonly SiteSubjectRelationship[];
}

export const SITE_SUBJECT_ID = "site-lop-nur-airfield";
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

const PART_OF_SITE: readonly SiteSubjectRelationship[] = [
  { kind: "part-of", targetId: SITE_SUBJECT_ID },
];

export const SITE_SUBJECTS: readonly SiteSubjectDef[] = Object.freeze([
  { id: SITE_SUBJECT_ID, kind: "site", label: SITE_PROFILE.name, relationships: [] },
  {
    id: TERRAIN_ENTITY_ID,
    kind: "terrain",
    label: "Deterministic terrain surface",
    relationships: PART_OF_SITE,
  },
  {
    id: ENVIRONMENT_ENTITY_ID,
    kind: "environment",
    label: "Monthly climatology environment",
    relationships: PART_OF_SITE,
  },
  {
    id: PERIMETER_ROUTE_ENTITY_ID,
    kind: "route",
    label: "Perimeter patrol route",
    relationships: PART_OF_SITE,
  },
  {
    id: CIRCUIT_ROUTE_ENTITY_ID,
    kind: "route",
    label: "Resident demonstrator circuit",
    relationships: PART_OF_SITE,
  },
  ...[...ALL_SEGMENTS, ...APRONS].map((item): SiteSubjectDef => ({
    id: item.id,
    kind: "pavement",
    label: item.name,
    observedDate: item.observedDate,
    relationships: PART_OF_SITE,
  })),
  ...STRUCTURES.map((structure): SiteSubjectDef => ({
    id: structure.id,
    kind: isAircraft(structure.type) ? "aircraft" : "structure",
    label: structure.name,
    observedDate: structure.observedDate,
    relationships: PART_OF_SITE,
  })),
  ...PATROL_ENTITY_IDS.map((id, index): SiteSubjectDef => ({
    id,
    kind: "vehicle",
    label: `Perimeter patrol ${index + 1}`,
    relationships: [
      { kind: "part-of", targetId: SITE_SUBJECT_ID },
      { kind: "follows-route", targetId: PERIMETER_ROUTE_ENTITY_ID },
    ],
  })),
  {
    id: CIRCUIT_AIRCRAFT_ID,
    kind: "aircraft",
    label: "Resident circuit demonstrator",
    relationships: [
      { kind: "part-of", targetId: SITE_SUBJECT_ID },
      { kind: "follows-route", targetId: CIRCUIT_ROUTE_ENTITY_ID },
    ],
  },
  {
    id: RADAR_ENTITY_ID,
    kind: "sensor",
    label: "Illustrative rotating radar prop",
    relationships: PART_OF_SITE,
  },
  {
    id: WINDSOCK_ENTITY_ID,
    kind: "sensor",
    label: "Climatology windsock",
    relationships: [
      { kind: "part-of", targetId: SITE_SUBJECT_ID },
      { kind: "derived-from", targetId: ENVIRONMENT_ENTITY_ID },
    ],
  },
]);

const SITE_SUBJECT_INDEX = new Map<string, SiteSubjectDef>(
  SITE_SUBJECTS.map((subject) => [subject.id, subject]),
);

export function getSiteSubject(id: string): SiteSubjectDef | undefined {
  return SITE_SUBJECT_INDEX.get(id);
}
