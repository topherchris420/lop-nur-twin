/**
 * Staging: where the server's abstract 2D garden lands on the sculpted one.
 *
 * The simulation knows seven places and a position in garden fractions; it
 * models no heights, surfaces or gravity. This module is the renderer's
 * explicit, documented interpretation of that state, and nothing else:
 *
 * - **At a place**, the fly stands on that place's sculpted surface. Its
 *   offset from the place's 2D anchor (the server keeps it within about
 *   0.018 of it) is scaled onto the surface around the matching 3D anchor and
 *   projected onto the surface's shape (a board, a sill, a leaf's underside,
 *   an aster's disc, the pear's skin, the saucer's rim, a stone's top).
 * - **Travelling**, its progress along the server's straight 2D route sets
 *   how far along a flight path between the two perches it is drawn. The
 *   path's shape is a presentation choice, seeded by the life and the
 *   journey number so every visitor sees the same one.
 * - **Small things**: the midge's 2D track maps onto a vertical sheet of air
 *   above the lawn; the swaying leaf's offset moves one maple leaf.
 *
 * Every function here is pure. They read `layout.ts` and never the network.
 */
import type { PlaceId, Vec2 } from "./observation.js";
import { groundHeight, LAYOUT, PLAN, standingHeight, stoneTop } from "./layout.js";
import {
  add,
  addScaled,
  clamp,
  cross,
  distance,
  dot,
  hash01,
  length,
  mix,
  normalize,
  rotateAbout,
  scale,
  sub,
  tangentOf,
  type V3,
} from "./vec.js";

export interface SurfacePoint {
  position: V3;
  /** Outward surface normal: the standing fly's "up". */
  normal: V3;
}

type Surface =
  | { kind: "plane" }
  | { kind: "ellipsoid"; center: V3; radii: V3; yaw: number }
  | { kind: "cap"; center: V3; radius: number }
  | { kind: "ring"; center: V3; radius: number; angle: number };

export interface PlaceStage {
  id: PlaceId;
  plan: readonly [number, number];
  anchor: V3;
  normal: V3;
  /** World directions that server +x and +y (down the old picture) offsets move along. */
  ax: V3;
  ay: V3;
  /** Metres per garden unit for offsets from the anchor, and their limits (m). */
  scale: number;
  limit: [number, number];
  surface: Surface;
  /** Direction flights leave along and arrive from. */
  approach: V3;
  /** Preferred facing (world direction) and how far either side of it a rest may turn (rad). */
  facing: V3 | null;
  spread: number;
  /** Surface waypoints from the anchor down to the ground, for walking journeys. */
  climb: SurfacePoint[];
  /** Moved by the wind with the leaf or flower head it stands on. */
  sways: "leaf" | "flower" | null;
}

const UP: V3 = [0, 1, 0];
const L = LAYOUT;

function pearFrame() {
  const p = L.pear;
  const yaw = p.yaw;
  const axis: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const center: V3 = [p.x, groundHeight(p.x, p.z) + p.radius * 0.94, p.z];
  return { axis, center };
}

function ringAt(angle: number, radius: number): V3 {
  const s = L.saucer;
  return [
    s.x + radius * Math.cos(angle),
    groundHeight(s.x, s.z) + s.height,
    s.z + radius * Math.sin(angle),
  ];
}

/**
 * From the windowsill to the ground at `x`, over every surface of the
 * sculpted wall: round the sill's front edge, back along its underside,
 * down the apron and the shiplap, over the foundation's ledge and down its
 * face.
 */
