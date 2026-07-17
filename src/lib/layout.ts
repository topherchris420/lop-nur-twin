/**
 * Site layout — the single source of truth for the airfield.
 *
 * Every runway, taxiway, dirt road, street, apron and structure is defined
 * here and consumed by BOTH the 3D scene (geometry placement, terrain
 * flattening, cinematic waypoints) and the 2D minimap. Coordinates are meters
 * in a local site grid: +x = east, +z = south (three.js ground plane), y = up.
 * North is therefore -z.
 *
 * The layout reconstructs a remote arid-zone airfield from public aerial
 * imagery: a single long concrete runway forming the SOUTH LEG of a large
 * triangle whose other two sides are graded-earth strips converging on an
 * apex to the north (both strips overshoot the corners, as in the imagery).
 * A wide paved stub leaves the runway mid-length and runs south-southeast to
 * a compound — concrete apron, large white assembly hangar, shelter row,
 * support grid on paved streets — with perimeter radar sites further out.
 */

export const SITE_SIZE = 4000; // terrain covers SITE_SIZE × SITE_SIZE meters
export const GRID_EASTING_ORIGIN = 40_000; // fake UTM-style grid offsets for the HUD
export const GRID_NORTHING_ORIGIN = 90_000;

export type SegmentKind = "runway" | "strip" | "taxiway" | "street" | "road";

export interface SegmentDef {
  id: string;
  kind: SegmentKind;
  name: string;
  /** centerline start, [x, z] meters */
  from: [number, number];
  /** centerline end, [x, z] meters */
  to: [number, number];
  width: number;
}

export interface ApronDef {
  id: string;
  name: string;
  center: [number, number];
  /** [width(x), depth(z)] before rotation */
  size: [number, number];
  rotation: number;
}

export type StructureType =
  | "tower"
  | "hangar-monolith"
  | "shelter-row"
  | "quonset"
  | "warehouse"
  | "hq"
  | "barracks"
  | "support"
  | "compound-walled"
  | "guardhouse"
  | "radome"
  | "fuel-tank"
  | "solar-array"
  | "aircraft-delta"
  | "aircraft-fighter";

export interface StructureDef {
  id: string;
  type: StructureType;
  name: string;
  /** footprint center, [x, z] meters */
  position: [number, number];
  /** rotation about Y, radians */
  rotation: number;
  /** [width(x), height(y), depth(z)] meters */
  size: [number, number, number];
  capacity: string;
  description: string;
}

export interface FlattenPad {
  center: [number, number];
  radius: number;
}

export interface Waypoint {
  /** [x, y, z] — y is absolute altitude in meters */
  position: [number, number, number];
  label: string;
}

/* ------------------------------------------------------------------ */
/* Compound frame                                                      */
/* ------------------------------------------------------------------ */

/**
 * The building compound sits on its own grid, rotated so its streets run
 * parallel to the paved stub that connects it to the runway. Local +u runs
 * across the compound (east-northeast), +v down it (south-southeast).
 */
export const COMPOUND_ROT = 0.47; // radians about Y
const COMPOUND_ORIGIN: [number, number] = [920, 900]; // assembly hangar center
const CU: [number, number] = [Math.cos(COMPOUND_ROT), -Math.sin(COMPOUND_ROT)];
const CV: [number, number] = [Math.sin(COMPOUND_ROT), Math.cos(COMPOUND_ROT)];

/** Compound-local (u, v) meters → world [x, z]. */
function compound(u: number, v: number): [number, number] {
  return [
    COMPOUND_ORIGIN[0] + u * CU[0] + v * CV[0],
    COMPOUND_ORIGIN[1] + u * CU[1] + v * CV[1],
  ];
}

/* ------------------------------------------------------------------ */
/* Runway & triangle strips                                            */
/* ------------------------------------------------------------------ */

export const RUNWAYS: SegmentDef[] = [
  {
    id: "rwy-08-26",
    kind: "runway",
    name: "Runway 08/26",
    from: [-1700, 260],
    to: [1700, -60],
    width: 50,
  },
];

/**
 * Graded-earth strips completing the triangle: the paved runway is the south
 * leg, these two converge on the northern apex at ≈[-80, -1780]. Both are
 * drawn long so they overshoot the triangle corners like the real gradings.
 */
export const STRIPS: SegmentDef[] = [
  {
    id: "tri-west",
    kind: "strip",
    name: "Triangle Strip West",
    from: [-1660, 330],
    to: [10, -1900],
    width: 40,
  },
  {
    id: "tri-east",
    kind: "strip",
    name: "Triangle Strip East",
    from: [-191, -1909],
    to: [1613, 177],
    width: 40,
  },
];

