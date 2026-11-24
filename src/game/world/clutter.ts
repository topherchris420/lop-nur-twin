import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { applyPreset, type HardSurfacePreset } from "@/gfx/greeble";
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

/**
 * A box with its edges chamfered. A real edge is never knife-sharp, and the
 * narrow bevel is what catches a highlight line and separates a face from
 * its neighbour; a 90 degree box edge renders as two flat colours meeting.
 */
function rbox(
  w: number,
  h: number,
  d: number,
  r: number,
  x: number,
  y: number,
  z: number,
  color: number,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  // A chamfer costs some seventy triangles; it only pays where there is a
  // face for its highlight to separate, and only on the top tier.
  const geometry =
    chamfers && Math.min(w, h, d) >= 0.1
      ? new RoundedBoxGeometry(
          w,
          h,
          d,
          1,
          Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)),
        )
      : new THREE.BoxGeometry(w, h, d);
  if (rz) geometry.rotateZ(rz);
  if (ry) geometry.rotateY(ry);
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

/** Set per build: chamfered edges on the top tier only. */
let chamfers = true;

/** A lathed solid from a (radius, height) profile, bottom to top. */
function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  color: number,
  shape?: (p: THREE.BufferAttribute) => void,
): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  if (shape) {
    shape(geometry.getAttribute("position") as THREE.BufferAttribute);
    geometry.computeVertexNormals();
  }
  return paint(geometry, color);
}

/** Recolour a painted part vertex by vertex, in its own coordinates. */
function shade(
  geometry: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, color: THREE.Color) => void,
): THREE.BufferGeometry {
  const position = geometry.attributes["position"]!;
  const color = geometry.attributes["color"]!;
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    c.setRGB(color.getX(i), color.getY(i), color.getZ(i));
    fn(position.getX(i), position.getY(i), position.getZ(i), c);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  return geometry;
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
    // The last few centimetres sit in the ground's own occlusion.
    const contact = 1 - Math.max(0, 1 - y / 0.06) * 0.35;
    const r = color.getX(i) * tone;
    const g = color.getY(i) * tone;
    const b = color.getZ(i) * tone;
    color.setXYZ(
      i,
      (r + (dust.r - r) * grime) * contact,
      (g + (dust.g - g) * grime) * contact,
      (b + (dust.b - b) * grime) * contact,
    );
  }
  color.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

const CONCRETE = 0x9c9488;

const RUST = 0x7a4a2c;
const SAND_BAG = 0x8a7f62;
const STEEL = 0x8b8f92;
const STEEL_DARK = 0x5c6064;
const WOOD = 0x9a7c52;
const RUBBER = 0x2e2e30;
/** Parts tinted per instance from a palette are painted near-white. */
const PAINT = 0xe0ded8;

/**
 * A New Jersey barrier, extruded from its real profile: 75 mm toe, 55 degree
 * lower face, 84 degree upper face, with the arrises cast chamfered, two
 * rebar lifting loops, drainage slots through the toe and pin lugs at the ends.
 */