function windowClimb(x: number): SurfacePoint[] {
  const sill = L.window.sill,
    wallZ = L.wall.front,
    r = sill.round;
  const front = wallZ + sill.depth,
    bottom = sill.top - sill.thickness,
    apronZ = wallZ + L.window.apron.face,
    apronBottom = bottom - L.window.apron.height,
    sidingZ = wallZ + L.wall.siding,
    ledge = L.wall.foundation.top,
    footZ = wallZ + L.wall.foundation.face;
  const out: V3 = [0, 0, 1],
    under: V3 = [0, -1, 0];
  const bend = (a: V3, b: V3) => normalize(add(a, b));
  const c = Math.SQRT1_2;
  return [
    { position: [x, sill.top, front - r], normal: UP },
    { position: [x, sill.top - r + r * c, front - r + r * c], normal: bend(UP, out) },
    { position: [x, sill.top - r, front], normal: out },
    { position: [x, bottom + r, front], normal: out },
    { position: [x, bottom + r - r * c, front - r + r * c], normal: bend(out, under) },
    { position: [x, bottom, front - r], normal: under },
    { position: [x, bottom, apronZ], normal: bend(under, out) },
    { position: [x, apronBottom, apronZ], normal: bend(out, under) },
    { position: [x, apronBottom, sidingZ], normal: bend(under, out) },
    { position: [x, ledge, sidingZ], normal: bend(out, UP) },
    { position: [x, ledge, footZ], normal: bend(UP, out) },
    { position: [x, groundHeight(x, footZ), footZ], normal: bend(out, UP) },
    { position: [x, groundHeight(x, footZ + 0.03), footZ + 0.03], normal: UP },
  ];
}

const RIM_RADIUS = L.saucer.radius - L.saucer.wall / 2;
/** Where on the saucer's rim the "water" place is: front left, toward the camera. */
const RIM_ANGLE = (2 * Math.PI) / 3;

function shelterUnderside(): { anchor: V3; normal: V3 } {
  const s = L.maple.shelter;
  const n = normalize(s.normal);
  return { anchor: addScaled(s.center, n, -0.0016), normal: scale(n, -1) };
}

