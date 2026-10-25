/**
 * One digital fly: a reduced-order body, its senses and a decision maker,
 * advanced on a fixed clock.
 *
 * Rates are fixed by the parameter table and independent of rendering: the
 * body integrates every `physicsStepMs` (5 ms), the eyes sample every
 * `sensePeriodMs` (10 ms) and the controller decides every
 * `decisionPeriodMs` (50 ms) on the sample from `visualLatencyMs` before.
 * `advance(dt)` runs however many steps `dt` holds and carries the remainder,
 * so a fly stepped 0.1 s at a time and one stepped 0.005 s at a time follow
 * the same trajectory. Three seeded streams (body, senses, controller) come
 * from one seed, so a seed and the world's own history replay exactly.
 *
 * What is simulated: the fly's centre of mass, heading, mode and the timing
 * of its gait, saccades, takeoffs and landings, with collisions against the
 * world. What is only drawn: body pitch and roll (derived from the thrust the
 * motion needs), the leg placement (inverse kinematics on FlyBody's legs) and
 * the wingbeat (FlyBody's prototype pattern). See docs/DIGITAL_FLY.md.
 *
 * The decision maker sees frozen copies of the body, the senses, the landing
 * sites and the parameters, and every command it returns goes through
 * `validateCommand`; a refusal puts the body in a safe hold for its mode.
 */
import { canonicalHash } from "../../game/pilot/hash.js";
import { mulberry32 } from "../../lib/noise.js";
import {
  checkedPerturbation,
  NO_PERTURBATION,
  type MotionPerturbation,
} from "./echo/apparatus.js";
import { gauss } from "./senses.js";
import { ReducedOrderController } from "./controller.js";
import {
  coordination,
  dutyFactor,
  stanceCount,
  stepPeriodS,
  steppingSpeedCmS,
  STEPPING_MIN_CMS,
  type GaitParams,
} from "./gait.js";
import {
  LIMITS,
  PERCHED,
  siteHolding,
  validateCommand,
  type AdapterStreams,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type GateContext,
  type GroomRoutine,
  type Mode,
  type MotorCommand,
} from "./neural.js";
import { resolveParams, type ControllerConfig, type ResolvedParams } from "./params.js";
import { inVisualField, Senses, type SenseFrame } from "./senses.js";
import { FOOT_RADIUS_CM, SKELETON } from "./skeleton.js";
import { degToRad, forward, left, radToDeg, type V3, wrapAngle } from "./units.js";
import {
  WALKABLE_NORMAL_Y,
  type FlyWorld,
  type LandingSite,
  type Perch,
  type SurfaceKind,
} from "./world.js";

export const FLY_VERSION = "digital-fly/8";
const G = 9.81;
/** Drag per unit mass used only to tilt the drawn body in forward flight (1/s). Not fitted. */
const DRAW_DRAG = 3;
/** The drawn thrust never points less upward than this share of gravity, so the drawn fly never turns over. */
const DRAW_THRUST_FLOOR_G = 0.1;
/** The feet must come this close to the landing point before a touchdown is tried (m). */
const TOUCHDOWN_REACH_M = 0.0015;
/** A touchdown needs the feet within this of the surface under them; farther, it is aborted (m). */
const TOUCHDOWN_GAP_M = 0.002;
/** A contact lasts while the surface stays within the standing height plus this (m). */
const CONTACT_SLOP_M = 0.001;
/**
 * A takeoff prepared in less than this is short-mode: no wing raise (s). A
 * model boundary, for commands that do not say (`MotorCommand.wings`).
 */
const SHORT_MODE_BELOW_S = 0.1;
/** How far the drawn body leans toward the jump by the end of a takeoff's preparation (rad). Drawing only. */
const LAUNCH_LEAN_RAD = 0.15;
/** A walking step goes ahead only onto a top within this of the current one (m). */
const STEP_HEIGHT_M = 0.004;

export interface FlyCounts {
  takeoffs: number;
  escapes: number;
  landings: number;
  saccades: number;
  /** Contacts with a surface, each counted once, when it begins. */
  collisions: number;
  /** Seconds spent in contact with a surface while airborne. */
  contactS: number;
  groomBouts: number;
  rejected: number;
  walkedM: number;
  flownM: number;
  /** Feeding bouts begun, seconds spent feeding and energy taken in (J). */
  meals: number;
  feedS: number;
  fedJ: number;
  /** Energy spent (J). */
  spentJ: number;
}

/** A surface the airborne fly is touching, and its outward normal there. */
export interface Contact {
  id: string;
  kind: SurfaceKind;
  normal: V3;
}

export interface FlyState {
  t: number;
  step: number;
  mode: Mode;
  sub: string;
  modeT: number;
  p: V3;
  v: V3;
  yaw: number;
  yawRate: number;
  pitch: number;
  roll: number;
  perch: Perch | null;
  edge: boolean;
  gaitClock: number;
  walkSpeed: number;
  wingHz: number;
  ampL: number;
  ampR: number;
  /** 0 folded over the abdomen .. 1 beating. */
  wingsOpen: number;
  /** 0 tucked for flight .. 1 extended to stand or land. */
  legs: number;
  /**
   * A turn of the heading under way. `launch` marks the turn the body makes
   * after a jump, toward where the jump is carrying it: the velocity keeps the
   * jump's direction while it lasts.
   */
  saccade: {
    from: number;
    delta: number;
    t0: number;
    dur: number;
    launch: boolean;
  } | null;
  takeoff: { heading: number; prepare: number; short: boolean } | null;
  /** The landing target: the point on the site's surface the feet are to touch. */
  target: { id: string; point: V3; radius: number; site: LandingSite } | null;
  contact: Contact | null;
  groom: GroomRoutine | null;
  responsiveness: number;
  /** The carbohydrate reserve that powers flight (J); full is `reserveJ`. */
  reserve: number;
  flightT: number;
  flightBout: number;
  counts: FlyCounts;
}

export interface DecisionRecord {
  t: number;
  from: string;
  to: string;
  reason: string;
  kind: "decision" | "event" | "refused";
}

/** Where and how a fly starts. */
export interface FlyStart {
  /** At rest the fly settles onto the surface below this point; in flight it starts exactly here. */
  p: V3;
  yaw: number;
  /**
   * `"rest"` (the default) perches the fly. `"flight"` starts it airborne in
   * cruise: wings open and beating, legs tucked, a fresh flight bout.
   */
  mode?: "rest" | "flight";
  /** Initial world-frame velocity (m/s). Flight only, within the body's flight limit. */
  v?: V3;
}