function jerseyBarrier(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [-0.285, 0],
    [0.285, 0],
    [0.285, 0.055],
    [0.268, 0.077],
    [0.112, 0.322],
    [0.072, 0.768],
    [0.05, 0.79],
    [-0.05, 0.79],
    [-0.072, 0.768],
    [-0.112, 0.322],
    [-0.268, 0.077],
    [-0.285, 0.055],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(profile[0]![0], profile[0]![1]);
  for (const [x, y] of profile.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: 1.95,
    bevelEnabled: hi,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  body.translate(0, 0, -0.975);
  const parts = [paint(body, CONCRETE)];
  for (const z of [-0.55, 0.55]) {
    const loop = new THREE.TorusGeometry(0.06, 0.01, hi ? 5 : 3, hi ? 10 : 5, Math.PI);
    loop.rotateY(Math.PI / 2);
    loop.translate(0, 0.79, z);
    parts.push(paint(loop, RUST));
  }
  // drainage slots: dark through the toe on both faces
  for (const z of [-0.5, 0.5]) parts.push(box(0.618, 0.07, 0.3, 0, 0.035, z, 0x2b2824));
  if (hi) {
    // steel pin lugs cast into each end, and a rust stain run from each
    for (const z of [-1.0, 1.0]) {
      parts.push(rbox(0.05, 0.16, 0.06, 0.012, 0, 0.58, z, STEEL_DARK));
      parts.push(rbox(0.05, 0.16, 0.06, 0.012, 0, 0.2, z, STEEL_DARK));
    }
  }
  return mergeParts(parts);
}

/** A gabion bastion: welded mesh cage, geotextile liner, earth fill. */
function hescoBastion(rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const s = 1.12;
  const h = 1.06;
  // The liner bellies out between the wires under the weight of the fill.
  const ls = hi ? 3 : 1;
  const liner = new THREE.BoxGeometry(s * 0.96, h * 0.97, s * 0.96, ls, ls, ls);
  liner.deleteAttribute("normal");
  liner.deleteAttribute("uv");
  const welded = mergeVertices(liner);
  liner.dispose();
  const lp = welded.getAttribute("position");
  for (let i = 0; i < lp.count; i += 1) {
    const x = lp.getX(i) / (s * 0.48);
    const y = lp.getY(i) / (h * 0.485);
    const z = lp.getZ(i) / (s * 0.48);
    const belly = (1 - y * y) * 0.035;
    lp.setXYZ(
      i,
      lp.getX(i) * (1 + belly * (1 - z * z)),
      lp.getY(i) + h * 0.485,
      lp.getZ(i) * (1 + belly * (1 - x * x)),
    );
  }
  welded.computeVertexNormals();
  parts.push(paint(welded, 0xa89a78));
  // corner coil joints
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(cyl(0.016, 0.016, h, 5, (sx * s) / 2, h / 2, (sz * s) / 2, STEEL_DARK));
    }
  }
  // welded mesh: verticals and horizontals on every face
  const n = hi ? 5 : 1;
  const wire = 0x7d8285;
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n - 0.5) * s;
    const y = 0.05 + (i / n) * (h - 0.1);
    for (const side of [-1, 1]) {
      const o = (side * s) / 2 + side * 0.012;
      parts.push(box(0.009, h, 0.009, t, h / 2, o, wire));
      parts.push(box(0.009, h, 0.009, o, h / 2, t, wire));
      parts.push(box(s, 0.009, 0.009, 0, y, o, wire));
      parts.push(box(0.009, 0.009, s, o, y, 0, wire));
    }
  }
  // earth fill heaped above the rim, with stones in it
  parts.push(blob(s * 0.47, 0, h - 0.02, 0, 0x8a7a58, 1, 0.22, 1));
  for (let i = 0; i < (hi ? 7 : 3); i += 1) {
    const r = 0.05 + rand() * 0.08;
    parts.push(
      rbox(
        r * 2,
        r * 1.2,
        r * 1.6,
        r * 0.3,
        (rand() - 0.5) * s * 0.75,
        h + r * 0.35,
        (rand() - 0.5) * s * 0.75,
        0x786a4c,
        rand() * 3,
      ),
    );
  }
  return mergeParts(parts);
}

/**
 * One filled sack: a rounded box that has slumped under its own weight, flat
 * where it beds, crowned on top, its tied end gathered into an ear, a seam
 * down each side and a few lumps where the fill is uneven.
 */