function buildStages(): Record<PlaceId, PlaceStage> {
  const fence = L.fence;
  const pitch = fence.boardWidth + fence.gap;
  // The board nearest the old picture's fence anchor, and its centre line.
  const board = Math.round((-1.646 - fence.x0 - fence.boardWidth / 2) / pitch);
  const boardX = fence.x0 + fence.boardWidth / 2 + board * pitch;
  const sill = L.window.sill;
  const pot = L.pot;
  const hero = L.heroAster;
  const heroN = normalize(hero.facing);
  const pear = pearFrame();
  const pearN = normalize(L.pear.bruise);
  const pearRadii: V3 = [L.pear.length * 0.48, L.pear.radius, L.pear.radius];
  const pearAnchor = projectEllipsoid(
    add(pear.center, scale(pearN, L.pear.radius)),
    pear.center,
    pearRadii,
    L.pear.yaw,
  );
  const stone = L.stones[2]!;
  const stoneY = stoneTop(2);
  const leaf = shelterUnderside();
  const rimPoint = ringAt(RIM_ANGLE, RIM_RADIUS);
  const g = (x: number, z: number) => groundHeight(x, z);
  const potGround = g(pot.x, pot.z);
  const wallZ = L.wall.front;

  return {
    leaf: {
      id: "leaf",
      plan: PLAN.leaf,
      anchor: leaf.anchor,
      normal: leaf.normal,
      ax: tangentOf([1, 0, 0], leaf.normal),
      ay: tangentOf([0, 0, 1], leaf.normal),
      scale: 0.9,
      limit: [0.018, 0.016],
      surface: { kind: "plane" },
      approach: normalize([0.1, -1, 0.55]),
      facing: normalize(sub(L.maple.shelter.twig, L.maple.shelter.center)),
      spread: Math.PI,
      climb: [
        { position: L.maple.shelter.twig, normal: normalize([0, 0.3, 1]) },
        { position: [-1.45, 1.42 + 0.035, 0.58], normal: UP },
        { position: [-2.2, 1.66 + 0.05, 0.74], normal: UP },
        { position: [-2.9, 1.5, 0.95 + 0.17], normal: [0, 0, 1] },
        { position: [-2.9, g(-2.9, 1.15), 1.15], normal: UP },
      ],
      sways: "leaf",
    },
    window: {
      id: "window",
      plan: PLAN.window,
      anchor: [1.62, sill.top, wallZ + 0.045],
      normal: UP,
      ax: [1, 0, 0],
      ay: [0, 0, 1],
      scale: 3,
      limit: [0.05, 0.022],
      surface: { kind: "plane" },
      approach: normalize([0, 1, 0.9]),
      facing: [0, 0, -1],
      spread: Math.PI,
      climb: windowClimb(1.62),
      sways: null,
    },
    flowers: {
      id: "flowers",
      plan: PLAN.flowers,
      anchor: addScaled(hero.center, heroN, 0.0016),
      normal: heroN,
      ax: tangentOf([1, 0, 0], heroN),
      ay: tangentOf([0, -1, 0], heroN),
      scale: 0.45,
      limit: [0.0075, 0.0075],
      surface: {
        kind: "cap",
        center: addScaled(hero.center, heroN, -0.011),
        radius: 0.0126,
      },
      approach: normalize(add(heroN, [0, 0.4, 0.3])),
      facing: null,
      spread: Math.PI,
      climb: [
        { position: addScaled(hero.center, heroN, -0.004), normal: normalize([0, 0, 1]) },
        {
          position: [0.73, potGround + pot.soil + 0.02, -0.08],
          normal: normalize([0, 0.2, 1]),
        },
        {
          position: [
            0.735,
            potGround + pot.soil + pot.rimHeight * 0.4,
            pot.z + pot.rimRadius,
          ],
          normal: normalize([0, 0.3, 1]),
        },
        {
          position: [
            0.74,
            g(0.74, pot.z + pot.rimRadius + 0.03),
            pot.z + pot.rimRadius + 0.03,
          ],
          normal: UP,
        },
      ],
      sways: "flower",
    },
    pear: {
      id: "pear",
      plan: PLAN.pear,
      anchor: pearAnchor,
      normal: ellipsoidNormal(pearAnchor, pear.center, pearRadii, L.pear.yaw),
      ax: [1, 0, 0],
      ay: [0, 0, 1],
      scale: 1.1,
      limit: [0.017, 0.015],
      surface: {
        kind: "ellipsoid",
        center: pear.center,
        radii: pearRadii,
        yaw: L.pear.yaw,
      },
      approach: normalize([0, 1, 0.5]),
      facing: null,
      spread: Math.PI,
      climb: [
        {
          position: projectEllipsoid(
            add(pear.center, [0, 0, 0.05]),
            pear.center,
            pearRadii,
            L.pear.yaw,
          ),
          normal: [0, 0, 1],
        },
        {
          position: [L.pear.x, g(L.pear.x, L.pear.z + 0.05), L.pear.z + 0.05],
          normal: UP,
        },
      ],
      sways: null,
    },
    water: {
      id: "water",
      plan: PLAN.water,
      anchor: rimPoint,
      normal: UP,
      ax: [Math.sin(RIM_ANGLE), 0, -Math.cos(RIM_ANGLE)],
      ay: [Math.cos(RIM_ANGLE), 0, Math.sin(RIM_ANGLE)],
      scale: 1.4,
      limit: [0.03, 0.0035],
      surface: {
        kind: "ring",
        center: [L.saucer.x, rimPoint[1], L.saucer.z],
        radius: RIM_RADIUS,
        angle: RIM_ANGLE,
      },
      approach: normalize([0, 1, 0.6]),
      // Toward the water.
      facing: [-Math.cos(RIM_ANGLE), 0, -Math.sin(RIM_ANGLE)],
      spread: 0.6,
      climb: [
        {
          position: ringAt(RIM_ANGLE, L.saucer.radius + 0.002),
          normal: [Math.cos(RIM_ANGLE), 0.3, Math.sin(RIM_ANGLE)],
        },
        {
          position: [
            L.saucer.x + (L.saucer.radius + 0.02) * Math.cos(RIM_ANGLE),
            g(L.saucer.x, L.saucer.z),
            L.saucer.z + (L.saucer.radius + 0.02) * Math.sin(RIM_ANGLE),
          ],
          normal: UP,
        },
      ],
      sways: null,
    },
    fence: {
      id: "fence",
      plan: PLAN.fence,
      anchor: [boardX, 0.62, fence.front],
      normal: [0, 0, 1],
      ax: [1, 0, 0],
      ay: [0, -1, 0],
      scale: 3,
      limit: [0.03, 0.054],
      surface: { kind: "plane" },
      approach: normalize([0, 0.35, 1]),
      // Flies on walls mostly face upward.
      facing: UP,
      spread: 1,
      climb: [
        { position: [boardX, fence.bottom + 0.01, fence.front], normal: [0, 0, 1] },
        {
          position: [boardX, g(boardX, fence.front + 0.05), fence.front + 0.05],
          normal: UP,
        },
      ],
      sways: null,
    },
    stone: {
      id: "stone",
      plan: PLAN.stone,
      anchor: [stone.x + 0.01, stoneY, stone.z + 0.01],
      normal: UP,
      ax: [1, 0, 0],
      ay: [0, 0, 1],
      scale: 2.6,
      limit: [0.1, 0.07],
      surface: { kind: "plane" },
      approach: normalize([0, 1, 0.4]),
      facing: null,
      spread: Math.PI,
      climb: [
        { position: [stone.x, stoneY - 0.01, stone.z + stone.rz], normal: [0, 0, 1] },
        {
          position: [
            stone.x,
            g(stone.x, stone.z + stone.rz + 0.03),
            stone.z + stone.rz + 0.03,
          ],
          normal: UP,
        },
      ],
      sways: null,
    },
  };
}

