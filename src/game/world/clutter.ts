import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { normalizeForMerge } from "../weapons/geometry";
import { mulberry32, seededNoise2D } from "@/lib/noise";
import { flattenFactor, terrainHeight } from "@/lib/terrain";
import { ALL_SEGMENTS, APRONS, GROUND_ZONES, RUNWAYS, STRUCTURES } from "@/lib/layout";
import type { SurfaceType } from "../core/types";

/**
 * Ground clutter.
 *
 * The map is a faithful reconstruction of an airfield, which means it is
 * mostly large convex buildings standing on flat concrete. Read from the air
 * that is exactly right. Stood on, it is the single thing most wrong with the
 * frame: there is nothing between the boot and the horizon to give the eye a
 * sense of scale, nothing to take cover behind, and nothing to cast the small
 * sharp shadows that make a surface look like it is outdoors.
 *
 * So this scatters the things an airfield is actually covered in — barriers,
 * bastions, sandbags, drums, crates, pipe, cable reels, generator skids —
 * plus the desert that the airfield was built on top of. Two ideas do most of
 * the work:
 *
 *  - **Clutter accumulates against things.** Nobody leaves a pallet in the
 *    middle of an apron; it ends up against a wall. So the densest placement
 *    is a walk around every building's perimeter, and the open scatter is
 *    thin by comparison. This is what stops it looking sprinkled.
 *  - **Weathering lives in the vertex colours.** Every prop gets multi-octave
 *    noise and a dust gradient baked in at build time, so grime follows the
 *    object rather than a UV layout, and props read as worn without a single
 *    texture fetch.
 *
 * Everything is instanced — one draw call per prop type — and deterministic
 * from a seed, so the same map is the same map on every load.
 */

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type Rand = () => number;

/**
 * Merge parts, keeping vertex colours.
 *
 * `mergeAndDispose` cannot be used here: it normalises its inputs, and
 * normalising deletes every attribute except position, normal and uv — which
 * is right for the weapons it was written for and fatal for anything carrying
 * colour. Parts arrive from `paint` already normalised and all with the same
 * attribute set, so they can go straight into a merge.
 */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0]!;
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    for (let i = 1; i < parts.length; i += 1) parts[i]!.dispose();
    return parts[0]!;
  }
  for (const part of parts) part.dispose();
  return merged;
}

/** A part is geometry plus a flat base colour; weathering comes later. */
function paint(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const normalized = normalizeForMerge(geometry);
  const count = normalized.attributes["position"]!.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  normalized.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return normalized;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) {
    geometry.rotateX(rx);
    geometry.rotateY(ry);
    geometry.rotateZ(rz);
  }
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  color: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  if (rx || ry || rz) {
    geometry.rotateX(rx);
    geometry.rotateY(ry);
    geometry.rotateZ(rz);
  }
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

function blob(
  r: number,
  x: number,
  y: number,
  z: number,
  color: number,
  sx = 1,
  sy = 1,
  sz = 1,
  ry = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(r, 6, 4);
  geometry.scale(sx, sy, sz);
  if (ry) geometry.rotateY(ry);
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

const grain = seededNoise2D(0x51ee);
const patch = seededNoise2D(0x9a03);

/**
 * Bake weathering into the vertex colours.
 *
 * Fine grain plus broad patchiness plus dust rising from the base. The dust
 * gradient is what actually grounds a prop: an object whose bottom is the same
 * clean colour as its top always looks like it was dropped in.
 */
function weather(
  geometry: THREE.BufferGeometry,
  dust: THREE.Color,
  height: number,
): void {
  const position = geometry.attributes["position"]!;
  const color = geometry.attributes["color"]!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const fine = 0.88 + 0.24 * (grain(x * 7.3 + z * 2.1, y * 6.7) * 0.5 + 0.5);
    const broad = 0.9 + 0.2 * (patch(x * 1.3, z * 1.3 + y * 0.9) * 0.5 + 0.5);
    const tone = fine * broad;
    // Dust climbs the lower quarter of the prop.
    const grime = Math.max(0, 1 - y / Math.max(0.2, height * 0.42)) ** 1.6 * 0.55;
    const r = color.getX(i) * tone;
    const g = color.getY(i) * tone;
    const b = color.getZ(i) * tone;
    color.setXYZ(
      i,
      r + (dust.r - r) * grime,
      g + (dust.g - g) * grime,
      b + (dust.b - b) * grime,
    );
  }
  color.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

const CONCRETE = 0x9c9488;

const RUST = 0x7a4a2c;
const OLIVE = 0x5f6347;
const SAND_BAG = 0x7d7355;
const STEEL = 0x8b8f92;
const STEEL_DARK = 0x5c6064;
const WOOD = 0x9a7c52;
const RUBBER = 0x2e2e30;

/** A New Jersey barrier, extruded from its real profile. */
function jerseyBarrier(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, 0);
  shape.lineTo(0.3, 0);
  shape.lineTo(0.24, 0.14);
  shape.lineTo(0.115, 0.56);
  shape.lineTo(0.095, 0.82);
  shape.lineTo(-0.095, 0.82);
  shape.lineTo(-0.115, 0.56);
  shape.lineTo(-0.24, 0.14);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false });
  geometry.translate(0, 0, -1.0);
  geometry.computeVertexNormals();
  return paint(geometry, CONCRETE);
}

