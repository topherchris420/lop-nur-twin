import { SITE_PROFILE, type Evidence } from "./siteData";

export const SITE_SIZE = SITE_PROFILE.worldExtentM;

export type SegmentKind = "runway" | "strip" | "taxiway" | "street" | "road";
export interface SegmentDef { id: string; kind: SegmentKind; name: string; from: [number, number]; to: [number, number]; width: number }
export interface ApronDef { id: string; name: string; center: [number, number]; size: [number, number]; rotation: number }
export type StructureType = "tower" | "hangar-monolith" | "shelter-row" | "quonset" | "warehouse" | "hq" | "barracks" | "support" | "compound-walled" | "guardhouse" | "radome" | "fuel-tank" | "solar-array" | "water-tower" | "comms-shelter" | "transformer-yard" | "guard-tower" | "covered-walkway" | "sewage-treatment" | "aircraft-delta" | "aircraft-fighter" | "aircraft-j36" | "aircraft-jxds";
export interface StructureDef { id: string; type: StructureType; name: string; position: [number, number]; rotation: number; size: [number, number, number]; modelBasis: string; description: string; evidence: Evidence }
export interface FlattenPad { center: [number, number]; radius: number }
export interface Waypoint { position: [number, number, number]; label: string }

/**
 * Coordinates use metres in a local east/south frame registered to WGS 84 / UTM
 * zone 45N: +x east, +z south, y up. The layout origin frames the triangular
 * site; the grid constants below anchor the modeled runway midpoint to the
 * public reference coordinate. This is a visualization, not an aeronautical chart.
 */
export const COMPOUND_ROT = 0.7679;
const COMPOUND_ORIGIN: [number, number] = [1018, 1410];
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];
function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

// Measured from a public Sentinel-2 L2A scene; endpoint uncertainty is about 40 m.
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
export const STRIPS: SegmentDef[] = [
  { id: "tri-west", kind: "strip", name: "West graded strip", from: [-2616, -2798], to: [-995, 2750], width: 42 },
  { id: "tri-north", kind: "strip", name: "North graded strip", from: [-2675, -2743], to: [2628, -748], width: 42 },
];
export const TAXIWAYS: SegmentDef[] = [
  { id: "twy-stub", kind: "taxiway", name: "Runway connector", from: [692, 1072], to: compound(8, -205), width: 42 },
  { id: "twy-apron", kind: "taxiway", name: "Apron throat", from: compound(8, -205), to: compound(8, -118), width: 46 },
];

const street = (id: string, name: string, a: [number, number], b: [number, number], width = 8): SegmentDef => ({ id, kind: "street", name, from: compound(...a), to: compound(...b), width });
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
];
export const ROADS: SegmentDef[] = [
  { id: "road-access", kind: "road", name: "South access track", from: compound(68, 228), to: [1560, 3250], width: 8 },
  { id: "road-perim", kind: "road", name: "Perimeter patrol track", from: [1560, 3250], to: [-1100, 2820], width: 7 },
];
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
  uncertainty: "Names, functions, heights, and fine geometry are illustrative unless separately sourced.",
  note: "The modeled footprint is an interpretation, not a surveyed or official facility record.",
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
export const STRUCTURES: StructureDef[] = [
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

  // Prototype parked on the north apron in the supplied September close-up.
  building(
    "jxds-prototype",
    "aircraft-jxds",
    "J-XDS prototype (reported)",
    -112,
    -82,
    [15, 3, 20],
    COMPOUND_ROT - 0.72,
    "A dark tailless aircraft commonly called J-XDS in public reporting; the name and capabilities are not official.",
    {
      status: "reported",
      confidence: "medium",
      sourceIds: ["twz-aircraft-2025"],
      observedOn: "2025-09-13",
      method: "Position and identity reported from commercial satellite imagery",
      uncertainty: "Aircraft name, role, dimensions, and exact parking position are not independently verified.",
      note: "The model is illustrative and should not be read as an authoritative aircraft identification.",
    },
  ),
  building(
    "j36-prototype",
    "aircraft-j36",
    "J-36 prototype (reported)",
    -85,
    -130,
    [18, 3, 24],
    COMPOUND_ROT - 0.65,
    "A large tailless aircraft commonly called J-36 in public reporting; the name and claimed capabilities are not official.",
    {
      status: "reported",
      confidence: "medium",
      sourceIds: ["twz-aircraft-2025"],
      observedOn: "2025-08-27",
      method: "Position and identity reported from commercial satellite imagery",
      uncertainty: "Aircraft name, role, dimensions, and exact parking position are not independently verified.",
      note: "The model is illustrative and should not be read as an authoritative aircraft identification.",
    },
  ),
];

export const FPS_SPAWN = {
  position: compound(-91, -60) as [number, number],
  target: compound(-112, -82) as [number, number],
};

export const FLATTEN_PADS: FlattenPad[] = [
  { center: COMPOUND_ORIGIN, radius: 430 },
  { center: [792, 975], radius: 300 },
];
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
export const ALL_SEGMENTS: SegmentDef[] = [...RUNWAYS, ...STRIPS, ...TAXIWAYS, ...STREETS, ...ROADS];
export function segmentLength(seg: SegmentDef): number { return Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
export function segmentAngle(seg: SegmentDef): number { return Math.atan2(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
export function segmentCenter(seg: SegmentDef): [number, number] { return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2]; }
const STRUCTURE_INDEX = new Map(STRUCTURES.map((structure) => [structure.id, structure]));
export function getStructure(id: string): StructureDef | undefined { return STRUCTURE_INDEX.get(id); }
export function isAircraft(type: StructureType): boolean { return type.startsWith("aircraft-"); }
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower", "hangar-monolith": "Hangars", "shelter-row": "Hangars", quonset: "Hangars", warehouse: "Storage", hq: "Support Buildings", barracks: "Support Buildings", support: "Support Buildings", "compound-walled": "Walled Yards", guardhouse: "Support Buildings", radome: "Sensors", "fuel-tank": "Fuel Farm", "solar-array": "Power & Utilities", "water-tower": "Power & Utilities", "comms-shelter": "Sensors", "transformer-yard": "Power & Utilities", "guard-tower": "Security", "covered-walkway": "Support Buildings", "sewage-treatment": "Power & Utilities", "aircraft-delta": "Aircraft", "aircraft-fighter": "Aircraft", "aircraft-j36": "Aircraft", "aircraft-jxds": "Aircraft",
};

/* ------------------------------------------------------------------ */
/* Dynamic props (animated scene dressing — see LivingScene.tsx).       */
/* Positions still live here so layout.ts stays the single source of    */
/* truth; the components only read them.                                */
/* ------------------------------------------------------------------ */

/** Windsock beside the apron and a slow-rotating air-search radar east of it. */
export const WINDSOCK_POS: [number, number] = compound(206, -26);
export const RADAR_POS: [number, number] = compound(300, 74);

/** Guard patrol route: gate → south access track → perimeter track. The
 *  vehicle ping-pongs along this polyline. */
export const SERVICE_ROUTE: [number, number][] = [
  compound(60, 178),
  [1560, 3250],
  [-1100, 2820],
];

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
