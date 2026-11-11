/**
 * An Eva-kind research subject in the garden commons.
 *
 * Research only. Her kind is her service's code, ported step for step
 * (`../eva/`), with its two research seams; nothing of hers is changed.
 * What the commons adds is a body and a shared place:
 *
 * - **Her body** is where the exhibit draws her. Her simulation is a 2D
 *   garden of seven places stepped every 5 s; the exhibit's director
 *   (`src/garden/core/performance.ts`) turns two consecutive states into
 *   the 3D pose visitors see. Here that pose, raised by FlyBody's standing
 *   height along her "up", is her body's centre, a solid sphere to the
 *   other occupant as any fly's is.
 * - **Her step and the other body: predict, then verify.** Her step at time
 *   `now` moves her over the 5 s before it. At the start of each 5 s the
 *   occupant steps a copy of her (`EvaGarden.restore`) to learn where she
 *   will go, and her body follows the director's pose across those 5 s. If
 *   on the way it would enter the other's body, it stops there; when her
 *   real step runs at the end of the 5 s, her `obstruct` seam ends her
 *   motion at the same share of the way, so her own physics and her own
 *   learner meet the collision (`learning.ts`: her estimates take in what
 *   her body actually did). If nothing stopped her, the real step must land
 *   exactly where the copy did (`mismatches` counts any that did not).
 * - **What she perceives of the other**: through her own object tracker
 *   (`perceive`), as one more thing in her garden, at its position mapped
 *   into her 2D frame, and only while it is in line of sight and near
 *   enough to cover at least one ommatidium of a fly's eye (FlyBody's
 *   inter-ommatidial angle). Her tracker reads each thing at the start and
 *   the end of her step; both ends map the other's 3D position into her
 *   frame through the same staging, so a still body is still to her however
 *   the exhibit animates her own. Her tracker, not this module, decides
 *   whether it moves on its own. The key it carries ("small-mover")
 *   describes what is sensed and names no one. Nothing in her decisions
 *   reads her tracker (her code: it only reports what it follows), so what
 *   she perceives of the other is recorded in her state and changes nothing
 *   she does; only a stop changes that.
 * - **What the other perceives of her**: her body, to its eyes as a moving
 *   thing and to its legs as touch and her (synthetic) surface chemistry.
 *
 * Her kind has no touch or taste of its own; nothing is added to it. Her
 * body is not held to the commons' solids (her world has none: the director
 * places it on the exhibit's surfaces), only to the other's body.
 */
import { LAYOUT } from "../../../garden/core/layout.js";
import {
  parseObservation,
  type Observation,
  type PlaceId,
} from "../../../garden/core/observation.js";
import { perform } from "../../../garden/core/performance.js";
import { STAGES } from "../../../garden/core/stage.js";
import { PARAMS } from "../../fly/params.js";
import type { V3 } from "../../fly/units.js";
import { birth, EvaGarden, PLACE_IDS, type BirthOptions } from "../eva/garden.js";
import type { Action, Point } from "../eva/learning.js";
import type { PlasticityMode } from "../eva/plasticity.js";
import type { SurfaceChemistry } from "../socialSensing.js";
import {
  FLY_BODY_LENGTH_M,
  FLY_BODY_RADIUS_M,
  type BodyPose,
  type Commons,
  type Occupant,
} from "./commons.js";

/** Her step (s): `World.advance`. */
export const EVA_STEP_S = 5;
/** FlyBody's standing height (m): the exhibit raises her body by it. */
export const EVA_STANDING_M = 0.00132;
/** Within this distance of the other body her pose is computed every commons step (m). */
export const POSE_NEAR_M = 0.1;
/** Farther away, every this often (s): her fastest flight moves well under POSE_NEAR_M in it. */
export const POSE_FAR_S = 0.05;
/** The key her tracker follows the other by. */
export const PERCEIVED_KEY = "small-mover";
/**
 * Farthest she perceives a fly-sized body: where it covers one ommatidium,
 * body length / tan(inter-ommatidial angle) (m).
 */
export const EVA_PERCEPTION_M =
  FLY_BODY_LENGTH_M / Math.tan((PARAMS.interommatidialDeg.value * Math.PI) / 180);