/** A gabion bastion: wire cage, earth fill, rubble crown. */
function hescoBastion(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const s = 1.12;
  const h = 1.06;
  parts.push(box(s * 0.96, h * 0.98, s * 0.96, 0, h / 2, 0, 0x8d7f5d));
  // Wire cage: four uprights per corner plus three horizontal bands.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(0.035, h, 0.035, (sx * s) / 2, h / 2, (sz * s) / 2, STEEL_DARK));
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const y = 0.16 + i * 0.37;
    parts.push(box(s, 0.03, 0.03, 0, y, s / 2, STEEL_DARK));
    parts.push(box(s, 0.03, 0.03, 0, y, -s / 2, STEEL_DARK));
    parts.push(box(0.03, 0.03, s, s / 2, y, 0, STEEL_DARK));
    parts.push(box(0.03, 0.03, s, -s / 2, y, 0, STEEL_DARK));
  }
  // Loose fill breaking the top edge.
  for (let i = 0; i < 7; i += 1) {
    const r = 0.06 + rand() * 0.09;
    parts.push(
      box(
        r * 2,
        r * 1.3,
        r * 1.7,
        (rand() - 0.5) * s * 0.8,
        h + r * 0.4,
        (rand() - 0.5) * s * 0.8,
        0x796b4e,
        rand(),
        rand() * 3,
        rand() * 0.4,
      ),
    );
  }
  return mergeParts(parts);
}

/** Three staggered courses of sandbags. */
function sandbagStack(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Filled bags slump: wide, flat and overlapping, never stacked spheres.
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    const y = 0.075 + row * 0.148;
    const n = 5 - (row > 2 ? 1 : 0);
    const offset = row % 2 === 0 ? 0 : 0.15;
    for (let i = 0; i < n; i += 1) {
      const x = (i - (n - 1) / 2) * 0.3 + offset;
      parts.push(
        blob(
          0.2,
          x,
          y,
          (rand() - 0.5) * 0.07,
          SAND_BAG,
          1.42 + rand() * 0.16,
          0.4,
          0.92,
          (rand() - 0.5) * 0.26,
        ),
      );
    }
  }
  return mergeParts(parts);
}

/** A cleated shipping crate. */
function crate(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 1.18;
  const h = 0.92;
  const d = 0.84;
  const tone = rand() > 0.45 ? WOOD : OLIVE;
  parts.push(box(w, h, d, 0, h / 2, 0, tone));
  // Corner cleats and a mid rail on each long face.
  for (const sx of [-1, 1]) {
    parts.push(box(0.075, h + 0.02, d + 0.03, (sx * w) / 2, h / 2, 0, tone, 0, 0, 0));
  }
  for (const sz of [-1, 1]) {
    parts.push(box(w + 0.03, 0.07, 0.05, 0, h * 0.72, (sz * d) / 2, 0x6d5a3c));
    parts.push(box(w + 0.03, 0.07, 0.05, 0, h * 0.26, (sz * d) / 2, 0x6d5a3c));
  }
  parts.push(box(w * 0.99, 0.05, d * 0.99, 0, h + 0.02, 0, 0x6d5a3c));
  return mergeParts(parts);
}

/** A 200-litre drum, hooped. */
function drum(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 0.88;
  const r = 0.29;
  const tone = rand() > 0.5 ? RUST : rand() > 0.5 ? OLIVE : 0x39546b;
  parts.push(cyl(r, r, h, 14, 0, h / 2, 0, tone));
  parts.push(cyl(r * 1.05, r * 1.05, 0.055, 14, 0, h * 0.3, 0, STEEL_DARK));
  parts.push(cyl(r * 1.05, r * 1.05, 0.055, 14, 0, h * 0.7, 0, STEEL_DARK));
  parts.push(cyl(r * 0.99, r * 0.99, 0.03, 14, 0, h - 0.01, 0, STEEL_DARK));
  return mergeParts(parts);
}