function toPearLocal(q: V3, center: V3, yaw: number): V3 {
  const d = sub(q, center);
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  // Local x along the pear's axis (yaw about +y from +x), y up, z completing.
  return [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
}
function fromPearLocal(l: V3, center: V3, yaw: number): V3 {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [
    center[0] + l[0] * c + l[2] * s,
    center[1] + l[1],
    center[2] - l[0] * s + l[2] * c,
  ];
}
/** Radial projection of `q` onto the ellipsoid. */
export function projectEllipsoid(q: V3, center: V3, radii: V3, yaw: number): V3 {
  const l = toPearLocal(q, center, yaw);
  const k = Math.hypot(l[0] / radii[0], l[1] / radii[1], l[2] / radii[2]) || 1;
  return fromPearLocal([l[0] / k, l[1] / k, l[2] / k], center, yaw);
}
export function ellipsoidNormal(p: V3, center: V3, radii: V3, yaw: number): V3 {
  const l = toPearLocal(p, center, yaw);
  const g: V3 = [l[0] / radii[0] ** 2, l[1] / radii[1] ** 2, l[2] / radii[2] ** 2];
  const w = sub(fromPearLocal(g, center, yaw), center);
  return normalize(w);
}

export const STAGES: Record<PlaceId, PlaceStage> = buildStages();

/** Offset from the place's 2D anchor, in metres along ax/ay, kept inside the place's limits. */
function localOffset(stage: PlaceStage, p: Vec2): [number, number] {
  let lx = (p[0] - stage.plan[0]) * stage.scale,
    ly = (p[1] - stage.plan[1]) * stage.scale;
  const r = Math.hypot(lx / stage.limit[0], ly / stage.limit[1]);
  if (r > 1) {
    lx /= r;
    ly /= r;
  }
  return [lx, ly];
}

/**
 * The surface point a fly at garden position `p` stands on at `place`
 * (without wind sway: see `swayFrame`).
 */
export function perchPoint(place: PlaceId, p: Vec2): SurfacePoint {
  const st = STAGES[place];
  const [lx, ly] = localOffset(st, p);
  const s = st.surface;
  switch (s.kind) {
    case "plane":
      return {
        position: add(addScaled(st.anchor, st.ax, lx), scale(st.ay, ly)),
        normal: st.normal,
      };
    case "ring": {
      const angle = s.angle + lx / s.radius;
      const r = s.radius + ly;
      return {
        position: [
          s.center[0] + r * Math.cos(angle),
          s.center[1],
          s.center[2] + r * Math.sin(angle),
        ],
        normal: UP,
      };
    }
    case "cap": {
      const q = add(addScaled(st.anchor, st.ax, lx), scale(st.ay, ly));
      const n = normalize(sub(q, s.center));
      return { position: addScaled(s.center, n, s.radius), normal: n };
    }
    case "ellipsoid": {
      const q = add(addScaled(st.anchor, st.ax, lx), scale(st.ay, ly));
      const pos = projectEllipsoid(q, s.center, s.radii, s.yaw);
      return { position: pos, normal: ellipsoidNormal(pos, s.center, s.radii, s.yaw) };
    }
  }
}

/**
 * The direction a resting fly faces at `p`: the place's preferred facing,
 * turned by an amount fixed by the position itself, so the same state looks
 * the same to every visitor and a fly that walks a step turns to a new rest.
 */
export function restingForward(place: PlaceId, p: Vec2, normal: V3): V3 {
  const st = STAGES[place];
  const base = tangentOf(st.facing ?? st.ax, normal, st.ay);
  const k = hash01("rest", place, Math.round(p[0] * 1e5), Math.round(p[1] * 1e5));
  return rotateAbout(base, normal, (k - 0.5) * 2 * st.spread);
}

// ------------------------------------------------------------------- wind

export interface Sway {
  /** Pivot the leaf or flower head turns about. */
  pivot: V3;
  axis: V3;
  angle: number;
}

/**
 * How the wind turns the shelter leaf and the hero aster at presented time
 * `t`: the leaf on its stalk, the flower on its stem. The scene moves the
 * clay with the same function, so a fly standing there rides along.
 * Deterministic in `t` and the reported wind; a visual reading of the
 * weather, not a simulation of it.
 */
export function swayFrame(
  kind: "leaf" | "flower",
  t: number,
  windKmh: number | null,
): Sway {
  const strength = clamp((windKmh ?? 8) / 35, 0.12, 1);
  if (kind === "leaf") {
    const s = L.maple.shelter;
    const a =
      0.055 *
      strength *
      (0.62 * Math.sin(2 * Math.PI * 0.27 * t + 0.4) +
        0.38 * Math.sin(2 * Math.PI * 0.71 * t + 1.9));
    return {
      pivot: s.twig,
      axis: normalize(cross(sub(s.center, s.twig), [0, 0, 1])),
      angle: a,
    };
  }
  const h = L.heroAster;
  const pivot: V3 = [
    L.pot.x - 0.03,
    groundHeight(L.pot.x, L.pot.z) + L.pot.soil,
    L.pot.z + 0.05,
  ];
  const a =
    0.045 *
    strength *
    (0.6 * Math.sin(2 * Math.PI * 0.41 * t + 2.2) +
      0.4 * Math.sin(2 * Math.PI * 0.93 * t + 0.3));
  return { pivot, axis: normalize(cross(sub(h.center, pivot), [0, 0, 1])), angle: a };
}

/** Applies a sway to a point (positions) or direction (with `direction`). */
export function applySway(s: Sway, v: V3, direction = false): V3 {
  if (direction) return rotateAbout(v, s.axis, s.angle);
  return add(s.pivot, rotateAbout(sub(v, s.pivot), s.axis, s.angle));
}

// ------------------------------------------------------------------ flight

/**
 * A flight path between two perches: a cubic curve that leaves along the
 * departure's approach direction, arcs over the garden and arrives along the
 * destination's, with a gentle seeded meander. Evaluated by arc length so
 * equal progress means equal distance.
 */
export class FlightPath {
  readonly length: number;
  private readonly lut: Float64Array;
  private readonly c: V3[];
  private readonly side: V3;
  private readonly meander: {
    a: number;
    k: number;
    phase: number;
    bob: number;
    k2: number;
    phase2: number;
  };

  constructor(
    readonly from: SurfacePoint,
    fromApproach: V3,
    readonly to: SurfacePoint,
    toApproach: V3,
    seed: number,
  ) {
    const span = distance(from.position, to.position);
    const reach = clamp(0.28 * span, 0.06, 0.45);
    const lift = clamp(0.22 + 0.16 * span, 0.18, 0.62) * (0.8 + 0.4 * frac(seed * 7.13));
    const p0 = from.position,
      p3 = to.position;
    const p1 = addScaled(addScaled(p0, fromApproach, reach), UP, lift * 0.55);
    const p2 = addScaled(addScaled(p3, toApproach, reach), UP, lift * 0.55);
    this.c = [p0, p1, p2, p3];
    const dir = sub(p3, p0);
    const flat: V3 = [dir[0], 0, dir[2]];
    this.side = length(flat) > 1e-6 ? normalize(cross(UP, flat)) : [1, 0, 0];
    this.meander = {
      a: Math.min(0.045, 0.02 * span) * (frac(seed * 3.7) > 0.5 ? 1 : -1),
      k: 1 + Math.floor(frac(seed * 5.3) * 2),
      phase: frac(seed * 11.9) * Math.PI * 2,
      bob: Math.min(0.02, 0.008 * span),
      k2: 2 + Math.floor(frac(seed * 2.1) * 3),
      phase2: frac(seed * 13.7) * Math.PI * 2,
    };
    const n = 96;
    this.lut = new Float64Array(n + 1);
    let prev = this.raw(0);
    for (let i = 1; i <= n; i++) {
      const p = this.raw(i / n);
      this.lut[i] = this.lut[i - 1]! + distance(prev, p);
      prev = p;
    }
    this.length = this.lut[n]!;
  }

  private bezier(s: number): V3 {
    const [a, b, c, d] = this.c as [V3, V3, V3, V3];
    const u = 1 - s;
    const w0 = u * u * u,
      w1 = 3 * u * u * s,
      w2 = 3 * u * s * s,
      w3 = s * s * s;
    return [
      a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3,
      a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3,
      a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3,
    ];
  }

  private raw(s: number): V3 {
    const m = this.meander;
    const env = Math.sin(Math.PI * s);
    const lateral = m.a * Math.sin(2 * Math.PI * m.k * s + m.phase) * env * env;
    const bob = m.bob * Math.sin(2 * Math.PI * m.k2 * s + m.phase2) * env;
    const p = addScaled(this.bezier(s), this.side, lateral);
    p[1] += bob;
    // Never below whatever is underneath.
    const floor = standingHeight(p[0], p[2]) + 0.012 * env;
    if (s > 0.02 && s < 0.98 && p[1] < floor) p[1] = floor;
    return p;
  }

  /** Curve parameter for a fraction `u` of the path's length. */
  private param(u: number): number {
    const target = clamp(u, 0, 1) * this.length;
    const lut = this.lut;
    let lo = 0,
      hi = lut.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid]! < target) lo = mid;
      else hi = mid;
    }
    const span = lut[hi]! - lut[lo]!;
    const f = span > 0 ? (target - lut[lo]!) / span : 0;
    return (lo + f) / (lut.length - 1);
  }

  /** Position a fraction `u` of the way along. */
  at(u: number): V3 {
    if (u <= 0) return this.from.position;
    if (u >= 1) return this.to.position;
    return this.raw(this.param(u));
  }

  /** Unit direction of travel a fraction `u` of the way along. */
  tangent(u: number): V3 {
    const e = 0.004;
    const a = this.raw(this.param(clamp(u - e, 0, 1))),
      b = this.raw(this.param(clamp(u + e, 0, 1)));
    const d = sub(b, a);
    return length(d) > 1e-9
      ? normalize(d)
      : normalize(sub(this.to.position, this.from.position));
  }
}

