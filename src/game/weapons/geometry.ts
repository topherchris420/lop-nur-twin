import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Small parametric solids for building firearms.
 *
 * The rule that makes procedural hard-surface read as real: nothing has a
 * perfectly sharp edge. Every real machined or moulded part has a chamfer or
 * a break-edge on the order of a quarter of a millimetre, and at viewmodel
 * distance that chamfer is what catches the light and gives the silhouette its
 * bite. So the primitive here is a *chamfered* box, not a box.
 */

const CHAMFER = 0.0006;

/** Rounded-rectangle path in the XY plane, centred on the origin. */
function roundedRectShape(w: number, h: number, radius: number): THREE.Shape {
  const r = Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4);
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  if (r <= 1e-5) {
    shape.moveTo(x, y);
    shape.lineTo(x + w, y);
    shape.lineTo(x + w, y + h);
    shape.lineTo(x, y + h);
    shape.closePath();
    return shape;
  }
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  shape.closePath();
  return shape;
}

export interface BoxOptions {
  /** Corner radius in the cross-section plane. */
  radius?: number;
  /** Edge break on the extruded ends. */
  chamfer?: number;
  /** Curve subdivision for the rounded corners. */
  curveSegments?: number;
}

/**
 * A box with broken edges, extruded along +Z and centred on the origin.
 * `w` is X, `h` is Y, `d` is Z.
 */
export function chamferedBox(
  w: number,
  h: number,
  d: number,
  options: BoxOptions = {},
): THREE.BufferGeometry {
  const chamfer = Math.min(options.chamfer ?? CHAMFER, w / 4, h / 4, d / 4);
  const radius = options.radius ?? chamfer * 1.5;
  const shape = roundedRectShape(
    w - chamfer * 2,
    h - chamfer * 2,
    Math.max(0, radius - chamfer),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d - chamfer * 2,
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: options.curveSegments ?? 3,
  });
  geometry.translate(0, 0, -(d - chamfer * 2) / 2 - chamfer);
  geometry.computeVertexNormals();
  return geometry;
}

/** A cylinder along Z with broken end edges. */
export function tube(
  radiusTop: number,
  radiusBottom: number,
  length: number,
  segments = 20,
  chamfer = CHAMFER,
): THREE.BufferGeometry {
  const c = Math.min(chamfer, length / 4, radiusTop / 3, radiusBottom / 3);
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    length - c * 2,
    segments,
    1,
    true,
  );
  parts.push(body);
  // Chamfered end caps: a short cone ring plus a small flat disc.
  const capTop = new THREE.CylinderGeometry(
    radiusTop - c,
    radiusTop,
    c,
    segments,
    1,
    true,
  );
  capTop.translate(0, (length - c) / 2, 0);
  parts.push(capTop);
  const discTop = new THREE.CircleGeometry(radiusTop - c, segments);
  discTop.rotateX(-Math.PI / 2);
  discTop.translate(0, length / 2, 0);
  parts.push(discTop);
  const capBottom = new THREE.CylinderGeometry(
    radiusBottom,
    radiusBottom - c,
    c,
    segments,
    1,
    true,
  );
  capBottom.translate(0, -(length - c) / 2, 0);
  parts.push(capBottom);
  const discBottom = new THREE.CircleGeometry(radiusBottom - c, segments);
  discBottom.rotateX(Math.PI / 2);
  discBottom.translate(0, -length / 2, 0);
  parts.push(discBottom);
  const merged = mergeAndDispose(parts);
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();
  return merged;
}

