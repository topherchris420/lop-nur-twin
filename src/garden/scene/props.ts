/**
 * The garden's sculpted props, each where `layout.ts` puts it and each
 * shaped so the surface the fly stands on is exactly the surface
 * `stage.ts` maps it to: the fence board's front, the windowsill's top, the
 * aster's disc and rays, the pear's skin, the saucer's rim, the stepping
 * stone's top. Away from those surfaces the clay is free to be uneven.
 */
import * as THREE from "three";
import { groundHeight, LAYOUT, stoneTop } from "../core/layout.js";
import type { Quality } from "../core/quality.js";
import { STAGES, swayFrame } from "../core/stage.js";
import { add, addScaled, cross, normalize, scale, sub, type V3 } from "../core/vec.js";
import { casterMaterial, withCascade, type ClayLibrary } from "./clay.js";
import {
  blob,
  clayColor,
  compose,
  frameQuat,
  lathe,
  leafSheet,
  merge,
  noise3,
  rng,
  tint,
  tube,
  weld,
} from "./geometry.js";
import { boardGrain, inCell, type DecalAtlas } from "./textures.js";

const L = LAYOUT;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// --------------------------------------------------------------------- fence

/** The cedar fence: dog-eared boards with scored grain, rails and posts behind. */
type Grain = ReturnType<typeof boardGrain>;

function fence(lib: ClayLibrary, grain: Grain): THREE.Group {
  const f = L.fence;
  const r = rng(0xfe7c);
  const pitch = f.boardWidth + f.gap;
  const perch = STAGES.fence.anchor[0];
  const bevel = 0.0018;
  const boards: THREE.BufferGeometry[] = [];
  // Boards all the way to the house; the last is cut to fit.
  const count = Math.ceil((f.x1 - f.x0) / pitch);
  const perchK = Math.floor((perch - f.x0) / pitch);
  const weathered = clayColor(0x9a8c7c),
    fresh = clayColor(0xffffff);
  for (let k = 0; k < count; k++) {
    const x0 = f.x0 + k * pitch;
    const isPerch = perch > x0 && perch < x0 + f.boardWidth;
    const last = k === count - 1;
    // Every other board, counted from the fly's own, sits half a millimetre
    // back, so neighbours that lean together overlap instead of sharing a plane.
    const back = (k - perchK) % 2 !== 0 ? 0.0005 : 0;
    const fit = Math.min(f.boardWidth, f.x1 - x0 - f.gap);
    const w = fit - (isPerch ? 0 : r() * 0.0015);
    const h = f.height - f.bottom + (isPerch ? 0 : (r() - 0.5) * 0.03);
    const ear = 0.02 + r() * 0.006;
    const s = new THREE.Shape();
    const iw = w - 2 * bevel,
      ih = h - 2 * bevel;
    s.moveTo(0, 0);
    s.lineTo(iw, 0);
    s.lineTo(iw, ih - ear);
    s.lineTo(iw - ear, ih);
    s.lineTo(ear, ih);
    s.lineTo(0, ih - ear);
    s.closePath();
    const depth = f.thickness - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 1,
    });
    g.translate(x0 + bevel, f.bottom + bevel, f.front - depth - bevel - back);
    // Every board but the fly's own (and the last, against the wall) leans a little.
    if (!isPerch && !last) {
      const tilt = (r() - 0.5) * 0.005;
      const m = new THREE.Matrix4().makeRotationZ(tilt);
      const c = new THREE.Vector3(x0 + w / 2, f.bottom, 0);
      g.translate(-c.x, -c.y, 0).applyMatrix4(m).translate(c.x, c.y, 0);
    }
    // Grain: u across the board, v up it, each board at its own offset in the texture.
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const ou = r(),
      ov = r();
    for (let i = 0; i < pos.count; i++)
      uv.setXY(
        i,
        ou + (pos.getX(i) - x0) / f.boardWidth,
        ov + (pos.getY(i) - f.bottom) / (f.boardWidth * 8),
      );
    const shade = new THREE.Color().copy(fresh).lerp(weathered, 0.15 + 0.5 * r());
    tint(g, () => shade);
    boards.push(g);
  }
  const boardMat = lib.get("fence", {
    color: 0xffffff,
    vertexColors: true,
    map: grain.color,
    reliefMap: grain.relief,
    roughness: 0.78,
    scale: 0.11,
    // Smoothed boards: the scribed grain is the relief, not hand marks, which
    // in the sun's raking light would read as hammered metal at the fly's scale.
    relief: 0.008,
    smudge: 0.08,
    wrap: 0.3,
  });
  // The relief map's depth is set from its scale: grain grooves about half a millimetre deep.
  boardMat.userData.clay.uClayReliefDepth.value = 0.0006;
  const group = new THREE.Group();
  group.name = "fence";
  const boardMesh = new THREE.Mesh(merge(boards), boardMat);
  boardMesh.castShadow = boardMesh.receiveShadow = true;
  group.add(boardMesh);
  const rails: THREE.BufferGeometry[] = [];
  for (const y of f.rails) {
    const g = new THREE.BoxGeometry(f.x1 - f.x0, 0.088, 0.038, 64, 2, 2);
    g.translate((f.x0 + f.x1) / 2, y, f.front - f.thickness - 0.019);
    rails.push(g);
  }
  for (let x = f.x0 + 0.3; x < f.x1; x += 2.4) {
    const g = new THREE.BoxGeometry(0.09, f.height + 0.1, 0.09, 2, 16, 2);
    g.translate(x, (f.height + 0.1) / 2 - 0.05, f.front - f.thickness - 0.038 - 0.045);
    rails.push(g);
  }
  const railMesh = new THREE.Mesh(
    merge(rails),
    lib.get("fence-rail", { color: 0x7d5a40, roughness: 0.8, scale: 0.12, relief: 0.04 }),
  );
  railMesh.castShadow = railMesh.receiveShadow = true;
  group.add(railMesh);
  // A dark backing behind the rails, as a set builder would hang one: what
  // shows between the boards reads as a joint, not as slits of bright sky.
  // It stops below the dog-ears, whose notches keep their sky.
  const top = f.height - 0.06;
  const backing = new THREE.PlaneGeometry(f.x1 - f.x0, top - f.bottom);
  backing.translate(
    (f.x0 + f.x1) / 2,
    (f.bottom + top) / 2,
    f.front - f.thickness - 0.039,
  );
  const backingMesh = new THREE.Mesh(
    backing,
    lib.get("fence-backing", { color: 0x2b2119, roughness: 0.95 }),
  );
  backingMesh.receiveShadow = true;
  group.add(backingMesh);
  return group;
}

