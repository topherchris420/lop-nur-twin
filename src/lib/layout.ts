export const SITE_SIZE = 6800;
export const GRID_EASTING_ORIGIN = 40_000;
export const GRID_NORTHING_ORIGIN = 90_000;

export type SegmentKind = "runway" | "strip" | "taxiway" | "street" | "road";
export interface SegmentDef { id: string; kind: SegmentKind; name: string; from: [number, number]; to: [number, number]; width: number }
export interface ApronDef { id: string; name: string; center: [number, number]; size: [number, number]; rotation: number }
export type StructureType = "tower" | "hangar-monolith" | "shelter-row" | "quonset" | "warehouse" | "hq" | "barracks" | "support" | "compound-walled" | "guardhouse" | "radome" | "fuel-tank" | "solar-array" | "water-tower" | "comms-shelter" | "transformer-yard" | "guard-tower" | "covered-walkway" | "sewage-treatment" | "aircraft-delta" | "aircraft-fighter" | "aircraft-j36" | "aircraft-jxds";
export interface StructureDef { id: string; type: StructureType; name: string; position: [number, number]; rotation: number; size: [number, number, number]; capacity: string; description: string }
export interface FlattenPad { center: [number, number]; radius: number }
export interface Waypoint { position: [number, number, number]; label: string }

/**
 * Lop Nur test airfield (~40.77°N, 89.28°E), Xinjiang.
 * Coordinates in metres, +x east, +z south, y up. Runway centre is the
 * geometric anchor; the whole site is translated so the runway/strip
 * triangle is centred on the terrain. Figures are scaled from public
 * Sentinel-2 imagery of the site.
 */

// Runway 05/23: single ~5 km paved concrete strip, azimuth ~46° (SW→NE).
export const RUNWAYS: SegmentDef[] = [
  { id: "rwy-05-23", kind: "runway", name: "Main concrete runway 05/23", from: [-1006, 2711], to: [2591, -762], width: 60 },
];

// Two graded-earth strips complete the triangle to a north-west apex, each
// overshooting the corners just like the real gradings.
export const STRIPS: SegmentDef[] = [
  { id: "tri-west", kind: "strip", name: "West graded strip (apex → 05)", from: [-2616, -2798], to: [-995, 2750], width: 42 },
  { id: "tri-north", kind: "strip", name: "North graded strip (apex → 23)", from: [-2675, -2743], to: [2628, -748], width: 42 },
];

/** Compound local frame: origin south-east of runway centre, +u along the
 *  runway (toward the 23 end), +v perpendicular toward the south-east. */