export const TAXIWAYS: SegmentDef[] = [
  {
    id: "twy-stub",
    kind: "taxiway",
    name: "Compound Stub",
    from: [500, 53],
    to: [838, 740],
    width: 40,
  },
];

/** Paved internal streets of the compound (compound-local coordinates). */
const STREET_DEFS: Array<{ id: string; name: string; from: [number, number]; to: [number, number]; width: number }> = [
  { id: "st-spine", name: "Compound Spine", from: [60, -60], to: [60, 235], width: 10 },
  { id: "st-cross-n", name: "North Cross Street", from: [45, -75], to: [285, -75], width: 9 },
  { id: "st-cross-mid", name: "Mid Cross Street", from: [45, 60], to: [285, 60], width: 9 },
  { id: "st-cross-s", name: "South Cross Street", from: [-150, 170], to: [285, 170], width: 9 },
  { id: "st-east", name: "East Street", from: [250, -180], to: [250, 192], width: 9 },
  { id: "st-apron-e", name: "Apron East Street", from: [135, -180], to: [252, -180], width: 9 },
  { id: "st-west", name: "Shelter Street", from: [-135, -95], to: [-192, -95], width: 9 },
  { id: "st-yard", name: "Yard Street", from: [-150, -95], to: [-150, 178], width: 8 },
];

export const STREETS: SegmentDef[] = STREET_DEFS.map((s) => ({
  id: s.id,
  kind: "street",
  name: s.name,
  from: compound(s.from[0], s.from[1]),
  to: compound(s.to[0], s.to[1]),
  width: s.width,
}));

export const ROADS: SegmentDef[] = [
  {
    id: "road-radar-w",
    kind: "road",
    name: "West Radar Road",
    from: [-1620, 245],
    to: [-1720, 780],
    width: 9,
  },
  {
    id: "road-radar-se",
    kind: "road",
    name: "Southeast Radar Road",
    from: compound(60, 235),
    to: [1620, 1180],
    width: 9,
  },
  {
    id: "road-gate-s",
    kind: "road",
    name: "South Access Track",
    from: compound(60, 235),
    to: [1350, 1750],
    width: 9,
  },
  {
    id: "road-met",
    kind: "road",
    name: "Met Station Track",
    from: [400, 70],
    to: [345, -150],
    width: 8,
  },
  {
    id: "road-solar",
    kind: "road",
    name: "Solar Array Track",
    from: [1005, -15],
    to: [1080, -140],
    width: 8,
  },
];

export const APRONS: ApronDef[] = [
  {
    id: "apron-main",
    name: "Main Apron",
    center: compound(0, -125),
    size: [270, 160],
    rotation: -COMPOUND_ROT,
  },
  {
    id: "apron-shelter",
    name: "Shelter Pad",
    center: compound(-180, -95),
    size: [70, 80],
    rotation: -COMPOUND_ROT,
  },
];

/* ------------------------------------------------------------------ */
/* Structures                                                          */
/* ------------------------------------------------------------------ */