// ---------------------------------------------------------- house and window

/**
 * Painted shiplap from the foundation to the eaves, cut round the window.
 * Each board's face lies in the plane `wall.front + wall.siding` (where a
 * fly climbing the wall walks); a chamfered groove marks every joint.
 */
function siding(lib: ClayLibrary): THREE.Mesh {
  const w = L.wall,
    win = L.window;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const r = rng(0x51d1);
  const base = clayColor(0xd6cdb8);
  const quad = (a: V3, b: V3, c: V3, d: V3, col: THREE.Color) => {
    const i = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) colors.push(col.r, col.g, col.b);
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const face = w.front + w.siding;
  const groove = 0.005,
    deep = 0.003;
  const openX0 = win.x0 - win.trim,
    openX1 = win.x1 + win.trim;
  const openY0 = win.sill.top - win.sill.thickness - win.apron.height,
    openY1 = win.y1 + win.trim;
  /** One board's strip between heights y0 and y1 over [xa, xb]; `joint` cuts the groove at its foot. */
  const strip = (
    xa: number,
    xb: number,
    y0: number,
    y1: number,
    joint: boolean,
    col: THREE.Color,
  ) => {
    const steps = Math.max(1, Math.round((xb - xa) / 0.08));
    const yf = joint ? y0 + groove : y0;
    for (let k = 0; k < steps; k++) {
      const a = xa + ((xb - xa) * k) / steps,
        b = xa + ((xb - xa) * (k + 1)) / steps;
      quad([a, yf, face], [b, yf, face], [b, y1, face], [a, y1, face], col);
      if (joint) {
        const shade = col.clone().multiplyScalar(0.82);
        // The chamfer, sloping back into the groove, and the ledge of the board below.
        quad(
          [a, y0, face - deep],
          [b, y0, face - deep],
          [b, yf, face],
          [a, yf, face],
          shade,
        );
        quad(
          [a, y0, face],
          [b, y0, face],
          [b, y0, face - deep],
          [a, y0, face - deep],
          shade,
        );
      }
    }
  };
  for (let y = w.foundation.top; y < w.height - 1e-6; y += w.board) {
    const y0 = y,
      y1 = Math.min(w.height, y + w.board);
    const col = base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.025);
    const joint = y0 > w.foundation.top + 1e-6;
    if (y1 <= openY0 || y0 >= openY1) {
      strip(w.x0, w.x1, y0, y1, joint, col);
      continue;
    }
    // A board the window cuts: whole below and above the opening, beside it in between.
    if (y0 < openY0) strip(w.x0, w.x1, y0, openY0, joint, col);
    const m0 = Math.max(y0, openY0),
      m1 = Math.min(y1, openY1);
    const cutJoint = joint && y0 >= openY0;
    strip(w.x0, openX0, m0, m1, cutJoint, col);
    strip(openX1, w.x1, m0, m1, cutJoint, col);
    if (y1 > openY1) strip(w.x0, w.x1, openY1, y1, false, col);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(
    g,
    lib.get("siding", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.6,
      scale: 0.16,
      relief: 0.025,
      smudge: 0.05,
      wrap: 0.25,
      scatter: 0x8a6a4a,
    }),
  );
  mesh.name = "siding";
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export interface WindowPieces {
  group: THREE.Group;
  /** Emissive interior, lit by the evening lamps. */
  interior: THREE.MeshStandardMaterial;
}

