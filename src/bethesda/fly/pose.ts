/**
 * Joint angles for drawing the fly: FlyBody's skeleton posed from the
 * simulated state. Nothing here feeds back into the simulation.
 *
 * Legs. On a surface every foot is placed by inverse kinematics on FlyBody's
 * own leg chain (coxa 3, femur 2, tibia 1 hinge, within the MJCF's ranges;
 * the tarsus follows at zero). The standing footprint is FlyBody's `qpos0`
 * stance lowered into the 0.8 crouch the simulator stands at. Walking moves
 * each foot through a stance (sliding back at the stride the simulated speed
 * and step period give, so a planted foot stays near its spot on the ground)
 * and a swing (lifted forward), on the simulator's per-leg phases: the drawn
 * tripod or tetrapod is the simulated one. A turn in place sweeps the planted
 * feet against the turn. Grooming moves the front legs to the head (eyes,
 * antennae) or the hind legs to the abdomen (abdomen, wings, notum) in small
 * circles. In flight the legs blend from FlyBody's retracted spring
 * references toward the zero pose as the simulator extends them to land.
 *
 * Wings. Folded at their spring references at rest; in flight FlyBody's
 * prototype stroke (`wing.ts`) at the simulator's beat frequency and per-side
 * amplitude, sampled at the renderer's clock. Halteres swing in antiphase.
 *
 * This is a kinematic drawing, not a contact or musculoskeletal simulation:
 * feet are placed, not pressed, and the stroke is a prototype pattern.
 */
import {
  bodyLocal,
  clamp,
  compose,
  IDENTITY,
  restAngles,
  type BodyDef,
  type Frame,
  type Vec3,
} from "./kinematics.js";
import {
  dutyFactor,
  LEGS,
  legPhases,
  phaseLag,
  stepPeriodS,
  strideCm,
  type GaitParams,
  type Leg,
} from "./gait.js";
import type { GroomRoutine, Mode } from "./neural.js";
import { PARAMS } from "./params.js";
import { SKELETON, type Skeleton } from "./skeleton.js";
import { strokeAt, type WingAngles } from "./wing.js";

/** What the pose needs from the (interpolated) simulated state. */
export interface PoseInput {
  mode: Mode;
  groom: GroomRoutine | null;
  /** 0 retracted (flight), 1 extended (standing or about to land). */
  legs: number;
  /** 0 folded, 1 spread or beating. */
  wingsOpen: number;
  walkSpeed: number;
  gaitClock: number;
  yawRate: number;
  /** Wingbeat phase in radians, advanced on the renderer's clock. */
  wingPhase: number;
  ampL: number;
  ampR: number;
  /** Seconds, the renderer's clock, for grooming rubs. */
  time: number;
}

const SEGMENTS = [
  "coxa",
  "femur",
  "tibia",
  "tarsus",
  "tarsus2",
  "tarsus3",
  "tarsus4",
  "claw",
];
/** The coxa, femur and tibia carry the inverse kinematics. */
const IK_BODIES = 3;
const LAMBDA = 0.02; // cm: damping for the least-squares step
const ITERATIONS = 12;

interface Dof {
  body: number;
  joint: number;
  lo: number;
  hi: number;
}
interface Chain {
  leg: Leg;
  bodies: BodyDef[];
  dofs: Dof[];
  /** Current IK solution, warm-started frame to frame. */
  theta: Float64Array;
  /** The claw origin at FlyBody's zero pose, thorax frame (cm). */
  zero: Vec3;
  /** Tibia to claw with the tarsus at zero: fixed, so composed once. */
  tail: Frame;
}

export class PoseSolver {
  readonly skeleton: Skeleton;
  private gait: GaitParams;
  private chains: Chain[];
  private byName: Map<string, BodyDef>;
  /** The surface in the thorax frame when standing: z (cm). */
  readonly footZ: number;
  private headPoint: Vec3;
  private abdomenPoint: Vec3;
  private out = new Map<string, number[]>();