export const STRUCTURES: StructureDef[] = [
  {
    id: "hangar-main",
    type: "hangar-monolith",
    name: "Assembly Hangar",
    position: compound(0, 0),
    rotation: COMPOUND_ROT,
    size: [56, 24, 92],
    capacity: "4 heavy airframes",
    description:
      "Monolithic white assembly hall, ~92 m deep with twin clerestory window bands and a full-width sliding door opening onto the main apron. The largest structure on site.",
  },
  {
    id: "tower",
    type: "tower",
    name: "Control Tower",
    position: compound(170, -160),
    rotation: COMPOUND_ROT,
    size: [10, 24, 10],
    capacity: "6 controllers",
    description:
      "24 m tapered shaft with a glazed octagonal cab and catwalk. Primary visual control point for the runway and the stub taxiway.",
  },
  {
    id: "shelter-row",
    type: "shelter-row",
    name: "Flight Shelter Row",
    position: compound(-215, -95),
    rotation: COMPOUND_ROT + Math.PI / 2,
    size: [64, 9, 26],
    capacity: "3 airframes",
    description:
      "Three-bay gabled shelter row on the west pad, bay mouths facing the apron. Each bay takes one fighter-class airframe.",
  },
  {
    id: "quonset",
    type: "quonset",
    name: "Storage Shelter",
    position: compound(150, -260),
    rotation: COMPOUND_ROT + Math.PI / 2,
    size: [30, 7, 16],
    capacity: "GSE & spares",
    description:
      "Ribbed steel quonset arch east of the stub taxiway, used for ground-support equipment.",
  },
  {
    id: "depot",
    type: "warehouse",
    name: "Logistics Depot",
    position: compound(160, -120),
    rotation: COMPOUND_ROT,
    size: [44, 8, 24],
    capacity: "1 200 t stores",
    description:
      "Flat-roof warehouse with three roller doors and a raised loading dock. Holds spares, rations and ground equipment.",
  },
  {
    id: "hq",
    type: "hq",
    name: "Operations HQ",
    position: compound(155, 0),
    rotation: COMPOUND_ROT,
    size: [30, 9, 16],
    capacity: "60 staff",
    description:
      "Two-storey administration and operations building with an entrance canopy and rooftop comms mast.",
  },
  {
    id: "barracks",
    type: "barracks",
    name: "Barracks",
    position: compound(155, 115),
    rotation: COMPOUND_ROT,
    size: [42, 7, 13],
    capacity: "96 bunks",
    description:
      "Long dormitory block for resident crews. The full roof carries a photovoltaic array, clearly visible from altitude.",
  },
  {
    id: "dormitory",
    type: "support",
    name: "Dormitory Annex",
    position: compound(222, 115),
    rotation: COMPOUND_ROT,
    size: [26, 6, 12],
    capacity: "32 bunks",
    description: "Overflow accommodation block on the east street.",
  },
  {
    id: "power",
    type: "support",
    name: "Power Station",
    position: compound(288, 15),
    rotation: COMPOUND_ROT,
    size: [18, 6, 12],
    capacity: "2 × 750 kVA",
    description: "Diesel generator hall feeding the site grid.",
  },
  {
    id: "yard-vehicle",
    type: "compound-walled",
    name: "Vehicle Yard",
    position: compound(-205, 115),
    rotation: COMPOUND_ROT,
    size: [46, 4.5, 36],
    capacity: "12 vehicles",
    description:
      "Walled maintenance yard with a workshop block and open hardstanding for site vehicles.",
  },
  {
    id: "yard-storage",
    type: "compound-walled",
    name: "Storage Yard",
    position: compound(95, 230),
    rotation: COMPOUND_ROT,
    size: [40, 4.5, 30],
    capacity: "Open stores",
    description: "Walled open-air storage compound at the south end of the spine street.",
  },
  {
    id: "gate",
    type: "guardhouse",
    name: "Gate Post",
    position: compound(40, -225),
    rotation: COMPOUND_ROT,
    size: [5, 4, 5],
    capacity: "2 sentries",
    description: "Checkpoint hut with a barrier arm where the stub taxiway meets the compound.",
  },
  {
    id: "fuel-tank-1",
    type: "fuel-tank",
    name: "Fuel Tank 1",
    position: compound(285, -140),
    rotation: 0,
    size: [13, 9, 13],
    capacity: "1 350 m³ Jet A-1",
    description: "Welded-steel vertical storage tank inside a low earth bund.",
  },
  {
    id: "fuel-tank-2",
    type: "fuel-tank",
    name: "Fuel Tank 2",
    position: compound(285, -105),
    rotation: 0,
    size: [13, 9, 13],
    capacity: "1 350 m³ Jet A-1",
    description: "Twin of Tank 1. Feeds the apron hydrant loop via the pump house.",
  },
  {
    id: "pump-house",
    type: "support",
    name: "Pump House",
    position: compound(262, -122),
    rotation: COMPOUND_ROT,
    size: [10, 4, 7],
    capacity: "40 m³/h",
    description: "Fuel transfer pumps between the tank farm and the apron hydrants.",
  },
  {
    id: "met-station",
    type: "support",
    name: "Met Station",
    position: [340, -160],
    rotation: 0.094,
    size: [14, 4.5, 9],
    capacity: "Automated",
    description:
      "Lone instrument building north of the runway, reached by a graded track across the strip.",
  },
  {
    id: "solar-array",
    type: "solar-array",
    name: "Solar Array",
    position: [1080, -140],
    rotation: 0.094,
    size: [96, 3, 64],
    capacity: "420 kWp",
    description:
      "Ground-mounted photovoltaic field northeast of the runway junction, six tilted rows on a graded pad.",
  },
  {
    id: "radome-w",
    type: "radome",
    name: "Radar Dome West",
    position: [-1720, 780],
    rotation: 0,
    size: [10, 16, 10],
    capacity: "S-band surveillance",
    description:
      "White geodesic radome on a squat service tower at the southwestern perimeter.",
  },
  {
    id: "radome-se",
    type: "radome",
    name: "Radar Dome Southeast",
    position: [1620, 1180],
    rotation: 0,
    size: [10, 16, 10],
    capacity: "X-band precision",
    description: "Perimeter radome covering the southeast approach corridor.",
  },
  {
    id: "ucav-01",
    type: "aircraft-delta",
    name: "UCAV 01",
    position: compound(-18, -82),
    rotation: COMPOUND_ROT + 0.35,
    size: [14, 3.2, 10],
    capacity: "Uncrewed",
    description:
      "Tailless flying-wing combat drone parked on the apron in front of the assembly hangar, matching the airframe seen in overhead imagery.",
  },
  {
    id: "fighter-01",
    type: "aircraft-fighter",
    name: "Fighter 01",
    position: compound(-95, -160),
    rotation: COMPOUND_ROT - 0.5,
    size: [11, 4.6, 16],
    capacity: "1 crew",
    description: "Twin-tail multirole fighter on the northwest corner of the main apron.",
  },
  {
    id: "fighter-02",
    type: "aircraft-fighter",
    name: "Fighter 02",
    position: compound(-172, -85),
    rotation: COMPOUND_ROT - Math.PI / 2 + 0.1,
    size: [11, 4.6, 16],
    capacity: "1 crew",
    description: "Fighter staged on the shelter pad, nose-out from the middle bay.",
  },
  {
    id: "fighter-03",
    type: "aircraft-fighter",
    name: "Fighter 03",
    position: [652, 362],
    rotation: COMPOUND_ROT,
    size: [11, 4.6, 16],
    capacity: "1 crew",
    description: "Fighter taxiing the stub between the compound apron and the runway.",
  },
];

