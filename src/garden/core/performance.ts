/**
 * The director: what the fly is seen doing at a presented instant.
 *
 * Input is the two published states around the instant (`timeline.ts`) and
 * nothing else, so every visitor watching the same moment sees the same
 * performance; output is a pose for the renderer. The simulation decided
 * everything that matters (where the fly is, what it does, whether it flies
 * or walks, when it arrives); this module only decides how that looks.
 *
 * - Each published state is drawn at a fixed **anchor**: on a place's surface
 *   while perched; on the journey's flight path while flying; on its walking
 *   route while walking or recovering mid-journey. The anchor depends on that
 *   one state alone, so consecutive intervals always meet.
 * - Between two states the fly does what the second one says it did in that
 *   step (`learning.last.action`): flies, walks, rests or grooms. Takeoffs
 *   and landings are fitted inside the step that contains them.
 * - Which medium a journey's step uses follows the server: a `fly` step is
 *   drawn in the air unless the fly's own learned estimates currently favour
 *   walking, in which case the server is trying its wings (every 37th trial)
 *   and the step is drawn as a hop along the ground. A `fly` step that did not
 *   move it is drawn as wings buzzing on the spot.
 * - Within a behaviour (which grooming routine, when the proboscis dabs, an
 *   antenna's twitch) choices are seeded by the life and the tick, never by
 *   the visitor.
 *
 * Positions are the fly's **feet point**: the spot on the surface below the
 * thorax (or where it would be, in the air). The renderer raises the body by
 * FlyBody's standing height along `up`.
 */
import type { GroomRoutine, Mode } from "../../bethesda/fly/neural.js";
import type { Observation, PlaceId, Vec2 } from "./observation.js";
import { PLAN, standingHeight } from "./layout.js";
import {
  airPoint,
  applySway,
  FlightPath,
  perchPoint,
  restingForward,
  routeProgress,
  STAGES,
  swayFrame,
  swayingLeafOffset,
  WalkPath,
  type SurfacePoint,
} from "./stage.js";
import type { Interval } from "./timeline.js";
import {
  addScaled,
  clamp,
  clamp01,
  cross,
  distance,
  dot,
  hash01,
  hashString,
  mix,
  normalize,
  slerpDir,
  smoothstep,
  sub,
  tangentOf,
  type V3,
} from "./vec.js";

export type Behaviour =
  | "sleeping"
  | "resting"
  | "grooming"
  | "feeding"
  | "drinking"
  | "walking"
  | "flying"
  | "taking off"
  | "landing"
  | "trying its wings";

export interface FlyPose {
  /** Feet point (world metres): on the surface when standing. */
  position: V3;
  /** Thorax axes: forward (+x), up (+z). Unit and orthogonal. */
  forward: V3;
  up: V3;
  /** FlyBody pose mode for the leg and wing solver. */
  mode: Mode;
  groom: GroomRoutine | null;
  /** 0 retracted (flight) … 1 extended (standing, landing). */
  legs: number;
  /** 0 folded … 1 spread or beating. */
  wingsOpen: number;
  beating: boolean;
  /** Walking speed (cm/s) and gait phase in [0, 1), as `pose.ts` takes them. */
  walkSpeed: number;
  gaitClock: number;
  /** rad/s, + left. */
  yawRate: number;
  /** 0 folded … 1 extended to the surface. */
  proboscis: number;
  /** 0 alert … 1 asleep: head and antennae lowered, abdomen still. */
  drowsy: number;
  /** Small head turns (rad): yaw + left, pitch + down. */
  headYaw: number;
  headPitch: number;
  /** Antenna sweep in [−1, 1]. */
  antenna: number;
  /** Abdominal pumping in [−1, 1]. */
  breath: number;
  /** Supported by a surface (1) or flying (0). */
  support: number;
  /** The surface under the fly, for contact shadows. */
  ground: SurfacePoint;
  /** Height of the feet point above `ground` (m). */
  altitude: number;
  /** Speed through the world, m/s. */
  speed: number;
  behaviour: Behaviour;
  /** The place it is at, or departed from while travelling. */
  place: PlaceId;
  destination: PlaceId | null;
  /** The first presented instant after a gap: cameras cut rather than glide. */
  cut: boolean;
}