  constructor(gait: GaitParams, skeleton: Skeleton = SKELETON) {
    this.skeleton = skeleton;
    this.gait = gait;
    this.byName = new Map(skeleton.bodies.map((b) => [b.name, b]));
    this.chains = LEGS.map((leg) => {
      const bodies = SEGMENTS.map((s) => this.body(`${s}_${leg}`));
      const dofs: Dof[] = [];
      bodies
        .slice(0, IK_BODIES)
        .forEach((b, bi) =>
          b.joints.forEach((j, ji) =>
            dofs.push({ body: bi, joint: ji, lo: j.range[0], hi: j.range[1] }),
          ),
        );
      const tail = bodies
        .slice(IK_BODIES)
        .reduce<Frame>((f, b) => compose(f, bodyLocal(b, [])), IDENTITY);
      const chain: Chain = {
        leg,
        bodies,
        dofs,
        theta: new Float64Array(dofs.length),
        zero: [0, 0, 0],
        tail,
      };
      chain.zero = this.claw(chain, chain.theta);
      return chain;
    });
    // In FlyBody's zero pose (every joint at 0, the MJCF reference, not a
    // measured stance) the lowest claw tips are standingHeight below the
    // thorax; `lowest` is the claw origins, a little higher. The simulator
    // stands the thorax at `standingCrouch` (0.8) of that height, so each
    // claw is placed (1 − 0.8) × standingHeight above its zero-pose height:
    // the tips meet the surface and the legs bend to reach it. A drawing
    // choice, not fitted (params.ts).
    const h0 = skeleton.measures.standingHeightCm;
    const lowest = Math.min(...this.chains.map((c) => c.zero[2]));
    this.footZ = lowest + (1 - PARAMS.standingCrouch.value) * h0;
    const zero = this.frames();
    this.headPoint = zero.get("head")!.p;
    this.abdomenPoint = zero.get("abdomen_3")?.p ?? zero.get("abdomen")!.p;
    // Settle the standing pose once, so the first drawn frame already stands.
    for (const chain of this.chains)
      for (let k = 0; k < 6; k++)
        this.reach(chain, [chain.zero[0], chain.zero[1], this.footZ]);
  }

  private body(name: string): BodyDef {
    const b = this.byName.get(name);
    if (!b) throw new Error(`FlyBody has no body ${name}`);
    return b;
  }

  private frames(
    angles: (b: BodyDef) => readonly number[] = () => [],
  ): Map<string, Frame> {
    const out = new Map<string, Frame>();
    for (const b of this.skeleton.bodies) {
      const local = bodyLocal(b, angles(b));
      out.set(b.name, b.parent === null ? local : compose(out.get(b.parent)!, local));
    }
    return out;
  }

  /** The claw origin for chain angles `theta`, in the thorax frame. */
  private claw(chain: Chain, theta: ArrayLike<number>): Vec3 {
    let f: Frame = IDENTITY;
    let k = 0;
    for (let bi = 0; bi < IK_BODIES; bi++) {
      const b = chain.bodies[bi]!;
      f = compose(
        f,
        bodyLocal(
          b,
          b.joints.map(() => theta[k++]!),
        ),
      );
    }
    return compose(f, chain.tail).p;
  }