export interface DigitalFlyOptions {
  seed: number;
  world: FlyWorld;
  start: FlyStart;
  config?: ControllerConfig;
  /** Relative sensory noise, 0 for none. */
  noise?: number;
  /** Builds the decision maker from its random stream; defaults to the reduced-order controller. */
  adapter?: (rng: () => number, streams: AdapterStreams) => FlyNeuralAdapter;
  logSize?: number;
  /** Experimental kinematic apparatus, hidden from the adapter. */
  perturbation?: (t: number) => MotionPerturbation;
}

const NO_SITES: readonly LandingSite[] = Object.freeze([]);

/** Where the eyes were when a sensory sample was taken. */
interface EyePose {
  p: V3;
  yaw: number;
}

/**
 * What the fast pathway gets for a sample between decisions: a decision's
 * input whose body is frozen only when first read. Freezing is the costly
 * part, and most samples are answered from the frame alone.
 */
class SampleInput implements DecisionInput {
  readonly frame: SenseFrame;
  readonly sites: readonly LandingSite[];
  readonly params: ResolvedParams;
  readonly dt: number;
  private made: BodySnapshot | null = null;
  private readonly make: () => BodySnapshot;
  constructor(
    make: () => BodySnapshot,
    frame: SenseFrame,
    sites: readonly LandingSite[],
    params: ResolvedParams,
    dt: number,
  ) {
    this.make = make;
    this.frame = frame;
    this.sites = sites;
    this.params = params;
    this.dt = dt;
  }
  get body(): BodySnapshot {
    return (this.made ??= this.make());
  }
}

export class DigitalFly {
  /** The resolved parameters, frozen. */
  readonly params: ResolvedParams;
  readonly world: FlyWorld;
  readonly adapter: FlyNeuralAdapter;
  readonly seed: number;
  readonly noise: number;
  /** Height of the thorax above the surface it stands on (m): FlyBody's zero-pose height × `standingCrouch`. */
  readonly standingHeight: number;
  state: FlyState;
  readonly log: DecisionRecord[] = [];
  /** The sensory sample the last decision used, and the command it produced. */
  lastFrame: SenseFrame | null = null;
  lastCommand: MotorCommand | null = null;
  /** The decision maker's own copy of the parameters: frozen, and not the one the gate reads. */
  private adapterParams: ResolvedParams;
  private senses: Senses;
  private frames: SenseFrame[] = [];
  /** Where the eyes were for each of `frames`, for the landing sites they could see. */
  private framePoses: EyePose[] = [];
  /** A frozen copy of the body now, for the fast pathway's inputs. */
  private readonly frozenSnapshot = (): BodySnapshot => frozen(this.snapshot());
  private command: MotorCommand;
  private bodyRng: () => number;
  private pendingUs = 0;
  private stepUs: number;
  private senseEvery: number;
  private decideEvery: number;
  private latencyFrames: number;
  private logSize: number;
  private gait: GaitParams;
  private surface: GateContext["surface"];
  private food: NonNullable<GateContext["food"]>;
  private perturbation?: (t: number) => MotionPerturbation;
  private intervention = NO_PERTURBATION;
  private motionRng: () => number;
  private motion = {
    forward: 0,
    lateral: 0,
    vertical: 0,
    turn: 0,
    dt: 0,
    clear: true,
    mode: "rest" as Mode,
  };

  constructor(o: DigitalFlyOptions) {
    this.seed = o.seed >>> 0;
    this.perturbation = o.perturbation;
    this.motionRng = mulberry32(this.seed ^ 0x510e527f);
    this.world = o.world;
    this.params = resolveParams(o.config);
    this.adapterParams = Object.freeze({ ...this.params });
    this.noise = o.noise ?? 0;
    if (!Number.isFinite(this.noise) || this.noise < 0 || this.noise > 1)
      throw new Error("sensory noise must be in [0, 1]");
    const P = this.params;
    this.standingHeight = (SKELETON.measures.standingHeightCm / 100) * P.standingCrouch;
    this.surface = (x, z, maxY) => this.world.perchAt(x, z, maxY);
    this.food = (p) => this.world.foodAt(p);
    this.bodyRng = mulberry32(this.seed ^ 0x9e3779b9);
    const senseRng = mulberry32(this.seed ^ 0x85ebca6b);
    const ctrlRng = mulberry32(this.seed ^ 0xc2b2ae35);
    const streams: AdapterStreams = { navigation: mulberry32(this.seed ^ 0x27d4eb2f) };
    this.adapter = (
      o.adapter ?? ((rng, st) => new ReducedOrderController(rng, st.navigation))
    )(ctrlRng, streams);
    this.senses = new Senses(o.world, P, this.noise, senseRng);
    this.stepUs = Math.max(1000, Math.round(P.physicsStepMs * 1000));
    this.senseEvery = Math.max(1, Math.round((P.sensePeriodMs * 1000) / this.stepUs));
    this.decideEvery = Math.max(1, Math.round((P.decisionPeriodMs * 1000) / this.stepUs));
    this.latencyFrames = Math.max(
      0,
      Math.round(P.visualLatencyMs / (this.senseEvery * (this.stepUs / 1000))),
    );
    this.logSize = o.logSize ?? 200;
    this.gait = {
      stanceLegsAt1: P.stanceLegsAt1,
      stanceLegsAt4: P.stanceLegsAt4,
      swingMs: P.swingMs,
      stepPeriodFloorMs: P.stepPeriodFloorMs,
      walkSpeedMinCmS: P.walkSpeedMinCmS,
      walkSpeedMaxCmS: P.walkSpeedMaxCmS,
    };
    const start = o.start;
    const startMode = start.mode ?? "rest";
    if (startMode !== "rest" && startMode !== "flight")
      throw new Error(`a fly starts at rest or in flight, not ${String(startMode)}`);
    if (!isV3(start.p) || !Number.isFinite(start.yaw))
      throw new Error("the start needs a finite position and heading");
    if (start.v !== undefined && !isV3(start.v))
      throw new Error("the start velocity must be a finite 3-vector (m/s)");
    const v0: V3 =
      start.v === undefined ? [0, 0, 0] : [start.v[0], start.v[1], start.v[2]];
    if (Math.hypot(...v0) > LIMITS.flightSpeed)
      throw new Error(
        `the start velocity exceeds the flight limit (${LIMITS.flightSpeed} m/s)`,
      );
    let perch: Perch | null = null;
    let p0: V3;
    if (startMode === "rest") {
      if (v0[0] !== 0 || v0[1] !== 0 || v0[2] !== 0)
        throw new Error(
          'a fly placed at rest starts still; give a velocity with mode "flight"',
        );
      perch = o.world.perchAt(start.p[0], start.p[2], start.p[1]);
      if (!perch) throw new Error("no surface below the fly's start");
      p0 = [start.p[0], perch.y + this.standingHeight, start.p[2]];
    } else {
      if (o.world.solid(start.p)) throw new Error("the fly's start is inside a solid");
      p0 = [start.p[0], start.p[1], start.p[2]];
    }
    const flying = startMode === "flight";
    this.state = {
      t: 0,
      step: 0,
      mode: startMode,
      sub: flying ? "cruise" : "",
      modeT: 0,
      p: p0,
      v: v0,
      yaw: wrapAngle(start.yaw),
      yawRate: 0,
      pitch: 0,
      roll: 0,
      perch,
      edge: false,
      gaitClock: 0,
      walkSpeed: 0,
      wingHz: P.wingbeatHz,
      ampL: 1,
      ampR: 1,
      wingsOpen: flying ? 1 : 0,
      legs: flying ? 0 : 1,
      saccade: null,
      takeoff: null,
      target: null,
      contact: null,
      groom: null,
      responsiveness: 1,
      reserve: P.reserveJ * P.startReserve,
      flightT: 0,
      flightBout: flying ? this.drawFlightBout() : 0,
      counts: {
        takeoffs: 0,
        escapes: 0,
        landings: 0,
        saccades: 0,
        collisions: 0,
        contactS: 0,
        groomBouts: 0,
        rejected: 0,
        walkedM: 0,
        flownM: 0,
        meals: 0,
        feedS: 0,
        fedJ: 0,
        spentJ: 0,
      },
    };
    // Placed in flight, the drawn attitude is the one holding that velocity.
    if (flying) this.drawAttitude([0, 0, 0]);
    this.command = flying
      ? { mode: "flight", velocity: [...v0], reason: "placed in flight" }
      : { mode: "rest", reason: "placed" };
    this.adapter.start?.(frozen(this.snapshot()));
  }

