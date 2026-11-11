/**
 * The commons: one authoritative world and one clock for two research
 * subjects, where each one's body is physically present to the other.
 *
 * The first-contact bridge (`bridge.ts`) gives two subjects two worlds and
 * lets each see a sphere of the other's size; it can be neither touched nor
 * smelt. Here there is one world. Each occupant lives in a `CommonsView` of
 * it that answers every question as the shared world does and adds the other
 * occupant's body:
 *
 * - **for the body**, a solid sphere (`solid`, and `raycast` without
 *   `visible`, which is what a moving body's `sweep` and its walking steps
 *   ask): its radius is the two bodies' equivalent radii summed, the
 *   configuration-space obstacle of two spheres, because the fly's own body
 *   is a point at its centre. Neither fly can walk or fly into the other.
 *   Nothing is pushed: contact blocks, it never moves the other body;
 * - **for the eyes**, a moving thing of the other's own size (`movers`),
 *   which the receiver's own eyes must find with their acuity, field of view,
 *   occlusion and latency, exactly as they treat any moving thing. Eye rays
 *   (`raycast` with `visible`) do not see it as a surface, so it is never
 *   counted twice and never hides itself;
 * - **for the legs**, touch: within `ENCOUNTER_GAP_M` of the other's body
 *   (Ramdya et al. 2015's Encounter criterion), the receiver gets a touch
 *   sample with the side it came from, and its tarsi sample the other's
 *   surface chemistry (Thistle et al. 2012: contact chemoreceptors on the
 *   legs). That goes to an occupant's `SocialPort`, never into its world.
 *
 * Nothing crosses but those: never an id, a name, a controller, a mode, a
 * memory or a state. A commons with one occupant steps that occupant exactly
 * as the bare world would (`commons.test.ts`).
 *
 * **One clock, stepped in turn.** The commons advances both occupants by one
 * physics step at a time, one after the other, alternating which goes first
 * each step, so each moves against where the other really is. (Stepped at
 * once, two bodies meeting head on would each stop at where the other had
 * been, overlap, and then pass through each other: a fly inside a solid may
 * always leave it, `sweep`.)
 */
import { sha256Json } from "../../../rain/sha256.js";
import { SKELETON } from "../../fly/skeleton.js";
import { left as leftOf, forward as forwardOf, type V3 } from "../../fly/units.js";
import {
  raySphere,
  type FlyWorld,
  type FoodPatch,
  type Hit,
  type LandingSite,
  type Landmark,
  type LightSample,
  type Mover,
  type Perch,
  type Sphere,
  type WorldInputs,
} from "../../fly/world.js";
import { refuseOriginal } from "../originals.js";
import type { SurfaceChemistry } from "../socialSensing.js";

export const COMMONS_SCHEMA = "first-contact-commons/v1" as const;
/** The id the other occupant carries among a receiver's moving things. */
export const COMMONS_MOVER_ID = "commons-other";
/** FlyBody's measured body length (m). */
export const FLY_BODY_LENGTH_M = SKELETON.measures.bodyLengthCm / 100;
/** Half of it: the equivalent-sphere radius the bridge also uses (m). */
export const FLY_BODY_RADIUS_M = FLY_BODY_LENGTH_M / 2;
/**
 * Ramdya et al. 2015 (doi:10.1038/nature14024), Methods: "We then determined
 * the times at which each fly was undergoing an Encounter (distance to nearest
 * neighbour <25% long-axis body length)." The gap between the two bodies'
 * surfaces (m) within which legs touch and tarsi taste.
 */
export const ENCOUNTER_GAP_M = 0.25 * FLY_BODY_LENGTH_M;
/**
 * Ramdya et al. 2015, Methods: a fly is stationary below "velocity magnitude
 * <1 mm/s". The commons reports whether the receiver itself was moving at a
 * touch; the receiver's own social module reads that from its own body.
 */
export const STATIONARY_MS = 0.001;

export const COMMONS_INPUT =
  "the other occupant: solid to the body, seen by the eyes, touched and tasted at contact";

/** Where an occupant's body is: the simulator's side of the boundary. */
export interface BodyPose {
  center: V3;
  yaw: number;
  /** Equivalent-sphere radius (m). */
  radius: number;
  /** Horizontal speed over ground (m/s), for the experimenter's record. */
  speed: number;
}

/** One sample of touch, delivered to the touched occupant only. */
export interface TouchSample {
  /** Commons time (s). */
  t: number;
  /** How long this sample lasts: the commons step (s). */
  dt: number;
  /** The first sample of a contact bout. */
  onset: boolean;
  /** Side of the receiver's body the other touched, relative to its heading (rad, + left). */
  bearing: number;
  /**
   * What the receiver's tarsi taste of the other's surface, before receptor
   * noise (the receiver's own sensory model adds that), or null if the other
   * carries no surface chemistry.
   */
  chemistry: SurfaceChemistry | null;
}

/** Where an occupant receives what touches it. Implementations must not reach back into the commons. */
export interface SocialPort {
  touch(sample: TouchSample): void;
  /** The contact bout has ended: no more samples follow until the next onset. */
  release?(): void;
}