  /** Damped least squares toward `target`, from the chain's last solution. */
  private reach(chain: Chain, target: Vec3): void {
    const th = chain.theta;
    const n = th.length;
    const J = new Float64Array(3 * n);
    for (let it = 0; it < ITERATIONS; it++) {
      const p = this.claw(chain, th);
      const e = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
      if (Math.hypot(e[0]!, e[1]!, e[2]!) < 1e-5) return;
      for (let k = 0; k < n; k++) {
        const save = th[k]!;
        th[k] = save + 1e-4;
        const q = this.claw(chain, th);
        th[k] = save;
        for (let r = 0; r < 3; r++) J[r * n + k] = (q[r]! - p[r]!) / 1e-4;
      }
      // (J Jᵀ + λ² I) y = e, then Δθ = Jᵀ y.
      const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          let s = r === c ? LAMBDA * LAMBDA : 0;
          for (let k = 0; k < n; k++) s += J[r * n + k]! * J[c * n + k]!;
          A[r * 3 + c] = s;
        }
      const y = solve3(A, e);
      for (let k = 0; k < n; k++) {
        let d = 0;
        for (let r = 0; r < 3; r++) d += J[r * n + k]! * y[r]!;
        const dof = chain.dofs[k]!;
        th[k] = clamp(th[k]! + d, dof.lo, dof.hi);
      }
    }
  }

  /** Joint angles per body for this state. The map is reused between calls. */
  solve(s: PoseInput): ReadonlyMap<string, readonly number[]> {
    const out = this.out;
    out.clear();
    const perched = s.mode !== "flight" && s.mode !== "land";
    const speed = s.mode === "walk" ? s.walkSpeed : 0;
    const walking = speed > 0.05;
    const duty = walking ? dutyFactor(speed, this.gait) : 1;
    const stride = walking ? strideCm(speed, this.gait) : 0;
    const period = walking ? stepPeriodS(speed, this.gait) : 1;
    const phases = walking ? legPhases(s.gaitClock, phaseLag(speed, this.gait)) : null;
    const lift = clamp(stride * 0.25, 0.008, 0.025);
    this.chains.forEach((chain, i) => {
      const segment = i % 3,
        left = i < 3;
      if (perched && s.legs > 0.5) {
        const target: Vec3 = [chain.zero[0], chain.zero[1], this.footZ];
        const groomer =
          s.mode === "groom" &&
          ((segment === 0 && (s.groom === "eyes" || s.groom === "antennae")) ||
            (segment === 2 &&
              (s.groom === "abdomen" || s.groom === "wings" || s.groom === "notum")));
        if (groomer) {
          const at = segment === 0 ? this.headPoint : this.abdomenPoint;
          const w = 2 * Math.PI * 5 * s.time + (left ? 0 : Math.PI);
          const side = left ? 1 : -1;
          const reachOut =
            segment === 0
              ? [at[0] + 0.035, at[1] + side * 0.012, at[2] - 0.01]
              : [
                  at[0] - 0.02,
                  at[1] + side * 0.03,
                  at[2] + (s.groom === "abdomen" ? -0.01 : 0.03),
                ];
          target[0] = reachOut[0]! + 0.008 * Math.cos(w);
          target[1] = reachOut[1]!;
          target[2] = reachOut[2]! + 0.008 * Math.sin(w);
        } else if (phases) {
          const ph = phases[i]!;
          let dx: number, dz: number, u: number;
          if (ph < duty) {
            u = ph / duty;
            dx = stride * (0.5 - u);
            dz = 0;
          } else {
            u = (ph - duty) / (1 - duty);
            dx = stride * (u - 0.5);
            dz = lift * Math.sin(Math.PI * u);
          }
          target[0] += dx;
          target[2] += dz;
        }
        if (s.mode === "walk" && Math.abs(s.yawRate) > 1e-3) {
          // A planted foot sweeps against the turn about the thorax's vertical.
          const a = -s.yawRate * period * 0.5 * (phases ? 0.5 - (phases[i]! % 1) : 0.5);
          const c = Math.cos(a),
            sn = Math.sin(a);
          const x = target[0],
            y = target[1];
          target[0] = x * c - y * sn;
          target[1] = x * sn + y * c;
        }
        this.reach(chain, target);
        let k = 0;
        chain.bodies.forEach((b, bi) =>
          out.set(
            b.name,
            bi < IK_BODIES
              ? b.joints.map(() => chain.theta[k++]!)
              : b.joints.map(() => 0),
          ),
        );
      } else {
        // In the air: spring references (retracted) blended to zero (extended).
        const t = clamp(s.legs, 0, 1);
        for (const b of chain.bodies)
          out.set(
            b.name,
            restAngles(b).map((r) => r * (1 - t)),
          );
        chain.theta.fill(0);
      }
    });
    const beating =
      s.mode === "flight" ||
      s.mode === "land" ||
      s.mode === "takeoff" ||
      s.mode === "escape";
    for (const [name, amp] of [
      ["wing_left", s.ampL],
      ["wing_right", s.ampR],
    ] as const) {
      const b = this.body(name);
      const folded = restAngles(b);
      const range = {
        yaw: b.joints[0]!.range,
        roll: b.joints[1]!.range,
        pitch: b.joints[2]!.range,
      };
      const spread: WingAngles = strokeAt(
        beating && s.wingsOpen >= 0.999 ? s.wingPhase : Math.PI / 2,
        amp || 1,
        range,
      );
      const t = clamp(s.wingsOpen, 0, 1);
      out.set(name, [
        folded[0]! + (spread.yaw - folded[0]!) * t,
        folded[1]! + (spread.roll - folded[1]!) * t,
        folded[2]! + (spread.pitch - folded[2]!) * t,
      ]);
    }
    for (const name of ["haltere_left", "haltere_right"]) {
      const b = this.body(name);
      const j = b.joints[0]!;
      const a =
        beating && s.wingsOpen > 0.5
          ? 0.9 * j.range[1] * Math.sin(s.wingPhase + Math.PI)
          : 0;
      out.set(name, [clamp(a, j.range[0], j.range[1])]);
    }
    return out;
  }
}

function solve3(A: number[], b: number[]): number[] {
  const [a, bb, c, d, e, f, g, h, i] = A as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return [0, 0, 0];
  const inv = [
    e * i - f * h,
    c * h - bb * i,
    bb * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    bb * g - a * h,
    a * e - bb * d,
  ];
  return [0, 1, 2].map(
    (r) =>
      (inv[r * 3]! * b[0]! + inv[r * 3 + 1]! * b[1]! + inv[r * 3 + 2]! * b[2]!) / det,
  );
}

/** Claw origins for a pose, thorax frame — for tests and the inspection view. */
export function clawPoints(
  angles: ReadonlyMap<string, readonly number[]>,
  skeleton: Skeleton = SKELETON,
): Vec3[] {
  const frames = new Map<string, Frame>();
  for (const b of skeleton.bodies) {
    const local = bodyLocal(b, angles.get(b.name) ?? []);
    frames.set(b.name, b.parent === null ? local : compose(frames.get(b.parent)!, local));
  }
  return LEGS.map((leg) => frames.get(`claw_${leg}`)!.p);
}