  /** A flight bout's length, drawn from the body's stream at the start of every flight. */
  private drawFlightBout(): number {
    const P = this.params;
    return Math.min(20, Math.max(1.5, -Math.log(1 - this.bodyRng()) * P.flightBoutMeanS));
  }

  get gaitParams(): GaitParams {
    return this.gait;
  }

  /** Advance by `dt` seconds of simulated time. */
  advance(dt: number): void {
    if (!(dt >= 0) || !Number.isFinite(dt))
      throw new Error("dt must be finite and non-negative");
    this.pendingUs += Math.round(dt * 1e6);
    while (this.pendingUs >= this.stepUs) {
      this.pendingUs -= this.stepUs;
      this.step();
    }
  }

  private record(kind: DecisionRecord["kind"], from: string, to: string, reason: string) {
    this.log.push({ t: round(this.state.t, 3), from, to, reason, kind });
    if (this.log.length > this.logSize)
      this.log.splice(0, this.log.length - this.logSize);
  }

  private label(mode = this.state.mode, sub = this.state.sub) {
    return sub ? `${mode}/${sub}` : mode;
  }

  /** A fresh copy of the body as a decision maker may see it. */
  private snapshot(): BodySnapshot {
    const s = this.state;
    const home = this.world.home;
    return {
      t: s.t,
      mode: s.mode,
      sub: s.sub,
      modeT: s.modeT,
      p: [...s.p],
      v: [...s.v],
      yaw: s.yaw,
      altitude: this.lastFrame?.altitude ?? 0,
      walkSpeed: s.walkSpeed,
      flightT: s.flightT,
      flightBout: s.flightBout,
      responsiveness: s.responsiveness,
      groom: s.groom,
      edge: s.edge,
      target: s.target ? { id: s.target.id, point: [...s.target.point] } : null,
      standingHeight: this.standingHeight,
      reserve: s.reserve / this.params.reserveJ,
      onFood: PERCHED.has(s.mode)
        ? (this.world.foodAt([s.p[0], s.p[1] - this.standingHeight, s.p[2]])?.kind ??
          null)
        : null,
      home: {
        center: [...home.center],
        radius: home.radius,
        ceiling: home.ceiling,
        ...(home.bounds
          ? {
              bounds: {
                min: { ...home.bounds.min },
                max: { ...home.bounds.max },
              },
            }
          : {}),
      },
    };
  }

  private setMode(mode: Mode, sub: string, reason: string, kind: DecisionRecord["kind"]) {
    const s = this.state;
    const from = this.label();
    s.mode = mode;
    s.sub = sub;
    s.modeT = 0;
    this.record(kind, from, this.label(), reason);
  }

  private step(): void {
    const s = this.state;
    const P = this.params;
    const h = this.stepUs / 1e6;
    const deciding = s.step % this.decideEvery === 0;
    if (s.step % this.senseEvery === 0) {
      this.frames.push(
        frozen(
          this.senses.sample({
            t: s.t,
            p: s.p,
            v: s.v,
            yaw: s.yaw,
            flying: !PERCHED.has(s.mode) && s.takeoff === null,
          }),
        ),
      );
      this.framePoses.push({ p: [s.p[0], s.p[1], s.p[2]], yaw: s.yaw });
      if (this.frames.length > this.latencyFrames + 1) {
        this.frames.shift();
        this.framePoses.shift();
      }
      // Every sample between decisions goes to the decision maker's fast pathway.
      if (!deciding) this.interrupt(this.senseEvery * h);
    }
    if (this.perturbation)
      this.intervention = checkedPerturbation(this.perturbation(s.t));
    if (deciding) {
      if (this.adapter.observeMotion) {
        const m = this.motion,
          q = this.intervention;
        this.adapter.observeMotion(
          frozen({
            tick: s.step,
            t: s.t,
            dt: m.dt,
            forwardM:
              m.forward +
              ((q.sensorBiasCmS + q.sensorNoiseCmS * gauss(this.motionRng)) * m.dt) / 100,
            lateralM: m.lateral,
            verticalM: m.vertical,
            turnRad: m.turn,
            reserve: s.reserve / P.reserveJ,
            mode: s.mode,
            clear: m.clear && m.mode === s.mode,
          }),
        );
        this.motion = {
          forward: 0,
          lateral: 0,
          vertical: 0,
          turn: 0,
          dt: 0,
          clear: true,
          mode: s.mode,
        };
      }
      this.decide(this.decideEvery * h);
    }
    const before = this.adapter.observeMotion ? { p: [...s.p], yaw: s.yaw } : null;
    this.integrate(h);
    if (before) {
      const dx = s.p[0] - before.p[0]!,
        dz = s.p[2] - before.p[2]!;
      const m = this.motion;
      m.forward += Math.cos(s.yaw) * dx - Math.sin(s.yaw) * dz;
      m.lateral += Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz;
      m.vertical += s.p[1] - before.p[1]!;
      m.turn += wrapAngle(s.yaw - before.yaw);
      m.dt += h;
      m.clear =
        m.clear && !s.edge && s.contact === null && !s.saccade && m.mode === s.mode;
    }
    this.metabolize(h);
    s.responsiveness +=
      (1 - s.responsiveness) * (1 - Math.exp(-h / P.habituationRecoveryS));
    s.t = round(s.t + h, 6);
    s.modeT += h;
    s.step++;
  }