function sandbag(
  rand: Rand,
  hi: boolean,
  len: number,
  wid: number,
  hgt: number,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1, hi ? 4 : 3, hi ? 2 : 1, hi ? 2 : 1);
  box.deleteAttribute("normal");
  box.deleteAttribute("uv");
  const g = mergeVertices(box);
  box.dispose();
  const p = g.getAttribute("position");
  const tie = rand() > 0.5 ? 1 : -1;
  const lump = seededNoise2D(Math.floor(rand() * 0x7fffffff));
  const sag = 0.78 + rand() * 0.3;
  for (let i = 0; i < p.count; i += 1) {
    const nx = p.getX(i) * 2;
    const ny = p.getY(i) * 2;
    const nz = p.getZ(i) * 2;
    let x = nx * len * 0.5 * (1 - 0.08 * ny * ny);
    let y = ny * hgt * 0.5 * (1 - 0.55 * nx ** 4) * (1 - 0.45 * nz ** 4);
    let z = nz * wid * 0.5 * (1 - 0.2 * ny * ny) * (1 - 0.22 * nx ** 4);
    y *= ny < 0 ? 0.62 : sag;
    const e = tie * nx;
    if (e > 0.62) {
      const t = (e - 0.62) / 0.38;
      y *= 1 - 0.5 * t;
      z *= 1 - 0.62 * t;
      x += tie * 0.035 * t;
    }
    const n = lump(nx * 1.7 + nz * 0.6, ny * 1.3 + nz * 1.1);
    y += n * 0.014 * (ny > 0 ? 1 : 0.3);
    z += n * 0.009 * nz;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const bag = paint(g, SAND_BAG);
  const batch = 0.86 + rand() * 0.24;
  return shade(bag, (x, y, z, c) => {
    c.multiplyScalar(batch);
    // the side seam and the tie cord
    if (Math.abs(y) < hgt * 0.12 && Math.abs(z) > wid * 0.38) c.multiplyScalar(0.8);
    if (tie * x > len * 0.44) c.setHex(0x6b5f45);
  });
}

/**
 * A sandbag wall: four courses in running bond, two bags deep, stretcher and
 * header courses alternating, every bag its own size and slump, the bottom
 * course bedded into the ground.
 */
function sandbagStack(rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const length = 1.6;
  const L = 0.56;
  const W = 0.3;
  let y = -0.03;
  for (let course = 0; course < 4; course += 1) {
    const h = 0.15 * (0.92 + rand() * 0.14);
    const lay = (x: number, z: number, yaw: number): void => {
      const bag = sandbag(
        rand,
        hi,
        L * (0.94 + rand() * 0.1),
        W * (0.94 + rand() * 0.1),
        h * (0.9 + rand() * 0.2),
      );
      bag.rotateY(yaw + (rand() - 0.5) * 0.14);
      bag.translate(x + (rand() - 0.5) * 0.035, y + h * 0.31, z + (rand() - 0.5) * 0.03);
      parts.push(bag);
    };
    if (course % 2 === 0) {
      // stretchers: two rows along the wall, offset half a bag every other one
      const offset = course % 4 === 0 ? 0 : L / 2;
      for (const z of [-W / 2 - 0.005, W / 2 + 0.005]) {
        for (let x = -length / 2 + L / 2 - offset; x < length / 2; x += L) {
          if (Math.abs(x) > length / 2 - 0.12) continue;
          lay(x, z, 0);
        }
      }
    } else {
      // headers: one bag across the full depth
      for (let x = -length / 2 + W / 2; x < length / 2 - 0.05; x += W + 0.01) {
        lay(x, 0, Math.PI / 2);
      }
    }
    y += h * 0.8;
  }
  return mergeParts(parts);
}

/**
 * A military packing crate: planked faces with gaps, a nailed frame and a
 * diagonal brace on each long side, steel corner caps, rope handles and a
 * stencilled label panel.
 */
