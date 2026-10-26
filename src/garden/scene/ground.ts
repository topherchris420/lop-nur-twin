/**
 * The garden floor: one sculpted sheet of clay (lawn, gravel path, the bed
 * along the fence) and everything scattered on it by hand: tufts of grass
 * blades, pebbles, moss cushions, fallen maple leaves, a ring of mushrooms
 * and the maple's exposed roots. Heights come from `groundHeight`, the same
 * function the fly's landings use, so nothing floats or sinks.
 *
 * Variation is controlled, never repeated: every tuft, pebble and leaf has
 * its own seeded size, lean, turn and colour, and the scatter thins and
 * thickens the way a real lawn does (worn by the path, lush in the corners,
 * leaves drifting under the maple).
 */
import * as THREE from "three";
import {
  bedMask,
  ellipseRadius,
  groundHeight,
  LAYOUT,
  pathDistance,
  pathMask,
} from "../core/layout.js";
import type { Quality } from "../core/quality.js";
import { casterMaterial, type ClayLibrary, type WindSettings } from "./clay.js";
import {
  blob,
  clayColor,
  lathe,
  leafSheet,
  merge,
  noise3,
  rng,
  tint,
  tube,
  type Rand,
} from "./geometry.js";
import { inCell, type DecalAtlas } from "./textures.js";

const G = LAYOUT.ground;

/** Clear of every prop footprint: pot, saucer, pear, stones, maple trunk. */
function open(x: number, z: number, margin = 0): boolean {
  const pot = LAYOUT.pot,
    sc = LAYOUT.saucer,
    pear = LAYOUT.pear,
    tr = LAYOUT.maple.trunk;
  if (Math.hypot(x - pot.x, z - pot.z) < pot.rimRadius + margin) return false;
  if (Math.hypot(x - sc.x, z - sc.z) < sc.radius + margin) return false;
  if (Math.hypot(x - pear.x, z - pear.z) < 0.075 + margin) return false;
  if (Math.hypot(x - tr.x, z - tr.z) < tr.radius + 0.05 + margin) return false;
  for (const s of LAYOUT.stones)
    if (ellipseRadius(s, x, z) < 1.04 + margin * 6) return false;
  if (z < LAYOUT.fence.front + 0.03) return false;
  if (x > LAYOUT.wall.x0 && z < LAYOUT.wall.front + 0.03) return false;
  return true;
}

// ------------------------------------------------------------------ terrain

function terrain(lib: ClayLibrary, q: Quality): THREE.Mesh {
  const step = q.name === "performance" ? 0.03 : 0.018;
  const nx = Math.ceil((G.maxX - G.minX) / step),
    nz = Math.ceil((G.maxZ - G.minZ) / step);
  const g = new THREE.PlaneGeometry(G.maxX - G.minX, G.maxZ - G.minZ, nx, nz);
  g.rotateX(-Math.PI / 2);
  g.translate((G.maxX + G.minX) / 2, 0, (G.maxZ + G.minZ) / 2);
  g.deleteAttribute("uv");
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const n = noise3(0x7e11);
  const lawn = clayColor(0x56702e),
    lawnDry = clayColor(0x7b7a3c),
    soil = clayColor(0x4b3629),
    soilDark = clayColor(0x35261d),
    gravel = clayColor(0xa89c86),
    gravelWarm = clayColor(0x9a8a70);
  const c = new THREE.Color();
  tint(g, (p) => {
    const path = pathMask(p.x, p.z),
      bed = bedMask(p.x, p.z);
    const patch = 0.5 + 0.5 * n(p.x * 1.7, p.z * 1.7, 0);
    c.copy(lawn).lerp(lawnDry, patch * 0.7);
    // Worn, bare earth along the path's edges and where feet cut the corner.
    const wear = Math.max(
      0,
      1 - Math.abs(pathDistance(p.x, p.z) - LAYOUT.path.halfWidth) / 0.09,
    );
    c.lerp(soil, wear * 0.55);
    c.lerp(gravel.clone().lerp(gravelWarm, 0.5 + 0.5 * n(p.x * 6, p.z * 6, 3)), path);
    c.lerp(soilDark.clone().lerp(soil, 0.5 + 0.5 * n(p.x * 3, p.z * 3, 5)), bed);
    // Grime where things meet the ground: the fence foot, the wall, the props.
    const fenceFoot = Math.max(0, 1 - (p.z - LAYOUT.fence.front) / 0.12);
    const wallFoot =
      p.x > LAYOUT.wall.x0 ? Math.max(0, 1 - (p.z - LAYOUT.wall.front) / 0.1) : 0;
    c.multiplyScalar(1 - 0.35 * Math.max(fenceFoot, wallFoot));
    return c.clone();
  });
  const m = new THREE.Mesh(
    g,
    lib.get("ground", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.86,
      scale: 0.07,
      relief: 0.05,
      smudge: 0.12,
      wrap: 0.25,
    }),
  );
  m.name = "ground";
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------- grass