  /**
   * The landing sites on offer: the tops within `landingSearchM` that the
   * eyes saw in the sample the decision uses (inside an eye's field, at least
   * one ommatidium across and with a clear line to them, from where the eyes
   * were then), the point of the surface directly under the fly, and the site
   * already being approached. Frozen, so a decision maker cannot add to them.
   */
  private offeredSites(eyes: EyePose): readonly LandingSite[] {
    const s = this.state;
    const P = this.params;
    if (s.mode !== "flight" && s.mode !== "land") return NO_SITES;
    const all: LandingSite[] = [];
    this.world.landingSites(eyes.p, P.landingSearchM, all);
    const out: LandingSite[] = [];
    const fwd = forward(eyes.yaw),
      lft = left(eyes.yaw);
    const acuity = degToRad(P.interommatidialDeg);
    for (const site of all) {
      const d: V3 = [
        site.center[0] - eyes.p[0],
        site.center[1] - eyes.p[1],
        site.center[2] - eyes.p[2],
      ];
      const dist = Math.hypot(...d);
      if (dist < 1e-3) continue;
      // A top narrower than one ommatidium is not resolved, as for a moving thing.
      const size = 2 * Math.atan2(Math.min(site.half[0], site.half[1]), dist);
      if (size < acuity) continue;
      const bearing = Math.atan2(
        d[0] * lft[0] + d[2] * lft[2],
        d[0] * fwd[0] + d[2] * fwd[2],
      );
      const elevation = Math.asin(Math.max(-1, Math.min(1, d[1] / dist)));
      if (!inVisualField(bearing, elevation, size / 2)) continue;
      const dir: V3 = [d[0] / dist, d[1] / dist, d[2] / dist];
      const hit = this.world.raycast(eyes.p, dir, dist, true);
      if (hit && hit.t < dist - 0.01) continue;
      // Whether the sun is on it, which the eyes see as its brightness.
      const sunlit = this.world.light([
        site.center[0],
        site.center[1] + 0.01,
        site.center[2],
      ]).sunlit;
      out.push(frozenSite(sunlit === undefined ? site : { ...site, sunlit }));
    }
    const below = this.world.perchAt(s.p[0], s.p[2], s.p[1]);
    if (below) {
      const sunlit = this.world.light([s.p[0], below.y + 0.01, s.p[2]]).sunlit;
      out.push(
        frozenSite({
          id: below.id,
          kind: below.kind,
          center: [s.p[0], below.y, s.p[2]],
          half: [0, 0],
          angle: 0,
          below: true,
          ...(sunlit === undefined ? {} : { sunlit }),
        }),
      );
    }
    // The site being approached stays on offer while the fly approaches it.
    if (s.target) out.push(s.target.site);
    return Object.freeze(out);
  }

  private decide(dt: number): void {
    const frame = this.frames[0];
    if (!frame) return;
    this.lastFrame = frame;
    const sites = this.offeredSites(this.framePoses[0]!);
    let raw: unknown;
    try {
      raw = this.adapter.decide({
        body: frozen(this.snapshot()),
        frame,
        sites,
        params: this.adapterParams,
        dt,
      });
    } catch (e) {
      this.refuse(`the decision maker failed: ${describe(e)}`);
      return;
    }
    // Checked against a fresh snapshot, not the copy the decision maker held.
    const verdict = validateCommand(raw, this.snapshot(), this.params, {
      sites,
      surface: this.surface,
      food: this.food,
    });
    if (!verdict.ok) {
      this.refuse(`command refused: ${verdict.reason}`);
      return;
    }
    this.lastCommand = verdict.command;
    this.apply(verdict.command, sites);
    this.adapter.acceptedMotion?.(verdict.command, this.motionParams(), false);
  }

  /**
   * Offer a sensory sample that falls between decisions to the decision
   * maker's fast pathway, if it has one. A command it returns passes the same
   * gate as a decision; null lets the current command run on.
   */
  private interrupt(dt: number): void {
    const frame = this.frames[0];
    if (!frame) return;
    const s = this.state;
    // No new sites between decisions: only the one being approached stays on offer.
    const sites = s.target ? Object.freeze([s.target.site]) : NO_SITES;
    let raw: unknown;
    try {
      const fast = this.adapter.interrupt;
      if (typeof fast !== "function") return;
      raw = fast.call(
        this.adapter,
        new SampleInput(this.frozenSnapshot, frame, sites, this.adapterParams, dt),
      );
    } catch (e) {
      this.refuse(`the decision maker's interrupt failed: ${describe(e)}`);
      return;
    }
    if (raw === null || raw === undefined) return;
    const verdict = validateCommand(raw, this.snapshot(), this.params, {
      sites,
      surface: this.surface,
      food: this.food,
    });
    if (!verdict.ok) {
      this.refuse(`interrupt refused: ${verdict.reason}`);
      return;
    }
    this.lastFrame = frame;
    this.lastCommand = verdict.command;
    this.apply(verdict.command, sites);
    this.adapter.acceptedMotion?.(verdict.command, this.motionParams(), true);
  }

  /** Actual rounded integration clock, not the requested parameter periods. */
  private motionParams(): ResolvedParams {
    return Object.freeze({
      ...this.adapterParams,
      physicsStepMs: this.stepUs / 1000,
      decisionPeriodMs: (this.decideEvery * this.stepUs) / 1000,
    });
  }

  /** Count and log a refusal, and hold safely: the last accepted command does not keep running. */
  private refuse(reason: string): void {
    const s = this.state;
    const from = this.label();
    s.counts.rejected++;
    this.command = this.hold();
    this.adapter.invalidateMotion?.();
    if (s.mode === "flight" && s.sub === "cruise") s.sub = "hover";
    this.record("refused", from, this.label(), reason);
  }