export interface Occupant {
  /** A research id (`refuseOriginal`, `research-` prefix). */
  readonly id: string;
  pose(): BodyPose;
  /** Simulator-side surface chemistry, or null for none (a non-fly control). */
  readonly chemistry: SurfaceChemistry | null;
  /** Advance by one commons step (s). */
  step(dt: number): void;
  /** Receives touch, if this occupant can sense it. */
  readonly port?: SocialPort;
}

/** A contact bout, as the experimenter records it. */
export interface ContactBout {
  start: number;
  end: number | null;
  /** Closest the two body centres came (m). */
  closestM: number;
  /** Speeds of occupant 0 and 1 at onset (m/s). */
  onsetSpeeds: [number, number];
}

/** One line of the commons' hash-chained record. */
export interface CommonsEvent {
  seq: number;
  t: number;
  kind: "join" | "contact-start" | "contact-end" | "leave";
  detail: Record<string, unknown>;
  prev: string;
  hash: string;
}

/**
 * One occupant's world: the shared world, plus the other occupant's body as
 * a solid for its body and a moving thing for its eyes.
 */
export class CommonsView implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: WorldInputs;
  declare readonly wind?: (p: V3, t: number) => V3;
  private readonly sphere: Sphere = {
    kind: "wall",
    id: COMMONS_MOVER_ID,
    center: [0, 0, 0],
    r: 0,
  };

  readonly inner: FlyWorld;
  readonly index: 0 | 1;
  private readonly commons: Commons;

  constructor(inner: FlyWorld, commons: Commons, index: 0 | 1) {
    this.inner = inner;
    this.commons = commons;
    this.index = index;
    this.id = `${inner.id}+commons-${index}`;
    this.home = inner.home;
    this.inputs = {
      supported: [...inner.inputs.supported, COMMONS_INPUT],
      proxies: [...inner.inputs.proxies],
      unsupported: [...inner.inputs.unsupported],
    };
    if (inner.wind) {
      const wind = inner.wind.bind(inner);
      this.wind = (p, t) => wind(p, t);
    }
  }

  /** The other occupant's body as an obstacle to this one's body, or null. */
  private obstacle(): Sphere | null {
    const other = this.commons.poseOf(this.index === 0 ? 1 : 0);
    const self = this.commons.poseOf(this.index);
    if (!other || !self) return null;
    const s = this.sphere;
    s.center[0] = other.center[0];
    s.center[1] = other.center[1];
    s.center[2] = other.center[2];
    s.r = other.radius + self.radius;
    return s;
  }

  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.inner.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    const hit = this.inner.raycast(origin, dir, maxT, visible);
    if (visible) return hit;
    const s = this.obstacle();
    if (!s) return hit;
    const body = raySphere(origin, dir, s, hit ? hit.t : maxT);
    return body && (!hit || body.t < hit.t) ? body : hit;
  }
  solid(p: V3): boolean {
    if (this.inner.solid(p)) return true;
    const s = this.obstacle();
    if (!s) return false;
    return Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]) < s.r;
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.inner.movers(near, radius, out, t);
    const other = this.commons.poseOf(this.index === 0 ? 1 : 0);
    if (!other) return;
    const c = other.center;
    if (
      Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) >
      radius + other.radius
    )
      return;
    out.push({
      id: COMMONS_MOVER_ID,
      kind: "stimulus",
      center: [c[0], c[1], c[2]],
      radius: other.radius,
    });
  }
  light(p: V3): LightSample {
    return this.inner.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.inner.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.inner.foodAt(p);
  }
  odour(p: V3): number {
    return this.inner.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.inner.landmarks(near, radius, out);
  }
}

/** Bearing of world point `q` from a body at `p` facing `yaw` (rad, + left), the eyes' convention. */
export function bearingFrom(p: V3, yaw: number, q: V3): number {
  const f = forwardOf(yaw),
    l = leftOf(yaw);
  const dx = q[0] - p[0],
    dz = q[2] - p[2];
  return Math.atan2(dx * l[0] + dz * l[2], dx * f[0] + dz * f[2]);
}

export interface CommonsOptions {
  /** Commons step (s); the fly's physics step by default. */
  stepS?: number;
}

/**
 * The shared world, its clock, and its two places. Occupants join by index;
 * a view exists before its occupant (a fly is built in its world).
 */
export class Commons {
  readonly world: FlyWorld;
  readonly stepS: number;
  private readonly occupants: [Occupant | null, Occupant | null] = [null, null];
  private readonly views: [CommonsView, CommonsView];
  private steps = 0;
  private inContact = false;
  private bout: ContactBout | null = null;
  readonly bouts: ContactBout[] = [];
  private readonly events: CommonsEvent[] = [];
  /** Cached poses for the current step (null until joined). */
  private readonly poses: [BodyPose | null, BodyPose | null] = [null, null];