/** An open tube (no caps) along Z — for barrel shrouds and handguards. */
export function shell(
  outer: number,
  inner: number,
  length: number,
  segments = 20,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0004,
    bevelSegments: 1,
    curveSegments: segments,
  });
  geometry.translate(0, 0, -length / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Lathe a profile around the Z axis. `profile` is `[radius, z]` pairs ordered
 * from the back of the part to the front — this is how suppressors, muzzle
 * devices and optic bodies get their stepped, turned look.
 */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments = 24,
): THREE.BufferGeometry {
  const points = profile.map(([r, z]) => new THREE.Vector2(Math.max(1e-5, r), z));
  const geometry = new THREE.LatheGeometry(points, segments);
  // LatheGeometry revolves around Y; the weapon axis is Z.
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A MIL-STD-1913 rail: a base with a chamfered top and recoil slots cut into
 * it at 10 mm pitch. Built as ribs rather than CSG so it stays cheap.
 */
export function picatinnyRail(
  length: number,
  width = 0.0212,
  height = 0.0085,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const baseHeight = height * 0.45;
  const base = chamferedBox(width * 0.86, baseHeight, length, { chamfer: 0.0004 });
  base.translate(0, baseHeight / 2, 0);
  parts.push(base);

  const pitch = 0.0102;
  const ribDepth = 0.0056;
  const count = Math.max(1, Math.floor(length / pitch));
  const start = -length / 2 + (length - (count - 1) * pitch) / 2;
  for (let i = 0; i < count; i += 1) {
    // The classic trapezoid cross-section: 45° flanks the ring clamps onto.
    const rib = new THREE.BufferGeometry();
    const top = width / 2 - height * 0.42;
    const bottom = width / 2;
    const y0 = baseHeight;
    const y1 = height;
    const hz = ribDepth / 2;
    const verts = new Float32Array([
      -bottom,
      y0,
      -hz,
      bottom,
      y0,
      -hz,
      top,
      y1,
      -hz,
      -top,
      y1,
      -hz,
      -bottom,
      y0,
      hz,
      bottom,
      y0,
      hz,
      top,
      y1,
      hz,
      -top,
      y1,
      hz,
    ]);
    const idx = [
      0,
      1,
      2,
      0,
      2,
      3, // back
      5,
      4,
      7,
      5,
      7,
      6, // front
      4,
      5,
      1,
      4,
      1,
      0, // bottom
      3,
      2,
      6,
      3,
      6,
      7, // top
      4,
      0,
      3,
      4,
      3,
      7, // left
      1,
      5,
      6,
      1,
      6,
      2, // right
    ];
    rib.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    rib.setIndex(idx);
    rib.computeVertexNormals();
    rib.translate(0, 0, start + i * pitch);
    parts.push(rib);
  }
  return mergeAndDispose(parts);
}

/**
 * M-LOK style negative space: a row of rounded slots along a handguard face.
 * Modelled as recessed plates so we get the read without boolean geometry.
 */
export function mlokSlots(
  count: number,
  spacing: number,
  slotLength = 0.032,
  slotWidth = 0.0072,
  depth = 0.0016,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const start = (-(count - 1) * spacing) / 2;
  for (let i = 0; i < count; i += 1) {
    const slot = chamferedBox(slotWidth, depth, slotLength, {
      radius: slotWidth / 2,
      chamfer: 0.0003,
      curveSegments: 4,
    });
    slot.translate(0, 0, start + i * spacing);
    parts.push(slot);
  }
  return mergeAndDispose(parts);
}

/** Longitudinal cooling/lightening flutes cut around a barrel or handguard. */
export function flutes(
  count: number,
  radius: number,
  length: number,
  width = 0.004,
  depth = 0.0012,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const flute = chamferedBox(width, depth * 2, length, {
      radius: width / 2,
      chamfer: 0.0003,
      curveSegments: 3,
    });
    flute.rotateZ(-angle);
    flute.translate(
      Math.sin(angle) * (radius - depth),
      Math.cos(angle) * (radius - depth),
      0,
    );
    parts.push(flute);
  }
  return mergeAndDispose(parts);
}