export const COMPOUND_ROT = 0.7679; // = 90° − runway azimuth, in radians
const COMPOUND_ORIGIN: [number, number] = [1018, 1410];
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];
function compound(u: number, v: number): [number, number] { return [COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0], COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

const CAMP_ORIGIN: [number, number] = [779, 1738];
function camp(u: number, v: number): [number, number] { return [CAMP_ORIGIN[0] + u * CU[0] + v * CV[0], CAMP_ORIGIN[1] + u * CU[1] + v * CV[1]]; }

export const TAXIWAYS: SegmentDef[] = [
  // Spur off mid-runway down to the compound throat, then onto the apron.
  { id: "twy-spur", kind: "taxiway", name: "Runway connector", from: [692, 1072], to: compound(0, -70), width: 44 },
  { id: "twy-apron", kind: "taxiway", name: "Apron throat", from: compound(0, -70), to: compound(0, 30), width: 52 },
];

const street = (id: string, name: string, a: [number, number], b: [number, number], width = 8): SegmentDef => ({ id, kind: "street", name, from: compound(...a), to: compound(...b), width });
export const STREETS: SegmentDef[] = [
  street("st-back", "Hangar frontage road", [-180, 120], [180, 120], 9),
  street("st-front", "Apron edge road", [-180, -48], [180, -48], 8),
  street("st-ops", "Operations spur", [70, 120], [128, 158], 8),
  street("st-fuel", "Fuel farm road", [150, 118], [242, 62], 8),
  street("st-cross", "Compound cross road", [40, -48], [40, 178], 7),
  street("st-west", "West service road", [-120, -48], [-120, 168], 7),
];
export const ROADS: SegmentDef[] = [
  { id: "road-camp", kind: "road", name: "Support-camp track", from: compound(-180, 70), to: camp(120, 40), width: 8 },
  { id: "road-access", kind: "road", name: "South access track", from: compound(60, 178), to: [1560, 3250], width: 9 },
  { id: "road-perim", kind: "road", name: "Perimeter patrol track", from: [1560, 3250], to: [-1100, 2820], width: 6 },
];
export const APRONS: ApronDef[] = [
  { id: "apron-main", name: "Main aircraft apron", center: compound(-2, 34), size: [372, 190], rotation: -COMPOUND_ROT },
  { id: "apron-fuel", name: "Fuel hardstand", center: compound(232, 74), size: [96, 92], rotation: -COMPOUND_ROT },
];

const building = (id: string, type: StructureType, name: string, u: number, v: number, size: [number, number, number], rotation = COMPOUND_ROT, description = "Reconstructed from public Sentinel-2 imagery of the Lop Nur airfield."): StructureDef => ({ id, type, name, position: compound(u, v), rotation, size, capacity: "Reference footprint", description });
const campBuilding = (id: string, type: StructureType, name: string, u: number, v: number, size: [number, number, number], rotation = COMPOUND_ROT, description = "Support camp, reconstructed from public imagery."): StructureDef => ({ id, type, name, position: camp(u, v), rotation, size, capacity: "Reference footprint", description });

export const STRUCTURES: StructureDef[] = [
  // --- Flight line: the hangars along the back edge of the apron ---
  building("hangar-main", "hangar-monolith", "Main assembly hangar", 5, 96, [92, 24, 58], COMPOUND_ROT, "The dominant white hall on the apron — over 90 m (300 ft) across, with a full-width door facing the flight line. Enlarged during the 2020s build-out."),
  building("shelters-fighter", "shelter-row", "Fighter shelter block", -136, 84, [78, 14, 34], COMPOUND_ROT + Math.PI, "Three joined shelters sized for fighter-class aircraft, added at the south-west end of the apron."),
  building("hangar-ne", "hangar-monolith", "North-east hangar", 143, 80, [56, 18, 44], COMPOUND_ROT, "Newer hangar raised at the north-east end of the expanded apron."),

  // --- Aircraft parked on the apron in front of the main hangar ---
  building("j36-prototype", "aircraft-j36", "J-36 sixth-gen demonstrator", -34, 22, [23, 3, 20], COMPOUND_ROT, "Tailless three-engine sixth-generation demonstrator (~20 m span), photographed on the central apron in 2025."),
  building("jxds-prototype", "aircraft-jxds", "J-XDS demonstrator", 28, 26, [17, 3, 20], COMPOUND_ROT, "Lambda-wing tailless demonstrator (~15 m span) seen beside the main hangar in 2025."),
  building("ucav-delta", "aircraft-delta", "Flying-wing UCAV", -94, 36, [15, 3, 18], COMPOUND_ROT + 0.18, "Tailless flying-wing UCAV staged on the western apron."),

  // --- Operations & technical buildings ---
  building("tower-main", "tower", "Control / observation tower", 66, 140, [18, 26, 18], COMPOUND_ROT, "Slender concrete tower overlooking the apron and runway."),
  building("ops-hq", "hq", "Operations building", 102, 152, [40, 12, 24]),
  building("ops-annex", "support", "Operations annex", 130, 152, [22, 9, 20]),
  building("depot-main", "warehouse", "Logistics depot", -22, 154, [46, 9, 22]),
  building("workshop", "warehouse", "Maintenance workshop", -72, 152, [40, 8, 20]),
  building("store-yard", "compound-walled", "Walled equipment yard", -128, 150, [52, 3.5, 40]),

  // --- Fuel farm (expanded storage on the east hardstand) ---
  building("fuel-a", "fuel-tank", "Fuel tank A", 218, 52, [16, 11, 16]),
  building("fuel-b", "fuel-tank", "Fuel tank B", 244, 66, [16, 11, 16]),
  building("fuel-c", "fuel-tank", "Fuel tank C", 232, 94, [14, 9, 14]),
  building("pump-house", "support", "Fuel pump house", 200, 78, [14, 6, 12]),

  // --- Utilities ---
  building("power-yard", "transformer-yard", "Switchyard", 198, 140, [26, 4, 20]),
  building("water-tower", "water-tower", "Water tower", -50, 178, [8, 16, 8]),
  building("comms", "comms-shelter", "Comms shelter", 40, 172, [10, 5, 8]),
  building("gate-house", "guardhouse", "Main gate", 60, 196, [4, 4, 4], COMPOUND_ROT, "Gate and barrier on the south access track into the compound."),

  // --- Detached support camp to the south-west ---
  campBuilding("camp-barracks", "barracks", "Support-camp barracks", 0, 0, [50, 7, 16]),
  campBuilding("camp-mess", "support", "Camp mess / admin", 40, 26, [24, 6, 14]),
  campBuilding("camp-solar", "solar-array", "Camp solar field", -46, 42, [60, 3, 44]),
  campBuilding("camp-water", "water-tower", "Camp water tank", 42, -14, [7, 13, 7]),

  // --- Perimeter sensors ---
  building("radar-east", "radome", "East perimeter radar", 340, -30, [14, 10, 14], COMPOUND_ROT, "Radome on the eastern perimeter of the compound."),
  building("guard-nw", "guard-tower", "North-west guard tower", -210, -30, [4, 9, 4]),
  building("guard-se", "guard-tower", "South-east guard tower", 210, 196, [4, 9, 4]),
];

export const FPS_SPAWN = {
  position: compound(-30, 46) as [number, number],
  target: compound(-34, 22) as [number, number],
};

export const FLATTEN_PADS: FlattenPad[] = [
  { center: COMPOUND_ORIGIN, radius: 360 }, // main compound
  { center: CAMP_ORIGIN, radius: 150 }, // support camp
  { center: [792, 975], radius: 260 }, // runway/spur junction area
];
export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [-1006, 150, 2711], label: "Runway 05 threshold" },
  { position: [792, 195, 975], label: "Runway centre" },
  { position: [770, 150, 1130], label: "Compound taxiway" },
  { position: [1138, 175, 1660], label: "Lop Nur compound" },
  { position: [1088, 92, 1475], label: "Main assembly hangar" },
  { position: [1032, 66, 1420], label: "Apron flight line" },
  { position: [2591, 185, -762], label: "Runway 23 threshold" },
  { position: [-2591, 240, -2711], label: "North-west apex" },
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
