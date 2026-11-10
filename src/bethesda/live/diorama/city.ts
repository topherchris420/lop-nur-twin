/**
 * Bethesda as a tabletop clay model: the same imported geometry the flat map
 * drew (`model.ts`, `terrain.ts`, and the trees of `furniture.ts` and
 * `streetscape.ts` that the fly itself lands on), sculpted instead of traced.
 *
 * - **The board**: the bare-earth terrain as one slab of clay, as thick as
 *   the model needs to stand on a workbench. Where the imported city ends,
 *   the slab ends: past it there is no model, and the picture shows a table.
 * - **Streets**: rolled strips laid over the slab, pavement first, then the
 *   carriageway, then footpaths and the crossings painted over them.
 * - **Buildings**: every footprint at its modelled height, as a block with a
 *   thumbed-over top edge (a low hipped roof on the houses), in a few mixed
 *   colours of clay, with window rows pressed in at 3.3 m a storey: the
 *   storey height the city model itself assumes. The colours and the windows
 *   are the sculptor's; the model records neither.
 * - **Trees**: a rolled trunk and lumps of green.
 *
 * Everything is built in city metres and scaled once (`MODEL_SCALE`), so the
 * clay's hand marks come out the size of real fingerprints on a 1 : 400 model.
 * It is all built from seeds: the same model on every visit.
 */
import * as THREE from "three";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "../../../lib/noise.js";
import type { ClayLibrary, ClaySettings } from "../../../garden/scene/clay.js";
import { withCascade } from "../../../garden/scene/clay.js";
import { blob } from "../../../garden/scene/geometry.js";
import { awnings, rooftopUnit, streetTrees, treeShape } from "../../furniture.js";
import {
  bounds,
  buildings,
  parks,
  pathWays,
  roadWays,
  type Building,
  type Point,
} from "../../model.js";
import { mappedTrees } from "../../streetscape.js";
import { groundAt, minimumGround } from "../../terrain.js";
import { MODEL_SCALE } from "./stage.js";

/** How far below the lowest ground the slab reaches (city metres): a 25 mm board. */
const SLAB_DEPTH = 10;
/** The underside of the slab, and so the table top, in city metres. */
export const TABLE_Y = minimumGround - SLAB_DEPTH;
const TILE = 240;
/** One tile of hand marks on the model (model metres): a thumbprint is a few city metres across. */
const CLAY_TILE = 0.05;

const srgb = (hex: number) => new THREE.Color(hex);

const PALETTE = {
  ground: srgb(0x8fb05c),
  slab: srgb(0x7f8f5c),
  park: srgb(0x5d9a3c),
  pavement: srgb(0xcdc3ae),
  asphalt: srgb(0x4d4a48),
  path: srgb(0xe0cf9f),
  crossing: srgb(0xf2ecda),
  trunk: srgb(0x6b4a35),
  crowns: [0x4a8436, 0x5f983c, 0x3a7038, 0x7ba640, 0x528f3d].map(srgb),
  /** Walls and roofs for houses, and for everything else. */
  houseWalls: [0xecdcb8, 0xdcc79c, 0xb4c7a8, 0xbfd3dc, 0xe8b680, 0xd49f86, 0xf3ead6].map(
    srgb,
  ),
  houseRoofs: [0xb04f35, 0x91463a, 0x566270, 0x74513f, 0x4a5c58].map(srgb),
  blockWalls: [
    0xd8cbb0, 0xbdb5a4, 0xb9553a, 0xcb7a50, 0x98b1bf, 0x86a2b0, 0xe0d7c2, 0xc9aa80,
    0xa3aeb2, 0xd9b45a,
  ].map(srgb),
  blockRoofs: [0x9a968c, 0xb9a98a, 0x7d8a8f, 0xa66a4f, 0x6f8f7a, 0xcfc8b8, 0x7a6a5f].map(
    srgb,
  ),
  plant: srgb(0xb8bcba),
  awnings: [0xb23a2e, 0x2f5f8a, 0x3f7a4c, 0xd9a441, 0xe9e2cf].map(srgb),
};