/** A ring of ports around a muzzle device, e.g. a compensator's gas holes. */
export function portRing(
  count: number,
  radius: number,
  portRadius: number,
  depth: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const port = tube(portRadius, portRadius, depth, 8, 0.0002);
    port.rotateX(Math.PI / 2);
    port.rotateZ(-angle);
    port.translate(Math.sin(angle) * radius, Math.cos(angle) * radius, 0);
    parts.push(port);
  }
  return mergeAndDispose(parts);
}

/**
 * A curved box-magazine body. `curve` is the radius of the arc the magazine
 * follows; a 5.56 mag is roughly 0.36 m, a 7.62 mag much tighter.
 */
export function curvedMagazine(
  width: number,
  depth: number,
  length: number,
  curveRadius: number,
  segments = 8,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segLength = length / segments;
  const totalAngle = length / curveRadius;
  for (let i = 0; i < segments; i += 1) {
    const t = (i + 0.5) / segments;
    const angle = (t - 0.5) * totalAngle;
    // Taper slightly toward the floorplate, as a real double-stack does.
    const taper = 1 - t * 0.06;
    const seg = chamferedBox(width * taper, segLength * 1.06, depth * taper, {
      radius: 0.0016,
      chamfer: 0.0004,
      curveSegments: 3,
    });
    seg.rotateX(Math.PI / 2);
    seg.rotateX(angle);
    seg.translate(
      0,
      -curveRadius + Math.cos(angle) * curveRadius,
      Math.sin(angle) * curveRadius,
    );
    seg.translate(0, -(length / 2) * 0 - 0, 0);
    parts.push(seg);
  }
  const merged = mergeAndDispose(parts);
  // Orient down the -Y axis: magazines hang below the magwell.
  merged.rotateX(-Math.PI / 2);
  merged.computeVertexNormals();
  return merged;
}

/**
 * Bring a geometry into the one layout `mergeGeometries` can combine:
 * non-indexed, with exactly `position`, `normal` and `uv`.
 *
 * The primitives here come from four different generators — `ExtrudeGeometry`
 * is non-indexed, `CylinderGeometry` and `LatheGeometry` are indexed, and the
 * hand-built rail ribs have no UVs at all — and a merge fails outright on any
 * of those mismatches. Normalising once, here, is what keeps every call site
 * free to use whichever primitive fits the part.
 */
export function normalizeForMerge(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let result = geometry;
  if (result.getIndex()) {
    const expanded = result.toNonIndexed();
    result.dispose();
    result = expanded;
  }
  if (!result.getAttribute("normal")) result.computeVertexNormals();
  if (!result.getAttribute("uv")) {
    const count = result.getAttribute("position").count;
    result.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const name of Object.keys(result.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") {
      result.deleteAttribute(name);
    }
  }
  return result;
}

/** Merge a list of geometries and dispose the sources. */
export function mergeAndDispose(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry();
  const normalized = parts.map(normalizeForMerge);
  if (normalized.length === 1) return normalized[0]!;
  const merged = mergeGeometries(normalized, false);
  if (!merged) {
    // Should be unreachable after normalising, but never crash a weapon build.
    for (let i = 1; i < normalized.length; i += 1) normalized[i]!.dispose();
    return normalized[0]!;
  }
  for (const p of normalized) p.dispose();
  return merged;
}

/** Convenience: transform a geometry then return it. */
export function place(
  geometry: THREE.BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  if (rx) geometry.rotateX(rx);
  if (ry) geometry.rotateY(ry);
  if (rz) geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  return geometry;
}

/** Mirror a geometry across X, for the left/right halves of a part. */
export function mirrorX(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const clone = geometry.clone();
  clone.scale(-1, 1, 1);
  const index = clone.getIndex();
  if (index) {
    const array = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < array.length; i += 3) {
      const tmp = array[i]!;
      array[i] = array[i + 2]!;
      array[i + 2] = tmp;
    }
    index.needsUpdate = true;
  }
  clone.computeVertexNormals();
  return clone;
}