const UP: V3 = [0, 1, 0];

// ------------------------------------------------------------------ journeys

interface Journey {
  fromPlace: PlaceId;
  dest: PlaceId;
  travelFrom: Vec2;
  travelTo: Vec2;
  flight: FlightPath;
  walk: WalkPath;
}

const journeys = new Map<string, Journey>();

/** The place a state is at (or departed from); an unknown name falls back to the nearest known place. */
export function placeOf(o: Observation): PlaceId {
  if (o.place) return o.place;
  let best: PlaceId = "stone",
    d = Infinity;
  for (const id of Object.keys(PLAN) as PlaceId[]) {
    const p = PLAN[id];
    const e = Math.hypot(p[0] - o.position[0], p[1] - o.position[1]);
    if (e < d) {
      d = e;
      best = id;
    }
  }
  return best;
}

/** The journey a travelling state belongs to; its paths are seeded by the life and the journey count. */
export function journeyOf(o: Observation): Journey | null {
  const tr = o.travel;
  if (!tr) return null;
  const fromPlace = placeOf(o);
  const key = `${o.lifeId}|${o.journeys}|${fromPlace}|${tr.destination}|${tr.from.join(",")}`;
  let j = journeys.get(key);
  if (!j) {
    const start = perchPoint(fromPlace, tr.from);
    const end = perchPoint(tr.destination, tr.to);
    j = {
      fromPlace,
      dest: tr.destination,
      travelFrom: tr.from,
      travelTo: tr.to,
      flight: new FlightPath(
        start,
        STAGES[fromPlace].approach,
        end,
        STAGES[tr.destination].approach,
        hash01("journey", o.lifeId, o.journeys) * 1000,
      ),
      walk: new WalkPath(start, fromPlace, end, tr.destination),
    };
    journeys.set(key, j);
    if (journeys.size > 8) journeys.delete(journeys.keys().next().value!);
  }
  return j;
}

/** A capability's expected gain, as `learning.choose_motion` scores it. */
function score(
  c: { samples: number; estimatedSpeed: number; successRate: number } | null,
) {
  if (!c) return null;
  return (c.estimatedSpeed * (c.successRate * c.samples + 1)) / (c.samples + 2);
}

/** The fly's own learned estimates currently favour walking over flying. */
export function prefersWalking(o: Observation): boolean {
  const fly = score(o.learning?.fly ?? null),
    walk = score(o.learning?.walk ?? null);
  return fly !== null && walk !== null && walk > fly;
}

// ------------------------------------------------------------------- anchors

export type Medium = "perch" | "ground" | "air";

export interface Anchor {
  medium: Medium;
  point: SurfacePoint;
  forward: V3;
  place: PlaceId;
  /** Progress along the journey's route, 0 when perched. */
  u: number;
  journey: Journey | null;
}

/** Still at the start of its route: the decision to leave, or a step that moved nothing. */
const departing = (o: Observation) =>
  !!o.travel &&
  Math.hypot(o.position[0] - o.travel.from[0], o.position[1] - o.travel.from[1]) < 1e-9;

/** Where, and facing which way, a published state is drawn. Depends on that state alone. */
export function anchorOf(o: Observation): Anchor {
  const place = placeOf(o);
  const j = journeyOf(o);
  if (!j || departing(o)) {
    const point = perchPoint(place, o.position);
    const rest = restingForward(place, o.position, point.normal);
    // About to leave: facing the way it will go.
    const forward = j ? tangentOf(j.flight.tangent(0), point.normal, rest) : rest;
    return { medium: "perch", point, forward, place, u: 0, journey: j };
  }
  const u = routeProgress(j.travelFrom, j.travelTo, o.position);
  if (o.learning?.last?.action === "fly" && !prefersWalking(o))
    return {
      medium: "air",
      point: { position: j.flight.at(u), normal: UP },
      forward: j.flight.tangent(u),
      place,
      u,
      journey: j,
    };
  const w = j.walk.at(u);
  return {
    medium: "ground",
    point: { position: w.position, normal: w.normal },
    forward: w.forward,
    place,
    u,
    journey: j,
  };
}