const frac = (x: number) => x - Math.floor(x);

/** Progress of `p` along the server's straight route from `from` to `to`, in [0, 1]. */
export function routeProgress(from: Vec2, to: Vec2, p: Vec2): number {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) return 1;
  return clamp(((p[0] - from[0]) * dx + (p[1] - from[1]) * dy) / d2, 0, 1);
}

/**
 * A walking journey's route over surfaces: down from the departure perch,
 * across the ground, up to the destination, as a polyline with normals.
 */
export class WalkPath {
  private readonly points: SurfacePoint[];
  private readonly cumulative: number[];
  readonly length: number;

  constructor(
    from: SurfacePoint,
    fromPlace: PlaceId,
    to: SurfacePoint,
    toPlace: PlaceId,
  ) {
    const down = STAGES[fromPlace].climb;
    const up = [...STAGES[toPlace].climb].reverse();
    const pts: SurfacePoint[] = [from, ...down];
    const a = down.at(-1)?.position ?? from.position,
      b = up[0]?.position ?? to.position;
    const steps = Math.max(1, Math.ceil(distance(a, b) / 0.15));
    for (let i = 1; i < steps; i++) {
      const p = mix(a, b, i / steps);
      p[1] = groundHeight(p[0], p[2]);
      pts.push({ position: p, normal: UP });
    }
    pts.push(...up, to);
    this.points = pts;
    this.cumulative = [0];
    for (let i = 1; i < pts.length; i++)
      this.cumulative.push(
        this.cumulative[i - 1]! + distance(pts[i - 1]!.position, pts[i]!.position),
      );
    this.length = this.cumulative.at(-1)!;
  }

