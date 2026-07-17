export const SITE_SIZE = 4000;
export const GRID_EASTING_ORIGIN = 40_000;
export const GRID_NORTHING_ORIGIN = 90_000;

export type SegmentKind = "runway" | "strip" | "taxiway" | "street" | "road";
export interface SegmentDef { id: string; kind: SegmentKind; name: string; from: [number, number]; to: [number, number]; width: number }
export interface ApronDef { id: string; name: string; center: [number, number]; size: [number, number]; rotation: number }
export type StructureType = "tower" | "hangar-monolith" | "shelter-row" | "quonset" | "warehouse" | "hq" | "barracks" | "support" | "compound-walled" | "guardhouse" | "radome" | "fuel-tank" | "solar-array" | "water-tower" | "comms-shelter" | "transformer-yard" | "guard-tower" | "covered-walkway" | "sewage-treatment" | "aircraft-delta" | "aircraft-fighter" | "aircraft-j36" | "aircraft-jxds";
export interface StructureDef { id: string; type: StructureType; name: string; position: [number, number]; rotation: number; size: [number, number, number]; capacity: string; description: string }
export interface FlattenPad { center: [number, number]; radius: number }
export interface Waypoint { position: [number, number, number]; label: string }

/** Local frame follows Screenshot 406: +u right, +v down. */
export const COMPOUND_ROT = 0.095;
const COMPOUND_ORIGIN: [number, number] = [900, 845];
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];
function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

// Lop Nur's main runway is ~5km (16,400+ feet) - one of the longest in the world
// Runway designation 05/23 per satellite imagery
export const RUNWAYS: SegmentDef[] = [{ id: "rwy-05-23", kind: "runway", name: "Main concrete runway (05/23)", from: [-2500, 320], to: [2500, -80], width: 60 }];
export const STRIPS: SegmentDef[] = [
  // Two unpaved graded strips completing the triangular pattern
  { id: "tri-west", kind: "strip", name: "Western graded strip", from: [-2450, 400], to: [10, -2300], width: 38 },
  { id: "tri-east", kind: "strip", name: "Eastern graded strip", from: [-200, -2320], to: [2400, 200], width: 38 },
];
export const TAXIWAYS: SegmentDef[] = [
  { id: "twy-stub", kind: "taxiway", name: "Runway connector", from: [505, 52], to: compound(8, -205), width: 42 },
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
  { id: "road-access", kind: "road", name: "South access track", from: compound(68, 228), to: [1160, 1560], width: 8 },
  { id: "road-west", kind: "road", name: "Western approach", from: compound(-205, 10), to: [320, 1080], width: 7 },
];
export const APRONS: ApronDef[] = [
  { id: "apron-main", name: "Main hangar apron", center: compound(-30, -112), size: [285, 92], rotation: -COMPOUND_ROT },
  { id: "apron-west", name: "West service pad", center: compound(-158, -4), size: [105, 106], rotation: -COMPOUND_ROT },
  { id: "apron-center", name: "Operations hardstand", center: compound(53, 118), size: [112, 90], rotation: -COMPOUND_ROT },
];

const building = (id: string, type: StructureType, name: string, u: number, v: number, size: [number, number, number], rotation = COMPOUND_ROT, description = "Structure reconstructed from Screenshot 406."): StructureDef => ({ id, type, name, position: compound(u, v), rotation, size, capacity: "Reference footprint", description });
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
    "J-XDS prototype",
    -112,
    -82,
    [15, 3, 20],
    COMPOUND_ROT - 0.72,
    "Dark tailless lambda-wing prototype positioned beside the main assembly hangar.",
  ),
  // J-36 sixth-generation stealth fighter - spotted at Lop Nur in 2025
  building(
    "j36-prototype",
    "aircraft-j36",
    "J-36 sixth-gen fighter",
    -85,
    -130,
    [18, 3, 24],
    COMPOUND_ROT - 0.65,
    "Chinese sixth-generation tailless stealth fighter with delta-wing configuration, first seen at Lop Nur in late 2025.",
  ),
];

export const FPS_SPAWN = {
  position: compound(-91, -60) as [number, number],
  target: compound(-112, -82) as [number, number],
};

export const FLATTEN_PADS: FlattenPad[] = [
  { center: COMPOUND_ORIGIN, radius: 430 }, // Main compound
  { center: [0, 100], radius: 600 }, // Runway flat area
];
export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [-2650, 200, 350], label: "Runway 05 threshold" },
  { position: [0, 170, 200], label: "Runway center" },
  { position: [500, 150, 120], label: "Runway junction" },
  { position: [865, 170, 565], label: "Lop Nur compound" },
  { position: [850, 80, 770], label: "Main assembly hall" },
  { position: [1040, 95, 915], label: "Central tower" },
  { position: [1100, 115, 1080], label: "Eastern laboratories" },
  { position: [2650, 180, 100], label: "Runway 23 threshold" },
];
export const ALL_SEGMENTS: SegmentDef[] = [...RUNWAYS, ...STRIPS, ...TAXIWAYS, ...STREETS, ...ROADS];
export function segmentLength(seg: SegmentDef): number { return Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
export function segmentAngle(seg: SegmentDef): number { return Math.atan2(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]); }
export function segmentCenter(seg: SegmentDef): [number, number] { return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2]; }
export function getStructure(id: string): StructureDef | undefined { return STRUCTURES.find((s) => s.id === id); }
export function isAircraft(type: StructureType): boolean { return type.startsWith("aircraft-"); }
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower", "hangar-monolith": "Hangars", "shelter-row": "Hangars", quonset: "Hangars", warehouse: "Storage", hq: "Support Buildings", barracks: "Support Buildings", support: "Support Buildings", "compound-walled": "Walled Yards", guardhouse: "Support Buildings", radome: "Sensors", "fuel-tank": "Fuel Farm", "solar-array": "Power & Utilities", "water-tower": "Power & Utilities", "comms-shelter": "Sensors", "transformer-yard": "Power & Utilities", "guard-tower": "Security", "covered-walkway": "Support Buildings", "sewage-treatment": "Power & Utilities", "aircraft-delta": "Aircraft", "aircraft-fighter": "Aircraft", "aircraft-j36": "Aircraft", "aircraft-jxds": "Aircraft",
};