export const EVA_OCCUPANT_APPROXIMATIONS = Object.freeze([
  "her body is the exhibit director's pose (a presentation of her 2D state), held to the other's body and to nothing else in the commons",
  "a stop part-way through her 5 s step is passed to her physics as the same share of her straight 2D motion (the director's 3D path is not linear in it)",
  "her perception of the other maps its 3D position into her 2D frame through the staging of her place at the step's start (the inverse of the exhibit's perch mapping), or in the air through a least-squares affine fit of her seven places to their exhibit anchors (`PLAN_FIT`, whose residual is large: the staging is not affine)",
  "she perceives the other within one ommatidium's reach in line of sight; her own model has no eyes",
]);

/** Least-squares affine map between her 2D garden fractions and the exhibit's plan (x, z). */
function fitPlan() {
  const rows = PLACE_IDS.map((id) => {
    const st = STAGES[id];
    return { u: st.plan[0], v: st.plan[1], x: st.anchor[0], z: st.anchor[2] };
  });
  // Solve [x z] = [u v 1] · M (3×2) by the normal equations.
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0],
    bz = [0, 0, 0];
  for (const r of rows) {
    const f = [r.u, r.v, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i]![j]! += f[i]! * f[j]!;
      bx[i]! += f[i]! * r.x;
      bz[i]! += f[i]! * r.z;
    }
  }
  const solve = (b: number[]) => {
    const m = A.map((row, i) => [...row, b[i]!]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let k = c + 1; k < 3; k++)
        if (Math.abs(m[k]![c]!) > Math.abs(m[p]![c]!)) p = k;
      [m[c], m[p]] = [m[p]!, m[c]!];
      for (let k = 0; k < 3; k++) {
        if (k === c) continue;
        const f = m[k]![c]! / m[c]![c]!;
        for (let j = c; j < 4; j++) m[k]![j]! -= f * m[c]![j]!;
      }
    }
    return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
  };
  const mx = solve(bx),
    mz = solve(bz);
  const forward = (u: number, v: number): [number, number] => [
    mx[0]! * u + mx[1]! * v + mx[2]!,
    mz[0]! * u + mz[1]! * v + mz[2]!,
  ];
  const det = mx[0]! * mz[1]! - mx[1]! * mz[0]!;
  const inverse = (x: number, z: number): Point => {
    const dx = x - mx[2]!,
      dz = z - mz[2]!;
    return [(mz[1]! * dx - mx[1]! * dz) / det, (-mz[0]! * dx + mx[0]! * dz) / det];
  };
  const residual = Math.sqrt(
    rows.reduce((s, r) => {
      const [x, z] = forward(r.u, r.v);
      return s + (x - r.x) ** 2 + (z - r.z) ** 2;
    }, 0) / rows.length,
  );
  return { forward, inverse, residualM: residual };
}

export const PLAN_FIT = fitPlan();

/**
 * A 3D offset as an offset in her 2D frame: at a place, through that
 * place's own staging (the inverse of `perchPoint`'s
 * `scale · (du·ax + dv·ay)`, by least squares in 3D); in the air, through
 * the plan fit's linear part. Only points within her perception reach of
 * her body are ever mapped (`inPlan`), near her place's anchor.
 */
export function localOffset(place: (typeof PLACE_IDS)[number] | null, d: V3): Point {
  if (place) {
    const st = STAGES[place];
    const a = st.ax.map((v) => v * st.scale),
      b = st.ay.map((v) => v * st.scale);
    const aa = a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!,
      bb = b[0]! * b[0]! + b[1]! * b[1]! + b[2]! * b[2]!,
      ab = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const ad = a[0]! * d[0] + a[1]! * d[1] + a[2]! * d[2],
      bd = b[0]! * d[0] + b[1]! * d[1] + b[2]! * d[2];
    const det = aa * bb - ab * ab;
    if (Math.abs(det) > 1e-12)
      return [(bb * ad - ab * bd) / det, (aa * bd - ab * ad) / det];
  }
  const o = PLAN_FIT.inverse(0, 0),
    q = PLAN_FIT.inverse(d[0], d[2]);
  return [q[0] - o[0], q[1] - o[1]];
}

/**
 * A 3D point as a position in her 2D frame: at a place, her place's plan
 * point plus the point's offset from that place's 3D anchor through its
 * staging (`localOffset`); in the air, through the plan fit.
 */
export function inPlan(place: PlaceId | null, q: V3): Point {
  if (place) {
    const st = STAGES[place];
    const [du, dv] = localOffset(place, [
      q[0] - st.anchor[0],
      q[1] - st.anchor[1],
      q[2] - st.anchor[2],
    ]);
    return [st.plan[0] + du, st.plan[1] + dv];
  }
  return PLAN_FIT.inverse(q[0], q[2]);
}