  /** The safe hold for the body's mode: hover in the air, stop walking, stay put when perched. */
  private hold(): MotorCommand {
    const s = this.state;
    switch (s.mode) {
      case "flight":
        return {
          mode: "flight",
          hover: true,
          velocity: [0, 0, 0],
          reason: "hold: hover",
        };
      case "land":
        return { mode: "land", hover: true, velocity: [0, 0, 0], reason: "hold: hover" };
      case "walk":
        return { mode: "walk", walkSpeed: 0, yawRate: 0, reason: "hold: stop" };
      case "groom":
        return s.groom
          ? { mode: "groom", groom: s.groom, reason: "hold" }
          : { mode: "groom", reason: "hold" };
      default:
        return { mode: s.mode, reason: "hold" };
    }
  }

  /** Take a validated landing target, with its point moved onto the real surface. */
  private setTarget(
    land: { id: string; point: V3 },
    sites: readonly LandingSite[],
  ): void {
    const s = this.state;
    const ctx: GateContext = { sites, surface: this.surface };
    // The gate has already found this site and this surface.
    const site = siteHolding(ctx, land.id, land.point)!;
    const top = this.world.perchAt(
      land.point[0],
      land.point[2],
      land.point[1] + LIMITS.landPointTolM,
    )!;
    s.target = {
      id: land.id,
      point: [land.point[0], top.y, land.point[2]],
      radius: Math.max(0.01, Math.min(site.half[0], site.half[1])),
      site,
    };
  }

  private apply(cmd: MotorCommand, sites: readonly LandingSite[]): void {
    const s = this.state;
    const P = this.params;
    this.command = cmd;
    if (cmd.mode !== s.mode) {
      switch (cmd.mode) {
        case "escape":
        case "takeoff": {
          const prepare = cmd.prepare ?? P.takeoffPrepMs / 1000;
          s.takeoff = {
            heading: cmd.heading ?? s.yaw,
            prepare,
            short: cmd.wings === undefined ? prepare < SHORT_MODE_BELOW_S : !cmd.wings,
          };
          if (cmd.mode === "escape") {
            s.counts.escapes++;
            s.responsiveness *= 1 - P.habituationStep;
          }
          s.walkSpeed = 0;
          s.groom = null;
          this.setMode(cmd.mode, "prepare", cmd.reason, "decision");
          return;
        }
        case "groom":
          s.groom = cmd.groom ?? "eyes";
          s.counts.groomBouts++;
          s.walkSpeed = 0;
          this.setMode("groom", s.groom, cmd.reason, "decision");
          return;
        case "walk":
          s.groom = null;
          this.setMode("walk", "", cmd.reason, "decision");
          break;
        case "rest":
          s.groom = null;
          s.walkSpeed = 0;
          this.setMode("rest", "", cmd.reason, "decision");
          return;
        case "feed":
          s.groom = null;
          s.walkSpeed = 0;
          s.counts.meals++;
          this.setMode("feed", "", cmd.reason, "decision");
          return;
        case "land":
          this.setTarget(cmd.land!, sites);
          s.saccade = null;
          this.setMode("land", "approach", cmd.reason, "decision");
          break;
        case "flight":
          s.target = null;
          this.setMode("flight", "cruise", cmd.reason, "decision");
          break;
      }
    } else if (s.mode === "land" && cmd.land && s.target) {
      const t = s.target;
      const p = cmd.land.point;
      if (cmd.land.id !== t.id || p[0] !== t.point[0] || p[2] !== t.point[2]) {
        const from = this.label();
        this.setTarget(cmd.land, sites);
        s.sub = "approach";
        this.record("decision", from, this.label(), `new landing target: ${cmd.reason}`);
      }
    } else if (s.takeoff && cmd.prepare !== undefined) this.bringForward(cmd);
    if (s.mode === "groom" && cmd.groom && cmd.groom !== s.groom) {
      const from = this.label();
      s.groom = cmd.groom;
      s.sub = cmd.groom;
      this.record("decision", from, this.label(), cmd.reason);
    }
    if (s.mode === "flight") {
      if (cmd.saccade !== undefined && s.sub !== "saccade") {
        s.saccade = {
          from: s.yaw,
          delta: cmd.saccade,
          t0: s.t,
          dur: P.saccadeMs / 1000,
          launch: false,
        };
        s.counts.saccades++;
        const from = this.label();
        s.sub = "saccade";
        this.record("decision", from, this.label(), cmd.reason);
      } else if (cmd.hover && s.sub === "cruise") {
        const from = this.label();
        s.sub = "hover";
        this.record("decision", from, this.label(), cmd.reason);
      } else if (!cmd.hover && s.sub === "hover") {
        const from = this.label();
        s.sub = "cruise";
        this.record("decision", from, this.label(), "hover ends");
      }
    }
  }

  /** How long before a long-mode jump the wings begin to rise (s): the published sequence, or the whole preparation if shorter. */
  private wingRaiseS(prepare: number): number {
    return Math.min(this.params.longModeSequenceMs / 1000, prepare);
  }

  /**
   * A takeoff under way, brought forward: the jump comes `cmd.prepare` from
   * now when that is sooner than planned, never later. This is how a
   * giant-fiber spike cuts the long-mode program short (von Reyn et al.
   * 2014): if the wings have not begun to rise, the fly jumps with them
   * folded, a short-mode takeoff, unless the command asks for them; once they
   * are rising it stays long-mode.
   */
  private bringForward(cmd: MotorCommand): void {
    const s = this.state;
    const t = s.takeoff!;
    const at = s.modeT + cmd.prepare!;
    if (at >= t.prepare) return;
    const raising = !t.short && s.modeT >= t.prepare - this.wingRaiseS(t.prepare);
    const from = this.label();
    t.prepare = at;
    t.short = !raising && cmd.wings !== true;
    this.record(
      "decision",
      from,
      this.label(),
      `jump brought forward to ${Math.round(at * 1000)} ms, ${t.short ? "wings folded (short mode)" : "wings rising (long mode)"}: ${cmd.reason}`,
    );
  }

  private integrate(h: number): void {
    const s = this.state;
    const cmd = this.command;
    const ease = (x: number, target: number, tau: number) =>
      x + (target - x) * (1 - Math.exp(-h / tau));
    switch (s.mode) {
      case "rest":
      case "groom":
      case "feed":
        s.v = [0, 0, 0];
        s.walkSpeed = 0;
        s.yawRate = 0;
        s.pitch = ease(s.pitch, 0, 0.05);
        s.roll = ease(s.roll, 0, 0.05);
        s.wingsOpen = ease(s.wingsOpen, 0, 0.04);
        s.legs = ease(s.legs, 1, 0.03);
        return;
      case "walk":
        this.walk(h, cmd);
        return;
      case "takeoff":
      case "escape":
        this.prepareTakeoff();
        return;
      case "flight":
      case "land":
        this.fly(h, cmd);
        return;
    }
  }

