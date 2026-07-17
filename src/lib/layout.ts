/**
 * Site layout — the single source of truth for the airfield.
 *
 * Every runway, taxiway, dirt road, apron and structure is defined here and
 * consumed by BOTH the 3D scene (geometry placement, terrain flattening,
 * cinematic waypoints) and the 2D minimap. Coordinates are meters in a local
 * site grid: +x = east, +z = south (three.js ground plane), y = up.
 * North is therefore -z.
 *
 * The layout reconstructs a remote arid-zone airfield from public aerial
 * imagery: two long paved runways in an asymmetric cross, a triangular loop
 * of graded strips to the northwest, and a sparse building cluster southeast
 * of the runway intersection.
 */

export const SITE_SIZE = 4000; // terrain covers SITE_SIZE × SITE_SIZE meters
export const GRID_EASTING_ORIGIN = 40_000; // fake UTM-style grid offsets for the HUD
export const GRID_NORTHING_ORIGIN = 90_000;

export type SegmentKind = "runway" | "strip" | "taxiway" | "road";

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
  | "hangar-barrel"
  | "hangar-gable"
  | "warehouse"
  | "support"
  | "radome"
  | "fuel-tank";

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
/* Runways & strips                                                    */
/* ------------------------------------------------------------------ */

export const RUNWAYS: SegmentDef[] = [
  {
    id: "rwy-18-36",
    kind: "runway",
    name: "Runway 18/36",
    from: [0, 1250],
    to: [0, -1250],
    width: 45,
  },
  {
    id: "rwy-07-25",
    kind: "runway",
    name: "Runway 07/25",
    from: [1200, -100],
    to: [-1150, -780],
    width: 45,
  },
];

/** Graded-earth triangle loop northwest of the main runways. */
export const STRIPS: SegmentDef[] = [
  {
    id: "tri-north",
    kind: "strip",
    name: "Triangle Strip N",
    from: [-1850, -1450],
    to: [-950, -850],
    width: 30,
  },
  {
    id: "tri-east",
    kind: "strip",
    name: "Triangle Strip E",
    from: [-950, -850],
    to: [-1350, 150],
    width: 30,
  },
  {
    id: "tri-west",
    kind: "strip",
    name: "Triangle Strip W",
    from: [-1350, 150],
    to: [-1850, -1450],
    width: 30,
  },
];

export const TAXIWAYS: SegmentDef[] = [
  {
    id: "twy-a",
    kind: "taxiway",
    name: "Taxiway A",
    from: [0, -250],
    to: [330, -250],
    width: 18,
  },
  {
    id: "twy-b",
    kind: "taxiway",
    name: "Taxiway B",
    from: [330, -250],
    to: [330, -40],
    width: 18,
  },
  {
    id: "twy-c",
    kind: "taxiway",
    name: "Taxiway C",
    from: [600, -274],
    to: [500, -120],
    width: 18,
  },
];

export const ROADS: SegmentDef[] = [
  {
    id: "road-south",
    kind: "road",
    name: "South Access Road",
    from: [420, -30],
    to: [520, 600],
    width: 9,
  },
  {
    id: "road-south-2",
    kind: "road",
    name: "South Access Road (outer)",
    from: [520, 600],
    to: [700, 1700],
    width: 9,
  },
  {
    id: "road-east",
    kind: "road",
    name: "East Supply Road",
    from: [520, -140],
    to: [1850, 60],
    width: 9,
  },
  {
    id: "road-radar-w",
    kind: "road",
    name: "West Radar Road",
    from: [-1150, -780],
    to: [-1780, -1080],
    width: 9,
  },
  {
    id: "road-tri-link",
    kind: "road",
    name: "Triangle Link",
    from: [-1150, -780],
    to: [-950, -850],
    width: 9,
  },
  {
    id: "road-ne",
    kind: "road",
    name: "Northeast Track",
    from: [1200, -100],
    to: [1650, -950],
    width: 9,
  },
  {
    id: "road-radar-se",
    kind: "road",
    name: "Southeast Radar Road",
    from: [520, 600],
    to: [1520, 920],
    width: 9,
  },
];

export const APRONS: ApronDef[] = [
  {
    id: "apron-main",
    name: "Main Apron",
    center: [420, -170],
    size: [220, 250],
    rotation: 0,
  },
];

/* ------------------------------------------------------------------ */
/* Structures                                                          */
/* ------------------------------------------------------------------ */

