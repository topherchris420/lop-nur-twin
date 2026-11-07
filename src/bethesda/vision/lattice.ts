/**
 * The research compound eye's geometry: two hexagonal ommatidial lattices
 * and the looming units that tile them. Static, computed once.
 *
 * Each eye is centred on the axis of FlyBody's eye camera, as the fly's own
 * senses use it (`EYES` in `fly/senses.ts`: about ±67° azimuth, 5° elevation,
 * 150° wide). Its ommatidia lie on a hexagonal lattice in that eye's Lambert
 * azimuthal equal-area projection, so they cover the sphere at an even
 * density whose spacing is the fly's inter-ommatidial angle (4.6°): about
 * 830 per eye, the order of the 700–800 of a real Drosophila eye. Directions
 * are in the fly's level, heading-aligned frame (x forward, y left, z up), as
 * if the head stabilized gaze, which is how the fly's senses treat vision.
 *
 * Simplifications, each a model choice: the lattice is regular and both eyes
 * mirror each other; the projection compresses spacing radially and
 * stretches it tangentially toward the edge of each eye (by up to 21% at the
 * rim); the binocular overlap in front is the overlap of the two cones.
 */
import { EYES } from "../fly/senses.js";
import { degToRad } from "../fly/units.js";
import { VISION_PARAMS } from "./params.js";

/** Unit directions of the three lattice axes in an eye's plane: 0°, 60° and 120°. */
export const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, Math.sqrt(3) / 2],
  [-0.5, Math.sqrt(3) / 2],
];

export interface EyeLattice {
  /** How many ommatidia, both eyes. */
  n: number;
  /** Which eye (0 right, 1 left) each ommatidium belongs to. */
  eye: Uint8Array;
  /** Plane coordinates (rad-equivalent) in its eye's projection. */
  x: Float64Array;
  y: Float64Array;
  /** Unit direction in the fly's level frame: forward, left, up. */
  dx: Float64Array;
  dy: Float64Array;
  dz: Float64Array;
  /** Azimuth (+ left) and elevation (rad) of each ommatidium. */
  azimuth: Float64Array;
  elevation: Float64Array;
  /** Neighbour along each lattice axis (+AXES[k]), or −1: `neighbour[3 i + k]`. */
  neighbour: Int32Array;
  /** The plane direction of increasing azimuth at each ommatidium (unit vector, 2 per). */
  azimuthTangent: Float64Array;
  /** First ommatidium of each eye: [0, n0, n]. */
  eyeStart: [number, number, number];
}

export interface LoomingUnits {
  n: number;
  eye: Uint8Array;
  /** Centre azimuth and elevation (rad) in the fly's level frame. */
  azimuth: Float64Array;
  elevation: Float64Array;
  /** CSR members: ommatidium index, weight, and branch (0 +x, 1 +y, 2 −x, 3 −y). */
  start: Int32Array;
  member: Int32Array;
  weight: Float64Array;
  branch: Uint8Array;
}

interface Basis {
  a: [number, number, number];
  h: [number, number, number];
  v: [number, number, number];
}

function basis(az: number, el: number): Basis {
  return {
    a: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
    h: [-Math.sin(az), Math.cos(az), 0],
    v: [-Math.sin(el) * Math.cos(az), -Math.sin(el) * Math.sin(az), Math.cos(el)],
  };
}

/** A plane point (Lambert azimuthal equal-area about the axis) as a unit direction. */
export function planeToDirection(
  b: Basis,
  x: number,
  y: number,
): [number, number, number] {
  const r = Math.hypot(x, y);
  if (r === 0) return [b.a[0], b.a[1], b.a[2]];
  const rho = 2 * Math.asin(Math.min(1, r / 2));
  const c = Math.cos(rho),
    s = Math.sin(rho) / r;
  return [
    c * b.a[0] + s * (x * b.h[0] + y * b.v[0]),
    c * b.a[1] + s * (x * b.h[1] + y * b.v[1]),
    c * b.a[2] + s * (x * b.h[2] + y * b.v[2]),
  ];
}

/** A unit direction as a plane point of the eye whose basis is `b`. */
export function directionToPlane(
  b: Basis,
  d: [number, number, number],
): [number, number] {
  const ca = d[0] * b.a[0] + d[1] * b.a[1] + d[2] * b.a[2];
  const ph = d[0] * b.h[0] + d[1] * b.h[1] + d[2] * b.h[2];
  const pv = d[0] * b.v[0] + d[1] * b.v[1] + d[2] * b.v[2];
  const rho = Math.acos(Math.max(-1, Math.min(1, ca)));
  const t = Math.hypot(ph, pv);
  if (t < 1e-15) return [0, 0];
  const r = 2 * Math.sin(rho / 2);
  return [(r * ph) / t, (r * pv) / t];
}

/** The least weight a looming unit's emptiest branch may hold, as a share of its fullest. */
const MIN_BRANCH_SHARE = 0.1;

const EYE_BASES: readonly Basis[] = EYES.map((e) => basis(e.azimuth, e.elevation));