// ----------------------------------------------------------------- behaviour

/** Grooming in the order flies clean: the head with the front legs, the body with the hind legs, rubbing between. */
const GROOM_BOUTS: GroomRoutine[][] = [
  ["front legs", "eyes", "front legs"],
  ["antennae", "front legs"],
  ["eyes", "antennae", "front legs"],
  ["hind legs", "wings", "hind legs"],
  ["abdomen", "hind legs"],
  ["notum", "wings", "hind legs"],
];

function groomAt(seed: string, s: number, span: number): GroomRoutine {
  const bout = GROOM_BOUTS[Math.floor(hash01(seed, "bout") * GROOM_BOUTS.length)]!;
  return bout[Math.min(bout.length - 1, Math.floor((s / span) * bout.length))]!;
}

/** A smooth 0…1 pulse train: `count` pulses spread through `span`, seeded. */
function pulses(seed: string, s: number, span: number, count: number, width: number) {
  let v = 0;
  for (let i = 0; i < count; i++) {
    const c = ((i + 0.5 + (hash01(seed, i) - 0.5) * 0.6) / count) * span;
    const d = Math.abs(s - c) / width;
    if (d < 1) v = Math.max(v, 0.5 + 0.5 * Math.cos(Math.PI * d));
  }
  return v;
}

interface Idle {
  headYaw: number;
  headPitch: number;
  antenna: number;
  breath: number;
  proboscis: number;
  drowsy: number;
  groom: GroomRoutine | null;
  /** A brief wing lift while resting. */
  wings: number;
}

/** What a perched fly does with itself during a step, for an activity label. */
function idle(activity: string, seed: string, s: number, span: number): Idle {
  const out: Idle = {
    headYaw: 0,
    headPitch: 0,
    antenna: 0,
    breath: 0.5 * Math.sin(2 * Math.PI * (s / 1.9 + hash01(seed, "breath"))),
    proboscis: 0,
    drowsy: 0,
    groom: null,
    wings: 0,
  };
  const once = (key: string, within: number, len: number) => {
    const c = hash01(seed, key) * span * within;
    const d = (s - c) / len;
    return d >= 0 && d < 1 ? Math.sin(Math.PI * d) : 0;
  };
  const sign = (key: string) => (hash01(seed, key) < 0.5 ? -1 : 1);
  switch (activity) {
    case "sleeping":
      out.drowsy = 1;
      out.headPitch = 0.22;
      out.antenna = -0.6;
      out.breath *= 0.35;
      break;
    case "grooming":
      out.groom = groomAt(seed, s, span);
      out.headPitch = out.groom === "eyes" || out.groom === "antennae" ? 0.12 : 0;
      out.headYaw = out.groom === "eyes" ? 0.12 * Math.sin(2 * Math.PI * s * 0.8) : 0;
      break;
    case "feeding":
    case "drinking": {
      const dabs = 2 + Math.floor(hash01(seed, "dabs") * 3);
      out.proboscis = 0.35 + 0.65 * pulses(seed, s, span, dabs, (span / dabs) * 0.55);
      out.headPitch = 0.16 + 0.1 * out.proboscis;
      out.antenna = 0.15 * Math.sin(2 * Math.PI * s * 0.37);
      break;
    }
    default:
      // Resting: still, with an occasional antenna flick, a glance, a wing settle.
      out.antenna = 0.5 * once("antenna", 1, 0.5) * sign("a-sign");
      out.headYaw = 0.16 * once("glance", 0.8, 1.6) * sign("g-sign");
      out.wings = hash01(seed, "wing") < 0.25 ? 0.35 * once("wing-at", 0.7, 0.6) : 0;
  }
  return out;
}