/** Pipe stacked on timber skids. */
function pipeStack(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const len = 2.6;
  const r = 0.155;
  for (const z of [-0.9, 0.9]) {
    parts.push(box(0.9, 0.12, 0.14, 0, 0.06, z, WOOD));
  }
  const rowY = [0.12 + r, 0.12 + r * 2.7];
  for (let row = 0; row < 2; row += 1) {
    const n = row === 0 ? 3 : 2;
    for (let i = 0; i < n; i += 1) {
      const x = (i - (n - 1) / 2) * (r * 2.05);
      parts.push(cyl(r, r, len, 12, x, rowY[row]!, 0, STEEL, Math.PI / 2, 0, 0));
    }
  }
  return mergeParts(parts);
}

/** A wooden cable reel stood on its rims. */
function cableReel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = 0.68;
  for (const x of [-0.31, 0.31]) {
    parts.push(cyl(R, R, 0.07, 16, x, R, 0, WOOD, 0, 0, Math.PI / 2));
  }
  parts.push(cyl(0.3, 0.3, 0.56, 12, 0, R, 0, 0x4a4238, 0, 0, Math.PI / 2));
  // A few turns of cable still on the drum.
  for (let i = 0; i < 4; i += 1) {
    parts.push(
      cyl(
        0.36 + i * 0.012,
        0.36 + i * 0.012,
        0.5 - i * 0.08,
        12,
        0,
        R,
        0,
        0x24262a,
        0,
        0,
        Math.PI / 2,
      ),
    );
  }
  return mergeParts(parts);
}

/** A skid-mounted generator set. */
function genset(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 1.86;
  const h = 1.0;
  const d = 0.96;
  parts.push(box(w, 0.14, d, 0, 0.07, 0, STEEL_DARK));
  parts.push(box(w * 0.96, h - 0.2, d * 0.94, 0, 0.14 + (h - 0.2) / 2, 0, 0x6f7a63));
  // Louvred end and an exhaust stack.
  parts.push(box(0.05, h * 0.5, d * 0.7, w / 2 - 0.01, h * 0.5, 0, 0x3d443a));
  for (let i = 0; i < 5; i += 1) {
    parts.push(
      box(0.07, 0.035, d * 0.66, w / 2 - 0.02, h * 0.32 + i * 0.09, 0, 0x2c322a),
    );
  }
  parts.push(cyl(0.075, 0.075, 0.42, 8, -w * 0.3, h + 0.12, d * 0.28, STEEL_DARK));
  parts.push(box(w * 0.4, 0.06, 0.06, w * 0.18, h - 0.04, 0, STEEL_DARK));
  return mergeParts(parts);
}

/** A stack of three pallets. */
function palletStack(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let s = 0; s < 3; s += 1) {
    const y = s * 0.145;
    for (const z of [-0.36, 0, 0.36]) {
      parts.push(box(1.16, 0.075, 0.1, 0, y + 0.037, z, WOOD));
    }
    for (let i = 0; i < 5; i += 1) {
      const z = (i / 4 - 0.5) * 0.78;
      parts.push(box(1.16, 0.022, 0.11, 0, y + 0.086, z, 0xa88a5c));
    }
  }
  return mergeParts(parts);
}

/** A traffic cone with a reflective band. */
function cone(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(0.32, 0.04, 0.32, 0, 0.02, 0, 0xb8481f));
  parts.push(cyl(0.035, 0.145, 0.56, 8, 0, 0.32, 0, 0xc2521f));
  parts.push(cyl(0.082, 0.098, 0.1, 8, 0, 0.42, 0, 0xd8d2c4));
  return mergeParts(parts);
}

/** Broken concrete and spoil. */
function rubble(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const r = 0.07 + rand() * 0.17;
    parts.push(
      box(
        r * 2.4,
        r * 0.72,
        r * 1.9,
        (rand() - 0.5) * 0.7,
        r * 0.34,
        (rand() - 0.5) * 0.7,
        rand() > 0.4 ? 0x6b6357 : 0x7a705c,
        (rand() - 0.5) * 0.5,
        rand() * 3.1,
        (rand() - 0.5) * 0.4,
      ),
    );
  }
  return mergeParts(parts);
}