/** One merged mesh's worth of triangles, built a vertex at a time. */
class Soup {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly f: number[] = [];
  readonly i: number[] = [];

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    col: THREE.Color,
    facade: readonly [number, number, number, number] | null = null,
  ): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(col.r, col.g, col.b);
    if (facade) this.f.push(...facade);
    else this.f.push(0, 0, 0, 0);
    return this.p.length / 3 - 1;
  }

  /** A triangle, turned to face the way its vertices' normals do. */
  tri(a: number, b: number, c: number) {
    const p = this.p,
      n = this.n;
    const ux = p[3 * b]! - p[3 * a]!,
      uy = p[3 * b + 1]! - p[3 * a + 1]!,
      uz = p[3 * b + 2]! - p[3 * a + 2]!;
    const vx = p[3 * c]! - p[3 * a]!,
      vy = p[3 * c + 1]! - p[3 * a + 1]!,
      vz = p[3 * c + 2]! - p[3 * a + 2]!;
    const gx = uy * vz - uz * vy,
      gy = uz * vx - ux * vz,
      gz = ux * vy - uy * vx;
    const facing =
      gx * (n[3 * a]! + n[3 * b]! + n[3 * c]!) +
      gy * (n[3 * a + 1]! + n[3 * b + 1]! + n[3 * c + 1]!) +
      gz * (n[3 * a + 2]! + n[3 * b + 2]! + n[3 * c + 2]!);
    if (facing >= 0) this.i.push(a, b, c);
    else this.i.push(a, c, b);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Adds an indexed geometry (positions and normals), transformed, in one colour. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, col: THREE.Color) {
    const pos = g.getAttribute("position"),
      nor = g.getAttribute("normal"),
      index = g.getIndex();
    if (!index) throw new Error("diorama: an indexed geometry was expected");
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.p.length / 3;
    const v = new THREE.Vector3(),
      w = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      w.fromBufferAttribute(nor, k).applyMatrix3(normalMatrix).normalize();
      this.p.push(v.x, v.y, v.z);
      this.n.push(w.x, w.y, w.z);
      this.c.push(col.r, col.g, col.b);
      this.f.push(0, 0, 0, 0);
    }
    for (let k = 0; k < index.count; k++) this.i.push(base + index.getX(k));
  }

  /** A block of clay: `w` × `h` × `d`, its middle at (x, y, z), turned `angle` about +y. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    angle: number,
    col: THREE.Color,
  ) {
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    // Three's rotateY: x' = x cos + z sin, z' = z cos − x sin.
    const turn = (lx: number, lz: number): [number, number] => [
      lx * cos + lz * sin,
      lz * cos - lx * sin,
    ];
    const faces: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [nx, ny, nz] of faces) {
      // Two axes spanning the face.
      const u: [number, number, number] = nx ? [0, 1, 0] : [1, 0, 0];
      const v: [number, number, number] = nz ? [0, 1, 0] : nx ? [0, 0, 1] : [0, 0, 1];
      const ids: number[] = [];
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const lx = ((nx + u[0] * a + v[0] * b) * w) / 2,
          ly = ((ny + u[1] * a + v[1] * b) * h) / 2,
          lz = ((nz + u[2] * a + v[2] * b) * d) / 2;
        const [px, pz] = turn(lx, lz);
        const [qx, qz] = turn(nx, nz);
        ids.push(this.vertex(x + px, y + ly, z + pz, qx, ny, qz, col));
      }
      this.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    }
  }

  geometry(withFacade: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (withFacade) g.setAttribute("facade", new THREE.Float32BufferAttribute(this.f, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Soups by map tile, so the camera and the shadow maps draw only what they see. */
class Tiles {
  private readonly tiles = new Map<string, Soup>();
  at(p: Point): Soup {
    const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
    let s = this.tiles.get(key);
    if (!s) {
      s = new Soup();
      this.tiles.set(key, s);
    }
    return s;
  }
  each(f: (s: Soup) => void) {
    for (const s of this.tiles.values()) if (s.i.length) f(s);
  }
}

const UP: readonly [number, number, number] = [0, 1, 0];

// ------------------------------------------------------------------ streets

