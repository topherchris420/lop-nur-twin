import * as THREE from "three";
import {
  blend,
  ellipsoid,
  fieldOcclusion,
  frameFrom,
  roundBox,
  roundCone,
  smax,
  smin,
  surfaceNets,
  toParent,
  union,
  v3,
  type Field,
  type Frame,
  type V3,
} from "./sdf";

/**
 * First-person arms: gloved hands that actually close on the weapon.
 *
 * The rifle is the most-looked-at object in the game and the hands are what
 * tell the eye it is held. Two things made the earlier arms read as wrong
 * before anyone could say why: they were assembled from tubes and balls, so
 * every joint was a bead, and their curl was authored by hand, so fingers sat
 * in the polymer or a centimetre off it.
 *
 * Here each hand is one signed distance field — palm, metacarpals, thenar
 * pad, finger segments, knuckle armour and cuff blended with a smooth minimum
 * — meshed once with surface nets. The fingers are *solved*, not posed: every
 * joint closes about its flexion axis until its segment meets the weapon's
 * own contact shape, so the grasp follows whatever grip or handguard the
 * weapon builder describes. The weapon is then carved out of the hand, which
 * is what flattens a palm against a grip instead of letting it pass through,
 * and the same weapon field darkens the glove where the two touch.
 *
 * Hands are rigid children of the weapon. In a first-person view the hands
 * never move relative to the gun, so recoil, sway, aim and reload come free
 * and an elbow pop is impossible. The sleeves run back past the near plane
 * and are never seen to end.
 */

/* ------------------------------------------------------------------ */
/* What a weapon tells the arms                                        */
/* ------------------------------------------------------------------ */

/** A solid the hands collide with, in weapon space. */
export type ContactSolid =
  | { kind: "box"; center: V3; half: V3; radius: number; pitch?: number }
  | { kind: "tube"; center: V3; radius: number; halfLength: number };

export interface HandPlacement {
  /** Where the centre of the palm's contact surface sits, weapon space. */
  palm: V3;
  /** Direction the palm faces (toward the thing it holds). */
  facing: V3;
  /** Direction the index finger lies from the little finger. */
  indexSide: V3;
  /** Direction from the wrist to the elbow. */
  forearm: V3;
  /** Direction the thumb metacarpal points. */
  thumb: V3;
  /** Optional point the index fingertip reaches for (a trigger). */
  trigger?: V3;
  /**
   * Close over the firing hand as well as the weapon — a two-handed pistol
   * grip, where the support fingers wrap the firing fingers.
   */
  cup?: boolean;
}

export interface GraspSpec {
  /** Everything the firing hand touches or shadows. */
  contact: readonly ContactSolid[];
  right: HandPlacement;
  /** Null for one-handed weapons. */
  left: HandPlacement | null;
}