/** A dry desert shrub: splayed woody stems, no alpha to sort. */
function scrub(rand: Rand): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2 + rand() * 0.5;
    const lean = 0.5 + rand() * 0.55;
    const len = 0.3 + rand() * 0.26;
    const g = new THREE.CylinderGeometry(0.004, 0.021, len, 3);
    g.translate(0, len / 2, 0);
    g.rotateX(lean);
    g.rotateY(angle);
    parts.push(paint(g, rand() > 0.45 ? 0x6d6b43 : 0x857a52));
  }
  return mergeParts(parts);
}

/** A weathered desert stone. */
function rock(rand: Rand): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.3, 0);
  const position = geometry.attributes["position"]!;
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(
      i,
      position.getX(i) * (0.7 + rand() * 0.7),
      Math.max(0, position.getY(i)) * (0.4 + rand() * 0.4),
      position.getZ(i) * (0.7 + rand() * 0.7),
    );
  }
  geometry.computeVertexNormals();
  geometry.translate(0, 0.02, 0);
  return paint(geometry, 0x6f6857);
}

/** A stack of scrap tyres. */
function tyreStack(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    parts.push(cyl(0.34, 0.34, 0.17, 12, 0, 0.09 + i * 0.16, 0, RUBBER));
    parts.push(cyl(0.19, 0.19, 0.19, 10, 0, 0.09 + i * 0.16, 0, 0x1c1c1e));
  }
  return mergeParts(parts);
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                          */
/* ------------------------------------------------------------------ */

type MaterialKind = "hard" | "soft" | "organic";

interface PropDef {
  readonly id: string;
  readonly build: (rand: Rand) => THREE.BufferGeometry;
  readonly material: MaterialKind;
  readonly surface: SurfaceType;
  /** Height used for the dust gradient, and the cue that this is real cover. */
  readonly height: number;
  /** Cover props are baked into collision; dressing is not. */
  readonly cover: boolean;
  /** Relative weight when picking a prop for a slot. */
  readonly weight: number;
  /** Random scale range. */
  readonly scale: readonly [number, number];
}

const PROPS: readonly PropDef[] = [
  {
    id: "jersey",
    build: jerseyBarrier,
    material: "hard",
    surface: "concrete",
    height: 0.82,
    cover: true,
    weight: 1.5,
    scale: [0.94, 1.06],
  },
  {
    id: "hesco",
    build: hescoBastion,
    material: "soft",
    surface: "sand",
    height: 1.06,
    cover: true,
    weight: 1.1,
    scale: [0.92, 1.14],
  },
  {
    id: "sandbags",
    build: sandbagStack,
    material: "soft",
    surface: "sand",
    height: 0.66,
    cover: true,
    weight: 1.0,
    scale: [0.9, 1.15],
  },
  {
    id: "crate",
    build: crate,
    material: "hard",
    surface: "wood",
    height: 0.94,
    cover: true,
    weight: 1.4,
    scale: [0.85, 1.2],
  },
  {
    id: "drum",
    build: drum,
    material: "hard",
    surface: "thin-metal",
    height: 0.88,
    cover: true,
    weight: 1.6,
    scale: [0.95, 1.05],
  },
  {
    id: "pipes",
    build: pipeStack,
    material: "hard",
    surface: "metal",
    height: 0.75,
    cover: true,
    weight: 0.7,
    scale: [0.9, 1.1],
  },
  {
    id: "reel",
    build: cableReel,
    material: "hard",
    surface: "wood",
    height: 1.36,
    cover: true,
    weight: 0.55,
    scale: [0.85, 1.1],
  },
  {
    id: "genset",
    build: genset,
    material: "hard",
    surface: "metal",
    height: 1.12,
    cover: true,
    weight: 0.5,
    scale: [0.92, 1.06],
  },
  {
    id: "pallets",
    build: palletStack,
    material: "hard",
    surface: "wood",
    height: 0.44,
    cover: true,
    weight: 0.9,
    scale: [0.9, 1.12],
  },
  {
    id: "tyres",
    build: tyreStack,
    material: "hard",
    surface: "rubber",
    height: 0.53,
    cover: true,
    weight: 0.6,
    scale: [0.9, 1.15],
  },
  {
    id: "cone",
    build: cone,
    material: "hard",
    surface: "rubber",
    height: 0.6,
    cover: false,
    weight: 0.9,
    scale: [0.9, 1.1],
  },
  {
    id: "rubble",
    build: rubble,
    material: "hard",
    surface: "concrete",
    height: 0.3,
    cover: false,
    weight: 1.5,
    scale: [0.7, 1.5],
  },
  {
    id: "scrub",
    build: scrub,
    material: "organic",
    surface: "foliage",
    height: 0.5,
    cover: false,
    weight: 1.0,
    scale: [0.7, 1.6],
  },
  {
    id: "rock",
    build: rock,
    material: "hard",
    surface: "gravel",
    height: 0.3,
    cover: false,
    weight: 1.0,
    scale: [0.5, 1.7],
  },
];

