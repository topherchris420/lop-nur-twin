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

/** Reference frame follows the north-up close aerial: +u right, +v down. */
export const COMPOUND_ROT = 0.47;
const COMPOUND_ORIGIN: [number, number] = [920, 900];
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];
function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]] }

export const RUNWAYS: SegmentDef[] = [{ id: "rwy-08-26", kind: "runway", name: "Unmarked concrete runway", from: [-1700, 260], to: [1700, -60], width: 54 }];
export const STRIPS: SegmentDef[] = [
  { id: "tri-west", kind: "strip", name: "Western graded strip", from: [-1660, 330], to: [10, -1900], width: 34 },
  { id: "tri-east", kind: "strip", name: "Eastern graded strip", from: [-190, -1910], to: [1615, 175], width: 34 },
];
export const TAXIWAYS: SegmentDef[] = [
  { id: "twy-stub", kind: "taxiway", name: "Runway connector", from: [505, 52], to: [805, 662], width: 42 },
  { id: "twy-apron", kind: "taxiway", name: "Apron throat", from: [805, 662], to: compound(-44, -150), width: 48 },
];

const street = (id: string, name: string, a: [number, number], b: [number, number], width = 8): SegmentDef => ({ id, kind: "street", name, from: compound(...a), to: compound(...b), width });
export const STREETS: SegmentDef[] = [
  street("st-west", "West service road", [-88, -30], [-88, 220], 9),
  street("st-north", "North cross road", [-86, -12], [190, -12], 9),
  street("st-mid", "Central cross road", [-88, 88], [190, 88], 8),
  street("st-south", "South cross road", [-88, 190], [195, 190], 8),
  street("st-east", "East perimeter road", [190, -35], [190, 230], 8),
  street("st-center", "Compound spine", [62, -18], [62, 225], 8),
];
export const ROADS: SegmentDef[] = [
  { id: "road-access", kind: "road", name: "South access track", from: compound(62, 225), to: [1390, 1660], width: 8 },
  { id: "road-isolated", kind: "road", name: "Isolated building track", from: [505, 52], to: [335, -145], width: 6 },
];
export const APRONS: ApronDef[] = [
  { id: "apron-main", name: "Main concrete apron", center: compound(-64, -106), size: [210, 150], rotation: -COMPOUND_ROT },
  { id: "apron-hangar", name: "Hangar forecourt", center: compound(-28, -48), size: [126, 108], rotation: -COMPOUND_ROT },
  { id: "apron-shelter", name: "Three-bay shelter pad", center: compound(-145, 112), size: [96, 78], rotation: -COMPOUND_ROT },
];

const building = (id: string, type: StructureType, name: string, u: number, v: number, size: [number, number, number], rotation = COMPOUND_ROT, description = "Structure reconstructed from the supplied overhead reference."): StructureDef => ({ id, type, name, position: compound(u, v), rotation, size, capacity: "Reference footprint", description });
export const STRUCTURES: StructureDef[] = [
  building("hangar-main", "hangar-monolith", "Main assembly hangar", 0, 0, [62, 22, 88], COMPOUND_ROT, "Large white assembly hall with a shallow roof, bright perimeter cap, twin horizontal facade bands and attached service volumes."),
  building("shelter-row", "shelter-row", "Three-bay white shelter", -151, 116, [70, 9, 28], COMPOUND_ROT + Math.PI / 2),
  building("quonset", "quonset", "Arched equipment shed", 51, -137, [32, 8, 18], COMPOUND_ROT + Math.PI / 2),
  building("utility-north", "support", "North utility building", 96, -126, [18, 6, 14]),
  building("depot-west", "warehouse", "West stores", -74, 86, [34, 7, 18]),
  building("service-small", "support", "Service shop", -53, 126, [20, 6, 14]),
  building("operations", "hq", "Operations block", 82, 50, [28, 9, 20]),
  building("warehouse-east", "warehouse", "East warehouse", 145, 41, [42, 8, 18]),
  building("support-east", "support", "East support block", 151, 94, [34, 6, 16]),
  building("barracks-east", "barracks", "East accommodation", 151, 146, [39, 7, 15]),
  building("support-center", "support", "Central support block", 74, 122, [28, 6, 16]),
  building("court-center", "compound-walled", "Central courtyard", 70, 177, [45, 4.5, 34]),
  building("court-south", "compound-walled", "South courtyard", 127, 213, [52, 4.5, 39]),
  building("stores-south", "warehouse", "South stores", -18, 205, [42, 7, 17]),
  building("workshop-south", "support", "South workshop", -62, 164, [28, 6, 16]),
  { id: "isolated-building", type: "support", name: "Isolated runway building", position: [335, -145], rotation: 0.47, size: [23, 7, 15], capacity: "Reference footprint", description: "Small isolated rectangular building northwest of the taxiway junction." },
];

export const FLATTEN_PADS: FlattenPad[] = [{ center: COMPOUND_ORIGIN, radius: 390 }, { center: [335, -145], radius: 45 }];
export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [-1850, 180, 300], label: "Runway west" }, { position: [500, 150, 120], label: "Runway junction" },
  { position: [760, 100, 610], label: "Taxiway" }, { position: [870, 125, 735], label: "Compound overview" },
  { position: [940, 65, 830], label: "Main hangar" }, { position: [1150, 100, 1080], label: "Support compound" },
];
export const ALL_SEGMENTS: SegmentDef[] = [...RUNWAYS, ...STRIPS, ...TAXIWAYS, ...STREETS, ...ROADS];
export function segmentLength(seg: SegmentDef): number { return Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]) }
export function segmentAngle(seg: SegmentDef): number { return Math.atan2(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1]) }
export function segmentCenter(seg: SegmentDef): [number, number] { return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2] }
export function getStructure(id: string): StructureDef | undefined { return STRUCTURES.find((s) => s.id === id) }
export function isAircraft(type: StructureType): boolean { return type.startsWith("aircraft-") }
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower", "hangar-monolith": "Hangars", "shelter-row": "Hangars", quonset: "Hangars", warehouse: "Storage", hq: "Support Buildings", barracks: "Support Buildings", support: "Support Buildings", "compound-walled": "Walled Yards", guardhouse: "Support Buildings", radome: "Sensors", "fuel-tank": "Fuel Farm", "solar-array": "Power & Utilities", "water-tower": "Power & Utilities", "comms-shelter": "Sensors", "transformer-yard": "Power & Utilities", "guard-tower": "Security", "covered-walkway": "Support Buildings", "sewage-treatment": "Power & Utilities", "aircraft-delta": "Aircraft", "aircraft-fighter": "Aircraft", "aircraft-j36": "Aircraft", "aircraft-jxds": "Aircraft",
};