const BEHAVIOURS: Record<string, Behaviour> = {
  sleeping: "sleeping",
  grooming: "grooming",
  feeding: "feeding",
  drinking: "drinking",
  resting: "resting",
  walking: "walking",
  flying: "flying",
};
const behaviourOf = (activity: string): Behaviour => BEHAVIOURS[activity] ?? "resting";

// --------------------------------------------------------------------- poses

type Extras = Omit<
  FlyPose,
  "position" | "forward" | "up" | "ground" | "behaviour" | "place" | "destination"
>;
const BASE: Extras = {
  mode: "rest",
  groom: null,
  legs: 1,
  wingsOpen: 0,
  beating: false,
  walkSpeed: 0,
  gaitClock: 0,
  yawRate: 0,
  proboscis: 0,
  drowsy: 0,
  headYaw: 0,
  headPitch: 0,
  antenna: 0,
  breath: 0,
  support: 1,
  altitude: 0,
  speed: 0,
  cut: false,
};

/** Orthonormal (forward, up) from a wanted forward and an up hint. */
function frame(forward: V3, up: V3): { forward: V3; up: V3 } {
  const u = normalize(up);
  const f = tangentOf(forward, u);
  return { forward: f, up: normalize(cross(cross(f, u), f)) };
}

const ease = (x: number) => x * x * (3 - 2 * x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

/** A perched anchor moved by the wind at presented time `t`. */
function swayed(a: Anchor, forward: V3, t: number, wind: number | null) {
  const kind = a.medium === "perch" ? STAGES[a.place].sways : null;
  if (!kind) return { point: a.point, forward };
  const s = swayFrame(kind, t, wind);
  return {
    point: {
      position: applySway(s, a.point.position),
      normal: applySway(s, a.point.normal, true),
    },
    forward: applySway(s, forward, true),
  };
}

interface Scene {
  t: number;
  wind: number | null;
  seed: string;
  destination: PlaceId | null;
}

/** A fly standing at an anchor doing `activity`, `s` seconds into a step of `span`. */
function standing(
  a: Anchor,
  forward: V3,
  activity: string,
  s: number,
  span: number,
  c: Scene,
): FlyPose {
  const sw = swayed(a, forward, c.t, c.wind);
  const f = frame(sw.forward, sw.point.normal);
  const i = idle(activity, c.seed, s, span);
  return {
    ...BASE,
    mode: i.groom ? "groom" : i.proboscis > 0 ? "feed" : "rest",
    groom: i.groom,
    wingsOpen: i.wings,
    proboscis: i.proboscis,
    drowsy: i.drowsy,
    headYaw: i.headYaw,
    headPitch: i.headPitch,
    antenna: i.antenna,
    breath: i.breath,
    position: sw.point.position,
    forward: f.forward,
    up: f.up,
    ground: sw.point,
    behaviour: behaviourOf(activity),
    place: a.place,
    destination: c.destination,
  };
}

/** Walking along a surface route `at`, `u` of the way along it. */
function walking(
  at: (u: number) => SurfacePoint & { forward: V3 },
  u: number,
  routeLength: number,
  speed: number,
  place: PlaceId,
  c: Scene,
): FlyPose {
  const w = at(u);
  const f = frame(w.forward, w.normal);
  // FlyBody's stride at walking speed is a millimetre or two: one gait cycle per stride.
  const stride = 0.0012 + 0.0004 * clamp(speed / 0.02, 0, 1);
  return {
    ...BASE,
    mode: "walk",
    position: w.position,
    forward: f.forward,
    up: f.up,
    ground: { position: w.position, normal: w.normal },
    walkSpeed: speed * 100,
    gaitClock: ((u * routeLength) / stride) % 1,
    speed,
    behaviour: "walking",
    place,
    destination: c.destination,
  };
}

const groundBelow = (p: V3): SurfacePoint => ({
  position: [p[0], Math.min(p[1], standingHeight(p[0], p[2])), p[2]],
  normal: UP,
});

/** Body frame in flight: along the path, banked into turns, nose up when slow. */
function airborne(
  position: V3,
  dir: V3,
  speed: number,
  bank: number,
  place: PlaceId,
  c: Scene,
): FlyPose {
  const flat = tangentOf(dir, UP, [0, 0, -1]);
  const side = normalize(cross(UP, flat));
  const pitchUp = 0.08 + 0.17 * (1 - smoothstep(0.02, 0.08, speed));
  const fr = frame(
    addScaled(flat, UP, dot(dir, UP) * 0.8 + pitchUp),
    addScaled(UP, side, -bank),
  );
  const g = groundBelow(position);
  return {
    ...BASE,
    mode: "flight",
    legs: 0,
    wingsOpen: 1,
    beating: true,
    support: 0,
    position,
    forward: fr.forward,
    up: fr.up,
    ground: g,
    altitude: Math.max(0, position[1] - g.position[1]),
    speed,
    behaviour: "flying",
    place,
    destination: c.destination,
  };
}

/**
 * The fly at presented time `t` (server seconds) within `iv`. Pure: the same
 * interval and time give the same pose for every visitor.
 */
export function perform(iv: Interval, t: number): FlyPose {
  const { prev, next } = iv;
  const span = Math.max(1e-6, next.updatedAt - prev.updatedAt);
  const B = anchorOf(next);
  const c: Scene = {
    t,
    wind: next.weather.windKmh,
    seed: `${next.lifeId}|${prev.ticks}`,
    destination: next.travel?.destination ?? null,
  };

  if (prev === next || iv.discontinuous || iv.tau >= 1) {
    // At the latest state, or waiting for the next: hold its anchor and carry on its activity.
    c.seed = `${next.lifeId}|${next.ticks}`;
    if (B.medium === "air") return hover(B, t, c);
    const activity = B.medium === "perch" && !next.travel ? next.activity : "resting";
    return {
      ...standing(B, B.forward, activity, iv.late % 5, 5, c),
      cut: iv.discontinuous,
    };
  }

  const A = anchorOf(prev);
  const s = iv.tau * span;
  const action = next.learning?.last?.action ?? null;
  const activity = prev.travel ? "resting" : prev.activity;

  if (A.medium === "perch" && B.medium === "perch") {
    if (A.place !== B.place) return shortFlight(A, B, iv.tau, span, c);
    const moved = distance(A.point.position, B.point.position) > 2e-4;
    if (action === "fly" && next.travel) return tryingWings(A, s, span, c);
    if (moved && action === "walk")
      return calibrationStep(A, B, iv.tau, span, activity, c);
    // Settling toward the way it will leave, if this step ended in a decision to go.
    const turn = next.travel && !prev.travel ? smoothstep(0.7, 1, iv.tau) : 0;
    const pose = standing(A, slerpDir(A.forward, B.forward, turn), activity, s, span, c);
    pose.wingsOpen = Math.max(pose.wingsOpen, 0.25 * turn);
    return pose;
  }

  const journey = B.journey ?? A.journey;
  if (!journey) return standing(B, B.forward, next.activity, s, span, c);

  if (A.medium === "air" && B.medium === "air")
    return cruise(journey, A.u, B.u, iv.tau, span, A.place, c);
  if (B.medium === "air") return takeoff(A, journey, B.u, iv.tau, span, c);
  if (A.medium === "air")
    return B.medium === "perch"
      ? arrival(journey, A.u, B, iv.tau, span, c)
      : descent(journey, A.u, B, iv.tau, span, c);

  // Surface to surface within a journey: walking, hopping, or recovering mid-route.
  const w = journey.walk;
  const u0 = A.medium === "perch" ? 0 : A.u;
  const u1 = B.medium === "perch" ? 1 : B.u;
  if (Math.abs(u1 - u0) < 1e-6)
    return action === "fly"
      ? tryingWings(B, s, span, c)
      : standing(B, B.forward, "resting", s, span, c);
  const hop = action === "fly";
  const u = u0 + (u1 - u0) * (hop ? ease(iv.tau) : iv.tau);
  const speed = (Math.abs(u1 - u0) * w.length) / span;
  let pose = walking((x) => w.at(x), u, w.length, speed, journey.fromPlace, c);
  if (B.medium === "perch") {
    // Arriving on foot: settle onto the spot and facing the server reports.
    const k = smoothstep(0.85, 1, iv.tau);
    const sw = swayed(B, B.forward, t, c.wind);
    const position = addScaled(
      pose.position,
      sub(sw.point.position, w.at(1).position),
      k,
    );
    const f = frame(slerpDir(pose.forward, sw.forward, k), sw.point.normal);
    pose = { ...pose, position, forward: f.forward, up: f.up, place: B.place };
  }
  if (!hop) return pose;
  // A hop along the route: the server's flight was weaker than its walking.
  const h = Math.sin(Math.PI * iv.tau);
  return {
    ...pose,
    position: addScaled(pose.position, pose.ground.normal, 0.012 * h),
    mode: h > 0.05 ? "flight" : "rest",
    legs: 1 - 0.8 * h,
    wingsOpen: clamp01(h * 3),
    beating: h > 0.05,
    support: 1 - h,
    altitude: 0.012 * h,
    behaviour: "flying",
  };
}

/** Holding in the air at an anchor: hovering while the next state is on its way. */
function hover(B: Anchor, t: number, c: Scene): FlyPose {
  const phase = hash01(c.seed) * 2 * Math.PI;
  const side = normalize(cross(UP, tangentOf(B.forward, UP, [0, 0, -1])));
  const position = addScaled(
    addScaled(B.point.position, UP, 0.004 * Math.sin(2 * Math.PI * 0.6 * t + phase)),
    side,
    0.003 * Math.sin(2 * Math.PI * 0.37 * t),
  );
  return { ...airborne(position, B.forward, 0, 0, B.place, c), legs: 0.2 };
}

function cruise(
  j: Journey,
  u0: number,
  u1: number,
  tau: number,
  span: number,
  place: PlaceId,
  c: Scene,
) {
  const u = u0 + (u1 - u0) * tau;
  const speed = (Math.abs(u1 - u0) * j.flight.length) / span;
  const dir = j.flight.tangent(u);
  const ahead = j.flight.tangent(Math.min(1, u + 0.03));
  const bank = clamp(dot(cross(dir, ahead), UP) * 8, -0.5, 0.5);
  // A fly's flight is never perfectly smooth: a small flutter, presentation only.
  const p = j.flight.at(u);
  p[1] += 0.0025 * Math.sin(2 * Math.PI * 1.7 * c.t + u * 13);
  return airborne(p, dir, speed, bank, place, c);
}

function takeoff(
  A: Anchor,
  j: Journey,
  u1: number,
  tau: number,
  span: number,
  c: Scene,
): FlyPose {
  // Wings open and it jumps in the first half second, then flies, gathering speed.
  const s = tau * span;
  const lift = 0.45;
  const sw = swayed(A, A.forward, c.t, c.wind);
  if (s < lift) {
    const k = s / lift;
    const f = frame(sw.forward, sw.point.normal);
    return {
      ...BASE,
      mode: "takeoff",
      position: sw.point.position,
      forward: f.forward,
      up: f.up,
      ground: sw.point,
      wingsOpen: smoothstep(0, 0.7, k),
      beating: k > 0.7,
      behaviour: "taking off",
      place: A.place,
      destination: c.destination,
    };
  }
  const k = (s - lift) / Math.max(1e-6, span - lift);
  const u = u1 * (0.4 * k + 0.6 * k * k);
  const start = A.medium === "ground" ? j.walk.at(A.u).position : j.flight.at(0);
  // Leave from where it actually stood (a swaying leaf, a point on its walking route).
  const offset = sub(sw.point.position, start);
  const position = addScaled(j.flight.at(u), offset, 1 - smoothstep(0, 0.35, k));
  const speed = ((u1 * j.flight.length) / Math.max(1e-6, span - lift)) * (0.4 + 1.2 * k);
  const pose = airborne(
    position,
    j.flight.tangent(Math.max(u, 0.01)),
    speed,
    0,
    A.place,
    c,
  );
  return settle(
    {
      ...pose,
      legs: 1 - smoothstep(0, 0.3, k),
      mode: k < 0.3 ? "takeoff" : "flight",
      behaviour: k < 0.3 ? "taking off" : "flying",
    },
    sw.forward,
    sw.point.normal,
    1 - smoothstep(0, 0.35, k),
  );
}

/** Turns a pose toward a resting frame by `w` (0 none, 1 entirely): how takeoffs and landings meet the perch. */
function settle(p: FlyPose, forward: V3, up: V3, w: number): FlyPose {
  if (w <= 0) return p;
  const target = frame(forward, up);
  const f = frame(slerpDir(p.forward, target.forward, w), slerpDir(p.up, target.up, w));
  return { ...p, forward: f.forward, up: f.up };
}

function arrival(
  j: Journey,
  u0: number,
  B: Anchor,
  tau: number,
  span: number,
  c: Scene,
): FlyPose {
  // Fly in, slowing over the last second and turning to settle, legs forward; touch down, fold the wings.
  const s = tau * span;
  const touch = span - 0.45;
  const sw = swayed(B, B.forward, c.t, c.wind);
  if (s >= touch) {
    const k = (s - touch) / (span - touch);
    const f = frame(sw.forward, sw.point.normal);
    return {
      ...BASE,
      position: sw.point.position,
      forward: f.forward,
      up: f.up,
      ground: sw.point,
      wingsOpen: 1 - ease(k),
      behaviour: "landing",
      place: B.place,
      destination: B.place,
    };
  }
  const k = s / touch;
  const u = u0 + (1 - u0) * easeOut(k);
  // Land where the server says it is, which is within a step of the route's end.
  const correction = sub(sw.point.position, j.flight.at(1));
  const position = addScaled(j.flight.at(u), correction, smoothstep(0.4, 1, k));
  const speed = (((1 - u0) * j.flight.length) / touch) * 2 * (1 - k);
  const landing = smoothstep(0.75, 1, k);
  const pose = airborne(
    position,
    j.flight.tangent(Math.min(u, 0.995)),
    speed,
    0,
    j.fromPlace,
    c,
  );
  return settle(
    {
      ...pose,
      legs: landing,
      mode: landing > 0 ? "land" : "flight",
      behaviour: landing > 0 ? "landing" : "flying",
    },
    sw.forward,
    sw.point.normal,
    smoothstep(0.6, 1, k),
  );
}

/** From the air down to a surface mid-journey: coming down to rest or to walk. */
function descent(
  j: Journey,
  u0: number,
  B: Anchor,
  tau: number,
  span: number,
  c: Scene,
): FlyPose {
  const from = j.flight.at(u0);
  const to = B.point.position;
  if (tau > 0.9) {
    const f = frame(B.forward, B.point.normal);
    return {
      ...BASE,
      position: to,
      forward: f.forward,
      up: f.up,
      ground: B.point,
      wingsOpen: 1 - (tau - 0.9) / 0.1,
      behaviour: "landing",
      place: j.fromPlace,
      destination: c.destination,
    };
  }
  const k = ease(tau / 0.9);
  const position = mix(from, to, k);
  const pose = airborne(
    position,
    normalize(sub(to, from)),
    distance(from, to) / span,
    0,
    j.fromPlace,
    c,
  );
  return settle(
    {
      ...pose,
      legs: smoothstep(0.5, 1, k),
      mode: k > 0.5 ? "land" : "flight",
      behaviour: "landing",
    },
    B.forward,
    B.point.normal,
    smoothstep(0.55, 1, k),
  );
}

/** Wings buzzing on the spot: a flight attempt that did not move it. */
function tryingWings(A: Anchor, s: number, span: number, c: Scene): FlyPose {
  const pose = standing(A, A.forward, "resting", s, span, c);
  const k = smoothstep(0, 0.3, s) * (1 - smoothstep(span - 0.6, span, s));
  return {
    ...pose,
    mode: "takeoff",
    wingsOpen: k,
    beating: k > 0.95,
    behaviour: "trying its wings",
  };
}

/** A step of a few millimetres on the perch: turn, walk, settle. */
function calibrationStep(
  A: Anchor,
  B: Anchor,
  tau: number,
  span: number,
  activity: string,
  c: Scene,
): FlyPose {
  const s = tau * span;
  const len = distance(A.point.position, B.point.position);
  const start = span * (0.15 + 0.15 * hash01(c.seed, "step"));
  const dur = clamp(len / 0.002, 0.8, 2.2);
  const dir = tangentOf(
    sub(B.point.position, A.point.position),
    A.point.normal,
    A.forward,
  );
  if (s < start)
    return standing(
      A,
      slerpDir(A.forward, dir, smoothstep(start - 0.5, start, s)),
      activity,
      s,
      span,
      c,
    );
  if (s > start + dur)
    return standing(
      B,
      slerpDir(dir, B.forward, smoothstep(start + dur, start + dur + 0.7, s)),
      activity,
      s,
      span,
      c,
    );
  const at = (u: number) => {
    const sa = swayed(A, dir, c.t, c.wind);
    const sb = swayed(B, dir, c.t, c.wind);
    return {
      position: mix(sa.point.position, sb.point.position, u),
      normal: normalize(mix(sa.point.normal, sb.point.normal, u)),
      forward: sa.forward,
    };
  };
  const pose = walking(at, ease((s - start) / dur), len, len / dur, A.place, c);
  return { ...pose, behaviour: behaviourOf(activity) };
}

/** Two perches with no journey seen between them (states were missed): a direct flight across. */
function shortFlight(A: Anchor, B: Anchor, tau: number, span: number, c: Scene): FlyPose {
  const path = new FlightPath(
    A.point,
    STAGES[A.place].approach,
    B.point,
    STAGES[B.place].approach,
    hashString(c.seed),
  );
  if (tau < 0.08) return standing(A, A.forward, "resting", tau * span, span, c);
  if (tau > 0.92) return standing(B, B.forward, "resting", tau * span, span, c);
  const u = ease((tau - 0.08) / 0.84);
  return airborne(path.at(u), path.tangent(u), path.length / (0.84 * span), 0, A.place, {
    ...c,
    destination: B.place,
  });
}

// ------------------------------------------------------------ small things

export interface Nearby {
  /** The midge the server tracks, in the air above the lawn, or null when not reported. */
  midge: V3 | null;
  /** The swaying leaf's offset from rest (m, x right and y up), or null. */
  leaf: [number, number] | null;
}

/** The two independent things the server reports, interpolated across the interval. */
export function nearbyAt(iv: Interval): Nearby {
  const find = (o: Observation, name: string) =>
    o.learning?.nearby.find((n) => n.name === name)?.position;
  const lerp2 = (a: Vec2 | undefined, b: Vec2 | undefined): Vec2 | null =>
    a && b
      ? [a[0] + (b[0] - a[0]) * iv.tau, a[1] + (b[1] - a[1]) * iv.tau]
      : (b ?? a ?? null);
  const m = lerp2(find(iv.prev, "drifting_midge"), find(iv.next, "drifting_midge"));
  const l = lerp2(find(iv.prev, "swaying_leaf"), find(iv.next, "swaying_leaf"));
  return {
    midge: m ? airPoint(m) : null,
    leaf: l ? swayingLeafOffset(l) : null,
  };
}