function windowAndWall(lib: ClayLibrary): WindowPieces {
  const w = L.wall,
    win = L.window,
    sill = win.sill;
  const group = new THREE.Group();
  group.name = "house";
  group.add(siding(lib));
  const white = lib.get("trim", {
    color: 0xeae5d8,
    roughness: 0.48,
    scale: 0.08,
    relief: 0.03,
    wrap: 0.25,
  });
  const box = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    segs = 2,
  ) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, segs, segs, 2);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  };
  const face = w.front + w.siding;
  const sillBottom = sill.top - sill.thickness;
  const trim = merge([
    box(win.x0 - win.trim, win.x0, sillBottom, win.y1 + win.trim, w.front, face + 0.012), // left casing
    box(win.x1, win.x1 + win.trim, sillBottom, win.y1 + win.trim, w.front, face + 0.012), // right casing
    box(
      win.x0 - win.trim - 0.012,
      win.x1 + win.trim + 0.012,
      win.y1,
      win.y1 + win.trim + 0.012,
      w.front,
      face + 0.016,
      4,
    ), // head
    box(
      win.x0 - win.trim,
      win.x1 + win.trim,
      sillBottom - win.apron.height,
      sillBottom,
      w.front,
      w.front + win.apron.face,
      4,
    ), // apron
    // The sash: rails round the glass and the cross of its bars.
    box(
      win.x0,
      win.x1,
      win.y0 - 0.05,
      win.y0 + 0.035,
      w.front - 0.03,
      w.front - 0.005,
      4,
    ),
    box(win.x0, win.x1, win.y1 - 0.035, win.y1, w.front - 0.03, w.front - 0.005, 4),
    box(win.x0, win.x0 + 0.035, win.y0, win.y1, w.front - 0.03, w.front - 0.005),
    box(win.x1 - 0.035, win.x1, win.y0, win.y1, w.front - 0.03, w.front - 0.005),
    box(
      (win.x0 + win.x1) / 2 - 0.012,
      (win.x0 + win.x1) / 2 + 0.012,
      win.y0,
      win.y1,
      w.front - 0.028,
      w.front - 0.008,
    ),
    box(
      win.x0,
      win.x1,
      (win.y0 + win.y1) / 2 - 0.012,
      (win.y0 + win.y1) / 2 + 0.012,
      w.front - 0.028,
      w.front - 0.008,
      4,
    ),
  ]);
  const trimMesh = new THREE.Mesh(trim, white);
  trimMesh.castShadow = trimMesh.receiveShadow = true;
  group.add(trimMesh);
  // The sill: its top flat where the fly perches, its front edges rounded
  // (radius `sill.round`). The cross-section (out from the wall × up), shrunk
  // by the bevel that rounds its ends, run along x.
  const ss = new THREE.Shape();
  const b = 0.003;
  const sd = sill.depth - 2 * b,
    st = sill.thickness - 2 * b,
    rr = sill.round - b;
  ss.moveTo(0, 0);
  ss.lineTo(sd - rr, 0);
  ss.absarc(sd - rr, rr, rr, -Math.PI / 2, 0, false);
  ss.lineTo(sd, st - rr);
  ss.absarc(sd - rr, st - rr, rr, 0, Math.PI / 2, false);
  ss.lineTo(0, st);
  ss.closePath();
  const sg = new THREE.ExtrudeGeometry(ss, {
    depth: sill.x1 - sill.x0 - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 6,
  });
  // A quarter turn about +y: the extrusion runs along −x, the section's x out from the wall.
  sg.rotateY(-Math.PI / 2);
  sg.translate(sill.x1 - b, sill.top - sill.thickness + b, w.front + b);
  sg.computeBoundingSphere();
  const sillMesh = new THREE.Mesh(sg, white);
  sillMesh.name = "windowsill";
  sillMesh.castShadow = sillMesh.receiveShadow = true;
  group.add(sillMesh);
  // Glass: old, slightly wavy, reflecting the garden; the room behind it dim by day, lamp-lit at night.
  const glass = lib.keep(
    withCascade(
      new THREE.MeshPhysicalMaterial({
        color: 0x1a201e,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.42,
        envMapIntensity: 1.4,
        specularIntensity: 1,
      }),
    ),
  );
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(win.x1 - win.x0, win.y1 - win.y0, 8, 8),
    glass,
  );
  const pp = pane.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = noise3(0x91a5);
  for (let i = 0; i < pp.count; i++)
    pp.setZ(i, 0.0008 * n(pp.getX(i) * 7, pp.getY(i) * 7, 0));
  pane.geometry.computeVertexNormals();
  pane.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, w.front - 0.018);
  pane.renderOrder = 2;
  group.add(pane);
  const interior = lib.keep(
    withCascade(
      new THREE.MeshStandardMaterial({
        color: 0x2a221c,
        roughness: 0.9,
        emissive: new THREE.Color(1, 0.62, 0.3),
        emissiveIntensity: 0,
      }),
    ),
  );
  const room = new THREE.Mesh(
    new THREE.PlaneGeometry(win.x1 - win.x0 + 0.3, win.y1 - win.y0 + 0.3),
    interior,
  );
  room.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, w.front - 0.35);
  group.add(room);
  // Curtains drawn to the sides, folded.
  const curtainMat = lib.get("curtain", {
    color: 0xb9a68a,
    roughness: 0.85,
    scale: 0.05,
    relief: 0.03,
    wrap: 0.7,
    scatter: 0xb06a30,
  });
  for (const side of [-1, 1]) {
    const cg = new THREE.PlaneGeometry(0.16, win.y1 - win.y0 + 0.1, 24, 6);
    const cp = cg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++)
      cp.setZ(i, 0.012 * Math.sin(cp.getX(i) * 110 + side));
    cg.computeVertexNormals();
    const c = new THREE.Mesh(cg, curtainMat);
    c.position.set(
      side < 0 ? win.x0 + 0.1 : win.x1 - 0.1,
      (win.y0 + win.y1) / 2,
      w.front - 0.12,
    );
    group.add(c);
  }
  const foundation = new THREE.Mesh(
    box(
      w.x0,
      w.x1,
      -0.06,
      w.foundation.top,
      w.front - 0.05,
      w.front + w.foundation.face,
      6,
    ),
    lib.get("foundation", {
      color: 0x8e8a82,
      roughness: 0.88,
      scale: 0.12,
      relief: 0.06,
      smudge: 0.12,
    }),
  );
  foundation.castShadow = foundation.receiveShadow = true;
  group.add(foundation);
  return { group, interior };
}

// ------------------------------------------------------------- pot of asters

export interface Asters {
  group: THREE.Group;
  /** The flower the fly visits, on its own stem, pivoting where `swayFrame("flower")` says. */
  hero: THREE.Group;
}

function pot(lib: ClayLibrary): THREE.Group {
  const p = L.pot;
  const y0 = groundHeight(p.x, p.z);
  const body = lathe(
    [
      [0.001, -0.004],
      [p.baseRadius, -0.004],
      [p.baseRadius + 0.004, 0.012],
      [p.bodyTopRadius, p.bodyHeight],
      [p.rimRadius + 0.001, p.bodyHeight + 0.003],
      [p.rimRadius + 0.003, p.bodyHeight + p.rimHeight * 0.5],
      [p.rimRadius, p.bodyHeight + p.rimHeight],
      [p.rimRadius - p.wall * 0.6, p.bodyHeight + p.rimHeight + 0.002],
      [p.rimRadius - p.wall, p.bodyHeight + p.rimHeight - 0.006],
      [p.rimRadius - p.wall - 0.002, p.soil],
    ],
    { segments: 72, seed: 0x9071, wobble: 0.012, lumps: 1.7, lean: 0.012, leanDir: 0.7 },
  );
  const n = noise3(0x9072);
  const terra = clayColor(0xb86a42),
    bloom = clayColor(0xd8bfa6),
    damp = clayColor(0x7e452c);
  const c = new THREE.Color();
  tint(body, (v) => {
    const h = v.y / (p.bodyHeight + p.rimHeight);
    c.copy(terra).offsetHSL(0, 0, 0.03 * n(v.x * 18, v.y * 18, v.z * 18));
    const salt =
      smooth(0.6, 0.95, h) * (0.35 + 0.35 * n(v.x * 9, v.y * 4, v.z * 9)) +
      Math.max(0, n(v.x * 6, v.y * 6, v.z * 6) - 0.55);
    c.lerp(bloom, Math.min(0.6, Math.max(0, salt)));
    c.lerp(damp, (1 - smooth(0, 0.25, h)) * 0.6);
    return c.clone();
  });
  body.translate(p.x, y0, p.z);
  const potMesh = new THREE.Mesh(
    body,
    lib.get("terracotta", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.82,
      scale: 0.06,
      relief: 0.05,
      smudge: 0.06,
      wrap: 0.35,
      scatter: 0xa04020,
    }),
  );
  potMesh.name = "pot";
  potMesh.castShadow = potMesh.receiveShadow = true;
  const soil = lathe(
    [
      [0.001, 0.01],
      [0.05, 0.009],
      [0.11, 0.005],
      [p.rimRadius - p.wall - 0.001, 0],
    ],
    { segments: 48, seed: 0x9073, wobble: 0.03, lumps: 3.2 },
  );
  soil.translate(p.x, y0 + p.soil, p.z);
  const soilMesh = new THREE.Mesh(
    soil,
    lib.get("soil", {
      color: 0x3e2c20,
      roughness: 0.95,
      scale: 0.02,
      relief: 0.14,
      smudge: 0.15,
    }),
  );
  soilMesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(potMesh, soilMesh);
  return group;
}