function build(): { lattice: EyeLattice; units: LoomingUnits } {
  const spacing = degToRad(VISION_PARAMS.interommatidialDeg.value);
  const half = degToRad(VISION_PARAMS.eyeFovDeg.value / 2);
  const rMax = 2 * Math.sin(half / 2);
  const reach = Math.ceil(rMax / spacing) + 2;
  const eye: number[] = [],
    xs: number[] = [],
    ys: number[] = [],
    keys: Map<string, number>[] = [];
  const axial: [number, number][] = [];
  const eyeStart: [number, number, number] = [0, 0, 0];
  EYE_BASES.forEach((_, e) => {
    const map = new Map<string, number>();
    keys.push(map);
    if (e === 1) eyeStart[1] = xs.length;
    for (let r = -reach; r <= reach; r++)
      for (let q = -2 * reach; q <= 2 * reach; q++) {
        const x = spacing * (q + r / 2),
          y = spacing * (Math.sqrt(3) / 2) * r;
        if (Math.hypot(x, y) > rMax) continue;
        map.set(`${q},${r}`, xs.length);
        eye.push(e);
        xs.push(x);
        ys.push(y);
        axial.push([q, r]);
      }
  });
  const n = xs.length;
  eyeStart[2] = n;
  const L: EyeLattice = {
    n,
    eye: Uint8Array.from(eye),
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    dx: new Float64Array(n),
    dy: new Float64Array(n),
    dz: new Float64Array(n),
    azimuth: new Float64Array(n),
    elevation: new Float64Array(n),
    neighbour: new Int32Array(3 * n).fill(-1),
    azimuthTangent: new Float64Array(2 * n),
    eyeStart,
  };
  const STEPS: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 1],
  ];
  for (let i = 0; i < n; i++) {
    const b = EYE_BASES[L.eye[i]!]!;
    const d = planeToDirection(b, L.x[i]!, L.y[i]!);
    L.dx[i] = d[0];
    L.dy[i] = d[1];
    L.dz[i] = d[2];
    const az = Math.atan2(d[1], d[0]),
      el = Math.asin(Math.max(-1, Math.min(1, d[2])));
    L.azimuth[i] = az;
    L.elevation[i] = el;
    const [q, r] = axial[i]!;
    STEPS.forEach(([dq, dr], k) => {
      const j = keys[L.eye[i]!]!.get(`${q + dq},${r + dr}`);
      if (j !== undefined) L.neighbour[3 * i + k] = j;
    });
    // Increasing azimuth at this ommatidium, in its eye's plane (numerically).
    const da = 1e-4;
    const ce = Math.cos(el);
    const p2 = directionToPlane(b, [
      ce * Math.cos(az + da),
      ce * Math.sin(az + da),
      Math.sin(el),
    ]);
    const tx = p2[0] - L.x[i]!,
      ty = p2[1] - L.y[i]!;
    const tn = Math.hypot(tx, ty) || 1;
    L.azimuthTangent[2 * i] = tx / tn;
    L.azimuthTangent[2 * i + 1] = ty / tn;
  }

  // Looming units: centres on a coarser hexagonal lattice in each eye's plane.
  const uSpacing = degToRad(VISION_PARAMS.lplc2SpacingDeg.value);
  const sigma = degToRad(VISION_PARAMS.lplc2SigmaDeg.value);
  const cut = 2.5 * sigma;
  const uEye: number[] = [],
    uAz: number[] = [],
    uEl: number[] = [],
    start: number[] = [0],
    member: number[] = [],
    weight: number[] = [],
    branch: number[] = [];
  const uReach = Math.ceil(rMax / uSpacing) + 2;
  EYE_BASES.forEach((b, e) => {
    for (let r = -uReach; r <= uReach; r++)
      for (let q = -2 * uReach; q <= 2 * uReach; q++) {
        const cx = uSpacing * (q + r / 2),
          cy = uSpacing * (Math.sqrt(3) / 2) * r;
        if (Math.hypot(cx, cy) > rMax) continue;
        const mine: [number, number, number][] = [];
        const sums = [0, 0, 0, 0];
        for (let i = eyeStart[e]!; i < eyeStart[e + 1]!; i++) {
          const ox = L.x[i]! - cx,
            oy = L.y[i]! - cy;
          const dist = Math.hypot(ox, oy);
          if (dist > cut || dist < 1e-9) continue;
          const w = Math.exp(-(dist * dist) / (2 * sigma * sigma));
          // The branch whose cardinal direction is nearest the ommatidium's offset.
          const b = ((Math.round(Math.atan2(oy, ox) / (Math.PI / 2)) % 4) + 4) % 4;
          mine.push([i, w, b]);
          sums[b]! += w;
        }
        // A unit whose field the eye's edge cuts so that a branch holds under a
        // tenth of the fullest one's weight could barely ever see outward
        // motion on all four sides: it is not built (a model choice).
        if (Math.min(...sums) < MIN_BRANCH_SHARE * Math.max(...sums)) continue;
        for (const [i, w, b] of mine) {
          member.push(i);
          weight.push(w);
          branch.push(b);
        }
        start.push(member.length);
        const d = planeToDirection(b, cx, cy);
        uEye.push(e);
        uAz.push(Math.atan2(d[1], d[0]));
        uEl.push(Math.asin(Math.max(-1, Math.min(1, d[2]))));
      }
  });
  const U: LoomingUnits = {
    n: uEye.length,
    eye: Uint8Array.from(uEye),
    azimuth: Float64Array.from(uAz),
    elevation: Float64Array.from(uEl),
    start: Int32Array.from(start),
    member: Int32Array.from(member),
    weight: Float64Array.from(weight),
    branch: Uint8Array.from(branch),
  };
  return { lattice: L, units: U };
}

const BUILT = build();
/** Both eyes' ommatidia. */
export const LATTICE: EyeLattice = BUILT.lattice;
/** The looming units tiling both eyes. */
export const LOOMING_UNITS: LoomingUnits = BUILT.units;
/** Cardinal direction of each looming-unit branch in its eye's plane. */
export const BRANCH_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