  /**
   * The energy budget over one step: the mode's metabolic power is drawn from
   * the reserve, and a feeding fly takes in `feedIntakeMw` until the reserve
   * is full. Nothing here moves the body: an empty reserve stops voluntary
   * takeoffs (the controller's rule), not flight already under way.
   */
  private metabolize(h: number): void {
    const s = this.state;
    const P = this.params;
    const power =
      s.mode === "flight" || s.mode === "land"
        ? P.flightPowerMw
        : s.mode === "rest" || s.mode === "feed"
          ? P.restPowerMw
          : P.walkPowerMw;
    const spent = Math.min(s.reserve, (power / 1000) * h);
    s.reserve -= spent;
    s.counts.spentJ += spent;
    if (s.mode === "feed") {
      const taken = Math.min(P.reserveJ - s.reserve, (P.feedIntakeMw / 1000) * h);
      s.reserve += taken;
      s.counts.fedJ += taken;
      s.counts.feedS += h;
    }
  }

  private walk(h: number, cmd: MotorCommand): void {
    const s = this.state;
    const target = s.edge ? 0 : (cmd.walkSpeed ?? s.walkSpeed);
    s.walkSpeed +=
      (target - s.walkSpeed) * (1 - Math.exp(-h / this.params.walkSpeedTauS));
    s.yawRate = (cmd.yawRate ?? 0) * this.intervention.turningGain;
    s.yaw = wrapAngle(s.yaw + s.yawRate * h);
    s.wingsOpen = 0;
    s.legs = 1;
    s.pitch = 0;
    s.roll = 0;
    const speed = (s.walkSpeed / 100) * this.intervention.movementGain;
    // The legs step at the speed the feet pass over the ground, so a turn on the spot is stepped.
    const stepping = steppingSpeedCmS(s.walkSpeed, s.yawRate, FOOT_RADIUS_CM);
    if (stepping >= STEPPING_MIN_CMS)
      s.gaitClock = (s.gaitClock + h / stepPeriodS(stepping, this.gait)) % 1;
    const f = forward(s.yaw);
    const nx = s.p[0] + (f[0] * speed + this.intervention.driftMPerS[0]) * h,
      nz = s.p[2] + (f[2] * speed + this.intervention.driftMPerS[2]) * h;
    const perch = this.world.perchAt(nx, nz, s.p[1] + STEP_HEIGHT_M);
    const ok =
      perch !== null &&
      Math.abs(perch.y - (s.perch?.y ?? perch.y)) <= STEP_HEIGHT_M &&
      !this.world.solid([nx, perch.y + this.standingHeight, nz]);
    if (!ok) {
      s.edge = true;
      s.v = [0, 0, 0];
      return;
    }
    s.edge = false;
    s.perch = perch;
    s.v = [f[0] * speed, 0, f[2] * speed];
    s.p = [nx, perch.y + this.standingHeight, nz];
    s.counts.walkedM += speed * h;
  }

  private prepareTakeoff(): void {
    const s = this.state;
    const P = this.params;
    const t = s.takeoff!;
    s.v = [0, 0, 0];
    s.legs = 1;
    // The body does not turn to jump: the postural adjustment aims the jump,
    // leaning the body toward where it will go, away from a threat (Card &
    // Dickinson 2008). Drawn as pitch and roll toward the jump's heading.
    const toward = wrapAngle(t.heading - s.yaw);
    const lean = LAUNCH_LEAN_RAD * Math.min(1, s.modeT / t.prepare);
    s.pitch = -lean * Math.cos(toward);
    s.roll = -lean * Math.sin(toward);
    // A long-mode takeoff raises the wings at the end of its preparation, over
    // the published duration of the long-mode sequence, just before the jump;
    // a short-mode one jumps with them still folded (von Reyn et al. 2014).
    s.wingsOpen = t.short
      ? 0
      : Math.min(1, Math.max(0, 1 - (t.prepare - s.modeT) / this.wingRaiseS(t.prepare)));
    if (s.modeT < t.prepare) return;
    // The jump: along the heading the posture aimed, at the jump's elevation.
    const elevation = degToRad(P.jumpElevationDeg);
    const f = forward(t.heading);
    const v = P.jumpSpeedCmS / 100;
    s.v = [
      f[0] * v * Math.cos(elevation),
      v * Math.sin(elevation),
      f[2] * v * Math.cos(elevation),
    ];
    s.perch = null;
    s.contact = null;
    s.counts.takeoffs++;
    s.flightT = 0;
    s.flightBout = this.drawFlightBout();
    const jump = s.mode === "escape" ? `${t.short ? "short" : "long"}-mode jump` : "jump";
    s.takeoff = null;
    if (Math.abs(toward) > 1e-6) {
      // In the air the heading turns to where the jump is going, in one
      // saccade-length turn, and the jump's direction holds while it does.
      s.saccade = {
        from: s.yaw,
        delta: toward,
        t0: s.t,
        dur: P.saccadeMs / 1000,
        launch: true,
      };
      this.setMode(
        "flight",
        "saccade",
        `${jump}; the heading turns ${Math.round(radToDeg(toward))}° to its direction`,
        "event",
      );
    } else this.setMode("flight", "cruise", jump, "event");
    this.command = { mode: "flight", velocity: [...s.v], reason: jump };
  }

  /**
   * The drawn attitude and wingbeat for an acceleration `a` at the current
   * velocity: the pitch and roll that, at the current heading, turn the wing
   * thrust axis (FlyBody's `hover_up_dir`, vertical at the hover pitch) onto
   * the thrust the motion needs (gravity, acceleration and a nominal drag);
   * the beat frequency from that load.
   */
  private drawAttitude(a: V3): void {
    const s = this.state;
    const P = this.params;
    const T: V3 = [
      a[0] + DRAW_DRAG * s.v[0],
      a[1] + G + DRAW_DRAG * s.v[1],
      a[2] + DRAW_DRAG * s.v[2],
    ];
    const f = forward(s.yaw),
      l = left(s.yaw);
    // The thrust in the heading's frame: forward, left, up.
    const up = Math.max(T[1], DRAW_THRUST_FLOOR_G * G);
    const tf = T[0] * f[0] + T[2] * f[2],
      tl = T[0] * l[0] + T[2] * l[2];
    const n = Math.hypot(tf, tl, up);
    // The thrust axis in the body: forward and up, vertical once pitched up to the hover pitch.
    const hover = degToRad(P.bodyPitchHoverDeg);
    const hx = Math.sin(hover),
      hz = Math.cos(hover);
    // Roll swings the axis sideways (by at most hz), then pitch turns it in the
    // body's vertical plane onto the rest of the thrust.
    const sinRoll = Math.max(-1, Math.min(1, -tl / n / hz));
    s.roll = Math.asin(sinRoll);
    s.pitch =
      Math.atan2(up / n, tf / n) - Math.atan2(hz * Math.sqrt(1 - sinRoll * sinRoll), hx);
    const load = Math.hypot(...T) / G;
    s.wingHz =
      P.wingbeatHz *
      (1 + P.wingbeatRelRange * Math.max(-1, Math.min(1, (load - 1) / 0.5)));
  }

