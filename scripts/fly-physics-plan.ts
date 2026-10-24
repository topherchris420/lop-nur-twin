/**
 * The digital fly's walking plan, sampled for FlyBody's physics.
 *
 * The browser fly (src/bethesda/fly/) moves a reduced-order body and draws its
 * legs by inverse kinematics on FlyBody's own leg chains (pose.ts). This
 * module runs that fly in an empty arena under a scripted decision maker,
 * whose every command passes the fly's own gate like any controller's, and
 * samples what the browser would draw on FlyBody's 2 ms walking control clock:
 * the thorax path, each leg's stance or swing, and the joint angles the pose
 * solver gives FlyBody's leg actuators. The research backend in fly-physics/
 * drives FlyBody's MuJoCo model with those angles and measures how far the
 * physical body follows the plan.
 *
 * Nothing here changes the fly. It reads the fly's state after each 5 ms step
 * and interpolates between steps the way FlyView does: position, heading,
 * walking speed and leg extension linearly, the turn rate from the later step,
 * and the gait clock advanced from the earlier step at the stepping speed's
 * period. The joint angles are then solved for each sample in order, so the
 * solver's warm start is the same every run. One scenario on one JavaScript
 * engine always writes the same bytes.
 */
import { arenaWorld } from "../src/bethesda/fly/arena.js";
import { DigitalFly, FLY_VERSION, type FlyState } from "../src/bethesda/fly/fly.js";
import {
  dutyFactor,
  LEGS,
  legPhases,
  phaseLag,
  stepPeriodS,
  steppingSpeedCmS,
  STEPPING_MIN_CMS,
} from "../src/bethesda/fly/gait.js";
import type {
  AdapterDescriptor,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../src/bethesda/fly/neural.js";
import { clawPoints, PoseSolver } from "../src/bethesda/fly/pose.js";
import { FOOT_RADIUS_CM, SKELETON } from "../src/bethesda/fly/skeleton.js";
import { forward, left, wrapAngle, type V3 } from "../src/bethesda/fly/units.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";
import { sha256Json } from "../src/rain/sha256.js";

export const TRACE_SCHEMA = "fly-physics-trace/v1" as const;
/** FlyBody's walking control timestep (`_WALK_CONTROL_TIMESTEP`, flybody/tasks/constants.py). */
export const CONTROL_DT_S = 0.002;
/** Where the fly stands, and the way it faces (world frame: +x east, +y up, yaw 0 facing east). */
const START: V3 = [0, 0.5, 0];
const START_YAW = 0;
/** The lab's empty 4 m room: nothing within reach of a walk of a few centimetres. */
const ROOM = { size: [4, 2.5, 4] as V3, ambient: 0.6 };

export interface PhysicsScenario {
  id: string;
  description: string;
  /** The commanded walking speed (cm/s) and turn rate (rad/s, + left), held for the whole plan. */
  walkSpeedCmS: number;
  yawRate: number;
  durationS: number;
  /** Seeds the fly's random streams; the scripted plan itself draws nothing. */
  seed: number;
}

/** The fixed plans the backend replays. */
export const PHYSICS_SCENARIOS: readonly PhysicsScenario[] = [
  {
    id: "walk-1cms",
    description: "straight walking at 1 cm/s",
    walkSpeedCmS: 1,
    yawRate: 0,
    durationS: 2,
    seed: 1,
  },
  {
    id: "walk-2cms",
    description: "straight walking at 2 cm/s",
    walkSpeedCmS: 2,
    yawRate: 0,
    durationS: 2,
    seed: 1,
  },
  {
    id: "walk-3cms",
    description: "straight walking at 3 cm/s",
    walkSpeedCmS: 3,
    yawRate: 0,
    durationS: 2,
    seed: 1,
  },
  {
    id: "turn-on-the-spot",
    description: "turning on the spot at 2 rad/s to the left",
    walkSpeedCmS: 0,
    yawRate: 2,
    durationS: 2,
    seed: 1,
  },
  {
    id: "walk-and-turn",
    description: "walking at 2 cm/s while turning at 1 rad/s to the left",
    walkSpeedCmS: 2,
    yawRate: 1,
    durationS: 2,
    seed: 1,
  },
];

export const PLAN_DESCRIPTOR: AdapterDescriptor = {
  id: "fly-physics-plan/v1",
  label: "Scripted walking plan for the physics backend",
  fidelity:
    "Commands one walking speed and turn rate for the whole run; no sensing, no neurons, no behaviour.",
  simulatesNeurons: false,
  regions: [],
};

/**
 * The scripted decision maker: from rest it walks, and while walking it keeps
 * the scenario's speed and turn rate. It answers through the fly's gate like
 * any other controller and never touches the body.
 */
export class PlanAdapter implements FlyNeuralAdapter {
  readonly descriptor = PLAN_DESCRIPTOR;
  private readonly scenario: PhysicsScenario;
  constructor(scenario: PhysicsScenario) {
    this.scenario = scenario;
  }
  decide(input: DecisionInput): MotorCommand {
    const mode = input.body.mode;
    if (mode !== "rest" && mode !== "walk")
      return { mode, reason: "fly-physics plan: not walking, hold" };
    const { walkSpeedCmS, yawRate } = this.scenario;
    return {
      mode: "walk",
      walkSpeed: walkSpeedCmS,
      yawRate,
      reason: `fly-physics plan: walk at ${walkSpeedCmS} cm/s, turning at ${yawRate} rad/s`,
    };
  }
}

/** FlyBody's eight leg actuators per leg: seven joints and the tarsus tendon (`tarsus2_*`). */
const LEG_JOINTS = [
  "coxa_abduct",
  "coxa_twist",
  "coxa",
  "femur_twist",
  "femur",
  "tibia",
  "tarsus",
] as const;
export const LEG_ACTUATORS: readonly string[] = LEGS.flatMap((leg) => [
  ...LEG_JOINTS.map((j) => `${j}_${leg}`),
  `tarsus2_${leg}`,
]);

const JOINT_RANGES = new Map(
  SKELETON.bodies.flatMap((b) => b.joints.map((j) => [j.name, j.range] as const)),
);
const TENDONS = new Map(SKELETON.tendons.map((t) => [t.name, t.joints] as const));
for (const name of LEG_ACTUATORS)
  if (!JOINT_RANGES.has(name) && !TENDONS.has(name))
    throw new Error(`FlyBody has no joint or tendon ${name}`);

export interface PhysicsTrace {
  schema: typeof TRACE_SCHEMA;
  scenario: PhysicsScenario;
  fly: {
    version: string;
    source_sha256: string;
    controller: string;
    /** The reduced-order body's integration step (s); samples fall between steps. */
    physics_step_s: number;
    /** The thorax's height above the surface it stands on (cm). */
    standing_height_cm: number;
    /** Commands the fly's gate refused while the plan ran: always 0, or there is no trace. */
    gate_refusals: number;
  };
  engine: { runtime: string; version: string };
  frame: string;
  sampling: { dt_s: number; count: number; interpolation: string };
  legs: readonly string[];
  actuators: readonly string[];
  samples: {
    t: number[];
    /** Thorax x, y, z (cm) and the heading turned since the start (rad, + left, unwrapped). */
    thorax: number[][];
    mode: string[];
    walk_speed_cms: number[];
    yaw_rate: number[];
    gait_clock: number[];
    /** Per leg, in `legs` order: 1 in stance, 0 in swing. */
    stance: number[][];
    /** Per actuator, in `actuators` order: the joint or tendon target (rad). */
    targets: number[][];
    /** Each claw's origin in the thorax frame (cm), in `legs` order, x y z flattened. */
    claws: number[][];
  };
  sha256: string;
}

type Snapshot = Pick<
  FlyState,
  | "t"
  | "mode"
  | "groom"
  | "yaw"
  | "yawRate"
  | "walkSpeed"
  | "gaitClock"
  | "legs"
  | "wingsOpen"
> & { p: V3 };

const snap = (s: FlyState): Snapshot => ({
  t: s.t,
  mode: s.mode,
  groom: s.groom,
  p: [s.p[0], s.p[1], s.p[2]],
  yaw: s.yaw,
  yawRate: s.yawRate,
  walkSpeed: s.walkSpeed,
  gaitClock: s.gaitClock,
  legs: s.legs,
  wingsOpen: s.wingsOpen,
});

const round = (x: number, digits: number) => {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  return r === 0 ? 0 : r;
};

/** The JavaScript engine this process runs on. */
export function currentEngine(): { runtime: string; version: string } {
  const v = (globalThis as { process?: { versions?: Record<string, string> } }).process
    ?.versions;
  if (v?.bun) return { runtime: "bun", version: v.bun };
  if (v?.node) return { runtime: "node", version: v.node };
  return { runtime: "unknown", version: "unknown" };
}

/** Run the fly through one scenario and sample its plan on the 2 ms clock. */
export function planTrace(
  scenario: PhysicsScenario,
  engine = currentEngine(),
): PhysicsTrace {
  const world = arenaWorld({ size: ROOM.size, ambient: ROOM.ambient }, "fly-physics");
  const fly = new DigitalFly({
    seed: scenario.seed,
    world,
    start: { p: START, yaw: START_YAW },
    adapter: () => new PlanAdapter(scenario),
  });
  const h = fly.params.physicsStepMs / 1000;
  const steps = Math.round(scenario.durationS / h);
  const states: Snapshot[] = [snap(fly.state)];
  for (let i = 0; i < steps; i++) {
    fly.advance(h);
    states.push(snap(fly.state));
  }
  if (fly.state.counts.rejected !== 0)
    throw new Error(
      `the fly's gate refused ${fly.state.counts.rejected} command(s) of the ${scenario.id} plan`,
    );

  const gait = fly.gaitParams;
  const solver = new PoseSolver(gait);
  const p0 = states[0]!.p;
  const f0 = forward(START_YAW),
    l0 = left(START_YAW);
  const count = Math.round(scenario.durationS / CONTROL_DT_S) + 1;
  const samples: PhysicsTrace["samples"] = {
    t: [],
    thorax: [],
    mode: [],
    walk_speed_cms: [],
    yaw_rate: [],
    gait_clock: [],
    stance: [],
    targets: [],
    claws: [],
  };
  let heading = 0,
    lastYaw = states[0]!.yaw;
  for (let k = 0; k < count; k++) {
    const t = Math.round(k * CONTROL_DT_S * 1e6) / 1e6;
    const i = Math.min(states.length - 1, Math.floor(t / h + 1e-9));
    const a = states[i]!,
      b = states[Math.min(states.length - 1, i + 1)]!;
    const alpha = b === a ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const lerp = (x: number, y: number) => x + (y - x) * alpha;
    const p: V3 = [lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2])];
    const yaw = wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * alpha);
    heading += wrapAngle(yaw - lastYaw);
    lastYaw = yaw;
    const walkSpeed = lerp(a.walkSpeed, b.walkSpeed);
    const walking = b.mode === "walk";
    const stepping = steppingSpeedCmS(
      walking ? walkSpeed : 0,
      walking ? b.yawRate : 0,
      FOOT_RADIUS_CM,
    );
    const stepped = walking && stepping >= STEPPING_MIN_CMS;
    const gaitClock =
      stepped && a.mode === "walk"
        ? (a.gaitClock + (t - a.t) / stepPeriodS(stepping, gait)) % 1
        : b.gaitClock;
    const legs = lerp(a.legs, b.legs);
    const angles = solver.solve({
      mode: b.mode,
      groom: b.groom,
      legs,
      wingsOpen: lerp(a.wingsOpen, b.wingsOpen),
      walkSpeed,
      gaitClock,
      yawRate: b.yawRate,
      wingPhase: 0,
      ampL: 1,
      ampR: 1,
      time: t,
    });
    // As pose.ts places the feet: every foot down while standing, or by its phase while stepping.
    const placed = b.mode !== "flight" && b.mode !== "land" && legs > 0.5;
    const duty = stepped ? dutyFactor(stepping, gait) : 1;
    const phases = stepped ? legPhases(gaitClock, phaseLag(stepping, gait)) : null;
    const stance = LEGS.map((_, n) => (placed && (!phases || phases[n]! < duty) ? 1 : 0));
    const joint = new Map<string, number>();
    for (const body of SKELETON.bodies) {
      const values = angles.get(body.name);
      body.joints.forEach((j, n) => joint.set(j.name, values?.[n] ?? 0));
    }
    const targets = LEG_ACTUATORS.map((name) => {
      const tendon = TENDONS.get(name);
      const value = tendon
        ? tendon.reduce((s, m) => s + m.coef * (joint.get(m.joint) ?? 0), 0)
        : joint.get(name)!;
      const range = JOINT_RANGES.get(name);
      if (range && (value < range[0] - 1e-9 || value > range[1] + 1e-9))
        throw new Error(`${name} target ${value} outside FlyBody's range at ${t} s`);
      return round(value, 7);
    });
    const d: V3 = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
    samples.t.push(t);
    samples.thorax.push([
      round((d[0] * f0[0] + d[2] * f0[2]) * 100, 6),
      round((d[0] * l0[0] + d[2] * l0[2]) * 100, 6),
      round(p[1] * 100, 6),
      round(heading, 7),
    ]);
    samples.mode.push(b.mode);
    samples.walk_speed_cms.push(round(walking ? walkSpeed : 0, 6));
    samples.yaw_rate.push(round(walking ? b.yawRate : 0, 6));
    samples.gait_clock.push(round(gaitClock, 7));
    samples.stance.push(stance);
    samples.targets.push(targets);
    samples.claws.push(clawPoints(angles).flatMap((c) => c.map((x) => round(x, 7))));
  }
  const body = {
    schema: TRACE_SCHEMA,
    scenario: { ...scenario },
    fly: {
      version: FLY_VERSION,
      source_sha256: FLY_SOURCE.sha256,
      controller: PLAN_DESCRIPTOR.id,
      physics_step_s: h,
      standing_height_cm: round(fly.standingHeight * 100, 7),
      gate_refusals: fly.state.counts.rejected,
    },
    engine,
    frame:
      "FlyBody's: centimetres, x forward along the heading at the start, y the fly's left, z up from the floor; heading anticlockwise seen from above, unwrapped",
    sampling: {
      dt_s: CONTROL_DT_S,
      count,
      interpolation:
        "the reduced-order body steps every 5 ms; between steps position, heading, walking speed and leg extension are interpolated linearly, the turn rate is the later step's, and the gait clock is advanced from the earlier step at the stepping speed's period, as FlyView draws it",
    },
    legs: [...LEGS],
    actuators: [...LEG_ACTUATORS],
    samples,
  };
  return { ...body, sha256: sha256Json(body) };
}

/** The trace as written to disk: compact JSON, one trailing newline. */
export const traceText = (trace: PhysicsTrace) => `${JSON.stringify(trace)}\n`;