function crate(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 1.18;
  const h = 0.92;
  const d = 0.84;
  const t = 0.02;
  const frame = 0xc8c2b4;
  if (!hi) {
    parts.push(box(w, h, d, 0, h / 2, 0, PAINT));
    for (const sz of [-1, 1]) {
      parts.push(box(w + 0.03, 0.08, 0.04, 0, h - 0.06, (sz * d) / 2, frame));
      parts.push(box(w + 0.03, 0.08, 0.04, 0, 0.06, (sz * d) / 2, frame));
    }
    return mergeParts(parts);
  }
  // a dark carcass behind the planks, so the gaps read as gaps
  parts.push(box(w - 0.02, h - 0.02, d - 0.02, 0, h / 2, 0, 0x2c2620));
  const planks = 4;
  const gap = 0.008;
  const ph = (h - gap * (planks - 1)) / planks;
  for (let i = 0; i < planks; i += 1) {
    const y = ph / 2 + i * (ph + gap);
    const tone = PAINT - (i % 2) * 0x080808;
    for (const sz of [-1, 1]) parts.push(box(w, ph, t, 0, y, (sz * (d - t)) / 2, tone));
    for (const sx of [-1, 1])
      parts.push(box(t, ph, d - 2 * t, (sx * (w - t)) / 2, y, 0, tone));
  }
  const lid = 5;
  const lw = (d - gap * (lid - 1)) / lid;
  for (let i = 0; i < lid; i += 1) {
    const z = -d / 2 + lw / 2 + i * (lw + gap);
    parts.push(box(w, t, lw, 0, h - t / 2, z, PAINT - (i % 2) * 0x060606));
  }
  // frame battens proud of the planks, and the brace across each long side
  const fb = 0.075;
  for (const sz of [-1, 1]) {
    const z = (sz * d) / 2 + (sz * t) / 2;
    parts.push(rbox(w, fb, t, 0.005, 0, h - fb / 2, z, frame));
    parts.push(rbox(w, fb, t, 0.005, 0, fb / 2, z, frame));
    parts.push(rbox(fb, h - 2 * fb, t, 0.005, w / 2 - fb / 2, h / 2, z, frame));
    parts.push(rbox(fb, h - 2 * fb, t, 0.005, -w / 2 + fb / 2, h / 2, z, frame));
    const run = Math.hypot(w - 2 * fb, h - 2 * fb);
    parts.push(
      rbox(
        run * 0.97,
        fb * 0.9,
        t,
        0.005,
        0,
        h / 2,
        z,
        frame,
        0,
        sz * Math.atan2(h - 2 * fb, w - 2 * fb),
      ),
    );
  }
  for (const sx of [-1, 1]) {
    const x = (sx * w) / 2 + (sx * t) / 2;
    parts.push(box(t, fb, d, x, h - fb / 2, 0, frame));
    parts.push(box(t, fb, d, x, fb / 2, 0, frame));
    // rope handle through two cleats
    parts.push(box(t * 1.6, 0.06, 0.08, x + sx * 0.012, h * 0.62, -0.2, frame));
    parts.push(box(t * 1.6, 0.06, 0.08, x + sx * 0.012, h * 0.62, 0.2, frame));
    const rope = new THREE.TorusGeometry(0.2, 0.012, 4, 8, Math.PI);
    rope.rotateZ(Math.PI);
    rope.rotateY(Math.PI / 2);
    rope.translate(x + sx * 0.03, h * 0.62, 0);
    parts.push(paint(rope, 0x8f7e5c));
  }
  // steel corner caps
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0.045, h - 0.045]) {
        parts.push(
          rbox(
            0.1,
            0.1,
            0.1,
            0.008,
            sx * (w / 2 - 0.035),
            y,
            sz * (d / 2 - 0.035),
            0x4a4d4f,
          ),
        );
      }
    }
  }
  // stencilled label panel and lettering on one long side
  const z = d / 2 + t + 0.003;
  parts.push(box(0.42, 0.2, 0.004, 0, h * 0.55, z, 0xd8d0b8));
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      box(
        0.34 - i * 0.07,
        0.025,
        0.003,
        -i * 0.035,
        h * 0.55 + 0.06 - i * 0.05,
        z + 0.003,
        0x262421,
      ),
    );
  }
  return mergeParts(parts);
}

/**
 * A 200-litre steel drum, lathed from its real section: rolled chimes top
 * and bottom, two rolling hoops, the lid set down inside the chime, two
 * bungs, and a dent or two.
 */