  private fly(h: number, cmd: MotorCommand): void {
    const s = this.state;
    const P = this.params;
    // Heading: a saccade follows a smooth, bell-shaped velocity profile; otherwise the commanded rate.
    const yaw0 = s.yaw;
    if (s.saccade) {
      const u = Math.min(1, (s.t + h - s.saccade.t0) / s.saccade.dur);
      const profile = u * u * (3 - 2 * u);
      s.yaw = wrapAngle(s.saccade.from + s.saccade.delta * profile);
      if (u >= 1) {
        s.saccade = null;
        if (s.mode === "flight" && s.sub === "saccade") s.sub = "cruise";
      }
    } else
      s.yaw = wrapAngle(s.yaw + (cmd.yawRate ?? 0) * this.intervention.turningGain * h);
    const yawRate = wrapAngle(s.yaw - yaw0) / h;
    const yawAcc = (yawRate - s.yawRate) / h;
    s.yawRate = yawRate;
    // Desired velocity: in cruise the horizontal speed is carried along the
    // current heading; while the heading turns after a jump, along the jump's.
    let vd: V3 = cmd.velocity ? [...cmd.velocity] : [0, 0, 0];
    if (s.mode === "flight" && s.sub !== "hover") {
      const speed = Math.hypot(vd[0], vd[2]);
      const f = forward(s.saccade?.launch ? s.saccade.from + s.saccade.delta : s.yaw);
      vd = [f[0] * speed, vd[1], f[2] * speed];
    }
    if (s.mode === "flight" && s.sub === "hover") vd = [0, vd[1], 0];
    if (this.perturbation)
      vd = vd.map(
        (v, i) => v * this.intervention.movementGain + this.intervention.driftMPerS[i]!,
      ) as V3;
    // A contact lasts while its surface stays within reach; its normal follows a curved surface.
    this.keepContact();
    // An exponential approach to the desired velocity, stable for any time
    // constant (0 follows at once), and at most maxAccelG per second.
    const k = 1 - Math.exp(-h / P.velocityTauS);
    let dv: V3 = [(vd[0] - s.v[0]) * k, (vd[1] - s.v[1]) * k, (vd[2] - s.v[2]) * k];
    const dvMax = P.maxAccelG * G * h;
    const dn = Math.hypot(...dv);
    if (dn > dvMax)
      dv = [(dv[0] * dvMax) / dn, (dv[1] * dvMax) / dn, (dv[2] * dvMax) / dn];
    s.v = [s.v[0] + dv[0], s.v[1] + dv[1], s.v[2] + dv[2]];
    // In contact, the fly cannot push into the surface: it slides along it.
    if (s.contact) s.v = slide(s.v, s.contact.normal);
    this.drawAttitude([dv[0] / h, dv[1] / h, dv[2] / h]);
    const steer = Math.max(-1, Math.min(1, yawAcc / 300));
    s.ampL = 1 - 0.15 * steer;
    s.ampR = 1 + 0.15 * steer;
    s.wingsOpen = 1;
    s.flightT += h;
    // Legs: tucked in cruise; extended once the landing target looms past the published retinal size.
    let legsTarget = 0;
    if (s.mode === "land" && s.target) {
      const d = Math.hypot(
        s.target.point[0] - s.p[0],
        s.target.point[1] - s.p[1],
        s.target.point[2] - s.p[2],
      );
      const size = 2 * Math.atan2(s.target.radius, Math.max(1e-4, d));
      if (size >= degToRad(P.legExtensionDeg)) legsTarget = 1;
      if (s.sub === "approach" && legsTarget === 1) {
        const from = this.label();
        s.sub = "legs extended";
        this.record(
          "event",
          from,
          this.label(),
          `landing target subtends ${((size * 180) / Math.PI).toFixed(0)}° ≥ ${P.legExtensionDeg}°: legs extend`,
        );
      }
    }
    s.legs += (legsTarget - s.legs) * (1 - Math.exp(-h / 0.04));
    this.move(h);
    if (s.contact && (s.mode === "flight" || s.mode === "land")) s.counts.contactS += h;
  }

  /** End the contact if its surface has moved out of reach; else follow its normal. */
  private keepContact(): void {
    const s = this.state;
    const c = s.contact;
    if (!c) return;
    const back = this.world.raycast(
      s.p,
      [-c.normal[0], -c.normal[1], -c.normal[2]],
      this.standingHeight + CONTACT_SLOP_M,
      false,
    );
    if (back && back.id === c.id)
      s.contact = { id: c.id, kind: c.kind, normal: [...back.normal] };
    else s.contact = null;
  }