const COVER_IDS = PROPS.filter((p) => p.cover).map((p) => p.id);
const DRESSING_IDS = ["cone", "rubble", "tyres"];
const DESERT_IDS = ["scrub", "rock", "rubble"];

/* ------------------------------------------------------------------ */
/* Placement                                                          */
/* ------------------------------------------------------------------ */

interface Slot {
  prop: number;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  tint: number;
}

/** Structure footprints as rotated rectangles, for rejection tests. */
interface Footprint {
  x: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  hd: number;
}

function buildFootprints(): Footprint[] {
  return STRUCTURES.map((s) => ({
    x: s.position[0],
    z: s.position[1],
    cos: Math.cos(-s.rotation),
    sin: Math.sin(-s.rotation),
    hw: s.size[0] / 2,
    hd: s.size[2] / 2,
  }));
}

/** Signed distance to a footprint's edge; negative inside. */
function footprintDistance(f: Footprint, x: number, z: number): number {
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = dx * f.cos - dz * f.sin;
  const lz = dx * f.sin + dz * f.cos;
  return Math.max(Math.abs(lx) - f.hw, Math.abs(lz) - f.hd);
}

/** Distance from a point to a runway's paved surface. */
function runwayDistance(x: number, z: number): number {
  let best = Infinity;
  for (const r of RUNWAYS) {
    const ax = r.from[0];
    const az = r.from[1];
    const bx = r.to[0];
    const bz = r.to[1];
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lenSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - r.width / 2;
    if (d < best) best = d;
  }
  return best;
}

function pickWeighted(rand: Rand, ids: readonly string[]): number {
  let total = 0;
  for (const id of ids) total += PROPS.find((p) => p.id === id)!.weight;
  let roll = rand() * total;
  for (const id of ids) {
    const index = PROPS.findIndex((p) => p.id === id);
    roll -= PROPS[index]!.weight;
    if (roll <= 0) return index;
  }
  return PROPS.findIndex((p) => p.id === ids[ids.length - 1]);
}

export interface ClutterOptions {
  seed?: number;
  /** Scales every count; 0 places nothing. */
  density?: number;
}

export interface ClutterResult {
  group: THREE.Group;
  instances: number;
  triangles: number;
  dispose(): void;
}

/**
 * Scatter clutter across the airfield and return it as instanced meshes.
 *
 * Placement runs in three passes, in descending order of how much each one
 * does for the frame: against building walls, inside the named engagement
 * zones, and out across the open desert.
 */