function observe(garden: EvaGarden): Observation {
  const snap = garden.snapshot();
  return parseObservation({ ...snap, server_time: snap.updated_at });
}

export interface EvaOccupantOptions {
  /** A research id: `research-…`. */
  lifeId: string;
  seed: string;
  /** Unix seconds; her clock is this plus commons time. */
  bornAt: number;
  plasticity?: PlasticityMode | "off";
  body?: BirthOptions["body"];
  chemistry: SurfaceChemistry | null;
  commons: Commons;
  index: 0 | 1;
}

export class EvaOccupant implements Occupant {
  readonly id: string;
  readonly chemistry: SurfaceChemistry | null;
  readonly garden: EvaGarden;
  private readonly mode: PlasticityMode | "off";
  private readonly commons: Commons;
  private readonly index: 0 | 1;
  private readonly bornAt: number;
  /** Seconds since joining (commons time). */
  private t = 0;
  private t0 = 0;
  private posedAt = -Infinity;
  private prev: Observation;
  private next: Observation;
  /** Share of the current 5 s at which her body was stopped, or null. */
  private stoppedAt: number | null = null;
  private current: { center: V3; yaw: number };
  private speed = 0;
  /** Steps where the real step did not land where the copy did, without a stop. */
  mismatches = 0;
  /** Steps in which her body was stopped by the other's. */
  stops = 0;
  /** Steps her tracker had the other in view. */
  perceivedSteps = 0;
  /** Commons steps in which the two bodies overlapped (only after a jump between anchors). */
  overlapSteps = 0;
  /**
   * Her tracker reads where each thing was at the start of her step and where
   * it is at the end (her own midge and leaf are functions of time). What she
   * could see of the other at the start is captured then; the end is seen
   * live. Both ends of a step map the other's 3D position into her 2D frame
   * through the same staging (her place at the step's start), so a still body
   * stays still to her however the exhibit animates her own.
   */
  private seenAtStart: {
    at: number;
    place: PlaceId | null;
    seen: Record<string, Point>;
  } = { at: Number.NaN, place: null, seen: {} };

  constructor(o: EvaOccupantOptions) {
    this.id = o.lifeId;
    this.chemistry = o.chemistry ? [...o.chemistry] : null;
    this.mode = o.plasticity ?? "off";
    this.commons = o.commons;
    this.index = o.index;
    this.bornAt = o.bornAt;
    this.garden = birth({
      lifeId: o.lifeId,
      seed: o.seed,
      bornAt: o.bornAt,
      plasticity: this.mode,
      ...(o.body ? { body: o.body } : {}),
      perceive: (now) => this.perceive(now),
      obstruct: (start, end, action) => this.obstruct(start, end, action),
    });
    this.prev = observe(this.garden);
    this.next = this.predict();
    this.current = this.poseAt(0);
  }

  /** Captures what she sees of the other now, as the start of her current step. */
  private captureStart(): void {
    const place = this.prev.travel ? null : this.prev.place;
    this.seenAtStart = { at: this.prev.updatedAt, place, seen: this.sight(place) };
  }

  private other(): BodyPose | null {
    return this.commons.poseOf(this.index === 0 ? 1 : 0);
  }

  /** Her tracker's view of the other at `now`: the start of her step, or its end. */
  private perceive(now: number): Record<string, Point> {
    // Nothing to see until the other is placed (and before her own first step is set up).
    if (!this.other() || !this.next) return {};
    if (Math.abs(now - this.seenAtStart.at) < 1e-6) return this.seenAtStart.seen;
    return this.sight(this.seenAtStart.place);
  }

  /**
   * What she sees of the other now: within reach of her body, in line of
   * sight, at its position in her 2D frame through `place`'s staging (null:
   * in the air, through `PLAN_FIT`).
   */
  private sight(place: PlaceId | null): Record<string, Point> {
    const o = this.other();
    if (!o) return {};
    const p = this.current?.center;
    if (!p) return {};
    const d = Math.hypot(o.center[0] - p[0], o.center[1] - p[1], o.center[2] - p[2]);
    if (d > EVA_PERCEPTION_M) return {};
    if (d > 1e-9) {
      const dir: V3 = [
        (o.center[0] - p[0]) / d,
        (o.center[1] - p[1]) / d,
        (o.center[2] - p[2]) / d,
      ];
      if (this.commons.world.raycast(p, dir, Math.max(0, d - o.radius), true)) return {};
    }
    return { [PERCEIVED_KEY]: inPlan(place, o.center) };
  }