/** A New England aster's rays: many and narrow, overlapping at the disc and out as far as the fly walks. */
const RAY_WIDTH = 0.0017;
const HERO_RAYS = 42;

/**
 * A ray petal of unit length, base at the origin, leaving along +z with its
 * upper side +y: it bends down at radius `bend` (unit lengths) for the
 * first `until` of its length, then runs straight, so on the hero aster it
 * lies on the perch sphere exactly as far as a fly can stand on it.
 */
function rayGeometry(
  atlas: DecalAtlas,
  bend: number,
  until: number,
): THREE.BufferGeometry {
  const along = 10;
  const w = RAY_WIDTH / L.heroAster.rayLength;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let y = 0,
    z = 0,
    angle = 0;
  const ds = 1 / along;
  for (let i = 0; i <= along; i++) {
    const s = i / along;
    for (let j = 0; j < 3; j++) {
      const u = j / 2;
      // A shallow groove down the middle of the ray.
      const lift = j === 1 ? -0.004 : 0;
      positions.push(
        (u - 0.5) * w,
        y + lift * Math.cos(angle),
        z - lift * Math.sin(angle),
      );
      uvs.push(...inCell(atlas.cells.petal, u, 1 - s));
    }
    // March the midline: bend down until `until`, straight after.
    const k = s < until ? ds / bend : 0;
    z += Math.cos(angle + k / 2) * ds;
    y -= Math.sin(angle + k / 2) * ds;
    angle += k;
  }
  for (let i = 0; i < along; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** How far the hero's florets stand above its receptacle, and how far their tips stand proud of the fly's sphere. */
const FLORET_DEPTH = 0.00045,
  FLORET_PROUD = 0.00008;

/**
 * The hero's disc florets: five-lobed buds in the golden-angle spiral of a
 * daisy's head. Their tips make the surface `stage.ts` stands the fly on,
 * so its feet settle among them; the receptacle lies `FLORET_DEPTH` below.
 * The centre is still in bud; this late in the season the outer ring has
 * opened and some florets have gone over to rust.
 */
function discFlorets(
  material: THREE.Material,
  frame: THREE.Matrix4,
  sphere: number,
  discRadius: number,
): THREE.InstancedMesh {
  const count = 90;
  const spacing = discRadius * Math.sqrt(Math.PI / count);
  const bud = new THREE.SphereGeometry(1, 15, 10);
  const pos = bud.getAttribute("position") as THREE.BufferAttribute;
  const half = (FLORET_DEPTH + FLORET_PROUD + 0.0003) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    // Five teeth round the tip, as a corolla's.
    const k =
      0.52 * spacing * (1 + 0.18 * Math.max(0, y) * Math.cos(5 * Math.atan2(z, x)));
    pos.setXYZ(i, x * k, FLORET_PROUD + (y - 1) * half, z * k);
  }
  const g = weld(bud);
  const deep = clayColor(0x6a3c14),
    light = new THREE.Color(1, 1, 1);
  tint(g, (p) => deep.clone().lerp(light, smooth(-FLORET_DEPTH, 0, p.y)));
  const mesh = new THREE.InstancedMesh(g, material, count);
  mesh.name = "disc florets";
  mesh.castShadow = mesh.receiveShadow = true;
  const bud0 = clayColor(0xc6a432),
    gold = clayColor(0xe4b236),
    open = clayColor(0xda982c),
    rust = clayColor(0x96462a);
  const r = rng(0xf10e);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const Y = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    twist = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const t = Math.sqrt((i + 0.5) / count);
    const rho = discRadius * 0.95 * t,
      a = i * golden;
    const p = new THREE.Vector3(
      rho * Math.cos(a),
      Math.sqrt(sphere * sphere - rho * rho),
      rho * Math.sin(a),
    );
    q.setFromUnitVectors(Y, p.clone().normalize()).multiply(
      twist.setFromAxisAngle(Y, r() * Math.PI * 2),
    );
    const size = 0.85 + 0.25 * t + (r() - 0.5) * 0.1;
    m.compose(p, q, new THREE.Vector3(size, size, size)).premultiply(frame);
    mesh.setMatrixAt(i, m);
    const c = r() < 0.14 && t > 0.3 ? rust : t < 0.45 ? bud0 : t < 0.8 ? gold : open;
    mesh.setColorAt(i, c.clone().offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.06));
  }
  return mesh;
}

interface Head {
  center: V3;
  facing: V3;
  /** Radius of the disc, and the angle (rad) its edge slopes down at. */
  disc: number;
  slope: number;
  ray: number;
  rays: number;
  tint: THREE.Color;
}