export interface ArmsModel {
  /** Parent these directly under the weapon root; they are in weapon space. */
  right: THREE.Group;
  left: THREE.Group | null;
  triangleCount: number;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */

/** sRGB hex to the linear triple vertex colours are stored in. */
function linear(hex: number): V3 {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

// Coyote nylon back, darker synthetic leather palm, charcoal rubber armour.
// Desaturated on purpose: a saturated glove under the desert key reads as a toy.
const GLOVE = linear(0x8a7658);
const LEATHER = linear(0x5b4d3e);
const ARMOR = linear(0x4a443d);
const STRAP = linear(0x4a4239);
const STITCH = linear(0xa39478);

/* ------------------------------------------------------------------ */
/* Contact field                                                       */
/* ------------------------------------------------------------------ */

function solidField(s: ContactSolid): Field {
  if (s.kind === "tube") {
    const [cx, cy, cz] = s.center;
    const r = s.radius;
    const h = s.halfLength;
    const f: Field = (x, y, z) => {
      const dr = Math.hypot(x - cx, y - cy) - r;
      const dz = Math.abs(z - cz) - h;
      return Math.min(Math.max(dr, dz), 0) + Math.hypot(Math.max(dr, 0), Math.max(dz, 0));
    };
    f.bound = { c: s.center, r: Math.hypot(r, h) };
    return f;
  }
  const pitch = s.pitch ?? 0;
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  // Same convention as `place(..., rx)`: rotate about +X by `pitch`.
  const frame: Frame = {
    o: s.center,
    x: [1, 0, 0],
    y: [0, c, sn],
    z: [0, -sn, c],
  };
  return roundBox(frame, s.half[0], s.half[1], s.half[2], s.radius);
}

/* ------------------------------------------------------------------ */
/* Hand skeleton                                                       */
/* ------------------------------------------------------------------ */

/**
 * Right hand, local frame: +x toward the little finger, +y distal (wrist to
 * knuckles), +z dorsal. The left hand is this model mirrored in x. Joint
 * centres, segment lengths and radii are a large adult hand plus ~1 mm of
 * glove.
 */
interface FingerDef {
  mcp: V3;
  dir: V3;
  lengths: readonly [number, number, number];
  radii: readonly [number, number, number, number];
  /** Rest flexion per joint, radians. */
  rest: readonly [number, number, number];
}

const FINGERS: readonly FingerDef[] = [
  {
    mcp: [-0.0285, 0.089, 0.0015],
    dir: [-0.07, 1, 0],
    lengths: [0.043, 0.026, 0.022],
    radii: [0.0104, 0.0097, 0.0089, 0.0081],
    rest: [0.12, 0.2, 0.12],
  },
  {
    mcp: [-0.0085, 0.0935, 0.0025],
    dir: [0, 1, 0],
    lengths: [0.047, 0.029, 0.023],
    radii: [0.0107, 0.01, 0.0091, 0.0083],
    rest: [0.14, 0.22, 0.14],
  },
  {
    mcp: [0.0115, 0.0895, 0.0015],
    dir: [0.07, 1, 0],
    lengths: [0.044, 0.028, 0.022],
    radii: [0.0101, 0.0095, 0.0087, 0.0079],
    rest: [0.16, 0.25, 0.16],
  },
  {
    mcp: [0.0295, 0.0795, -0.0005],
    dir: [0.16, 1, 0],
    lengths: [0.035, 0.021, 0.019],
    radii: [0.0091, 0.0085, 0.0078, 0.0071],
    rest: [0.2, 0.3, 0.2],
  },
];

const THUMB_CMC: V3 = [-0.023, 0.021, -0.009];
const THUMB_LENGTHS = [0.045, 0.033, 0.027] as const;
const THUMB_RADII = [0.0132, 0.0121, 0.0111, 0.0097] as const;

/** A finger or thumb segment after solving, in weapon space. */
interface Segment {
  a: V3;
  b: V3;
  ra: number;
  rb: number;
  /** Unit dorsal direction for this segment (for pads and the palmar test). */
  dorsal: V3;
  /** 0 proximal, 1 middle, 2 distal. */
  index: number;
  thumb: boolean;
}

interface SolvedHand {
  frame: Frame;
  mirror: number;
  segments: Segment[];
  wrist: V3;
  forearm: V3;
}

function localToWorld(frame: Frame, mirror: number, p: V3): V3 {
  return toParent(frame, p[0] * mirror, p[1], p[2]);
}

function dirToWorld(frame: Frame, mirror: number, d: V3): V3 {
  return v3.normalize([
    frame.x[0] * d[0] * mirror + frame.y[0] * d[1] + frame.z[0] * d[2],
    frame.x[1] * d[0] * mirror + frame.y[1] * d[1] + frame.z[1] * d[2],
    frame.x[2] * d[0] * mirror + frame.y[2] * d[1] + frame.z[2] * d[2],
  ]);
}

/** Minimum clearance of a tapered segment against the contact field. */
function segmentClearance(
  contact: Field,
  a: V3,
  b: V3,
  ra: number,
  rb: number,
  from = 0.25,
): number {
  let worst = Infinity;
  for (let i = 0; i <= 6; i += 1) {
    const t = from + ((1 - from) * i) / 6;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const d = contact(x, y, z) - (ra + (rb - ra) * t);
    if (d < worst) worst = d;
  }
  return worst;
}

const CLEARANCE = 0.0004;
const STEP = 0.02;

/**
 * Close one chain joint by joint. Each joint turns about `axis` from its
 * rest angle until its own segment would enter the weapon, then locks and
 * hands over to the next. A segment that never meets anything stops at its
 * joint limit, which is what an unsupported fingertip does.
 */
function closeChain(
  contact: Field,
  base: V3,
  dir: V3,
  axis: V3,
  lengths: readonly number[],
  radii: readonly number[],
  rest: readonly number[],
  limits: readonly number[],
): number[] {
  const angles = rest.slice();
  for (let j = 0; j < lengths.length; j += 1) {
    const start = pointAlong(base, dir, axis, lengths, angles, j);
    let best = angles[j]!;
    for (let a = rest[j]!; a <= limits[j]!; a += STEP) {
      angles[j] = a;
      const d = v3.rotate(dir, axis, sumTo(angles, j));
      const end = v3.add(start, v3.scale(d, lengths[j]!));
      const clear = segmentClearance(
        contact,
        start,
        end,
        radii[j]!,
        radii[j + 1]!,
        j === 0 ? 0.35 : 0.1,
      );
      if (clear < CLEARANCE) break;
      best = a;
    }
    angles[j] = best;
  }
  return angles;
}

function sumTo(angles: readonly number[], j: number): number {
  let s = 0;
  for (let i = 0; i <= j; i += 1) s += angles[i]!;
  return s;
}

/** Joint `j`'s position in a planar chain. */
function pointAlong(
  base: V3,
  dir: V3,
  axis: V3,
  lengths: readonly number[],
  angles: readonly number[],
  j: number,
): V3 {
  let p = base;
  for (let i = 0; i < j; i += 1) {
    const d = v3.rotate(dir, axis, sumTo(angles, i));
    p = v3.add(p, v3.scale(d, lengths[i]!));
  }
  return p;
}

function chainSegments(
  base: V3,
  dir: V3,
  axis: V3,
  dorsal0: V3,
  lengths: readonly number[],
  radii: readonly number[],
  angles: readonly number[],
  thumb: boolean,
): Segment[] {
  const out: Segment[] = [];
  let p = base;
  for (let i = 0; i < lengths.length; i += 1) {
    const turn = sumTo(angles, i);
    const d = v3.rotate(dir, axis, turn);
    const q = v3.add(p, v3.scale(d, lengths[i]!));
    out.push({
      a: p,
      b: q,
      ra: radii[i]!,
      rb: radii[i + 1]!,
      dorsal: v3.normalize(v3.rotate(dorsal0, axis, turn)),
      index: i,
      thumb,
    });
    p = q;
  }
  return out;
}

/** Index finger reaching for a trigger: a small search over two joints. */
function reachTrigger(
  contact: Field,
  base: V3,
  dir: V3,
  axis: V3,
  f: FingerDef,
  target: V3,
  palmar: V3,
): number[] {
  let best = f.rest.slice();
  let bestScore = Infinity;
  for (let a1 = 0; a1 <= 1.2; a1 += 0.025) {
    for (let a2 = 0; a2 <= 1.5; a2 += 0.025) {
      const angles = [a1, a2, a2 * 0.45];
      const segs = chainSegments(base, dir, axis, palmar, f.lengths, f.radii, angles, false);
      const tip = segs[2]!;
      // The pad, not the nail: a point just palmar of the distal segment's middle.
      const pad = v3.add(
        v3.lerp(tip.a, tip.b, 0.55),
        v3.scale(tip.dorsal, (tip.ra + tip.rb) * 0.5),
      );
      let score = v3.length(v3.sub(pad, target));
      for (const s of segs) {
        const clear = segmentClearance(contact, s.a, s.b, s.ra, s.rb, s.index === 0 ? 0.35 : 0);
        if (clear < 0) score += -clear * 6 + 0.004;
      }
      if (score < bestScore) {
        bestScore = score;
        best = angles;
      }
    }
  }
  return best;
}

function solveHand(placement: HandPlacement, contact: Field, mirror: number): SolvedHand {
  // Right-handed frame: z dorsal (away from what the palm faces), x toward
  // the little finger on a right hand and the index on a mirrored left.
  const z = v3.normalize(v3.scale(placement.facing, -1));
  const side = v3.scale(placement.indexSide, mirror > 0 ? -1 : 1);
  const xRaw = v3.sub(side, v3.scale(z, v3.dot(side, z)));
  const x = v3.normalize(xRaw);
  const y = v3.cross(z, x);
  // The palm's contact surface is 1.6 cm palmar of the frame, halfway to the knuckles.
  const origin = v3.sub(v3.sub(placement.palm, v3.scale(y, 0.05)), v3.scale(z, -0.0165));
  const frame: Frame = { o: origin, x, y, z };

  const segments: Segment[] = [];
  const palmarWorld = v3.scale(z, -1);

  FINGERS.forEach((f, i) => {
    const base = localToWorld(frame, mirror, f.mcp);
    const dir = dirToWorld(frame, mirror, v3.normalize(f.dir));
    const axis = v3.normalize(v3.cross(dir, palmarWorld));
    let angles: number[];
    if (i === 0 && placement.trigger) {
      angles = reachTrigger(contact, base, dir, axis, f, placement.trigger, palmarWorld);
    } else {
      angles = closeChain(contact, base, dir, axis, f.lengths, f.radii, f.rest, [
        1.75, 1.9, 1.4,
      ]);
    }
    segments.push(...chainSegments(base, dir, axis, z, f.lengths, f.radii, angles, false));
  });

  // Thumb: metacarpal along the requested direction, then IP/MCP close onto
  // the weapon toward the index finger.
  const cmc = localToWorld(frame, mirror, THUMB_CMC);
  const tdir = v3.normalize(placement.thumb);
  const toward = v3.normalize(v3.add(v3.scale(palmarWorld, 0.7), v3.scale(y, 0.7)));
  const taxisRaw = v3.cross(tdir, toward);
  const taxis = v3.normalize(taxisRaw);
  const tdorsal = v3.normalize(v3.cross(taxis, tdir));
  const tangles = closeChain(
    contact,
    cmc,
    tdir,
    taxis,
    THUMB_LENGTHS,
    THUMB_RADII,
    [0, 0.08, 0.1],
    [0, 0.7, 0.9],
  );
  segments.push(
    ...chainSegments(cmc, tdir, taxis, tdorsal, THUMB_LENGTHS, THUMB_RADII, tangles, true),
  );

  const wrist = localToWorld(frame, mirror, [0.002, 0.004, -0.001]);
  return { frame, mirror, segments, wrist, forearm: v3.normalize(placement.forearm) };
}

/* ------------------------------------------------------------------ */
/* The glove as a field                                                */
/* ------------------------------------------------------------------ */

interface GloveFields {
  body: Field;
  armor: Field;
  cuff: Field;
  shape: Field;
}

function gloveFields(hand: SolvedHand, contact: Field): GloveFields {
  const { frame, mirror } = hand;
  const L = (p: V3) => localToWorld(frame, mirror, p);
  const sub = (lx: number, ly: number, lz: number): Frame => ({
    o: L([lx, ly, lz]),
    x: frame.x,
    y: frame.y,
    z: frame.z,
  });

  // Palm: a thin core with a metacarpal per finger over it, so the back of
  // the hand has tendons and a knuckle ridge instead of a flat lid.
  const palmCore = roundBox(sub(0.001, 0.05, -0.003), 0.031, 0.036, 0.0105, 0.0095);
  const metacarpals: Field[] = [];
  const carpal: V3[] = [
    [-0.013, 0.014, 0.001],
    [-0.004, 0.012, 0.002],
    [0.007, 0.014, 0.001],
    [0.017, 0.018, -0.001],
  ];
  FINGERS.forEach((f, i) => {
    metacarpals.push(roundCone(L(carpal[i]!), L(f.mcp), 0.0098, f.radii[0] * 1.02));
  });
  const thenar = ellipsoid(
    frameFrom(L([-0.019, 0.034, -0.011]), dirOf(frame, mirror, [-0.45, 1, -0.2]), frame.z),
    0.0145,
    0.026,
    0.0115,
  );
  const hypothenar = ellipsoid(sub(0.023, 0.04, -0.008), 0.0118, 0.029, 0.0105);
  const palmPad = roundCone(
    L([-0.027, 0.084, -0.006]),
    L([0.028, 0.076, -0.007]),
    0.0088,
    0.0082,
  );

  // Wrist and cuff follow the forearm, not the hand, so a bent wrist reads as
  // one: the glove cuff is where the hand's frame hands over to the arm's.
  const wrist = hand.wrist;
  const fa = hand.forearm;
  const cuffFrame = frameFrom(v3.add(wrist, v3.scale(fa, 0.024)), fa, frame.z);
  const heel = roundBox(
    frameFrom(v3.add(wrist, v3.scale(fa, 0.004)), fa, frame.z),
    0.027,
    0.014,
    0.0175,
    0.0155,
  );
  const cuff = roundBox(cuffFrame, 0.0305, 0.021, 0.0215, 0.019);

  const fingerFields: Field[] = [];
  const padFields: Field[] = [];
  for (const s of hand.segments) {
    fingerFields.push(roundCone(s.a, s.b, s.ra, s.rb));
    if (!s.thumb && s.index === 0) {
      // Rubber armour on the back of each proximal phalanx.
      const mid = v3.lerp(s.a, s.b, 0.55);
      const along = v3.normalize(v3.sub(s.b, s.a));
      const padFrame = frameFrom(v3.add(mid, v3.scale(s.dorsal, s.ra * 0.8)), along, s.dorsal);
      padFields.push(roundBox(padFrame, s.ra * 0.66, 0.0095, 0.0021, 0.0019));
    }
  }
  // Knuckle guard: one moulded bar over the MCP row with a boss per knuckle.
  const knuckles: Field[] = FINGERS.map((f) => {
    const c = L([f.mcp[0], f.mcp[1] - 0.002, f.mcp[2] + f.radii[0] * 0.9]);
    return ellipsoid({ o: c, x: frame.x, y: frame.y, z: frame.z }, f.radii[0] * 0.78, 0.0085, 0.0034);
  });
  const bar = roundBox(sub(0.001, 0.077, 0.0108), 0.029, 0.0058, 0.0019, 0.0017);
  const armor = union([...knuckles, bar, ...padFields]);

  const palm = blend(
    [palmCore, ...metacarpals, thenar, hypothenar, palmPad, heel],
    0.011,
  );
  const fingers = union(fingerFields);
  const body: Field = (x, y, zz) => smin(palm(x, y, zz), fingers(x, y, zz), 0.0065);
  const withArmor: Field = (x, y, zz) =>
    smin(body(x, y, zz), armor(x, y, zz), 0.0032);
  const withCuff: Field = (x, y, zz) => smin(withArmor(x, y, zz), cuff(x, y, zz), 0.006);
  // Carve the weapon out, with a hair of clearance, so a palm pressed against
  // polymer flattens against it instead of passing through.
  const shape: Field = (x, y, zz) =>
    smax(withCuff(x, y, zz), -(contact(x, y, zz) - 0.0003), 0.0015);
  return { body, armor, cuff, shape };
}

function dirOf(frame: Frame, mirror: number, d: V3): V3 {
  return dirToWorld(frame, mirror, v3.normalize(d));
}

/* ------------------------------------------------------------------ */
/* Meshing and baking                                                  */
/* ------------------------------------------------------------------ */

interface BakedMesh {
  geometry: THREE.BufferGeometry;
  triangles: number;
  shape: Field;
}

function boundsOf(hand: SolvedHand): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3, r: number) => {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, p[i]! - r);
      max[i] = Math.max(max[i]!, p[i]! + r);
    }
  };
  for (const s of hand.segments) {
    grow(s.a, s.ra + 0.006);
    grow(s.b, s.rb + 0.006);
  }
  grow(hand.frame.o, 0.05);
  grow(localToWorld(hand.frame, hand.mirror, [0, 0.09, 0]), 0.05);
  grow(v3.add(hand.wrist, v3.scale(hand.forearm, 0.05)), 0.04);
  return { min, max };
}