/**
 * A strip of clay laid along a line and pressed onto the slab: `width` wide,
 * its top `lift` above the ground, its edges thumbed down to the surface
 * below, with a round of clay at every joint so bends and junctions close.
 */
function strip(
  tiles: Tiles,
  points: readonly Point[],
  width: number,
  lift: number,
  col: THREE.Color,
  joints: number,
) {
  const half = width / 2;
  // How far the thumbed edge runs out, and how far it drops.
  const edge = Math.min(0.45, half * 0.5),
    drop = Math.min(lift, 0.16);
  const y = (p: Point) => groundAt(p) + lift;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!,
      b = points[k]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length;
    // Left of travel (x east, z south).
    const lx = dz,
      lz = -dx;
    const pieces = Math.max(1, Math.ceil(length / 12));
    const soup = tiles.at({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    let last: number[] | null = null;
    for (let s = 0; s <= pieces; s++) {
      const t = s / pieces;
      const cx = a.x + (b.x - a.x) * t,
        cz = a.z + (b.z - a.z) * t;
      const row: number[] = [];
      // Across the strip: outer edge, shoulder, shoulder, outer edge.
      for (const [off, down, tilt] of [
        [half + edge, drop, 1],
        [half, 0, 0.25],
        [-half, 0, -0.25],
        [-half - edge, drop, -1],
      ] as const) {
        const p = { x: cx + lx * off, z: cz + lz * off };
        const nl = Math.hypot(tilt * 0.8, 1);
        row.push(
          soup.vertex(
            p.x,
            y(p) - down,
            p.z,
            (lx * tilt * 0.8) / nl,
            1 / nl,
            (lz * tilt * 0.8) / nl,
            col,
          ),
        );
      }
      if (last)
        for (let q = 0; q < 3; q++)
          soup.quad(last[q]!, row[q]!, row[q + 1]!, last[q + 1]!);
      last = row;
    }
  }
  if (joints < 3) return;
  for (const p of points) {
    const soup = tiles.at(p);
    const centre = soup.vertex(p.x, y(p), p.z, ...UP, col);
    const rim: number[] = [],
      skirt: number[] = [];
    for (let s = 0; s < joints; s++) {
      const a = (s / joints) * Math.PI * 2;
      const ox = Math.cos(a),
        oz = Math.sin(a);
      const inner = { x: p.x + ox * half, z: p.z + oz * half };
      const outer = { x: p.x + ox * (half + edge), z: p.z + oz * (half + edge) };
      rim.push(soup.vertex(inner.x, y(inner), inner.z, ox * 0.2, 0.98, oz * 0.2, col));
      skirt.push(
        soup.vertex(outer.x, y(outer) - drop, outer.z, ox * 0.62, 0.78, oz * 0.62, col),
      );
    }
    for (let s = 0; s < joints; s++) {
      const t = (s + 1) % joints;
      soup.tri(centre, rim[s]!, rim[t]!);
      soup.quad(rim[s]!, skirt[s]!, skirt[t]!, rim[t]!);
    }
  }
}

/** A broken line of paint down the middle of a carriageway: thin strips of pale clay, `on` long and `off` apart. */
function dashes(
  tiles: Tiles,
  points: readonly Point[],
  lift: number,
  col: THREE.Color,
  on = 3,
  off = 6,
) {
  const half = 0.16;
  let phase = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!,
      b = points[k]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length;
    const soup = tiles.at(a);
    let s = -phase;
    for (; s < length; s += on + off) {
      const from = Math.max(0, s),
        to = Math.min(length, s + on);
      if (to - from < 0.4) continue;
      const corner = (t: number, side: number) => {
        const p = {
          x: a.x + dx * t + dz * half * side,
          z: a.z + dz * t - dx * half * side,
        };
        return soup.vertex(p.x, groundAt(p) + lift, p.z, ...UP, col);
      };
      soup.quad(corner(from, 1), corner(to, 1), corner(to, -1), corner(from, -1));
    }
    // The pattern carries on round the bend.
    phase = (length + phase) % (on + off);
  }
}