function drum(rand: Rand, hi: boolean): THREE.BufferGeometry {
  const profile: readonly (readonly [number, number])[] = hi
    ? [
        [0, 0.014],
        [0.262, 0.014],
        [0.27, 0.004],
        [0.288, 0],
        [0.293, 0.012],
        [0.288, 0.026],
        [0.283, 0.034],
        [0.283, 0.272],
        [0.291, 0.286],
        [0.291, 0.3],
        [0.283, 0.314],
        [0.283, 0.566],
        [0.291, 0.58],
        [0.291, 0.594],
        [0.283, 0.608],
        [0.283, 0.846],
        [0.288, 0.854],
        [0.293, 0.868],
        [0.288, 0.88],
        [0.27, 0.876],
        [0.262, 0.864],
        [0, 0.864],
      ]
    : [
        [0, 0.01],
        [0.288, 0],
        [0.29, 0.02],
        [0.284, 0.03],
        [0.284, 0.29],
        [0.292, 0.3],
        [0.284, 0.31],
        [0.284, 0.58],
        [0.292, 0.59],
        [0.284, 0.6],
        [0.284, 0.85],
        [0.29, 0.875],
        [0, 0.865],
      ];
  const dents = Array.from({ length: hi ? 2 : 0 }, () => ({
    a: rand() * Math.PI * 2,
    y: 0.1 + rand() * 0.65,
    r: 0.07 + rand() * 0.08,
    depth: 0.008 + rand() * 0.016,
  }));
  const body = lathe(profile, hi ? 18 : 12, PAINT, (p) => {
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 0.2) continue;
      let push = 0;
      for (const dent of dents) {
        let da = Math.atan2(z, x) - dent.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const dist = Math.hypot(da * 0.285, y - dent.y) / dent.r;
        if (dist < 1) push += dent.depth * (1 - dist * dist) ** 2;
      }
      if (push > 0) p.setXYZ(i, (x * (r - push)) / r, y, (z * (r - push)) / r);
    }
  });
  const parts = [body];
  if (hi) {
    parts.push(cyl(0.034, 0.034, 0.016, 10, 0.18, 0.868, 0.06, STEEL_DARK));
    parts.push(cyl(0.02, 0.02, 0.014, 8, -0.18, 0.868, -0.04, STEEL_DARK));
  }
  return mergeParts(parts);
}

/** Pipe stacked on timber skids, the bores open and dark. */
function pipeStack(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const len = 2.6;
  const r = 0.155;
  for (const z of [-0.9, 0.9]) {
    parts.push(rbox(0.9, 0.12, 0.14, 0.012, 0, 0.06, z, WOOD));
    if (hi) {
      // chocks nailed to the skid stop the bottom row rolling
      for (const sx of [-1, 1])
        parts.push(box(0.08, 0.08, 0.12, sx * 0.42, 0.16, z, WOOD));
    }
  }
  const rowY = [0.12 + r, 0.12 + r * 2.7];
  for (let row = 0; row < 2; row += 1) {
    const n = row === 0 ? 3 : 2;
    for (let i = 0; i < n; i += 1) {
      const x = (i - (n - 1) / 2) * (r * 2.05);
      parts.push(
        cyl(r, r, len, hi ? 12 : 10, x, rowY[row]!, 0, STEEL, Math.PI / 2, 0, 0),
      );
      for (const end of hi ? [-1, 1] : []) {
        parts.push(
          cyl(
            r * 0.86,
            r * 0.86,
            0.01,
            12,
            x,
            rowY[row]!,
            end * (len / 2 + 0.003),
            0x1c1a18,
            Math.PI / 2,
            0,
            0,
          ),
        );
      }
    }
  }
  return mergeParts(parts);
}