export const STRUCTURES: StructureDef[] = [
  {
    id: "tower",
    type: "tower",
    name: "Control Tower",
    position: [350, -120],
    rotation: 0,
    size: [8, 26, 8],
    capacity: "6 controllers",
    description:
      "26 m concrete shaft with a glazed octagonal cab. Primary visual control point for both runways.",
  },
  {
    id: "hangar-a",
    type: "hangar-barrel",
    name: "Hangar A",
    position: [340, -310],
    rotation: 0,
    size: [60, 16, 40],
    capacity: "2 heavy airframes",
    description:
      "Barrel-roof maintenance shed, corrugated steel over a steel frame. Doors face the main apron.",
  },
  {
    id: "hangar-b",
    type: "hangar-barrel",
    name: "Hangar B",
    position: [420, -310],
    rotation: 0,
    size: [60, 16, 40],
    capacity: "2 heavy airframes",
    description:
      "Twin of Hangar A. Shared rail-mounted sliding doors on the south face.",
  },
  {
    id: "hangar-c",
    type: "hangar-gable",
    name: "Hangar C",
    position: [502, -310],
    rotation: 0,
    size: [56, 14, 38],
    capacity: "3 light airframes",
    description:
      "Gable-roof shed used for light aircraft and ground-support equipment.",
  },
  {
    id: "depot",
    type: "warehouse",
    name: "Logistics Depot",
    position: [462, -60],
    rotation: 0,
    size: [50, 8, 25],
    capacity: "1 200 t stores",
    description:
      "Flat-roof warehouse with a raised loading dock on the road side. Holds spares, rations and ground equipment.",
  },
  {
    id: "admin",
    type: "support",
    name: "Admin Block",
    position: [386, -52],
    rotation: 0,
    size: [22, 4.5, 12],
    capacity: "40 staff",
    description: "Single-storey administration and operations building.",
  },
  {
    id: "barracks",
    type: "support",
    name: "Barracks",
    position: [386, -18],
    rotation: 0,
    size: [26, 3.8, 10],
    capacity: "64 bunks",
    description: "Low dormitory block for resident ground crew.",
  },
  {
    id: "power",
    type: "support",
    name: "Power Station",
    position: [332, -56],
    rotation: 0,
    size: [14, 5, 9],
    capacity: "2 × 750 kVA",
    description: "Diesel generator hall feeding the site grid.",
  },
  {
    id: "pump-house",
    type: "support",
    name: "Pump House",
    position: [528, -104],
    rotation: 0.35,
    size: [12, 4, 8],
    capacity: "40 m³/h",
    description: "Fuel transfer pumps between the tank farm and the apron hydrants.",
  },
  {
    id: "fuel-tank",
    type: "fuel-tank",
    name: "Fuel Tank 1",
    position: [548, -132],
    rotation: 0,
    size: [14, 9, 14],
    capacity: "1 350 m³ Jet A-1",
    description: "Welded-steel vertical storage tank inside a low earth bund.",
  },
  {
    id: "radome-w",
    type: "radome",
    name: "Radar Dome West",
    position: [-1780, -1080],
    rotation: 0,
    size: [10, 16, 10],
    capacity: "S-band surveillance",
    description:
      "White geodesic radome on a squat service tower at the western perimeter.",
  },
  {
    id: "radome-se",
    type: "radome",
    name: "Radar Dome Southeast",
    position: [1520, 920],
    rotation: 0,
    size: [10, 16, 10],
    capacity: "X-band precision",
    description:
      "Perimeter radome covering the southeast approach corridor.",
  },
];

/** Extra circular areas flattened in the heightfield (building pads etc.). */
export const FLATTEN_PADS: FlattenPad[] = [
  { center: [440, -170], radius: 280 },
  { center: [-1780, -1080], radius: 70 },
  { center: [1520, 920], radius: 70 },
];

/* ------------------------------------------------------------------ */
/* Cinematic flythrough waypoints                                      */
/* ------------------------------------------------------------------ */

export const CINEMATIC_WAYPOINTS: Waypoint[] = [
  { position: [40, 130, 1420], label: "Runway 36 threshold" },
  { position: [15, 70, 500], label: "Runway 36 rollout" },
  { position: [-60, 90, -450], label: "Runway intersection" },
  { position: [280, 45, -170], label: "Control tower" },
  { position: [430, 55, -390], label: "Hangar line" },
  { position: [-300, 130, -700], label: "Runway 25 climb-out" },
  { position: [-1350, 190, -900], label: "Triangle loop north" },
  { position: [-1400, 150, 260], label: "Triangle apex" },
  { position: [-500, 220, 900], label: "Southern desert" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const ALL_SEGMENTS: SegmentDef[] = [
  ...RUNWAYS,
  ...STRIPS,
  ...TAXIWAYS,
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

export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  tower: "Control Tower",
  "hangar-barrel": "Hangars",
  "hangar-gable": "Hangars",
  warehouse: "Storage",
  support: "Support Buildings",
  radome: "Sensors",
  "fuel-tank": "Fuel Farm",
};