  /** Move by the velocity for one step, with contacts, sliding and touchdowns. */
  private move(h: number): void {
    const s = this.state;
    const P = this.params;
    const step: V3 = [s.v[0] * h, s.v[1] * h, s.v[2] * h];
    const dist = Math.hypot(...step);
    const margin = this.standingHeight;
    const dir: V3 =
      dist > 0 ? [step[0] / dist, step[1] / dist, step[2] / dist] : [0, 0, 0];
    const hit = dist > 0 ? this.world.raycast(s.p, dir, dist + margin, false) : null;
    if (!hit) {
      s.p = [s.p[0] + step[0], s.p[1] + step[1], s.p[2] + step[2]];
      s.counts.flownM += dist;
      this.reachTarget();
      return;
    }
    const speed = Math.hypot(...s.v);
    const landing = s.mode === "land";
    const onset = !s.contact || s.contact.id !== hit.id;
    // The thorax stops the standing height short of the surface along its path.
    const stop = Math.max(0, hit.t - margin);
    const at: V3 = [
      s.p[0] + dir[0] * stop,
      s.p[1] + dir[1] * stop,
      s.p[2] + dir[2] * stop,
    ];
    // A slow touch on a top the fly can stand on: a touchdown if the feet are on it there.
    const gentle = hit.normal[1] > WALKABLE_NORMAL_Y && speed <= P.touchdownSpeedMS;
    let failed: string | null = null;
    if (gentle) {
      // In cruise the touch is a collision before the fly settles; landing, it is the touchdown.
      if (!landing && onset) this.collision(hit, speed);
      failed = this.settle(
        at,
        landing
          ? `touchdown on ${hit.kind} at ${speed.toFixed(2)} m/s`
          : `settled on ${hit.kind} after contact`,
      );
      if (failed === null) {
        s.counts.flownM += stop;
        return;
      }
    }
    // A contact: slide the rest of the step along the surface.
    let p = at;
    let moved = stop;
    const along = slide(dir, hit.normal);
    const alongLength = Math.hypot(...along);
    const rest = dist - stop;
    if (rest > 0 && alongLength > 1e-9) {
      const sd: V3 = [
        along[0] / alongLength,
        along[1] / alongLength,
        along[2] / alongLength,
      ];
      const reach = rest * alongLength;
      const block = this.world.raycast(p, sd, reach + margin, false);
      const go = block ? Math.max(0, Math.min(reach, block.t - margin)) : reach;
      p = [p[0] + sd[0] * go, p[1] + sd[1] * go, p[2] + sd[2] * go];
      moved += go;
    }
    s.p = p;
    s.counts.flownM += moved;
    s.contact = { id: hit.id, kind: hit.kind, normal: [...hit.normal] };
    const v = slide(s.v, hit.normal);
    const keep = P.contactKeep;
    s.v = onset ? [v[0] * keep, v[1] * keep, v[2] * keep] : v;
    if (!onset) {
      // Still touching the same surface: no new collision, and a landing may still finish.
      this.reachTarget();
      return;
    }
    if (landing || !gentle) this.collision(hit, speed);
    if (landing)
      // A contact that is not a touchdown ends the approach; the controller
      // waits `landRetryS` before choosing again.
      this.abortLanding(
        failed
          ? `landing aborted after contact with ${hit.kind}: ${failed}`
          : `landing aborted after contact with ${hit.kind}`,
      );
  }

  /** Count and log the start of a contact. */
  private collision(hit: { id: string; kind: SurfaceKind }, speed: number): void {
    this.state.counts.collisions++;
    this.record(
      "event",
      this.label(),
      this.label(),
      `collision with ${hit.kind} (${hit.id}) at ${speed.toFixed(2)} m/s`,
    );
  }

  /** Touch down when the feet have reached the landing point, slowly enough. */
  private reachTarget(): void {
    const s = this.state;
    const target = s.target;
    if (s.mode !== "land" || !target) return;
    const d = Math.hypot(
      target.point[0] - s.p[0],
      target.point[1] - (s.p[1] - this.standingHeight),
      target.point[2] - s.p[2],
    );
    if (d >= TOUCHDOWN_REACH_M || Math.hypot(...s.v) > this.params.touchdownSpeedMS)
      return;
    const failed = this.settle(s.p, `touchdown on ${target.id}`);
    if (failed !== null) this.abortLanding(`touchdown aborted: ${failed}`);
  }

  /**
   * Stand the fly with its thorax at `p`'s x and z if its feet are on a
   * walkable top there, within `TOUCHDOWN_GAP_M` of it. Returns null on
   * touchdown, or why not: the fly is never moved more than that gap to meet
   * a surface.
   */
  private settle(p: V3, reason: string): string | null {
    const s = this.state;
    const feetY = p[1] - this.standingHeight;
    const perch = this.world.perchAt(p[0], p[2], feetY + TOUCHDOWN_GAP_M);
    if (!perch) return "no surface under the fly";
    const gap = feetY - perch.y;
    if (gap > TOUCHDOWN_GAP_M)
      return `the feet are ${(gap * 1000).toFixed(1)} mm above the ${perch.kind}`;
    s.p = [p[0], perch.y + this.standingHeight, p[2]];
    s.v = [0, 0, 0];
    s.perch = perch;
    s.target = null;
    s.saccade = null;
    s.contact = null;
    s.counts.landings++;
    s.walkSpeed = 0;
    this.setMode("rest", "", reason, "event");
    this.command = { mode: "rest", reason };
    return null;
  }

  /** Give up the approach and fly on; the controller chooses again after `landRetryS`. */
  private abortLanding(reason: string): void {
    const s = this.state;
    s.target = null;
    this.setMode("flight", "cruise", reason, "event");
    this.command = { mode: "flight", velocity: [0, 0.1, 0], reason: "landing aborted" };
  }

  /** Legs in stance and the coordination pattern, for the panel and the renderer. */
  gaitNow(): { stance: number; pattern: string; duty: number } {
    const s = this.state;
    const stepping = steppingSpeedCmS(s.walkSpeed, s.yawRate, FOOT_RADIUS_CM);
    if (s.mode !== "walk" || stepping < STEPPING_MIN_CMS)
      return { stance: 6, pattern: "standing", duty: 1 };
    return {
      stance: stanceCount(s.gaitClock, stepping, this.gait),
      pattern: coordination(s.gaitClock, stepping, this.gait),
      duty: dutyFactor(stepping, this.gait),
    };
  }

  /** A hash of everything that decides the future: body, clocks and the controller's own state. */
  stateHash(): string {
    const ctrl = (this.adapter as { state?: unknown }).state ?? null;
    return canonicalHash({
      version: FLY_VERSION,
      seed: this.seed,
      state: this.state,
      controller: ctrl,
      pendingUs: this.pendingUs,
      frames: this.frames.length,
      ...(this.adapter.observeMotion ? { motion: this.motion } : {}),
      ...(this.perturbation ? { intervention: this.intervention } : {}),
    });
  }
}

/** `v` without its component into a surface with outward normal `n`. */
function slide(v: V3, n: V3): V3 {
  const into = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  return into < 0 ? [v[0] - n[0] * into, v[1] - n[1] * into, v[2] - n[2] * into] : v;
}

/** Freeze a value and everything it holds. */
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) frozen(v);
  }
  return value;
}

function frozenSite(site: LandingSite): LandingSite {
  return frozen({
    ...site,
    center: [site.center[0], site.center[1], site.center[2]],
    half: [site.half[0], site.half[1]],
  });
}

/** A thrown value as a short line for the log; never throws itself. */
function describe(e: unknown): string {
  try {
    const text = e instanceof Error ? e.message : String(e);
    return text.slice(0, 200) || "no message";
  } catch {
    return "unprintable error";
  }
}

function isV3(v: unknown): v is V3 {
  return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));
}

function round(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}