/** Extra circular areas flattened in the heightfield (building pads etc.). */
export const FLATTEN_PADS: FlattenPad[] = [
  { center: [920, 900], radius: 410 }, // compound
  { center: [340, -160], radius: 55 }, // met station
  { center: [1080, -140], radius: 85 }, // solar array
  { center: [-1720, 780], radius: 70 }, // radar west
  { center: [1620, 1180], radius: 70 }, // radar southeast
];

/* ------------------------------------------------------------------ */
/* Cinematic flythrough waypoints                                      */
/* ------------------------------------------------------------------ */

export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [-1900, 150, 240], label: "Runway 08 approach" },
  { position: [-800, 60, 190], label: "Runway 08 rollout" },
  { position: [430, 80, 90], label: "Stub junction" },
  { position: [790, 50, 640], label: "Stub taxiway" },
  { position: [870, 45, 800], label: "Main apron" },
  { position: [1150, 90, 1050], label: "Compound grid" },
  { position: [1500, 140, 90], label: "Runway 26 climb-out" },
  { position: [700, 220, -900], label: "Triangle east leg" },
  { position: [-80, 260, -1750], label: "Triangle apex" },
  { position: [-1100, 220, -800], label: "Triangle west leg" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const ALL_SEGMENTS: SegmentDef[] = [
  ...RUNWAYS,
  ...STRIPS,
  ...TAXIWAYS,
  ...STREETS,
  ...ROADS,
];

export function segmentLength(seg: SegmentDef): number {
  const dx = seg.to[0] - seg.from[0];
  const dz = seg.to[1] - seg.from[1];
  return Math.hypot(dx, dz);
}

/** Rotation about Y that aligns a unit-Z-length plane with the segment. */
export function segmentAngle(seg: SegmentDef): number {
  const dx = seg.to[0] - seg.from[0];
  const dz = seg.to[1] - seg.from[1];
  return Math.atan2(dx, dz);
}

export function segmentCenter(seg: SegmentDef): [number, number] {
  return [(seg.from[0] + seg.to[0]) / 2, (seg.from[1] + seg.to[1]) / 2];
}

export function getStructure(id: string): StructureDef | undefined {
  return STRUCTURES.find((s) => s.id === id);
}

export function isAircraft(type: StructureType): boolean {
  return type === "aircraft-delta" || type === "aircraft-fighter";
}

export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower",
  "hangar-monolith": "Hangars",
  "shelter-row": "Hangars",
  quonset: "Hangars",
  warehouse: "Storage",
  hq: "Support Buildings",
  barracks: "Support Buildings",
  support: "Support Buildings",
  "compound-walled": "Walled Yards",
  guardhouse: "Support Buildings",
  radome: "Sensors",
  "fuel-tank": "Fuel Farm",
  "solar-array": "Power & Utilities",
  "aircraft-delta": "Aircraft",
  "aircraft-fighter": "Aircraft",
};