function asters(lib: ClayLibrary, atlas: DecalAtlas, q: Quality): Asters {
  const p = L.pot;
  const hero = L.heroAster;
  const y0 = groundHeight(p.x, p.z);
  const r = rng(0xa57e);
  const group = new THREE.Group();
  group.name = "asters";
  const heroN = normalize(hero.facing);
  // The mound of flower heads over the pot, the hero at the front.
  const heads: Head[] = [];
  const target = q.name === "performance" ? 14 : 24;
  let guard = 0;
  while (heads.length < target && guard++ < 4000) {
    const a = r() * Math.PI * 2,
      d = Math.sqrt(r()) * 0.2;
    const cx = p.x + Math.cos(a) * d,
      cz = p.z + Math.sin(a) * d * 0.85;
    const cy = y0 + 0.38 + 0.2 * (1 - d / 0.2) + (r() - 0.5) * 0.05;
    const c: V3 = [cx, cy, cz];
    if (Math.hypot(cx - hero.center[0], cy - hero.center[1], cz - hero.center[2]) < 0.045)
      continue;
    if (
      heads.some(
        (h) => Math.hypot(h.center[0] - cx, h.center[1] - cy, h.center[2] - cz) < 0.034,
      )
    )
      continue;
    // Turned outward and toward the lawn, as a potted aster's dome of flowers faces the light it grew to.
    const out = normalize([cx - p.x, 0.55, cz - p.z + 0.45]);
    heads.push({
      center: c,
      facing: normalize(add(out, [(r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4])),
      disc: hero.discRadius * (0.85 + 0.3 * r()),
      ray: hero.rayLength * (0.8 + 0.4 * r()),
      rays: 32 + Math.floor(r() * 12),
      slope: Math.asin(1 / 2.4),
      tint: clayColor(0xffffff).offsetHSL(
        (r() - 0.5) * 0.04,
        (r() - 0.5) * 0.15,
        (r() - 0.5) * 0.08,
      ),
    });
  }
  // --- rays (instanced; the hero's are in its own group)
  const petalMat = lib.get("petal", {
    color: 0xffffff,
    map: atlas.color,
    reliefMap: atlas.relief,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.55,
    scale: 0.004,
    relief: 0.03,
    wrap: 0.75,
    scatter: 0x9a5ab0,
  });
  const petalCaster = lib.keep(casterMaterial({ map: atlas.color, alphaTest: 0.5 }));
  /** Rays round a head's disc, leaving its edge along the dome; the hero's at one exact length. */
  const placeRays = (
    h: Head,
    mesh: THREE.InstancedMesh,
    from: number,
    pivot: V3 | null,
    vary: boolean,
  ) => {
    const m = new THREE.Matrix4();
    const tangent = normalize(
      cross(h.facing, Math.abs(h.facing[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]),
    );
    const bitangent = normalize(cross(h.facing, tangent));
    let k = from;
    for (let i = 0; i < h.rays; i++) {
      const phi = (i / h.rays) * Math.PI * 2 + (r() - 0.5) * 0.12;
      const radial = normalize(
        add(scale(tangent, Math.cos(phi)), scale(bitangent, Math.sin(phi))),
      );
      const up = normalize(
        add(scale(h.facing, Math.cos(h.slope)), scale(radial, Math.sin(h.slope))),
      );
      const out = normalize(
        add(scale(radial, Math.cos(h.slope)), scale(h.facing, -Math.sin(h.slope))),
      );
      const base = add(h.center, scale(radial, h.disc));
      const len = vary ? h.ray * (0.9 + 0.2 * r()) : h.ray;
      m.compose(
        new THREE.Vector3(...(pivot ? sub(base, pivot) : base)),
        frameQuat(up, out),
        new THREE.Vector3(len, len, len),
      );
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, h.tint.clone().offsetHSL(0, 0, (r() - 0.5) * 0.05));
      k++;
    }
    return k;
  };
  const petals = rayGeometry(atlas, 1.6, 0.6);
  const rayCount = heads.reduce((s, h) => s + h.rays, 0);
  const rayMesh = new THREE.InstancedMesh(petals, petalMat, rayCount);
  rayMesh.castShadow = rayMesh.receiveShadow = true;
  rayMesh.customDepthMaterial = petalCaster;
  let k = 0;
  for (const h of heads) k = placeRays(h, rayMesh, k, null, true);
  rayMesh.count = k;
  group.add(rayMesh);
  // --- discs: a dome of florets, gold ringed by orange-tipped buds.
  const discMat = lib.get("aster-disc", {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.6,
    scale: 0.0016,
    relief: 0.22,
    smudge: 0.1,
    wrap: 0.6,
    scatter: 0xa06010,
  });
  const gold = clayColor(0xe3b23a),
    amber = clayColor(0xc9822a);
  const discGeom = (radius: number, sphere: number) => {
    const theta = Math.asin(Math.min(0.99, radius / sphere));
    const g = new THREE.SphereGeometry(sphere, 28, 6, 0, Math.PI * 2, 0, theta);
    tint(g, (v) =>
      gold.clone().lerp(amber, Math.min(1, Math.hypot(v.x, v.z) / radius) * 0.8),
    );
    g.deleteAttribute("uv");
    return g;
  };
  const discs: THREE.BufferGeometry[] = [];
  const bracts: THREE.BufferGeometry[] = [];
  const stems: THREE.BufferGeometry[] = [];
  const leafMats: THREE.Matrix4[] = [];
  const soilY = y0 + p.soil;
  const stemFor = (top: V3, under: V3, seed: number): V3[] => {
    const a = (seed * 2.399) % (Math.PI * 2);
    const d = 0.03 + 0.08 * ((seed * 0.618) % 1);
    const root: V3 = [p.x + Math.cos(a) * d, soilY - 0.01, p.z + Math.sin(a) * d];
    const mid: V3 = [
      (root[0] + top[0]) / 2 + 0.015 * Math.sin(seed),
      (root[1] + top[1]) / 2,
      (root[2] + top[2]) / 2,
    ];
    return [root, mid, add(top, scale(under, 0.012)), top];
  };
  heads.forEach((h, i) => {
    const g = discGeom(h.disc, h.disc * 2.4);
    g.translate(0, -h.disc * 2.4 * Math.cos(Math.asin(1 / 2.4)), 0);
    g.applyMatrix4(compose(h.center, frameQuat(h.facing, [1, 0, 0])));
    discs.push(g);
    const under = scale(h.facing, -1);
    const cup = lathe(
      [
        [0.001, -0.004],
        [h.disc * 0.8, -0.003],
        [h.disc * 1.05, -0.0008],
      ],
      { segments: 14, seed: 600 + i, wobble: 0.1 },
    );
    cup.applyMatrix4(compose(h.center, frameQuat(h.facing, [1, 0, 0])));
    bracts.push(cup);
    const path = stemFor(add(h.center, scale(under, 0.003)), under, i + 1);
    stems.push(
      tube(path.reverse(), [0.0012, 0.0016, 0.0018, 0.0022], {
        radial: 7,
        density: 70,
        seed: 700 + i,
        wobble: 0.1,
      }),
    );
    // Two or three leaves along each stem.
    for (let j = 0; j < 2 + (i % 2); j++) {
      const s = 0.3 + 0.25 * j;
      const root = path[path.length - 1]!;
      const at: V3 = [
        root[0] + (h.center[0] - root[0]) * s,
        root[1] + (h.center[1] - root[1]) * s,
        root[2] + (h.center[2] - root[2]) * s,
      ];
      const out = normalize([
        Math.cos(i * 2.1 + j * 2.4),
        0.25,
        Math.sin(i * 2.1 + j * 2.4),
      ]);
      leafMats.push(
        compose(
          at,
          frameQuat(normalize(add([0, 1, 0], scale(out, -0.5))), out),
          0.035 + (0.015 * ((i + j) % 3)) / 2,
        ),
      );
    }
  });
  const discMesh = new THREE.Mesh(merge(discs), discMat);
  discMesh.castShadow = discMesh.receiveShadow = true;
  const green = lib.get("aster-green", {
    color: 0x55602e,
    roughness: 0.6,
    scale: 0.006,
    relief: 0.05,
    wrap: 0.6,
    scatter: 0x3a5a10,
  });
  const bractMesh = new THREE.Mesh(merge(bracts), green);
  const stemMesh = new THREE.Mesh(merge(stems), green);
  for (const m of [bractMesh, stemMesh]) m.castShadow = m.receiveShadow = true;
  group.add(discMesh, bractMesh, stemMesh);
  // Aster leaves along the stems.
  const leafGeo = leafSheet({
    length: 1,
    width: 0.22,
    along: 6,
    across: 2,
    curl: -0.4,
    cup: 0.06,
    seed: 9,
  });
  const luv = leafGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < luv.count; i++)
    luv.setXY(i, ...inCell(atlas.cells.asterLeaf, luv.getX(i), luv.getY(i)));
  const leafMat = lib.get("aster-leaf", {
    color: 0xffffff,
    map: atlas.color,
    reliefMap: atlas.relief,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.6,
    scale: 0.01,
    relief: 0.03,
    wrap: 0.6,
    scatter: 0x3a5a10,
  });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafMats.length);
  leafMats.forEach((m, i) => leaves.setMatrixAt(i, m));
  leaves.castShadow = leaves.receiveShadow = true;
  leaves.customDepthMaterial = lib.keep(
    casterMaterial({ map: atlas.color, alphaTest: 0.5 }),
  );
  group.add(leaves);

  // --- the hero: its disc and rays lie on the sphere `stage.ts` perches the fly on.
  const sway = swayFrame("flower", 0, null);
  const pivot = sway.pivot;
  const heroGroup = new THREE.Group();
  heroGroup.name = "hero aster";
  heroGroup.position.set(...pivot);
  const cap = STAGES.flowers.surface;
  if (cap.kind !== "cap") throw new Error("the flowers stage must be a cap");
  const local = (v: V3): V3 => sub(v, pivot);
  // The receptacle lies under the florets, whose tips are the cap.
  const capFrame = compose(local(cap.center), frameQuat(heroN, [1, 0, 0]));
  const heroDisc = discGeom(hero.discRadius, cap.radius);
  heroDisc.applyMatrix4(
    compose(
      local(addScaled(cap.center, heroN, -FLORET_DEPTH)),
      frameQuat(heroN, [1, 0, 0]),
    ),
  );
  const hd = new THREE.Mesh(heroDisc, discMat);
  hd.castShadow = hd.receiveShadow = true;
  heroGroup.add(hd, discFlorets(discMat, capFrame, cap.radius, hero.discRadius));
  // Rays bend at the sphere's own radius for their first few millimetres.
  const heroPetals = rayGeometry(atlas, cap.radius / hero.rayLength, 0.42);
  const heroRays = new THREE.InstancedMesh(heroPetals, petalMat, HERO_RAYS);
  heroRays.castShadow = heroRays.receiveShadow = true;
  heroRays.customDepthMaterial = petalCaster;
  const apex = add(cap.center, scale(heroN, cap.radius));
  const discEdgeDrop = cap.radius - Math.sqrt(cap.radius ** 2 - hero.discRadius ** 2);
  const heroHead: Head = {
    center: add(apex, scale(heroN, -discEdgeDrop)),
    facing: heroN,
    disc: hero.discRadius,
    slope: Math.asin(hero.discRadius / cap.radius),
    ray: hero.rayLength,
    rays: HERO_RAYS,
    tint: clayColor(0xffffff),
  };
  heroRays.count = placeRays(heroHead, heroRays, 0, pivot, false);
  heroGroup.add(heroRays);
  const heroUnder = scale(heroN, -1);
  const heroCup = lathe(
    [
      [0.001, -0.005],
      [hero.discRadius * 0.85, -0.0035],
      [hero.discRadius * 1.05, -0.0009],
    ],
    { segments: 16, seed: 690, wobble: 0.1 },
  );
  heroCup.applyMatrix4(compose(local(heroHead.center), frameQuat(heroN, [1, 0, 0])));
  const heroStem = tube(
    [
      [0, -0.02, 0],
      local([
        pivot[0] + 0.01,
        (pivot[1] + hero.center[1]) / 2,
        (pivot[2] + hero.center[2]) / 2 - 0.02,
      ]),
      local(add(hero.center, scale(heroUnder, 0.018))),
      local(add(hero.center, scale(heroUnder, 0.004))),
    ],
    [0.0024, 0.002, 0.0018, 0.0015],
    { radial: 8, density: 80, seed: 699, wobble: 0.08 },
  );
  const hs = new THREE.Mesh(merge([heroCup, heroStem]), green);
  hs.castShadow = hs.receiveShadow = true;
  heroGroup.add(hs);
  group.add(heroGroup);
  return { group, hero: heroGroup };
}