  private obstruct(start: Point, end: Point, action: Action): Point {
    if (this.stoppedAt === null || (action !== "fly" && action !== "walk")) return end;
    const f = this.stoppedAt;
    return [start[0] + f * (end[0] - start[0]), start[1] + f * (end[1] - start[1])];
  }

  /** Where a copy of her is after her next step: her step does not read the other's body. */
  private predict(): Observation {
    const memory = this.garden.plasticityMemory();
    const copy = EvaGarden.restore(this.garden.state(), {
      plasticity: this.mode,
      ...(memory ? { memory } : {}),
    });
    copy.advance(this.garden.state().updated_at + EVA_STEP_S);
    const snap = copy.snapshot();
    return parseObservation({ ...snap, server_time: snap.updated_at });
  }

  private poseAt(elapsed: number): { center: V3; yaw: number } {
    const tau = Math.max(0, Math.min(1, elapsed / EVA_STEP_S));
    const pose = perform(
      { prev: this.prev, next: this.next, tau, late: 0, discontinuous: false },
      this.prev.updatedAt + tau * EVA_STEP_S,
    );
    const c: V3 = [
      pose.position[0] + pose.up[0] * EVA_STANDING_M,
      pose.position[1] + pose.up[1] * EVA_STANDING_M,
      pose.position[2] + pose.up[2] * EVA_STANDING_M,
    ];
    return { center: c, yaw: Math.atan2(-pose.forward[2], pose.forward[0]) };
  }

  pose(): BodyPose {
    return {
      center: [this.current.center[0], this.current.center[1], this.current.center[2]],
      yaw: this.current.yaw,
      radius: FLY_BODY_RADIUS_M,
      speed: this.speed,
    };
  }

  step(dt: number): void {
    // Her first step's start is seen at her first commons step, once both are placed.
    if (this.t === 0) this.captureStart();
    this.t += dt;
    const before = this.current.center;
    if (this.t - this.t0 >= EVA_STEP_S - 1e-9) {
      const predicted = this.next;
      this.garden.advance(this.bornAt + this.t0 + EVA_STEP_S);
      const real = observe(this.garden);
      if (this.stoppedAt !== null) this.stops++;
      else if (
        real.ticks !== predicted.ticks ||
        real.position[0] !== predicted.position[0] ||
        real.position[1] !== predicted.position[1] ||
        real.activity !== predicted.activity ||
        real.place !== predicted.place
      )
        this.mismatches++;
      if (real.learning?.nearby?.some((n) => n.name === PERCEIVED_KEY))
        this.perceivedSteps++;
      this.t0 += EVA_STEP_S;
      this.prev = real;
      this.next = this.predict();
      this.stoppedAt = null;
      this.captureStart();
    }
    const elapsed = this.t - this.t0;
    const o = this.other();
    // Her pose every commons step near the other body, else every POSE_FAR_S.
    const far =
      !o ||
      Math.hypot(
        o.center[0] - before[0],
        o.center[1] - before[1],
        o.center[2] - before[2],
      ) > POSE_NEAR_M;
    if (far && elapsed > 1e-9 && this.t - this.posedAt < POSE_FAR_S - 1e-9) {
      return;
    }
    const sinceLast = this.t - this.posedAt;
    this.posedAt = this.t;
    const candidate = this.poseAt(elapsed);
    const gap = (c: V3) =>
      o
        ? Math.hypot(c[0] - o.center[0], c[1] - o.center[1], c[2] - o.center[2]) -
          (FLY_BODY_RADIUS_M + o.radius)
        : Infinity;
    // Her body never moves into the other's, nor deeper into it (after a jump
    // between the director's anchors). The first refused move in a step is
    // where that step's motion stops; she stays there until the step ends.
    const refused =
      gap(candidate.center) < 0 && gap(candidate.center) < gap(this.current.center);
    if (refused && this.stoppedAt === null)
      this.stoppedAt = Math.max(0, Math.min(1, elapsed / EVA_STEP_S));
    if (this.stoppedAt === null) this.current = candidate;
    if (gap(this.current.center) < 0) this.overlapSteps++;
    const c = this.current.center;
    this.speed = Math.hypot(c[0] - before[0], c[2] - before[2]) / Math.max(dt, sinceLast);
  }

  /** Her tracker's record of the other, as her `/state` shows it. */
  trackOfOther() {
    return this.garden.state().learning.objects[PERCEIVED_KEY] ?? null;
  }
}

/** The exhibit places the pear at LAYOUT.pear; exported for scripts. */
export const GARDEN_PEAR = LAYOUT.pear;
