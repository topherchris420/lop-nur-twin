import * as THREE from "three";
import { creaseNormals, profileShape } from "./geometry";

/**
 * Machined receiver parts: extruded sections with rounded ends, a free-float
 * handguard whose M-LOK slots are real holes, and engraved markings.
 *
 * Everything the eye takes as "machined" on a rifle comes down to three
 * things a box cannot give: every edge is rounded and catches a line of
 * light, recesses have walls that fall into shadow, and the surfaces carry
 * small print. The first comes from `creaseNormals` on bevelled extrusions,
 * the second from building recesses out of real geometry — a groove is a
 * gap between two extrusions, a slot is a hole through a plate with a dark
 * liner behind it — and the third from one engraved-markings atlas.
 */

/** A section in the XY plane from `[x, y, filletRadius]` corners. */
export function section(points: readonly (readonly [number, number, number?])[]): THREE.Shape {
  // `profileShape` reads `[z, y]` and maps z to -x; feed it -x to get x.
  return profileShape(points.map(([x, y, r]) => [-x, y, r] as const));
}

/**
 * Extrude an XY section along Z, centred on the origin, with rounded ends:
 * `bevel` metres of edge break in `segments` steps, so the end faces turn
 * into the sides through a smooth highlight rather than a hard corner.
 */
export function extrudeSection(
  shape: THREE.Shape,
  length: number,
  bevel = 0.0012,
  segments = 3,
  curveSegments = 4,
): THREE.BufferGeometry {
  const b = Math.min(bevel, length / 4);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, length - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b * 0.9,
    bevelOffset: -b * 0.9,
    bevelSegments: segments,
    curveSegments,
  });
  geometry.translate(0, 0, -(length - b * 2) / 2);
  return creaseNormals(geometry);
}