  at(u: number): SurfacePoint & { forward: V3 } {
    const target = clamp(u, 0, 1) * this.length;
    let i = 1;
    while (i < this.points.length - 1 && this.cumulative[i]! < target) i++;
    const a = this.points[i - 1]!,
      b = this.points[i]!;
    const span = this.cumulative[i]! - this.cumulative[i - 1]!;
    const f = span > 0 ? clamp((target - this.cumulative[i - 1]!) / span, 0, 1) : 1;
    const normal = normalize(mix(a.normal, b.normal, f));
    const dir = sub(b.position, a.position);
    return {
      position: mix(a.position, b.position, f),
      normal,
      forward: tangentOf(length(dir) > 1e-9 ? dir : [1, 0, 0], normal),
    };
  }
}

/** Where a fly that stops mid-flight at `p` comes down: the surface below, never in the water. */
export function landingBelow(p: V3): SurfacePoint {
  let x = p[0],
    z = p[2];
  const sc = LAYOUT.saucer;
  const d = Math.hypot(x - sc.x, z - sc.z);
  if (d < sc.radius) {
    // Onto the rim rather than the water.
    const k = (sc.radius - sc.wall / 2) / Math.max(d, 1e-6);
    x = sc.x + (x - sc.x) * k;
    z = sc.z + (z - sc.z) * k;
  }
  return { position: [x, standingHeight(x, z), z], normal: UP };
}

// ------------------------------------------------------------ small things

/** The midge's 2D track as a point in the air above the lawn (an affine sheet; heights are not simulated). */
export function airPoint(p: Vec2): V3 {
  return [
    -0.15 + (p[0] - 0.55) * 4.0,
    0.72 + (0.4 - p[1]) * 2.6,
    -0.15 + (p[0] - 0.55) * 0.6,
  ];
}

/** The swaying leaf's offset from its resting place, metres (x right, y up). */
export function swayingLeafOffset(p: Vec2): [number, number] {
  return [(p[0] - 0.3) * 1.1, -(p[1] - 0.34) * 1.1];
}

/** Distance helper for tests and the camera: how far apart two places' anchors are. */
export const anchorDistance = (a: PlaceId, b: PlaceId) =>
  distance(STAGES[a].anchor, STAGES[b].anchor);
export { dot };