// ---------------------------------------------------------------------- pear

/**
 * The fallen pear. Its middle is exactly the ellipsoid `stage.ts` perches the
 * fly on (nothing there may move a fly's foot off the skin); the neck and the
 * calyx end are free to be a pear.
 */
function pear(lib: ClayLibrary): THREE.Group {
  const p = L.pear;
  const a = p.length * 0.48,
    R = p.radius;
  const profile: [number, number][] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const x = -a + ((0.0585 + a) * i) / N;
    let r: number;
    const ell = R * Math.sqrt(Math.max(0, 1 - (x / a) ** 2));
    if (x < -0.028) {
      const sup = R * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / a), 2.4)), 1 / 2.4);
      r = ell + (sup - ell) * smooth(-0.028, -0.042, x);
    } else if (x <= 0.02) r = ell;
    else {
      // Into a neck and the rounded stem end.
      const t = (x - 0.02) / 0.0385;
      const neck = 0.0325 - (0.0325 - p.neckRadius) * smooth(0, 0.62, t);
      r = neck * Math.sqrt(Math.max(0, 1 - Math.pow(smooth(0.55, 1, t), 2)));
    }
    profile.push([Math.max(r, 1e-4), x]);
  }
  profile[0] = [1e-4, -a];
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    96,
  );
  g.rotateZ(-Math.PI / 2); // lathe axis → the pear's local x
  const n = noise3(0x9ea2);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const k =
      1 +
      0.035 *
        n(x * 40, y * 40, z * 40) *
        (x < 0 ? smooth(0.028, 0.04, -x) : smooth(0.02, 0.03, x));
    pos.setXYZ(i, x, y * k, z * k);
  }
  const geo = weld(g);
  // Colour: Bartlett yellow-green, a blush where the sun found it, the bruise
  // the fly feeds on, and lenticels.
  const center: V3 = [p.x, groundHeight(p.x, p.z) + R * 0.94, p.z];
  const toLocal = (v: V3): V3 => {
    const d = sub(v, center);
    const c = Math.cos(p.yaw),
      s = Math.sin(p.yaw);
    return [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  };
  const bruise = toLocal(STAGES.pear.anchor);
  const base = clayColor(0xc6c06a),
    blush = clayColor(0xc98a4c),
    brown = clayColor(0x7a5328),
    dark = clayColor(0x4e3418),
    speck = clayColor(0x8a7a40);
  const r = rng(0x9ea3);
  const c = new THREE.Color();
  tint(geo, (v, nn) => {
    c.copy(base).offsetHSL(
      0.01 * n(v.x * 30, v.y * 30, 1),
      0,
      0.02 * n(v.x * 60, v.z * 60, 2),
    );
    c.lerp(
      blush,
      smooth(0.1, 0.9, nn.y) * 0.45 * (0.6 + 0.4 * n(v.x * 25, v.y * 25, v.z * 25)),
    );
    const d = Math.hypot(v.x - bruise[0], v.y - bruise[1], v.z - bruise[2]);
    c.lerp(
      brown,
      1 - smooth(0.007, 0.016, d + 0.002 * n(v.x * 200, v.y * 200, v.z * 200)),
    );
    c.lerp(dark, (1 - smooth(0.0, 0.007, d)) * 0.5);
    if (r() < 0.035) c.lerp(speck, 0.6);
    return c.clone();
  });
  const body = new THREE.Mesh(
    geo,
    lib.get("pear", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.42,
      scale: 0.018,
      relief: 0.03,
      smudge: 0.05,
      wrap: 0.55,
      scatter: 0xa86a10,
    }),
  );
  body.castShadow = body.receiveShadow = true;
  const stem = tube(
    [
      [0.056, 0.001, 0],
      [0.064, 0.004, 0.001],
      [0.07, 0.009, 0.003],
      [0.073, 0.016, 0.004],
    ],
    [0.0016, 0.0013, 0.0011, 0.0009],
    { radial: 7, density: 400, seed: 0x9ea4, wobble: 0.1 },
  );
  const stemMesh = new THREE.Mesh(
    stem,
    lib.get("pear-stem", { color: 0x5a4024, roughness: 0.7, scale: 0.004, relief: 0.06 }),
  );
  stemMesh.castShadow = true;
  const group = new THREE.Group();
  group.name = "pear";
  group.add(body, stemMesh);
  group.position.set(...center);
  group.rotation.y = p.yaw;
  return group;
}