  constructor(world: FlyWorld, options: CommonsOptions = {}) {
    this.world = world;
    this.stepS = options.stepS ?? 0.005;
    if (!(this.stepS > 0 && this.stepS <= 0.01))
      throw new Error("commons: step must be in (0, 10] ms");
    this.views = [new CommonsView(world, this, 0), new CommonsView(world, this, 1)];
  }

  /** Commons time (s). */
  get t(): number {
    return this.steps * this.stepS;
  }

  view(index: 0 | 1): CommonsView {
    return this.views[index];
  }

  join(index: 0 | 1, occupant: Occupant): void {
    refuseOriginal(occupant.id, "commons occupant");
    if (!occupant.id.startsWith("research-"))
      throw new Error(`commons occupants are research subjects, not ${occupant.id}`);
    if (this.occupants[index]) throw new Error(`commons: place ${index} is taken`);
    const other = this.poses[index === 0 ? 1 : 0],
      mine = occupant.pose();
    if (
      other &&
      Math.hypot(
        mine.center[0] - other.center[0],
        mine.center[1] - other.center[1],
        mine.center[2] - other.center[2],
      ) <
        mine.radius + other.radius
    )
      throw new Error("commons: an occupant cannot be placed inside the other's body");
    this.occupants[index] = occupant;
    this.poses[index] = occupant.pose();
    this.append("join", { index, id: occupant.id });
  }

  leave(index: 0 | 1): void {
    if (!this.occupants[index]) return;
    this.closeBout();
    this.occupants[index] = null;
    this.poses[index] = null;
    this.append("leave", { index });
  }

  /** The current pose of an occupant (the simulator's side), or null. */
  poseOf(index: 0 | 1): BodyPose | null {
    return this.poses[index];
  }

  occupant(index: 0 | 1): Occupant | null {
    return this.occupants[index];
  }

  /** Advance both occupants by one step each, in turn, and deliver touch. */
  step(): void {
    const order: (0 | 1)[] = this.steps % 2 === 0 ? [0, 1] : [1, 0];
    for (const i of order) {
      const o = this.occupants[i];
      if (!o) continue;
      o.step(this.stepS);
      this.poses[i] = o.pose();
    }
    this.steps++;
    this.touch();
  }

  /** Run `seconds` of commons time. */
  run(seconds: number, each?: () => void): void {
    const n = Math.round(seconds / this.stepS);
    for (let k = 0; k < n; k++) {
      this.step();
      each?.();
    }
  }

  private touch(): void {
    const a = this.poses[0],
      b = this.poses[1];
    const oa = this.occupants[0],
      ob = this.occupants[1];
    if (!a || !b || !oa || !ob) return;
    const d = Math.hypot(
      a.center[0] - b.center[0],
      a.center[1] - b.center[1],
      a.center[2] - b.center[2],
    );
    const contact = d - a.radius - b.radius <= ENCOUNTER_GAP_M;
    const onset = contact && !this.inContact;
    if (onset) {
      this.bout = {
        start: this.t,
        end: null,
        closestM: d,
        onsetSpeeds: [a.speed, b.speed],
      };
      this.append("contact-start", {
        distanceM: d,
        speeds: [a.speed, b.speed],
      });
    }
    if (contact) {
      this.bout!.closestM = Math.min(this.bout!.closestM, d);
      oa.port?.touch({
        t: this.t,
        dt: this.stepS,
        onset,
        bearing: bearingFrom(a.center, a.yaw, b.center),
        chemistry: ob.chemistry ? [...ob.chemistry] : null,
      });
      ob.port?.touch({
        t: this.t,
        dt: this.stepS,
        onset,
        bearing: bearingFrom(b.center, b.yaw, a.center),
        chemistry: oa.chemistry ? [...oa.chemistry] : null,
      });
    } else if (this.inContact) this.closeBout();
    this.inContact = contact;
  }

  private closeBout(): void {
    if (!this.bout) return;
    this.occupants[0]?.port?.release?.();
    this.occupants[1]?.port?.release?.();
    this.bout.end = this.t;
    this.bouts.push(this.bout);
    this.append("contact-end", {
      durationS: this.bout.end - this.bout.start,
      closestM: this.bout.closestM,
    });
    this.bout = null;
    this.inContact = false;
  }

  /** The record so far (contact bouts still open are not in `bouts`). */
  get record(): readonly CommonsEvent[] {
    return this.events;
  }

  /** The open bout, if the two are in contact now. */
  get openBout(): ContactBout | null {
    return this.bout;
  }

  private append(kind: CommonsEvent["kind"], detail: Record<string, unknown>) {
    const prev = this.events.at(-1)?.hash ?? "";
    const body = { seq: this.events.length, t: this.t, kind, detail, prev };
    this.events.push(Object.freeze({ ...body, hash: sha256Json(body) }));
  }
}

/** Re-derives every hash of a commons record; the first broken sequence number, or null. */
export function verifyCommonsRecord(events: readonly CommonsEvent[]): number | null {
  let prev = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const body = { seq: e.seq, t: e.t, kind: e.kind, detail: e.detail, prev: e.prev };
    if (e.seq !== i || e.prev !== prev || sha256Json(body) !== e.hash) return i;
    prev = e.hash;
  }
  return null;
}