const BLADE: WindSettings = { axis: "y", length: 1, amount: 0.22 };

/** One blade of sculpted grass in unit height: tapered, keeled, leaning. */
function bladeGeometry(): THREE.BufferGeometry {
  const segs = 4;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  // A light gradient, not a colour: the tuft's instance colour gives the hue,
  // and this darkens the root (where the tuft shades itself) and bleaches the tip.
  const base = new THREE.Color(0.36, 0.38, 0.32),
    tip = new THREE.Color(1.0, 0.98, 0.84);
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const w = 0.075 * (1 - Math.pow(s, 1.6)) + 0.005;
    const lean = 0.18 * s * s;
    for (const side of [-1, 0, 1]) {
      // Three columns: the keel in the middle stands proud of the edges.
      positions.push(side * w, s, lean + (side === 0 ? 0.012 * (1 - s) : 0));
      const k = Math.pow(s, 1.3);
      colors.push(
        base.r + (tip.r - base.r) * k,
        base.g + (tip.g - base.g) * k,
        base.b + (tip.b - base.b) * k,
      );
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j,
        b = a + 1,
        c = a + 3,
        d = a + 4;
      index.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** How lush the lawn is at (x, z): thinner on the worn path edges and under the maple, thick toward the camera. */
function lushness(
  x: number,
  z: number,
  n: (x: number, y: number, z: number) => number,
): number {
  if (pathMask(x, z) > 0.05 || bedMask(x, z) > 0.3) return 0;
  const edge = Math.min(
    1,
    Math.max(0, (pathDistance(x, z) - LAYOUT.path.halfWidth - 0.04) / 0.12),
  );
  const front = 0.55 + 0.45 * Math.min(1, Math.max(0, (z + 0.8) / 2.6));
  const shade =
    Math.hypot(x - LAYOUT.maple.trunk.x, z - LAYOUT.maple.trunk.z) < 0.6 ? 0.45 : 1;
  const patch = 0.65 + 0.35 * n(x * 2.2, z * 2.2, 9);
  return edge * front * shade * patch;
}

function grass(lib: ClayLibrary, q: Quality): THREE.InstancedMesh {
  const r = rng(0x9a55);
  const n = noise3(0x9a56);
  const geo = bladeGeometry();
  const mat = lib.get("grass", {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.55,
    scale: 0.012,
    relief: 0.04,
    smudge: 0.1,
    wrap: 0.55,
    scatter: 0x5a7a1a,
    side: THREE.DoubleSide,
    wind: BLADE,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, q.grass);
  mesh.name = "grass";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = lib.keep(casterMaterial({ wind: BLADE }));
  const m = new THREE.Matrix4(),
    qt = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3();
  const greens = [0x6d8a35, 0x7f9a3e, 0x5f7d2f, 0x93954a, 0xa69a55, 0x768f3a].map((h) =>
    clayColor(h),
  );
  const col = new THREE.Color();
  let k = 0;
  let guard = 0;
  while (k < q.grass && guard++ < q.grass * 40) {
    const cx = G.minX + 0.05 + r() * (G.maxX - G.minX - 0.1);
    const cz = G.minZ + r() * (G.maxZ - G.minZ - 0.05);
    const lush = lushness(cx, cz, n);
    if (lush <= 0 || r() > lush || !open(cx, cz, 0.01)) continue;
    // A tuft: blades from one crown, splaying outward.
    const blades = 4 + Math.floor(r() * 7);
    const tuftHeight =
      0.035 + 0.05 * r() * lush + 0.02 * (0.5 + 0.5 * n(cx * 3, cz * 3, 1));
    const tuftColor = greens[Math.floor(r() * greens.length)]!;
    const dryness = 0.5 + 0.5 * n(cx * 0.9, cz * 0.9, 4);
    for (let b = 0; b < blades && k < q.grass; b++) {
      const a = r() * Math.PI * 2,
        d = r() * 0.012;
      const x = cx + Math.cos(a) * d,
        z = cz + Math.sin(a) * d;
      p.set(x, groundHeight(x, z) - 0.002, z);
      e.set(
        (r() - 0.5) * 0.5 + Math.cos(a) * 0.25,
        a + (r() - 0.5) * 1.2,
        (r() - 0.5) * 0.5 - Math.sin(a) * 0.25,
      );
      qt.setFromEuler(e);
      const h = tuftHeight * (0.6 + 0.6 * r());
      const w = h * (0.55 + 0.4 * r());
      s.set(w, h, w);
      m.compose(p, qt, s);
      mesh.setMatrixAt(k, m);
      col
        .copy(tuftColor)
        .offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.1, (r() - 0.5) * 0.06);
      col.lerp(clayColor(0xb09a5e), dryness * 0.35 * r());
      mesh.setColorAt(k, col);
      k++;
    }
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ----------------------------------------------------------------- scatter

interface Scatter {
  x: number;
  z: number;
}

/** Samples points with density `weight(x, z)` in [0, 1] over the ground. */
function sample(
  r: Rand,
  count: number,
  weight: (x: number, z: number) => number,
): Scatter[] {
  const out: Scatter[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 200) {
    const x = G.minX + r() * (G.maxX - G.minX),
      z = G.minZ + r() * (G.maxZ - G.minZ);
    if (r() < weight(x, z)) out.push({ x, z });
  }
  return out;
}

/** Gravel: three hand-rolled pebble shapes, each instanced at its own sizes and turns. */
function pebbles(lib: ClayLibrary, q: Quality): THREE.Group {
  const r = rng(0x9eb1);
  const count = Math.round(q.scatter * 1.4);
  const mat = lib.get("pebble", {
    color: 0xffffff,
    roughness: 0.7,
    scale: 0.01,
    relief: 0.06,
    smudge: 0.15,
  });
  const meshes = [0, 1, 2].map((i) => {
    const shape = blob(1, {
      detail: 1,
      seed: 40 + i,
      lumps: 0.2 + 0.05 * i,
      frequency: 1 + 0.25 * i,
      squash: [1, 0.5 + 0.08 * i, 0.75 + 0.1 * i],
      floor: -0.25,
    });
    const mesh = new THREE.InstancedMesh(shape, mat, Math.ceil(count / 3));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    return mesh;
  });
  const group = new THREE.Group();
  group.name = "pebbles";
  group.add(...meshes);
  const stones = [0, 1, 2, 3].map((i) => LAYOUT.stones[i]!);
  const pts = sample(r, count, (x, z) => {
    const path = pathMask(x, z);
    if (path < 0.3) return 0;
    let near = 0;
    for (const s of stones)
      near = Math.max(near, Math.max(0, 1 - Math.hypot(x - s.x, z - s.z) / 0.5));
    return path * (0.15 + 0.85 * near) * (z > 0 ? 1 : 0.5);
  });
  const palette = [0xb3a892, 0x9a907e, 0x8b8578, 0xc2b49a, 0x7d746a, 0xa89273].map((h) =>
    clayColor(h),
  );
  const m = new THREE.Matrix4(),
    qt = new THREE.Quaternion(),
    e = new THREE.Euler();
  pts.forEach((pt, i) => {
    if (!open(pt.x, pt.z)) return;
    const mesh = meshes[i % 3]!;
    const size = 0.0035 + Math.pow(r(), 2.2) * 0.012;
    e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4);
    qt.setFromEuler(e);
    m.compose(
      new THREE.Vector3(pt.x, groundHeight(pt.x, pt.z) + size * 0.25, pt.z),
      qt,
      new THREE.Vector3(
        size * (0.8 + 0.4 * r()),
        size * (0.7 + 0.5 * r()),
        size * (0.8 + 0.4 * r()),
      ),
    );
    mesh.setMatrixAt(mesh.count, m);
    mesh.setColorAt(
      mesh.count,
      palette[Math.floor(r() * palette.length)]!.clone().offsetHSL(
        0,
        0,
        (r() - 0.5) * 0.08,
      ),
    );
    mesh.count++;
  });
  return group;
}

function moss(lib: ClayLibrary, q: Quality): THREE.InstancedMesh {
  const r = rng(0x3055);
  const count = Math.round(q.scatter * 0.8);
  const shape = blob(1, {
    detail: 2,
    seed: 77,
    lumps: 0.3,
    frequency: 2.6,
    squash: [1, 0.45, 1],
    floor: -0.1,
  });
  const mesh = new THREE.InstancedMesh(
    shape,
    lib.get("moss", {
      color: 0xffffff,
      roughness: 0.9,
      scale: 0.006,
      relief: 0.12,
      smudge: 0.2,
      wrap: 0.5,
      scatter: 0x4a6a12,
    }),
    count,
  );
  mesh.name = "moss";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const pts = sample(r, count, (x, z) => {
    const bed = bedMask(x, z);
    let stoneEdge = 0;
    for (const s of LAYOUT.stones) {
      const d = ellipseRadius(s, x, z);
      stoneEdge = Math.max(stoneEdge, Math.max(0, 1 - Math.abs(d - 1.02) / 0.1));
    }
    const trunk = Math.max(
      0,
      1 - Math.hypot(x - LAYOUT.maple.trunk.x, z - LAYOUT.maple.trunk.z) / 0.7,
    );
    return Math.max(bed * 0.8, stoneEdge * 0.6, trunk * 0.7);
  });
  const greens = [0x5d7a2a, 0x6f8c34, 0x4f6a24, 0x7f8f3a, 0x8a9a46].map((h) =>
    clayColor(h),
  );
  const m = new THREE.Matrix4(),
    qt = new THREE.Quaternion();
  let k = 0;
  for (const pt of pts) {
    if (!open(pt.x, pt.z, -0.02) && bedMask(pt.x, pt.z) < 0.3) {
      // Moss may creep onto a stone's rim, but not into the pot or the saucer.
      const onStone = LAYOUT.stones.some((s) => ellipseRadius(s, pt.x, pt.z) < 1.06);
      if (!onStone) continue;
    }
    const size = 0.008 + Math.pow(r(), 1.8) * 0.03;
    qt.setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0));
    m.compose(
      new THREE.Vector3(pt.x, groundHeight(pt.x, pt.z) - size * 0.08, pt.z),
      qt,
      new THREE.Vector3(
        size * (0.8 + 0.5 * r()),
        size * (0.6 + 0.6 * r()),
        size * (0.8 + 0.5 * r()),
      ),
    );
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(
      k,
      greens[Math.floor(r() * greens.length)]!.clone().offsetHSL(
        0,
        0,
        (r() - 0.5) * 0.06,
      ),
    );
    k++;
  }
  mesh.count = k;
  return mesh;
}

function fallenLeaves(
  lib: ClayLibrary,
  atlas: DecalAtlas,
  q: Quality,
): THREE.InstancedMesh {
  const r = rng(0x1ea5);
  const count = Math.round(q.scatter * 0.45);
  const geo = leafSheet({
    length: 1,
    width: 1,
    along: 6,
    across: 6,
    curl: 0.5,
    cup: 0.12,
    buckle: 0.02,
    seed: 5,
  });
  // Into the fallen-leaf cell of the atlas; the sheet's origin is the stalk.
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, ...inCell(atlas.cells.fallen, uv.getX(i), uv.getY(i)));
  geo.translate(0, 0, -0.08);
  const mat = lib.get("fallen-leaf", {
    color: 0xffffff,
    map: atlas.color,
    reliefMap: atlas.relief,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.68,
    scale: 0.01,
    relief: 0.03,
    wrap: 0.6,
    scatter: 0xa04a10,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "fallen leaves";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = lib.keep(
    casterMaterial({ map: atlas.color, alphaTest: 0.5 }),
  );
  const pts = sample(r, count, (x, z) => {
    const under = Math.max(0, 1 - Math.hypot(x + 1.6, (z - 0.7) * 1.4) / 2.0);
    return 0.06 + 0.9 * under * (1 - bedMask(x, z) * 0.5);
  });
  const tints = [0xffffff, 0xffd2a0, 0xe8a070, 0xd8c070, 0xc08060].map((h) =>
    clayColor(h),
  );
  const m = new THREE.Matrix4(),
    qt = new THREE.Quaternion();
  let k = 0;
  for (const pt of pts) {
    if (!open(pt.x, pt.z, 0.01)) continue;
    const size = 0.05 + r() * 0.05;
    qt.setFromEuler(
      new THREE.Euler(
        (r() - 0.5) * 0.3,
        r() * Math.PI * 2,
        (r() - 0.5) * 0.3 + (r() < 0.3 ? Math.PI : 0),
      ),
    );
    m.compose(
      new THREE.Vector3(pt.x, groundHeight(pt.x, pt.z) + 0.004, pt.z),
      qt,
      new THREE.Vector3(size, size, size),
    );
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, tints[Math.floor(r() * tints.length)]!);
    k++;
  }
  mesh.count = k;
  return mesh;
}

/** A small ring of mushrooms by the maple and a few in the bed: October. */
function mushrooms(lib: ClayLibrary): THREE.Group {
  const r = rng(0xf1f1);
  const group = new THREE.Group();
  group.name = "mushrooms";
  const capMat = lib.get("mushroom-cap", {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.5,
    scale: 0.01,
    relief: 0.05,
    wrap: 0.45,
    scatter: 0x9a4a20,
  });
  const stemMat = lib.get("mushroom-stem", {
    color: 0xe4d8c0,
    roughness: 0.6,
    scale: 0.008,
    relief: 0.05,
    wrap: 0.6,
  });
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = 0.6 + i * 0.42 + r() * 0.2,
      d = 0.32 + r() * 0.12;
    spots.push([
      LAYOUT.maple.trunk.x + Math.cos(a) * d,
      LAYOUT.maple.trunk.z + Math.sin(a) * d,
      0.7 + r() * 0.6,
    ]);
  }
  for (let i = 0; i < 4; i++)
    spots.push([-2.2 + i * 0.37 + r() * 0.1, -1.13 + r() * 0.08, 0.5 + r() * 0.5]);
  const caps: THREE.BufferGeometry[] = [],
    stems: THREE.BufferGeometry[] = [];
  const brown = clayColor(0x9a6a42),
    tan = clayColor(0xc49a6a),
    gill = clayColor(0xd9c6a6);
  spots.forEach(([x, z, s], i) => {
    const h = 0.03 * s,
      cr = 0.018 * s;
    const lean = (r() - 0.5) * 0.25;
    const stem = lathe(
      [
        [0.005 * s, 0],
        [0.0045 * s, h * 0.5],
        [0.0035 * s, h],
      ],
      { segments: 12, seed: 300 + i, wobble: 0.08, lean, leanDir: r() * 6.3 },
    );
    const cap = lathe(
      [
        [0.001, -0.003 * s],
        [cr * 0.6, -0.002 * s],
        [cr, -0.001 * s],
        [cr * 1.02, 0.002 * s],
        [cr * 0.85, 0.009 * s],
        [cr * 0.45, 0.014 * s],
        [0.001, 0.016 * s],
      ],
      { segments: 24, seed: 400 + i, wobble: 0.06 },
    );
    tint(cap, (p, n) =>
      n.y < -0.2
        ? gill.clone()
        : brown.clone().lerp(tan, Math.min(1, Math.hypot(p.x, p.z) / cr) * 0.6),
    );
    const y = groundHeight(x, z);
    const tiltX = Math.sin(lean) * h;
    stem.translate(x, y - 0.002, z);
    cap.rotateZ(lean * 0.8).translate(x + tiltX, y + h - 0.002, z);
    stems.push(stem);
    caps.push(cap);
  });
  const capMesh = new THREE.Mesh(merge(caps), capMat);
  const stemMesh = new THREE.Mesh(merge(stems), stemMat);
  for (const mesh of [capMesh, stemMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** The maple's surface roots, half sunk into the lawn. */
function roots(lib: ClayLibrary): THREE.Mesh {
  const r = rng(0x2007);
  const t = LAYOUT.maple.trunk;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + i * 0.55 + (r() - 0.5) * 0.3;
    const len = 0.35 + r() * 0.45;
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 5; k++) {
      const s = k / 5;
      const d = t.radius * 0.8 + s * len;
      const x = t.x + Math.cos(a + 0.15 * Math.sin(s * 4 + i)) * d,
        z = t.z + Math.sin(a + 0.15 * Math.sin(s * 4 + i)) * d;
      pts.push([x, groundHeight(x, z) + 0.012 * (1 - s) - 0.006 * s, z]);
    }
    parts.push(
      tube(pts, [0.045, 0.03, 0.018, 0.008], {
        radial: 9,
        density: 30,
        seed: 500 + i,
        wobble: 0.15,
      }),
    );
  }
  const mesh = new THREE.Mesh(
    merge(parts),
    lib.get("bark", {
      color: 0x6b5e52,
      roughness: 0.8,
      scale: 0.05,
      relief: 0.08,
      smudge: 0.12,
    }),
  );
  mesh.name = "roots";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface GroundSet {
  group: THREE.Group;
  /** Every instanced mesh, for disposal of their buffers. */
  dispose(): void;
}

export function buildGround(lib: ClayLibrary, atlas: DecalAtlas, q: Quality): GroundSet {
  const group = new THREE.Group();
  group.name = "ground set";
  const parts = [
    terrain(lib, q),
    grass(lib, q),
    pebbles(lib, q),
    moss(lib, q),
    fallenLeaves(lib, atlas, q),
    roots(lib),
  ];
  for (const p of parts) group.add(p);
  group.add(mushrooms(lib));
  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