/** Segment nearest to a point, for the palmar test and stitch lines. */
function nearestSegment(segments: readonly Segment[], p: V3): { seg: Segment | null; d: number } {
  let best: Segment | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    const ab = v3.sub(s.b, s.a);
    const t = Math.max(0, Math.min(1, v3.dot(v3.sub(p, s.a), ab) / v3.dot(ab, ab)));
    const q = v3.add(s.a, v3.scale(ab, t));
    const d = v3.length(v3.sub(p, q)) - (s.ra + (s.rb - s.ra) * t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { seg: best, d: bestD };
}

function bakeHand(hand: SolvedHand, contact: Field, cell: number): BakedMesh {
  const fields = gloveFields(hand, contact);
  const mesh = surfaceNets(fields.shape, boundsOf(hand), cell);
  const count = mesh.positions.length / 3;
  const colors = new Float32Array(count * 3);
  const surface = new Float32Array(count * 2);
  const occluder: Field = (x, y, z) => Math.min(fields.shape(x, y, z), contact(x, y, z));
  const z = hand.frame.z;
  const y = hand.frame.y;

  for (let v = 0; v < count; v += 1) {
    const px = mesh.positions[v * 3]!;
    const py = mesh.positions[v * 3 + 1]!;
    const pz = mesh.positions[v * 3 + 2]!;
    const nx = mesh.normals[v * 3]!;
    const ny = mesh.normals[v * 3 + 1]!;
    const nz = mesh.normals[v * 3 + 2]!;
    const p: V3 = [px, py, pz];
    const n: V3 = [nx, ny, nz];

    // Regions blend over a few millimetres. A hard switch per vertex steps
    // along the 2 mm lattice and reads as a stain, not a panel.
    const armorD = fields.armor(px, py, pz);
    const cuffD = fields.cuff(px, py, pz);
    const near = nearestSegment(hand.segments, p);
    const onFinger = near.seg !== null && near.d < 0.0035;
    // Palmar side: the palm's own normal, or the finger segment's.
    const palmarRef = onFinger && near.seg ? v3.scale(near.seg.dorsal, -1) : v3.scale(z, -1);
    const palmar = v3.dot(n, palmarRef);
    let leather = smoothstep(0.12, 0.42, palmar);
    if (onFinger && near.seg && near.seg.index === 2 && !near.seg.thumb) {
      // Reinforced fingertips wrap over the nail.
      const tipT = v3.dot(v3.sub(p, near.seg.a), v3.normalize(v3.sub(near.seg.b, near.seg.a)));
      leather = Math.max(leather, smoothstep(0.011, 0.016, tipT));
    }
    const armor = 1 - smoothstep(0.0002, 0.0014, armorD);
    const strap =
      (1 - smoothstep(0.0006, 0.002, cuffD)) * smoothstep(-0.002, 0.0005, fields.body(px, py, pz));
    let color: V3 = v3.lerp(GLOVE, LEATHER, leather);
    color = v3.lerp(color, ARMOR, armor);
    color = v3.lerp(color, STRAP, strap);
    // A pale stitch line round the cuff mouth.
    const along = v3.dot(v3.sub(p, hand.wrist), hand.forearm);
    color = v3.lerp(color, STITCH, strap * (1 - smoothstep(0.0006, 0.0014, Math.abs(along - 0.041))));
    const rough = 0.82 + (0.74 - 0.82) * leather + (0.6 - 0.82) * armor * (1 - leather);

    const ao = fieldOcclusion(occluder, px, py, pz, nx, ny, nz, 0.0028);
    const contactAo = Math.max(0, Math.min(1, contact(px, py, pz) / 0.006));
    const occlusion = Math.min(ao, 0.45 + 0.55 * contactAo);
    // Knuckles and fingertips scuff lighter; creases collect dust darker.
    const scuff = Math.max(0, v3.dot(n, y)) * 0.06 * (1 + armor * 0.6);
    const cavity = 0.8 + 0.2 * ao;
    colors[v * 3] = Math.min(1, color[0] * cavity + scuff);
    colors[v * 3 + 1] = Math.min(1, color[1] * cavity + scuff * 0.95);
    colors[v * 3 + 2] = Math.min(1, color[2] * cavity + scuff * 0.85);
    surface[v * 2] = rough;
    surface[v * 2 + 1] = occlusion;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("surface", new THREE.BufferAttribute(surface, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, triangles: mesh.indices.length / 3, shape: fields.shape };
}

/* ------------------------------------------------------------------ */
/* Sleeves                                                             */
/* ------------------------------------------------------------------ */

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A combat-shirt sleeve: an elliptical tube along the forearm with a gathered
 * elastic cuff over the glove and compression folds behind it. Folds are
 * creases, not ripples — `1 - |sin|` gives a sharp valley and a soft ridge,
 * which is how fabric actually buckles.
 */
function bakeSleeve(hand: SolvedHand, seed: number): BakedMesh {
  const rings = 56;
  const radial = 30;
  const length = 0.42;
  const fa = hand.forearm;
  const side = v3.normalize(v3.sub(hand.frame.x, v3.scale(fa, v3.dot(hand.frame.x, fa))));
  const up = v3.cross(fa, side);
  const start = v3.add(hand.wrist, v3.scale(fa, 0.028));

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const surface: number[] = [];
  const phase = [hash1(seed), hash1(seed + 1), hash1(seed + 2), hash1(seed + 3)];

  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    // Denser rings near the cuff, where the folds are.
    const s = Math.pow(t, 1.6) * length;
    const cuff = Math.max(0, 1 - s / 0.022);
    const base = 0.0355 + s * 0.042 - cuff * cuff * 0.004;
    const flat = 0.8 + Math.min(1, s / 0.2) * 0.1;
    for (let j = 0; j <= radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      // Compression folds: a few diagonal creases, strongest a few cm behind
      // the cuff where the fabric bunches on the glove.
      const bunch = Math.exp(-Math.pow((s - 0.045) / 0.04, 2));
      const crease1 = 1 - Math.abs(Math.sin(s * 95 + a * 1.0 + phase[0]! * 6));
      const crease2 = 1 - Math.abs(Math.sin(s * 61 - a * 2.0 + phase[1]! * 6));
      const long = Math.sin(a * 3 + s * 9 + phase[2]! * 6) * 0.5 + 0.5;
      const elastic = cuff > 0 ? Math.sin(a * 22) * 0.0007 * cuff : 0;
      const fold =
        (crease1 * 0.0032 + crease2 * 0.0022) * (0.35 + bunch) + long * 0.0016 * (1 - cuff);
      const r = base + fold + elastic;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = side[0] * ca * r + up[0] * sa * r * flat;
      const oy = side[1] * ca * r + up[1] * sa * r * flat;
      const oz = side[2] * ca * r + up[2] * sa * r * flat;
      positions.push(start[0] + fa[0] * s + ox, start[1] + fa[1] * s + oy, start[2] + fa[2] * s + oz);
      uvs.push(j / radial, s / 0.1);
      // Valleys darker; the cuff hem a touch darker still.
      const valley = 1 - (crease1 * 0.5 + crease2 * 0.3) * (0.3 + bunch) * 0.5;
      const hem = s < 0.012 ? 0.82 : 1;
      const shade = valley * hem;
      colors.push(shade, shade, shade);
      surface.push(0.9, Math.min(1, 0.55 + s * 3) * valley);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("surface", new THREE.Float32BufferAttribute(surface, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Winding: make the tube face outward whichever way the frame turned.
  const n = geometry.getAttribute("normal");
  const p = geometry.getAttribute("position");
  const probe = radial + 1 + 3;
  const out = v3.sub([p.getX(probe), p.getY(probe), p.getZ(probe)], v3.add(start, v3.scale(fa, v3.dot(v3.sub([p.getX(probe), p.getY(probe), p.getZ(probe)], start), fa))));
  if (v3.dot(out, [n.getX(probe), n.getY(probe), n.getZ(probe)]) < 0) {
    const idx = geometry.getIndex()!;
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i]!;
      arr[i] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return { geometry, triangles: indices.length / 3, shape: () => Infinity };
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
  float vmHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vmNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(vmHash(i + vec3(0, 0, 0)), vmHash(i + vec3(1, 0, 0)), f.x),
                   mix(vmHash(i + vec3(0, 1, 0)), vmHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(vmHash(i + vec3(0, 0, 1)), vmHash(i + vec3(1, 0, 1)), f.x),
                   mix(vmHash(i + vec3(0, 1, 1)), vmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float vmFbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vmNoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
  vec3 vmPerturb(vec3 surfPos, vec3 surfNorm, float h, float faceDir) {
    vec3 sx = dFdx(surfPos);
    vec3 sy = dFdy(surfPos);
    vec3 r1 = cross(sy, surfNorm);
    vec3 r2 = cross(surfNorm, sx);
    float det = dot(sx, r1) * faceDir;
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * surfNorm - grad);
  }
`;

type Finish = "glove" | "sleeve";

/**
 * Standard material, patched: per-vertex roughness and occlusion from the
 * bake, a procedural micro-relief (pebbled nylon on the glove, ripstop on the
 * sleeve) and, on the sleeve, a four-tone arid camouflage in object space.
 * Object space is weapon space here, so the pattern is glued to the arm and
 * never swims with sway.
 */
function armMaterial(finish: Finish): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: finish === "glove" ? "arm-glove" : "arm-sleeve",
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: finish === "glove" ? 0.55 : 0.45,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec2 surface;
         varying vec2 vSurface;
         varying vec3 vObj;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vSurface = surface;
         vObj = position;`,
      );
    const camo =
      finish === "sleeve"
        ? `
        {
          vec3 q = vObj * 26.0;
          float n1 = vmFbm(q);
          float n2 = vmFbm(q * 1.7 + vec3(4.1, 2.3, 7.7));
          float n3 = vmFbm(q * 3.1 + vec3(9.4, 1.1, 5.3));
          vec3 base = vec3(0.62, 0.53, 0.40);
          vec3 khaki = vec3(0.74, 0.66, 0.52);
          vec3 brown = vec3(0.42, 0.33, 0.24);
          vec3 olive = vec3(0.46, 0.44, 0.31);
          vec3 camo = base;
          camo = mix(camo, khaki, smoothstep(0.52, 0.56, n1));
          camo = mix(camo, olive, smoothstep(0.58, 0.61, n2));
          camo = mix(camo, brown, smoothstep(0.63, 0.66, n3) * (1.0 - smoothstep(0.5, 0.6, n1)));
          diffuseColor.rgb *= pow(camo, vec3(2.2));
        }`
        : "";
    const relief =
      finish === "glove"
        ? `float vmH = (vmNoise(vObj * 1400.0) - 0.5) * 0.00012 + (vmNoise(vObj * 420.0) - 0.5) * 0.00008;`
        : `vec2 vmW = abs(fract(vUv * vec2(90.0, 40.0)) - 0.5);
           float vmGrid = smoothstep(0.42, 0.5, max(vmW.x, vmW.y));
           float vmH = vmGrid * 0.00004 + (vmNoise(vObj * 900.0) - 0.5) * 0.00006;`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vSurface;
         varying vec3 vObj;
         ${NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         ${camo}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness * vSurface.x;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         ${relief}
         normal = vmPerturb(-vViewPosition, normal, vmH, faceDirection);`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
         float vmAo = vSurface.y;
         reflectedLight.indirectDiffuse *= vmAo;
         reflectedLight.indirectSpecular *= vmAo;
         reflectedLight.directDiffuse *= mix(1.0, vmAo, 0.55);
         reflectedLight.directSpecular *= vmAo;`,
      );
  };
  // The sleeve samples `vUv`; make sure the UV chunk is compiled in.
  if (finish === "sleeve") {
    material.defines = { ...(material.defines ?? {}), USE_UV: "" };
  }
  material.customProgramCacheKey = () => `vm-arm-${finish}-v1`;
  return material;
}

/* ------------------------------------------------------------------ */
/* Assembly and cache                                                  */
/* ------------------------------------------------------------------ */

interface BakedArm {
  glove: THREE.BufferGeometry;
  sleeve: THREE.BufferGeometry;
  triangles: number;
  /** The glove as a field, for a support hand that closes over this one. */
  shape: Field;
  key: string;
}

/**
 * Baked arms keyed by what each hand actually touches. Every rifle shares one
 * pistol grip, so the firing hand is meshed once for the whole arsenal; only
 * the support hand changes with handguard length and diameter.
 */
const cache = new Map<string, BakedArm>();

const CELL = 0.0022;

/** Contact solids near enough to a hand to touch or shadow it. */
function nearby(solids: readonly ContactSolid[], at: V3): ContactSolid[] {
  return solids.filter((s) => {
    const extent = s.kind === "tube" ? Math.hypot(s.radius, s.halfLength) : v3.length(s.half);
    return v3.length(v3.sub(s.center, at)) - extent < 0.16;
  });
}

function bakeArm(
  placement: HandPlacement,
  solids: readonly ContactSolid[],
  mirror: number,
  seed: number,
  under: BakedArm | null,
): BakedArm {
  const local = nearby(solids, placement.palm);
  const key = JSON.stringify([placement, local, mirror, seed, under?.key ?? null]);
  const hit = cache.get(key);
  if (hit) return hit;
  const weapon = union(local.map(solidField));
  const contact: Field = under
    ? (x, y, z) => Math.min(weapon(x, y, z), under.shape(x, y, z))
    : weapon;
  const hand = solveHand(placement, contact, mirror);
  const glove = bakeHand(hand, contact, CELL);
  const sleeve = bakeSleeve(hand, seed);
  const baked: BakedArm = {
    glove: glove.geometry,
    sleeve: sleeve.geometry,
    triangles: glove.triangles + sleeve.triangles,
    shape: glove.shape,
    key,
  };
  cache.set(key, baked);
  return baked;
}

function bakeSpec(spec: GraspSpec): { right: BakedArm; left: BakedArm | null } {
  const right = bakeArm(spec.right, spec.contact, 1, 11, null);
  const left = spec.left
    ? bakeArm(spec.left, spec.contact, -1, 29, spec.left.cup ? right : null)
    : null;
  return { right, left };
}

let gloveMaterial: THREE.MeshStandardMaterial | null = null;
let sleeveMaterial: THREE.MeshStandardMaterial | null = null;
let materialUsers = 0;

function retainMaterials(): { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } {
  if (!gloveMaterial) gloveMaterial = armMaterial("glove");
  if (!sleeveMaterial) sleeveMaterial = armMaterial("sleeve");
  materialUsers += 1;
  return { glove: gloveMaterial, sleeve: sleeveMaterial };
}

function releaseMaterials(): void {
  materialUsers = Math.max(0, materialUsers - 1);
  if (materialUsers > 0) return;
  gloveMaterial?.dispose();
  sleeveMaterial?.dispose();
  gloveMaterial = null;
  sleeveMaterial = null;
}

function armGroup(
  baked: BakedArm,
  materials: { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial },
): THREE.Group {
  const group = new THREE.Group();
  for (const [geometry, material] of [
    [baked.glove, materials.glove],
    [baked.sleeve, materials.sleeve],
  ] as const) {
    const mesh = new THREE.Mesh(geometry, material);
    // The name is what the viewmodel traversal keys on.
    mesh.name = "viewmodel-arm";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The sleeve crosses the near plane; a bounds test would cull the arm
    // once its centre sits behind the camera.
    mesh.frustumCulled = false;
    // Geometry is shared through the bake cache and must outlive any one
    // weapon; the weapon's dispose traversal skips meshes marked like this.
    mesh.userData["sharedGeometry"] = true;
    group.add(mesh);
  }
  group.userData["triangles"] = baked.triangles;
  return group;
}

/** Build a pair of gloved arms that hold the weapon described by `spec`. */
export function buildArms(spec: GraspSpec): ArmsModel {
  const baked = bakeSpec(spec);
  const materials = retainMaterials();
  const right = armGroup(baked.right, materials);
  const left = baked.left ? armGroup(baked.left, materials) : null;
  let released = false;
  return {
    right,
    left,
    triangleCount: baked.right.triangles + (baked.left?.triangles ?? 0),
    dispose(): void {
      if (released) return;
      released = true;
      releaseMaterials();
    },
  };
}