export function buildGroundClutter(options: ClutterOptions = {}): ClutterResult {
  const density = options.density ?? 1;
  const rand = mulberry32(options.seed ?? 0x5c1a77);
  const footprints = buildFootprints();
  const slots: Slot[][] = PROPS.map(() => []);

  /** Reject anything inside a building or too close to one to walk past. */
  const clearOfBuildings = (x: number, z: number, margin: number): boolean => {
    for (const f of footprints) {
      if (footprintDistance(f, x, z) < margin) return false;
    }
    return true;
  };

  const push = (prop: number, x: number, z: number, yaw: number): void => {
    const def = PROPS[prop]!;
    const [lo, hi] = def.scale;
    slots[prop]!.push({
      prop,
      x,
      z,
      yaw,
      scale: lo + rand() * (hi - lo),
      // A narrow tint spread reads as different production batches; go wider
      // and it looks like the props were coloured at random.
      tint: 0.84 + rand() * 0.32,
    });
  };

  /* --------------------------------------------------- against walls */
  // The densest pass, and the one that makes the place look used. Walk each
  // building's perimeter and lean clutter against it.
  for (const structure of STRUCTURES) {
    if (structure.type.startsWith("aircraft-")) continue;
    const hw = structure.size[0] / 2;
    const hd = structure.size[2] / 2;
    const perimeter = 2 * (hw + hd) * 2;
    const count = Math.round(perimeter * 0.055 * density);
    const cos = Math.cos(structure.rotation);
    const sin = Math.sin(structure.rotation);

    for (let i = 0; i < count; i += 1) {
      // Walk the rectangle, then step outward from whichever face we are on.
      const t = rand() * (hw + hd) * 2;
      let lx: number;
      let lz: number;
      let outX = 0;
      let outZ = 0;
      if (t < hw * 2) {
        lx = t - hw;
        lz = rand() > 0.5 ? hd : -hd;
        outZ = Math.sign(lz);
      } else {
        lz = t - hw * 2 - hd;
        lx = rand() > 0.5 ? hw : -hw;
        outX = Math.sign(lx);
      }
      const gap = 0.75 + rand() * 1.9;
      lx += outX * gap;
      lz += outZ * gap;

      const x = structure.position[0] + lx * cos + lz * sin;
      const z = structure.position[1] - lx * sin + lz * cos;
      if (!clearOfBuildings(x, z, 0.6)) continue;
      if (runwayDistance(x, z) < 12) continue;

      const prop = pickWeighted(rand, rand() < 0.72 ? COVER_IDS : DRESSING_IDS);
      // Props against a wall line up with it, roughly.
      const along = structure.rotation + (outX !== 0 ? Math.PI / 2 : 0);
      push(prop, x, z, along + (rand() - 0.5) * 0.5);
    }
  }

  /* ---------------------------------------------------- fighting zones */
  // Clusters, not sprinkle. Things on an airfield arrive by the pallet and get
  // put down together: barriers go in a line, drums go in a group, a fighting
  // position is sandbags and a bastion in an L. Scattering single props at
  // uniform density reads as noise no matter how many you place, whereas a
  // dozen deliberate groups read as a place someone works.
  const idOf = (id: string): number => PROPS.findIndex((p) => p.id === id);
  const spawnCluster = (cx: number, cz: number, heading: number): void => {
    const kind = rand();
    const drop = (prop: number, ox: number, oz: number, yaw: number): void => {
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const x = cx + ox * cos - oz * sin;
      const z = cz + ox * sin + oz * cos;
      if (!clearOfBuildings(x, z, 1.2)) return;
      if (runwayDistance(x, z) < 14) return;
      push(prop, x, z, heading + yaw);
    };

    if (kind < 0.26) {
      // A run of barriers, occasionally with a gap left to walk through.
      const n = 3 + Math.floor(rand() * 4);
      const gapAt = rand() < 0.4 ? Math.floor(rand() * n) : -1;
      for (let i = 0; i < n; i += 1) {
        if (i === gapAt) continue;
        drop(idOf("jersey"), 0, (i - (n - 1) / 2) * 2.06, (rand() - 0.5) * 0.05);
      }
    } else if (kind < 0.46) {
      // A drum group, some upright, some knocked over into rubble.
      const n = 3 + Math.floor(rand() * 5);
      for (let i = 0; i < n; i += 1) {
        drop(idOf("drum"), (rand() - 0.5) * 2.1, (rand() - 0.5) * 2.1, rand() * 3);
      }
      if (rand() < 0.5)
        drop(idOf("pallets"), (rand() - 0.5) * 2.4, (rand() - 0.5) * 2.4, rand() * 3);
    } else if (kind < 0.64) {
      // A fighting position: bastions across the front, sandbags at the corner.
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i += 1) {
        drop(idOf("hesco"), 0, (i - (n - 1) / 2) * 1.16, 0);
      }
      drop(idOf("sandbags"), 1.15, ((n - 1) / 2) * 1.16 + 0.5, Math.PI / 2);
      if (rand() < 0.6)
        drop(idOf("sandbags"), 1.2, -((n - 1) / 2) * 1.16 - 0.5, Math.PI / 2);
    } else if (kind < 0.82) {
      // A supply dump.
      const n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i += 1) {
        drop(
          idOf("crate"),
          (rand() - 0.5) * 2.8,
          (rand() - 0.5) * 2.8,
          (rand() - 0.5) * 0.4,
        );
      }
      if (rand() < 0.7)
        drop(idOf("pallets"), (rand() - 0.5) * 3, (rand() - 0.5) * 3, rand() * 3);
      if (rand() < 0.45)
        drop(idOf("tyres"), (rand() - 0.5) * 3, (rand() - 0.5) * 3, rand() * 3);
      if (rand() < 0.35)
        drop(idOf("reel"), (rand() - 0.5) * 3, (rand() - 0.5) * 3, rand() * 3);
    } else {
      // Works: a genset or pipe with cones marking it off.
      drop(rand() < 0.5 ? idOf("genset") : idOf("pipes"), 0, 0, 0);
      const n = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        drop(idOf("cone"), Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0);
      }
      if (rand() < 0.5)
        drop(idOf("rubble"), (rand() - 0.5) * 3, (rand() - 0.5) * 3, rand() * 3);
    }
  };

  for (const zone of GROUND_ZONES) {
    const area = Math.PI * zone.radius * zone.radius;
    const clusters = Math.round(area * 0.0022 * density);
    for (let i = 0; i < clusters; i += 1) {
      // Square-rooted radius keeps the disc evenly covered instead of
      // bunching everything at the centre.
      const r = Math.sqrt(rand()) * zone.radius;
      const angle = rand() * Math.PI * 2;
      const x = zone.position[0] + Math.cos(angle) * r;
      const z = zone.position[1] + Math.sin(angle) * r;
      if (!clearOfBuildings(x, z, 3)) continue;
      if (runwayDistance(x, z) < 18) continue;
      spawnCluster(x, z, rand() * Math.PI * 2);
    }
    // Loose dressing between the clusters, so the ground between them is not
    // conspicuously swept.
    const loose = Math.round(area * 0.004 * density);
    for (let i = 0; i < loose; i += 1) {
      const r = Math.sqrt(rand()) * zone.radius;
      const angle = rand() * Math.PI * 2;
      const x = zone.position[0] + Math.cos(angle) * r;
      const z = zone.position[1] + Math.sin(angle) * r;
      if (!clearOfBuildings(x, z, 1.4)) continue;
      if (runwayDistance(x, z) < 14) continue;
      push(pickWeighted(rand, DRESSING_IDS), x, z, rand() * Math.PI * 2);
    }
  }

  /* ------------------------------------------------------- pavement edges */
  // Aprons and taxiways are hundreds of metres across, and a fighting zone is
  // a thirty-metre disc, so most of the paved surface falls between the two.
  // Edges are where clutter genuinely accumulates — nothing is ever left in
  // the middle of a movement area — and they double as the cover that lines a
  // corridor, which is what makes a route worth walking rather than a void to
  // cross.
  for (const apron of APRONS) {
    const hw = apron.size[0] / 2;
    const hd = apron.size[1] / 2;
    const cos = Math.cos(apron.rotation);
    const sin = Math.sin(apron.rotation);
    const perimeter = (hw + hd) * 2;
    const count = Math.round(perimeter * 0.09 * density);
    for (let i = 0; i < count; i += 1) {
      const t = rand() * perimeter;
      let lx: number;
      let lz: number;
      if (t < hw * 2) {
        lx = t - hw;
        lz = (rand() > 0.5 ? hd : -hd) - (rand() - 0.5) * 5;
      } else {
        lz = t - hw * 2 - hd;
        lx = (rand() > 0.5 ? hw : -hw) - (rand() - 0.5) * 5;
      }
      const x = apron.center[0] + lx * cos + lz * sin;
      const z = apron.center[1] - lx * sin + lz * cos;
      if (!clearOfBuildings(x, z, 2.5)) continue;
      if (runwayDistance(x, z) < 16) continue;
      if (rand() < 0.3)
        spawnCluster(x, z, apron.rotation + (rand() < 0.5 ? 0 : Math.PI / 2));
      else
        push(
          pickWeighted(rand, rand() < 0.6 ? COVER_IDS : DRESSING_IDS),
          x,
          z,
          rand() * Math.PI * 2,
        );
    }
  }

  // Taxiway, street and road shoulders. Runways are left alone: an active
  // movement area is swept, and that emptiness is part of what an airfield is.
  for (const segment of ALL_SEGMENTS) {
    if (segment.kind === "runway") continue;
    const ax = segment.from[0];
    const az = segment.from[1];
    const dx = segment.to[0] - ax;
    const dz = segment.to[1] - az;
    const length = Math.hypot(dx, dz);
    if (length < 1) continue;
    const ux = dx / length;
    const uz = dz / length;
    const count = Math.round(length * 0.055 * density);
    for (let i = 0; i < count; i += 1) {
      const t = rand() * length;
      const side = rand() > 0.5 ? 1 : -1;
      const offset = segment.width / 2 + 0.8 + rand() * 4.5;
      const x = ax + ux * t - uz * side * offset;
      const z = az + uz * t + ux * side * offset;
      if (!clearOfBuildings(x, z, 2.5)) continue;
      if (runwayDistance(x, z) < 14) continue;
      const heading = Math.atan2(ux, uz);
      if (rand() < 0.22) spawnCluster(x, z, heading);
      else
        push(
          pickWeighted(rand, rand() < 0.55 ? COVER_IDS : DRESSING_IDS),
          x,
          z,
          heading + (rand() - 0.5) * 0.6,
        );
    }
  }

  /* ------------------------------------------------------ open desert */
  // Everything outside the paved surfaces. `flattenFactor` is 0 exactly where
  // pavement has levelled the ground, so it doubles as a paved/unpaved mask.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const zone of GROUND_ZONES) {
    minX = Math.min(minX, zone.position[0] - zone.radius);
    maxX = Math.max(maxX, zone.position[0] + zone.radius);
    minZ = Math.min(minZ, zone.position[1] - zone.radius);
    maxZ = Math.max(maxZ, zone.position[1] + zone.radius);
  }
  const pad = 130;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  // Desert scatter is the cheapest detail in the scene — twenty triangles a
  // stone, one draw call for all of them — and it is the only thing standing
  // between the pavement edge and an empty horizon, so it is laid on thick.
  const desertCount = Math.round((maxX - minX) * (maxZ - minZ) * 0.02 * density);
  for (let i = 0; i < desertCount; i += 1) {
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    // `flattenFactor` is 0 exactly where pavement has levelled the ground, so
    // it doubles as a paved mask. Testing against a random threshold rather
    // than a fixed one feathers the transition instead of drawing a line
    // around every apron.
    if (flattenFactor(x, z) < 0.25 + rand() * 0.5) continue;
    if (!clearOfBuildings(x, z, 2)) continue;
    const prop = pickWeighted(rand, DESERT_IDS);
    push(prop, x, z, rand() * Math.PI * 2);
  }

  /* ---------------------------------------------------------- build */
  const group = new THREE.Group();
  group.name = "ground-clutter";
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let instances = 0;
  let triangles = 0;

  const dust = new THREE.Color(0xa2967a);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const positionVec = new THREE.Vector3();
  const scaleVec = new THREE.Vector3();
  const euler = new THREE.Euler();
  const tintColor = new THREE.Color();

  for (let p = 0; p < PROPS.length; p += 1) {
    const def = PROPS[p]!;
    const list = slots[p]!;
    if (list.length === 0) continue;

    const geometry = def.build(rand);
    weather(geometry, dust, def.height);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometries.push(geometry);

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: def.material === "hard" ? 0.78 : def.material === "soft" ? 0.95 : 0.88,
      metalness: def.material === "hard" ? 0.18 : 0,
      side: def.material === "organic" ? THREE.DoubleSide : THREE.FrontSide,
    });
    material.name = `clutter-${def.id}`;
    materials.push(material);

    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    mesh.name = `clutter-${def.id}`;
    mesh.userData["surface"] = def.surface;
    // Only cover-sized props are worth a collider; the player should not snag
    // on a stone or a tuft of scrub.
    if (!def.cover) mesh.userData["noCollide"] = true;
    // Shadow casting is reserved for props big enough to throw a shadow the
    // sun's map can actually resolve at this site scale.
    mesh.castShadow = def.height > 0.5;
    mesh.receiveShadow = true;

    for (let i = 0; i < list.length; i += 1) {
      const slot = list[i]!;
      const y = terrainHeight(slot.x, slot.z);
      euler.set(0, slot.yaw, 0);
      quaternion.setFromEuler(euler);
      positionVec.set(slot.x, y, slot.z);
      // Slight non-uniform scale so repeated instances stop rhyming.
      scaleVec.set(slot.scale, slot.scale * (0.93 + (i % 7) * 0.022), slot.scale);
      matrix.compose(positionVec, quaternion, scaleVec);
      mesh.setMatrixAt(i, matrix);
      tintColor.setScalar(slot.tint);
      mesh.setColorAt(i, tintColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = true;
    mesh.computeBoundingSphere();

    group.add(mesh);
    instances += list.length;
    const index = geometry.getIndex();
    const tris = index ? index.count / 3 : geometry.attributes["position"]!.count / 3;
    triangles += tris * list.length;
  }

  return {
    group,
    instances,
    triangles,
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