/** A flat patch pressed onto the slab (a park), following the ground. */
function patch(tiles: Tiles, ring: readonly Point[], lift: number, col: THREE.Color) {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.z)));
  const flat = new THREE.ShapeGeometry(shape);
  const fine = new TessellateModifier(14, 6).modify(flat);
  flat.dispose();
  const pos = fine.getAttribute("position");
  const soup = tiles.at(ring[0]!);
  for (let k = 0; k < pos.count; k += 3) {
    const ids: number[] = [];
    for (let j = 0; j < 3; j++) {
      const p = { x: pos.getX(k + j), z: pos.getY(k + j) };
      ids.push(soup.vertex(p.x, groundAt(p) + lift, p.z, ...UP, col));
    }
    soup.tri(ids[0]!, ids[1]!, ids[2]!);
  }
  fine.dispose();
}

// ---------------------------------------------------------------- buildings

const HOUSES = new Set(["detached", "house", "residential", "terrace", "garage"]);
/** Structures drawn without windows: decks, canopies and the like. */
const BLANK = new Set(["parking", "roof", "bridge", "garage", "construction", "service"]);

interface Ring {
  points: Point[];
  /** Unit normals of each edge (from point k to k + 1), pointing out of the solid. */
  normals: Point[];
}

/** A closed ring without its repeated last point, with its edges' outward normals. */
function ringOf(raw: readonly Point[], hole: boolean): Ring | null {
  const points = raw.slice();
  const first = points[0],
    last = points.at(-1);
  if (first && last && points.length > 1 && first.x === last.x && first.z === last.z)
    points.pop();
  if (points.length < 3) return null;
  let area = 0;
  for (let k = 0; k < points.length; k++) {
    const a = points[k]!,
      b = points[(k + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  // Out of the solid: away from the footprint, or into the courtyard.
  const sign = (area > 0 ? 1 : -1) * (hole ? -1 : 1);
  const normals = points.map((a, k) => {
    const b = points[(k + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (sign * (b.z - a.z)) / length, z: (-sign * (b.x - a.x)) / length };
  });
  return { points, normals };
}

/** The ring moved `d` into the solid (mitred at the corners). */
function inset(r: Ring, d: number): Point[] {
  const count = r.points.length;
  return r.points.map((p, k) => {
    const a = r.normals[(k + count - 1) % count]!,
      b = r.normals[k]!;
    const along = 1 + a.x * b.x + a.z * b.z;
    // A hairpin corner would send the mitre to infinity.
    const scale = d / Math.max(along, 0.35);
    return { x: p.x - (a.x + b.x) * scale, z: p.z - (a.z + b.z) * scale };
  });
}

function building(tiles: Tiles, b: Building) {
  const outer = ringOf(b.ring, false);
  if (!outer) return;
  const holes = b.holes.map((h) => ringOf(h, true)).filter((h): h is Ring => h !== null);
  const random = mulberry32((Number(b.id) ^ 0x9e3779b9) >>> 0);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const house = HOUSES.has(b.type);
  const wall = pick(house ? PALETTE.houseWalls : PALETTE.blockWalls)
    .clone()
    .offsetHSL(0, 0, (random() - 0.5) * 0.06);
  const roof = pick(house ? PALETTE.houseRoofs : PALETTE.blockRoofs)
    .clone()
    .offsetHSL(0, 0, (random() - 0.5) * 0.05);
  const ground = groundAt(b.center);
  const top = ground + b.height;
  let low = ground;
  for (const p of outer.points) low = Math.min(low, groundAt(p));
  const base = low - 1.5;

  const xs = outer.points.map((p) => p.x),
    zs = outer.points.map((p) => p.z);
  const span = Math.min(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
  );
  // Houses: a low hipped roof. Everything else: a flat roof with a thumbed edge.
  const run =
    house && !holes.length ? Math.min(2.4, span * 0.28) : Math.min(0.8, span * 0.2);
  const rise = house && !holes.length ? Math.min(run * 0.8, b.height * 0.4) : 0.6;
  const eaves = top - rise;
  const face = eaves - ground;
  const windows = !BLANK.has(b.type) && face > 2.4;
  const soup = tiles.at(b.center);

  const walls = (r: Ring) => {
    const count = r.points.length;
    for (let k = 0; k < count; k++) {
      const p = r.points[k]!,
        q = r.points[(k + 1) % count]!,
        n = r.normals[k]!;
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      // The wall's height is negative where no windows are pressed.
      const tag = (u: number, y: number) =>
        [u, y - ground, length, windows ? face : -face] as const;
      soup.quad(
        soup.vertex(p.x, base, p.z, n.x, 0, n.z, wall, tag(0, base)),
        soup.vertex(q.x, base, q.z, n.x, 0, n.z, wall, tag(length, base)),
        soup.vertex(q.x, eaves, q.z, n.x, 0, n.z, wall, tag(length, eaves)),
        soup.vertex(p.x, eaves, p.z, n.x, 0, n.z, wall, tag(0, eaves)),
      );
    }
  };
  walls(outer);
  for (const h of holes) walls(h);

  // The roof's edge: from the eaves in to the cap.
  const cap = inset(outer, run);
  // No roof is quite flat: each corner is pressed down or left up a little.
  const lean = cap.map(() => (random() - 0.5) * Math.min(0.5, b.height * 0.04));
  const slope = house && !holes.length;
  const edgeColour = slope ? roof : wall.clone().offsetHSL(0, 0, 0.03);
  const count = outer.points.length;
  for (let k = 0; k < count; k++) {
    const j = (k + 1) % count;
    const p = outer.points[k]!,
      q = outer.points[j]!,
      n = outer.normals[k]!;
    // A slope is flat; a thumbed edge turns from the wall's normal to the roof's.
    const nl = Math.hypot(rise, run);
    const lower: [number, number, number] = slope
      ? [(n.x * rise) / nl, run / nl, (n.z * rise) / nl]
      : [n.x * 0.8, 0.6, n.z * 0.8];
    const upper: [number, number, number] = slope
      ? lower
      : [n.x * 0.15, 0.99, n.z * 0.15];
    soup.quad(
      soup.vertex(p.x, eaves, p.z, ...lower, edgeColour),
      soup.vertex(q.x, eaves, q.z, ...lower, edgeColour),
      soup.vertex(cap[j]!.x, top + lean[j]!, cap[j]!.z, ...upper, edgeColour),
      soup.vertex(cap[k]!.x, top + lean[k]!, cap[k]!.z, ...upper, edgeColour),
    );
  }
  const contour = cap.map((p) => new THREE.Vector2(p.x, p.z));
  const holeContours = holes.map((h) => h.points.map((p) => new THREE.Vector2(p.x, p.z)));
  const all = [...contour, ...holeContours.flat()];
  const ids = all.map((p, k) => soup.vertex(p.x, top + (lean[k] ?? 0), p.y, ...UP, roof));
  for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, holeContours))
    soup.tri(ids[a!]!, ids[c!]!, ids[d!]!);

  // What the fly can land on up here and along the shopfronts (furniture.ts).
  const plant = rooftopUnit(b);
  if (plant)
    soup.box(
      plant.point.x,
      ground + plant.y,
      plant.point.z,
      plant.w,
      plant.h + 0.5,
      plant.d,
      plant.angle,
      PALETTE.plant,
    );
  const shade = pick(PALETTE.awnings);
  for (const a of awnings(b))
    soup.box(
      a.point.x,
      ground + a.y,
      a.point.z,
      a.w,
      a.h + 0.35,
      a.d + 0.6,
      a.angle,
      shade,
    );
}

/**
 * Window rows pressed into the walls. Each wall carries, per vertex, how far
 * along it and how far above the ground the point is, and the wall's length
 * and height (city metres); the shader lays out whole windows only, a storey
 * every 3.3 m, and fades them to an even tone where they would be smaller
 * than a pixel.
 */
const FACADE_PATCH: NonNullable<ClaySettings["patch"]> = {
  key: "city-facade",
  apply(shader) {
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      "attribute vec4 facade;\nvarying vec4 vFacade;\nvoid main() {\n  vFacade = facade;",
    );
    const fragment = shader.fragmentShader
      .replace("void main() {", "varying vec4 vFacade;\nvoid main() {")
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
  float cityRecess = 0.0;
  float cityWall = abs( vFacade.w );
  if ( vFacade.z > 0.0 ) {
    // A wall's ends and its top are thumbed round, not cut square.
    float r = min( 0.9, 0.3 * vFacade.z );
    float a = max( 0.0, r - vFacade.x ), b = max( 0.0, vFacade.x - ( vFacade.z - r ) );
    float t = max( 0.0, vFacade.y - ( cityWall - r ) );
    cityRecess = - CITY_UNIT * ( a * a + b * b + t * t ) / ( 2.0 * r );
  }
  if ( vFacade.w > 2.4 && vFacade.z > 2.2 ) {
    float cols = max( 1.0, floor( ( vFacade.z - 0.6 ) / 3.1 ) );
    float rows = max( 1.0, floor( ( vFacade.w - 0.4 ) / 3.3 ) );
    vec2 cell = vec2( vFacade.z / cols, 3.3 );
    vec2 q = vec2( vFacade.x / cell.x, ( vFacade.y - 0.35 ) / cell.y );
    vec2 id = floor( q );
    vec2 f = ( fract( q ) - 0.5 ) * cell;
    float seed = fract( sin( dot( id + floor( vFacade.zw * 7.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec2 pane = vec2( min( 0.85, cell.x * 0.33 ), 0.95 );
    // Metres outside the pane (negative inside), and metres to a pixel.
    float d = max( abs( f.x ) - pane.x, abs( f.y + 0.1 ) - pane.y );
    float px = max( length( fwidth( vFacade.xy ) ), 1e-4 );
    float storey = step( 0.0, q.y ) * step( q.y, rows );
    float inside = ( 1.0 - smoothstep( -0.5 * px, 0.5 * px, d ) ) * storey;
    // Too small to draw: the wall takes the windows' share of tone instead.
    float far = smoothstep( 0.35, 1.1, px );
    float share = ( 4.0 * pane.x * pane.y ) / ( cell.x * cell.y ) * storey;
    float glass = mix( inside, share * 0.8, far );
    vec3 paneColour = mix( vec3( 0.045, 0.06, 0.085 ), vec3( 0.62, 0.56, 0.42 ), step( 0.86, seed ) * 0.55 );
    diffuseColor.rgb = mix( diffuseColor.rgb, paneColour, glass * 0.92 );
    roughnessFactor = mix( roughnessFactor, 0.22, inside * ( 1.0 - far ) );
    float bevel = max( 0.16, 1.5 * px );
    cityRecess -= CITY_UNIT * 0.22 * ( 1.0 - smoothstep( - bevel, 0.0, d ) ) * storey * ( 1.0 - far );
  }`,
      )
      .replace(
        "normal = clayRelief( - vViewPosition, normal, h, faceDirection );",
        "h += cityRecess;\n    normal = clayRelief( - vViewPosition, normal, h, faceDirection );",
      );
    if (!fragment.includes("h += cityRecess") || !fragment.includes("float cityRecess"))
      throw new Error("diorama: the clay shader changed; update city.ts");
    // A city metre, in the view space the relief is measured in.
    shader.fragmentShader = fragment.replace(/CITY_UNIT/g, MODEL_SCALE.toFixed(7));
  },
};

// -------------------------------------------------------------------- trees

function trees(tiles: Tiles, detail: number) {
  const lump = blob(1, { detail, seed: 0x7ee5, lumps: 0.16, frequency: 1.2 });
  const trunk = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  trunk.translate(0, 0.5, 0);
  // The trunk's taper is baked in: unit radius at the foot.
  const taper = trunk.getAttribute("position");
  for (let k = 0; k < taper.count; k++)
    if (taper.getY(k) > 0.5) taper.setXYZ(k, taper.getX(k) * 0.6, 1, taper.getZ(k) * 0.6);
  trunk.computeVertexNormals();
  const random = mulberry32(0x7ee5c1a7);
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler();
  const crown = (soup: Soup, x: number, y: number, z: number, r: number, s: number) => {
    e.set(random() * 6.28, random() * 6.28, random() * 6.28);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r, r * s, r));
    const colour = PALETTE.crowns[Math.floor(random() * PALETTE.crowns.length)]!;
    soup.add(lump, m, colour.clone().offsetHSL(0, 0, (random() - 0.5) * 0.05));
  };
  const stem = (soup: Soup, p: Point, height: number, radius: number) => {
    m.compose(
      new THREE.Vector3(p.x, groundAt(p) - 0.3, p.z),
      q.identity(),
      new THREE.Vector3(radius * 1.5, height + 0.9, radius * 1.5),
    );
    soup.add(trunk, m, PALETTE.trunk);
  };
  for (const t of streetTrees()) {
    const soup = tiles.at(t.point),
      g = groundAt(t.point);
    stem(soup, t.point, t.trunkHeight, 0.25);
    // The crowns near the Row are many small lumps; one in two is plenty at this scale.
    t.crowns.forEach((c, k) => {
      if (t.close && k % 2) return;
      crown(soup, c.x, g + c.y, c.z, c.r * (t.close ? 1.5 : 1.15), c.stretch);
    });
  }
  for (const t of mappedTrees) {
    const shape = treeShape(t.osmId),
      soup = tiles.at(t.point),
      g = groundAt(t.point);
    stem(soup, t.point, shape.trunkHeight, shape.trunkBottomRadius);
    for (const c of shape.crowns)
      crown(soup, t.point.x + c.dx, g + c.y, t.point.z + c.dz, c.r * 1.1, 1);
  }
  lump.dispose();
  trunk.dispose();
}

// -------------------------------------------------------------------- board

/** The slab: the terrain, and its cut sides down to the table. */
function slab(): THREE.BufferGeometry {
  const soup = new Soup();
  const N = 128;
  const at = (i: number, j: number): Point => ({
    x: bounds.min.x + ((bounds.max.x - bounds.min.x) * i) / N,
    z: bounds.min.z + ((bounds.max.z - bounds.min.z) * j) / N,
  });
  const dx = (bounds.max.x - bounds.min.x) / N,
    dz = (bounds.max.z - bounds.min.z) / N;
  // Kneaded colour: no lawn is one green.
  const noise = createNoise2D(mulberry32(0x51ab));
  const shade = new THREE.Color();
  const ids: number[] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const p = at(i, j);
      // The slope of the ground, for the light.
      const sx =
          (groundAt({ x: p.x + dx, z: p.z }) - groundAt({ x: p.x - dx, z: p.z })) / 2,
        sz = (groundAt({ x: p.x, z: p.z + dz }) - groundAt({ x: p.x, z: p.z - dz })) / 2;
      const n = new THREE.Vector3(-sx / dx, 1, -sz / dz).normalize();
      const tone = 0.6 * noise(p.x / 140, p.z / 140) + 0.4 * noise(p.x / 37, p.z / 37);
      shade.copy(PALETTE.ground).offsetHSL(0.012 * tone, 0.04 * tone, 0.035 * tone);
      ids.push(soup.vertex(p.x, groundAt(p), p.z, n.x, n.y, n.z, shade));
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      soup.quad(ids[a]!, ids[a + N + 1]!, ids[a + N + 2]!, ids[a + 1]!);
    }
  // The cut sides, where the model of the city ends.
  const side = (from: (k: number) => Point, nx: number, nz: number) => {
    let last: [number, number] | null = null;
    for (let k = 0; k <= N; k++) {
      const p = from(k);
      const row: [number, number] = [
        soup.vertex(p.x, groundAt(p), p.z, nx, 0, nz, PALETTE.slab),
        soup.vertex(p.x, TABLE_Y, p.z, nx, 0, nz, PALETTE.slab),
      ];
      if (last) soup.quad(last[0], last[1], row[1], row[0]);
      last = row;
    }
  };
  side((k) => at(k, 0), 0, -1);
  side((k) => at(k, N), 0, 1);
  side((k) => at(0, k), -1, 0);
  side((k) => at(N, k), 1, 0);
  return soup.geometry(false);
}

/** A workbench top: planks with a drawn grain, seams between them. */
function benchTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const random = mulberry32(0xbe7c4);
  const planks = 4,
    w = size / planks;
  for (let k = 0; k < planks; k++) {
    const tone = 0.86 + random() * 0.2;
    g.fillStyle = `rgb(${Math.round(150 * tone)},${Math.round(112 * tone)},${Math.round(74 * tone)})`;
    g.fillRect(k * w, 0, w, size);
    // Grain: long, slightly wavy lines, darker and lighter.
    for (let line = 0; line < 46; line++) {
      const x0 = k * w + random() * w,
        wave = (random() - 0.5) * w * 0.12,
        phase = random() * 6.28;
      g.strokeStyle =
        random() < 0.5
          ? `rgba(70,44,22,${0.05 + random() * 0.1})`
          : `rgba(230,196,150,${0.04 + random() * 0.07})`;
      g.lineWidth = 0.6 + random() * 1.6;
      g.beginPath();
      for (let y = 0; y <= size; y += size / 32) {
        const x = Math.min(
          (k + 1) * w - 1,
          Math.max(k * w + 1, x0 + Math.sin(phase + (y / size) * Math.PI * 2) * wave),
        );
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(40,24,12,0.55)";
    g.fillRect(k * w, 0, Math.max(1.5, size / 400), size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export interface CityModel {
  /** The clay model, scaled to the table: add it to the scene as it is. */
  group: THREE.Group;
  dispose(): void;
}

export function buildCity(lib: ClayLibrary, textureSize: number): CityModel {
  const clay = lib.get("city-clay", {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.66,
    scale: CLAY_TILE,
    relief: 0.016,
    smudge: 0.16,
    wrap: 0.34,
  });
  const facade = lib.get("city-facade", {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.6,
    scale: CLAY_TILE,
    relief: 0.016,
    smudge: 0.14,
    wrap: 0.32,
    patch: FACADE_PATCH,
  });
  const group = new THREE.Group();
  group.name = "city model";
  const disposables: { dispose(): void }[] = [];
  const mesh = (
    g: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
    cast: boolean,
  ) => {
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    disposables.push(g);
    return m;
  };

  mesh(slab(), clay, "slab", false);

  const flat = new Tiles();
  for (const p of parks) patch(flat, p.ring, 0.08, PALETTE.park);
  for (const w of roadWays)
    strip(flat, w.points, w.width + 3.2, 0.12, PALETTE.pavement, 8);
  for (const w of pathWays)
    if (!w.crossing) strip(flat, w.points, w.width, 0.18, PALETTE.path, 6);
  for (const w of roadWays) strip(flat, w.points, w.width, 0.26, PALETTE.asphalt, 10);
  for (const w of pathWays)
    if (w.crossing) strip(flat, w.points, w.width, 0.34, PALETTE.crossing, 0);
  // A centre line where two directions share one carriageway.
  for (const w of roadWays)
    if (!w.oneWay && w.width >= 7 && w.highway !== "service")
      dashes(flat, w.points, 0.31, PALETTE.crossing);
  flat.each((s) => mesh(s.geometry(false), clay, "streets", false));

  const blocks = new Tiles();
  for (const b of buildings) building(blocks, b);
  blocks.each((s) => mesh(s.geometry(true), facade, "buildings", true));

  const green = new Tiles();
  trees(green, textureSize >= 1024 ? 2 : 1);
  green.each((s) => mesh(s.geometry(false), clay, "trees", true));

  // The workbench the model stands on: not part of the city, so not scaled with it.
  const wood = benchTexture(Math.min(1024, textureSize));
  // Four planks to a tile: 125 mm boards, three metres long.
  wood.repeat.set(240, 40);
  const bench = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
    lib.keep(withCascade(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.58 }))),
  );
  bench.name = "workbench";
  bench.position.y = TABLE_Y * MODEL_SCALE;
  bench.receiveShadow = true;
  disposables.push(bench.geometry, wood);

  group.scale.setScalar(MODEL_SCALE);
  const root = new THREE.Group();
  root.name = "set";
  root.add(group, bench);
  return {
    group: root,
    dispose() {
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}