/** A wooden cable reel stood on its rims. */
function cableReel(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = 0.68;
  for (const x of [-0.31, 0.31]) {
    parts.push(cyl(R, R, 0.07, hi ? 24 : 14, x, R, 0, WOOD, 0, 0, Math.PI / 2));
    if (hi) {
      // the bolted battens that hold each flange's boards together
      for (const a of [0, Math.PI / 2]) {
        const batten = rbox(0.03, R * 1.7, 0.08, 0.008, 0, 0, 0, 0x7a6040);
        batten.rotateX(a);
        batten.translate(x + Math.sign(x) * 0.045, R, 0);
        parts.push(batten);
      }
      parts.push(
        cyl(
          0.09,
          0.09,
          0.02,
          10,
          x + Math.sign(x) * 0.045,
          R,
          0,
          STEEL_DARK,
          0,
          0,
          Math.PI / 2,
        ),
      );
    }
  }
  parts.push(cyl(0.3, 0.3, 0.56, 12, 0, R, 0, 0x4a4238, 0, 0, Math.PI / 2));
  // A few turns of cable still on the drum.
  for (let i = 0; i < 4; i += 1) {
    parts.push(
      cyl(
        0.36 + i * 0.012,
        0.36 + i * 0.012,
        0.5 - i * 0.08,
        hi ? 18 : 12,
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

/** A skid-mounted generator set: canopy, doors, louvres, panel and stack. */
function genset(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const w = 1.86;
  const h = 1.0;
  const d = 0.96;
  parts.push(rbox(w, 0.14, d, 0.015, 0, 0.07, 0, STEEL_DARK));
  parts.push(rbox(w * 0.96, h - 0.2, d * 0.94, 0.03, 0, 0.14 + (h - 0.2) / 2, 0, PAINT));
  // Louvred end and an exhaust stack.
  parts.push(box(0.05, h * 0.5, d * 0.7, w / 2 - 0.01, h * 0.5, 0, 0x3d443a));
  for (let i = 0; i < 5; i += 1) {
    parts.push(
      box(0.07, 0.035, d * 0.66, w / 2 - 0.02, h * 0.32 + i * 0.09, 0, 0x2c322a),
    );
  }
  parts.push(cyl(0.075, 0.075, 0.42, 8, -w * 0.3, h + 0.12, d * 0.28, STEEL_DARK));
  parts.push(box(w * 0.4, 0.06, 0.06, w * 0.18, h - 0.04, 0, STEEL_DARK));
  if (hi) {
    // forklift pockets through the skid
    for (const sx of [-0.45, 0.45]) {
      for (const sz of [-1, 1])
        parts.push(box(0.22, 0.08, 0.01, sx, 0.07, sz * (d / 2 + 0.002), 0x1e201e));
    }
    // canopy doors: shut lines, hinges, latches on both long sides
    for (const sz of [-1, 1]) {
      const z = sz * (d * 0.47 + 0.003);
      for (const x of [-0.62, 0, 0.62]) {
        parts.push(
          box(0.012, h - 0.34, 0.004, x - 0.3, 0.14 + (h - 0.2) / 2, z, 0x262a24),
        );
        parts.push(box(0.04, 0.025, 0.012, x + 0.2, 0.62, z + sz * 0.006, 0x2f3330));
      }
    }
    // control panel window, warning label, lifting eyes, rain cap, fuel filler
    parts.push(box(0.28, 0.2, 0.01, -0.62, 0.66, d * 0.47 + 0.008, 0x1d2426));
    parts.push(box(0.12, 0.08, 0.004, 0.22, 0.75, d * 0.47 + 0.006, 0xc9a43a));
    for (const x of [-0.6, 0.6]) {
      const eye = new THREE.TorusGeometry(0.04, 0.01, 4, 8, Math.PI);
      eye.translate(x, h - 0.06, 0);
      parts.push(paint(eye, STEEL_DARK));
    }
    parts.push(cyl(0.1, 0.075, 0.03, 8, -w * 0.3, h + 0.345, d * 0.28, STEEL_DARK));
    parts.push(
      cyl(
        0.035,
        0.035,
        0.05,
        8,
        w * 0.32,
        h - 0.17,
        -d * 0.47,
        0x2f3330,
        Math.PI / 2,
        0,
        0,
      ),
    );
  }
  return mergeParts(parts);
}

/** A stack of three pallets. */
function palletStack(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Stringers run the long way; deck boards cross them top and bottom, so
  // the stack reads as stacked pallets with daylight between, not as slabs.
  const bottom = hi ? 0.018 : 0;
  const pitch = 0.108 + bottom;
  for (let s = 0; s < 3; s += 1) {
    const y = s * pitch;
    if (hi) {
      for (const x of [-0.5, 0, 0.5])
        parts.push(box(0.13, bottom, 0.8, x, y + bottom / 2, 0, 0x9b8058));
    }
    for (const z of [-0.34, 0, 0.34]) {
      parts.push(box(1.16, 0.075, 0.1, 0, y + bottom + 0.0375, z, WOOD));
    }
    const boards = hi ? 7 : 5;
    for (let i = 0; i < boards; i += 1) {
      const x = (i / (boards - 1) - 0.5) * 1.03;
      parts.push(
        box(
          1.03 / boards - 0.012,
          0.022,
          0.8,
          x,
          y + bottom + 0.086,
          0,
          i % 3 === 1 ? 0x8d7552 : 0xa88a5c,
        ),
      );
    }
  }
  return mergeParts(parts);
}

/** A traffic cone: rubber base, ribbed shell, two retroreflective collars. */
function cone(_rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seg = hi ? 16 : 8;
  parts.push(rbox(0.36, 0.035, 0.36, 0.03, 0, 0.0175, 0, 0x1f1f20));
  const top = 0.66;
  const r0 = 0.15;
  const r1 = 0.026;
  const radius = (y: number) => r0 + ((r1 - r0) * (y - 0.035)) / (top - 0.035);
  parts.push(cyl(r1, r0, top - 0.035, seg, 0, (top + 0.035) / 2, 0, 0xd2501c));
  // the collars sit a hair proud of the shell
  for (const [y0, y1] of [
    [0.4, 0.49],
    [0.25, 0.3],
  ] as const) {
    parts.push(
      cyl(
        radius(y1) + 0.003,
        radius(y0) + 0.003,
        y1 - y0,
        seg,
        0,
        (y0 + y1) / 2,
        0,
        0xe6e4dc,
      ),
    );
  }
  parts.push(cyl(r1 + 0.004, r1 + 0.006, 0.02, seg, 0, top - 0.01, 0, 0xc04818));
  return mergeParts(parts);
}

/** Broken concrete and spoil, with rebar sticking out of it. */
function rubble(rand: Rand, hi: boolean): THREE.BufferGeometry {
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
  if (hi) {
    for (let i = 0; i < 2; i += 1) {
      parts.push(
        cyl(
          0.007,
          0.007,
          0.45,
          4,
          (rand() - 0.5) * 0.4,
          0.15,
          (rand() - 0.5) * 0.4,
          RUST,
          rand() - 0.5,
          rand() * 3,
          0.9 + rand() * 0.5,
        ),
      );
    }
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
  const position = geometry.getAttribute("position");
  const weathering = seededNoise2D(Math.floor(rand() * 0x100000000));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    // Non-indexed triangles duplicate each corner. Shape a point from its
    // coordinates so adjacent facets meet instead of pulling apart.
    const wear = 0.93 + 0.18 * weathering(7 * x + 2 * y, 9 * z - y);
    position.setXYZ(i, x * wear * 1.2, (y + 0.1) * wear * 0.56, z * wear * 0.84);
  }
  geometry.computeVertexNormals();
  // Keep the instanced stone at twenty triangles. Blend facet and ellipsoid
  // normals to round its weathered edges without multiplying the desert's vertices.
  const normal = geometry.getAttribute("normal");
  const rounded = new THREE.Vector3(),
    facet = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    rounded
      .set(
        position.getX(i) / (1.2 * 1.2),
        (position.getY(i) - 0.056) / (0.56 * 0.56),
        position.getZ(i) / (0.84 * 0.84),
      )
      .normalize();
    facet.fromBufferAttribute(normal, i).lerp(rounded, 0.62).normalize();
    normal.setXYZ(i, facet.x, facet.y, facet.z);
  }
  return paint(geometry, 0x807966);
}

/** A stack of scrap tyres, lathed from a real section. */
function tyreStack(rand: Rand, hi: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const section: readonly (readonly [number, number])[] = hi
    ? [
        [0.2, 0.02],
        [0.215, 0.002],
        [0.3, 0],
        [0.33, 0.012],
        [0.348, 0.04],
        [0.352, 0.085],
        [0.348, 0.13],
        [0.33, 0.158],
        [0.3, 0.17],
        [0.215, 0.168],
        [0.2, 0.15],
        [0.2, 0.02],
      ]
    : [
        [0.2, 0],
        [0.34, 0],
        [0.35, 0.085],
        [0.34, 0.17],
        [0.2, 0.17],
        [0.2, 0],
      ];
  for (let i = 0; i < 3; i += 1) {
    const tyre = lathe(section, hi ? 14 : 10, RUBBER, (p) => {
      // tread blocks: the shoulder steps in and out around the crown
      if (!hi) return;
      for (let k = 0; k < p.count; k += 1) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const r = Math.hypot(x, z);
        if (r < 0.345) continue;
        const a = Math.atan2(z, x);
        const s = Math.sign(Math.sin(a * 7 + 0.2)) * 0.006;
        p.setXYZ(k, (x * (r + s)) / r, p.getY(k), (z * (r + s)) / r);
      }
    });
    tyre.translate((rand() - 0.5) * 0.06, i * 0.165, (rand() - 0.5) * 0.06);
    parts.push(tyre);
  }
  return mergeParts(parts);
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                          */
/* ------------------------------------------------------------------ */

type MaterialKind = "hard" | "soft" | "organic";

interface PropDef {
  readonly id: string;
  /** `hi` is the top quality tier: full detail; below it, the old weight. */
  readonly build: (rand: Rand, hi: boolean) => THREE.BufferGeometry;
  /** Procedural surface (`@/gfx/greeble`), or none. */
  readonly finish: HardSurfacePreset | null;
  /** Paint batches an instance is tinted from; neutral tint when absent. */
  readonly palette?: readonly number[];
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
    finish: "cast",
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
    finish: "propFabric",
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
    finish: "propFabric",
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
    finish: "propWood",
    palette: [0x9a7c52, 0x8a7350, 0x5f6347, 0x565b43, 0x8b8578],
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
    finish: "propPaint",
    palette: [0x39546b, 0x5f6347, 0x7a3f2c, 0x2f3133, 0x6b6f4e, 0x8a8778],
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
    finish: "propPaint",
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
    finish: "propWood",
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
    finish: "propPaint",
    palette: [0x6f7a63, 0x9c937a, 0x5c6450],
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
    finish: "propWood",
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
    finish: "propRubber",
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
    finish: "propRubber",
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
    finish: "cast",
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
    finish: null,
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
    finish: "cast",
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
  /** Full prop detail (top tier). Lower tiers keep the lighter builds. */
  detailed?: boolean;
}

/** Base roughness and metalness for each finish; paint is a dielectric. */
const FINISH_PBR: Record<HardSurfacePreset, readonly [number, number]> = {
  concrete: [0.92, 0],
  cladding: [0.6, 0.2],
  machined: [0.45, 0.6],
  airframe: [0.5, 0.3],
  plated: [0.55, 0.1],
  profiled: [0.6, 0.15],
  roofSeam: [0.6, 0.15],
  cast: [0.9, 0],
  propPaint: [0.55, 0.08],
  propWood: [0.84, 0],
  propFabric: [0.95, 0],
  propRubber: [0.82, 0],
};

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
  const detailed = options.detailed ?? true;
  chamfers = detailed;
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
  const meshes: THREE.InstancedMesh[] = [];
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

    const geometry = def.build(rand, detailed);
    weather(geometry, dust, def.height);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometries.push(geometry);

    const [roughness, metalness] = def.finish
      ? FINISH_PBR[def.finish]
      : [def.material === "soft" ? 0.95 : 0.88, 0];
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
      side: def.material === "organic" ? THREE.DoubleSide : THREE.FrontSide,
    });
    // The micro-surface is what makes a prop at arm's length read as cast,
    // sawn, woven or painted rather than as a flat-coloured primitive.
    if (def.finish && detailed) applyPreset(material, def.finish, { seed: p * 13 + 5 });
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
      if (def.palette) {
        // a stable pick per instance, so the palette does not consume the seed
        tintColor
          .setHex(def.palette[(i * 7919 + p * 31) % def.palette.length]!)
          .multiplyScalar(slot.tint / 0.76);
      } else tintColor.setScalar(slot.tint);
      mesh.setColorAt(i, tintColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = true;
    mesh.computeBoundingSphere();

    group.add(mesh);
    meshes.push(mesh);
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
      // InstancedMesh.dispose() is what releases the GPU buffers behind
      // instanceMatrix and instanceColor; disposing the geometry does not.
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