// --------------------------------------------------------------- the saucer

export interface Saucer {
  group: THREE.Group;
  water: THREE.MeshStandardMaterial & {
    userData: {
      uniforms: {
        uTime: { value: number };
        uRain: { value: number };
        uWind: { value: number };
      };
    };
  };
}

function saucer(lib: ClayLibrary): Saucer {
  const s = L.saucer;
  const y0 = groundHeight(s.x, s.z);
  const rim = s.radius - s.wall / 2;
  const g = lathe(
    [
      [0.001, -0.002],
      [s.base, -0.002],
      [s.base + 0.004, 0.004],
      [s.radius - 0.003, s.height - 0.006],
      [s.radius, s.height - 0.0015],
      [rim + 0.0025, s.height - 0.0002],
      [rim, s.height],
      [rim - 0.0025, s.height - 0.0002],
      [s.radius - s.wall, s.height - 0.0015],
      [s.radius - s.wall - 0.004, 0.012],
      [s.base - 0.012, 0.0065],
      [0.001, 0.006],
    ],
    { segments: 120, seed: 0x5a0c, wobble: 0.0025, lumps: 2.2 },
  );
  const n = noise3(0x5a0d);
  const terra = clayColor(0xb46a44),
    bloom = clayColor(0xd4b8a0),
    wet = clayColor(0x6e3a24);
  const c = new THREE.Color();
  tint(g, (v) => {
    c.copy(terra).offsetHSL(0, 0, 0.03 * n(v.x * 20, v.y * 20, v.z * 20));
    c.lerp(bloom, Math.max(0, n(v.x * 8, v.y * 8, v.z * 8) - 0.35) * 0.7);
    // Below the waterline, inside: dark and wet.
    if (Math.hypot(v.x, v.z) < s.radius - s.wall - 0.0005 && v.y < s.water + 0.0005)
      c.lerp(wet, 0.75);
    return c.clone();
  });
  g.translate(s.x, y0, s.z);
  const dish = new THREE.Mesh(
    g,
    lib.get("terracotta-saucer", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.78,
      scale: 0.05,
      relief: 0.05,
      smudge: 0.06,
      wrap: 0.35,
      scatter: 0xa04020,
    }),
  );
  dish.name = "saucer";
  dish.castShadow = dish.receiveShadow = true;
  // Rainwater: dark, still, reflecting the sky; ripples from the wind and from raindrops.
  const uniforms = { uTime: { value: 0 }, uRain: { value: 0 }, uWind: { value: 0.3 } };
  const water = lib.keep(
    withCascade(
      new THREE.MeshStandardMaterial({
        color: 0x1f2a22,
        roughness: 0.035,
        metalness: 0,
        transparent: true,
        opacity: 0.86,
        envMapIntensity: 1.2,
      }),
      (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            /* glsl */ `#include <common>
varying vec3 vWaterPos;
uniform float uTime, uRain, uWind;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec2 waterSlope( vec2 p ) {
  vec2 s = vec2( 0.0 );
  // Wind ruffles: a few travelling waves.
  for ( int i = 0; i < 4; i ++ ) {
    float fi = float( i );
    vec2 dir = normalize( vec2( cos( fi * 2.1 + 0.4 ), sin( fi * 2.1 + 0.4 ) ) );
    float k = 90.0 + 70.0 * fi;
    float ph = dot( p, dir ) * k - uTime * ( 2.0 + fi );
    s += dir * cos( ph ) * k * 0.00002 * uWind;
  }
  // Raindrops: expanding rings at seeded places and times.
  for ( int i = 0; i < 6; i ++ ) {
    float fi = float( i );
    float cycle = uTime * 0.7 + fi * 0.37;
    float id = floor( cycle );
    float age = fract( cycle );
    vec2 c = vec2( wHash( vec2( id, fi ) ), wHash( vec2( fi, id ) ) ) * 0.26 - 0.13;
    vec2 d = p - c;
    float r = length( d );
    float front = age * 0.06;
    float ring = exp( -pow( ( r - front ) / 0.004, 2.0 ) ) * ( 1.0 - age );
    s += normalize( d + 1e-5 ) * ring * 0.25 * uRain;
  }
  return s;
}`,
          )
          .replace(
            "#include <normal_fragment_maps>",
            /* glsl */ `#include <normal_fragment_maps>
{
  vec2 sl = waterSlope( vWaterPos.xz - vec2( ${L.saucer.x.toFixed(4)}, ${L.saucer.z.toFixed(4)} ) );
  vec3 nW = normalize( vec3( -sl.x, 1.0, -sl.y ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
          );
      },
    ),
  ) as Saucer["water"];
  water.userData.uniforms = uniforms;
  // Its edge runs a millimetre into the inner wall, so no gap shows at the rim.
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(s.radius - s.wall + 0.001, 96),
    water,
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(s.x, y0 + s.water, s.z);
  surface.receiveShadow = true;
  surface.renderOrder = 1;
  // A few beads of rain on the rim and the outer wall, clear of the fly's drinking spot.
  const beadMat = lib.keep(
    withCascade(
      new THREE.MeshStandardMaterial({
        color: 0xdfe8e4,
        roughness: 0.02,
        metalness: 0,
        transparent: true,
        opacity: 0.4,
        envMapIntensity: 2,
      }),
    ),
  );
  const beads: THREE.BufferGeometry[] = [];
  const rr = rng(0x5a0e);
  for (const angle of [0.6, 1.3, 2.75, 3.4, 4.6, 5.5]) {
    const onTop = rr() < 0.5;
    const size = 0.0012 + rr() * 0.002;
    const b = blob(size, {
      detail: 3,
      seed: Math.round(angle * 10),
      lumps: 0.04,
      squash: [1, 0.55, 1],
      floor: 0,
    });
    const radius = onTop ? rim : s.radius - 0.001;
    const y = onTop ? y0 + s.height - 0.0001 : y0 + s.height - 0.008 - rr() * 0.012;
    b.translate(s.x + radius * Math.cos(angle), y, s.z + radius * Math.sin(angle));
    beads.push(b);
  }
  const beadMesh = new THREE.Mesh(merge(beads), beadMat);
  beadMesh.renderOrder = 2;
  const group = new THREE.Group();
  group.add(dish, surface, beadMesh);
  return { group, water };
}

// ------------------------------------------------------------- stepping stones

/**
 * Flat slabs of stone set in the path. Each top is level at `stoneTop(i)`
 * over the inner 92 % of its ellipse (where `standingHeight` says a fly
 * stands on it) and rounds over into the gravel beyond.
 */
function stones(lib: ClayLibrary): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const n = noise3(0x5707);
  LAYOUT.stones.forEach((s, i) => {
    const top = stoneTop(i);
    const ground = groundHeight(s.x, s.z);
    const rings = 22,
      seg = 72;
    const positions: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const base = clayColor(
      [0x8f8b82, 0x99928a, 0x8a877e, 0x958d80, 0x8c8a84, 0x9a9488][i]!,
    );
    const lichen = clayColor(0xb0b596),
      rust = clayColor(0xc7954e),
      crevice = clayColor(0x5e5a54);
    const c = new THREE.Color();
    // Ring radii in ellipse units: centre, flat top to 0.92, the rounded edge, then under the gravel.
    const radii: number[] = [];
    for (let k = 0; k <= rings; k++)
      radii.push(k < 16 ? (0.92 * k) / 15 : 0.92 + (0.2 * (k - 15)) / (rings - 15));
    radii[0] = 0;
    for (let k = 0; k <= rings; k++) {
      const u = Math.min(radii[k]!, 1.12);
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        // The outline wanders outward only, so the level top always covers the 0.92 ellipse.
        const out =
          1 + 0.07 * (0.5 + 0.5 * n(Math.cos(a) * 1.7, Math.sin(a) * 1.7, i * 3.1));
        const rr = u <= 0.92 ? u : 0.92 + (u - 0.92) * out;
        const lx = Math.cos(a) * rr * s.rx,
          lz = Math.sin(a) * rr * s.rz;
        const cy = Math.cos(s.yaw),
          sy = Math.sin(s.yaw);
        const x = s.x + lx * cy - lz * sy,
          z = s.z + lx * sy + lz * cy;
        let y = top;
        if (u > 0.92) {
          const e = (u - 0.92) / 0.2;
          y = top - (top - (ground - 0.012)) * Math.pow(e, 1.6);
        }
        positions.push(x, y, z);
        c.copy(base).offsetHSL(0, 0, 0.025 * n(x * 30, z * 30, i));
        const l = n(x * 14 + i, z * 14, 7),
          o = n(x * 22, z * 22 + i, 11);
        if (l > 0.45) c.lerp(lichen, Math.min(1, (l - 0.45) * 4) * 0.8);
        if (o > 0.62) c.lerp(rust, Math.min(1, (o - 0.62) * 5) * 0.7);
        // Only the foot of the slab darkens, where it meets the gravel: a darker
        // rounded edge would read from above as the lip of a hollow.
        if (u > 1.0) c.lerp(crevice, Math.min(1, (u - 1.0) / 0.12) * 0.55);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < rings; k++)
      for (let j = 0; j < seg; j++) {
        const a = k * seg + j,
          b = k * seg + ((j + 1) % seg),
          c2 = (k + 1) * seg + j,
          d = (k + 1) * seg + ((j + 1) % seg);
        // Counter-clockwise seen from above, so the top faces up.
        index.push(a, b, c2, b, d, c2);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    parts.push(weld(g));
  });
  const mesh = new THREE.Mesh(
    merge(parts),
    lib.get("stone", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.78,
      scale: 0.06,
      relief: 0.022,
      smudge: 0.1,
      wrap: 0.25,
    }),
  );
  mesh.name = "stepping stones";
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export interface PropSet {
  group: THREE.Group;
  hero: THREE.Group;
  window: WindowPieces;
  saucer: Saucer;
  dispose(): void;
}

export function buildProps(lib: ClayLibrary, atlas: DecalAtlas, q: Quality): PropSet {
  const group = new THREE.Group();
  group.name = "props";
  const win = windowAndWall(lib);
  const flowers = asters(lib, atlas, q);
  const sc = saucer(lib);
  // At High the grain is fine enough for the macro lens: a texel is a quarter of a millimetre.
  const grain = boardGrain(q.name === "high" ? 512 : q.textureSize >= 1024 ? 256 : 128);
  group.add(
    fence(lib, grain),
    win.group,
    pot(lib),
    flowers.group,
    pear(lib),
    sc.group,
    stones(lib),
  );
  return {
    group,
    hero: flowers.hero,
    window: win,
    saucer: sc,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        // Instanced meshes also hold their per-instance buffers on the GPU.
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      grain.color.dispose();
      grain.relief.dispose();
    },
  };
}