/** A rounded-rectangle hole in a plate's own XY plane. */
function slotPath(cx: number, cy: number, length: number, width: number): THREE.Path {
  const r = width / 2 - 1e-5;
  const hx = length / 2 - r;
  const path = new THREE.Path();
  path.moveTo(cx - hx, cy - r);
  path.lineTo(cx + hx, cy - r);
  path.absarc(cx + hx, cy, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(cx - hx, cy + r);
  path.absarc(cx - hx, cy, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  return path;
}

export interface HandguardSpec {
  length: number;
  /** Centre to flat, the same on all eight faces. */
  apothem: number;
  /** Wall thickness. */
  wall: number;
  slotLength: number;
  slotWidth: number;
  /** Centre-to-centre slot spacing along the rail. */
  slotPitch: number;
  /** Small round lightening holes along the 45 degree flats. */
  ventRadius: number;
}

export interface HandguardGeometry {
  /** The eight walls, with slots through them. */
  shell: THREE.BufferGeometry;
  /** A dark sleeve inside, which is what the slots show. */
  liner: THREE.BufferGeometry;
  /** End rings that close the octagon. */
  caps: THREE.BufferGeometry;
}

/**
 * A free-float M-LOK handguard: a regular octagon of plates along Z, centred
 * on the origin. The side and bottom plates carry rows of slots cut clean
 * through, with rounded walls; the 45 degree flats carry a row of round
 * lightening holes; the top flat is left for the rail. Inside sits a liner
 * a few millimetres in, so a slot reads as a hole with a lit rim and a dark
 * floor — a dark rectangle drawn on a surface was the thing that gave the
 * old handguard away.
 */
export function octagonHandguard(spec: HandguardSpec): HandguardGeometry {
  const { length, apothem: a, wall } = spec;
  const face = 2 * a * Math.tan(Math.PI / 8);
  const plates: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const theta = (i * Math.PI) / 4;
    const kind = i === 2 ? "top" : i % 2 === 0 ? "slots" : "vents";
    // Plate in its own frame: x along the handguard, y across the face,
    // extruded along +z through the wall.
    const width = face + wall * 0.85;
    const shape = new THREE.Shape();
    shape.moveTo(-length / 2, -width / 2);
    shape.lineTo(length / 2, -width / 2);
    shape.lineTo(length / 2, width / 2);
    shape.lineTo(-length / 2, width / 2);
    shape.closePath();
    if (kind === "slots") {
      const count = Math.max(1, Math.floor((length - 0.03) / spec.slotPitch));
      const start = (-(count - 1) * spec.slotPitch) / 2;
      for (let s = 0; s < count; s += 1) {
        shape.holes.push(
          slotPath(start + s * spec.slotPitch, 0, spec.slotLength, spec.slotWidth),
        );
      }
    } else if (kind === "vents") {
      const pitch = spec.slotPitch / 2;
      const count = Math.max(1, Math.floor((length - 0.03) / pitch));
      const start = (-(count - 1) * pitch) / 2;
      for (let s = 0; s < count; s += 1) {
        const hole = new THREE.Path();
        hole.absarc(start + s * pitch, 0, spec.ventRadius, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
    const bevel = Math.min(0.0005, wall * 0.3);
    const plate = new THREE.ExtrudeGeometry(shape, {
      depth: wall - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.9,
      bevelOffset: -bevel * 0.9,
      bevelSegments: 2,
      curveSegments: 5,
    });
    // Outer face at the apothem, then the plate's +z turned to face out.
    plate.translate(0, 0, a - wall + bevel);
    plate.rotateY(Math.PI / 2);
    plate.rotateZ(theta);
    plates.push(creaseNormals(plate));
  }

  const octagon = (apothem: number): THREE.Shape => {
    const r = apothem / Math.cos(Math.PI / 8);
    const shape = new THREE.Shape();
    for (let i = 0; i < 8; i += 1) {
      const t = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) shape.moveTo(Math.cos(t) * r, Math.sin(t) * r);
      else shape.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    }
    shape.closePath();
    return shape;
  };

  const liner = extrudeSection(octagon(a - wall - 0.0016), length - 0.006, 0.0004, 1, 1);

  const ringShape = octagon(a);
  const bore = new THREE.Path();
  bore.absarc(0, 0, a * 0.42, 0, Math.PI * 2, true);
  ringShape.holes.push(bore);
  const front = extrudeSection(ringShape, 0.004, 0.0007, 2, 12);
  front.translate(0, 0, -length / 2 + 0.002);
  const rear = extrudeSection(octagon(a), 0.004, 0.0007, 2, 1);
  rear.translate(0, 0, length / 2 - 0.002);

  return {
    shell: mergeOwned(plates),
    liner,
    caps: mergeOwned([front, rear]),
  };
}

function mergeOwned(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // The caller merges by material through the assembler, which normalises
  // attributes; here only the plates of one part are concatenated.
  const positions: number[] = [];
  const normals: number[] = [];
  for (const part of parts) {
    const g = part.getIndex() ? part.toNonIndexed() : part;
    positions.push(...(g.getAttribute("position").array as Float32Array));
    normals.push(...(g.getAttribute("normal").array as Float32Array));
    if (g !== part) g.dispose();
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

/* ------------------------------------------------------------------ */
/* Markings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Atlas regions, in UV (0..1, v up). Each is one engraving: the receiver's
 * calibre and model line, a serial, and the selector's three positions.
 */
export const MARKINGS = {
  model: [0, 0.75, 1, 1],
  serial: [0, 0.5, 1, 0.75],
  selector: [0, 0, 0.25, 0.5],
  rail: [0.25, 0, 1, 0.25],
} as const satisfies Record<string, readonly [number, number, number, number]>;

let markingsTexture: THREE.Texture | null = null;

/**
 * The engraving atlas: paint-filled roll marks, drawn once. Text is a
 * canvas fill in the browser's own sans-serif; under test there is no canvas
 * and the decals simply have nothing to show.
 */
export function getMarkingsTexture(): THREE.Texture {
  if (markingsTexture) return markingsTexture;
  if (typeof document === "undefined") {
    const data = new Uint8Array([0, 0, 0, 0]);
    const blank = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    blank.needsUpdate = true;
    markingsTexture = blank;
    return blank;
  }
  const w = 1024;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.textBaseline = "middle";
  // Region rows: model (top quarter), serial (second quarter).
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("MOD. 141  CAL 5.56x45", 18, h * 0.125);
  ctx.font = "34px sans-serif";
  ctx.fillText("SER. 0417-2231   BLACKSITE ARMS", 18, h * 0.375);
  // Selector: three positions round a hub, in the lower-left square.
  const cx = 128;
  const cy = h * 0.75;
  ctx.textAlign = "center";
  ctx.font = "bold 26px sans-serif";
  const labels: [string, number][] = [
    ["SAFE", -2.4],
    ["SEMI", -1.57],
    ["AUTO", -0.75],
  ];
  for (const [label, angle] of labels) {
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 40);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, -2.6, -0.55);
  ctx.stroke();
  // Rail position numbers along the bottom strip.
  ctx.font = "bold 30px sans-serif";
  for (let i = 0; i < 12; i += 1) {
    ctx.fillText(`${i + 1}`, 256 + 32 + i * 62, h - 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  markingsTexture = texture;
  return texture;
}

/**
 * A flat decal quad showing one atlas region, `width` x `height` metres,
 * facing -X (the weapon's left side) with its text running toward the butt.
 */
export function leftDecal(
  region: readonly [number, number, number, number],
  width: number,
  height: number,
): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(width, height);
  const uv = plane.getAttribute("uv");
  const [u0, v0, u1, v1] = region;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  plane.rotateY(-Math.PI / 2);
  return plane;
}
