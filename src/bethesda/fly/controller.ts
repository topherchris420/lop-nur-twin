/**
 * The built-in decision maker: a reduced-order behavioural state machine.
 *
 * Arbitration runs top-down: the giant-fiber proxy first (an escape jump when
 * perched, an evasive saccade in the air, even mid-landing), checked at every
 * sensory sample through `interrupt` as well as at the head of every
 * decision; then, every decision period, landing when a flight bout is over,
 * collision avoidance, and the drives that alternate rest, grooming, walking
 * and flight. Every choice is a validated `MotorCommand` (neural.ts) with a
 * reason the log keeps. The probabilistic choices are hazards drawn from the
 * fly's own seeded stream, so a seed replays exactly. The rates, thresholds,
 * gains and time constants it is built on are named parameters (params.ts)
 * with their provenance. The shaping constants written here (turn rates,
 * spreads and durations, the grooming start weights, clamps, site-scoring
 * weights, the home tether) are fixed model choices, listed in
 * docs/DIGITAL_FLY.md. Nothing here is a neural simulation.
 */
import { gauss, type SenseFrame } from "./senses.js";
import {
  GROOM_SITES,
  PERCHED,
  type AdapterDescriptor,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type GroomSite,
  type MotorCommand,
} from "./neural.js";
import type { ResolvedParams } from "./params.js";
import { degToRad, forward, radToDeg, type V3, wrapAngle, yawOf } from "./units.js";

export const REDUCED_ORDER_DESCRIPTOR: AdapterDescriptor = {
  id: "reduced-order-fsm/v1",
  label: "Reduced-order behavioural controller",
  fidelity:
    "Hierarchical state machine over published behavioural regularities; no neurons, synapses or connectome are simulated.",
  simulatesNeurons: false,
  regions: [
    {
      module: "looming escape (giant-fiber proxy)",
      vfb: [
        "FBbt_00111763",
        "FBbt_00003874",
        "FBbt_00004020",
        "VFB_00102109",
        "VFB_00102110",
      ],
      relation: "functional association (published)",
      note: "LPLC2 (angular size) and LC4 (angular velocity) visual projection neurons in the lobula and lobula plate drive the giant fiber (Ache et al. 2019; von Reyn et al. 2014; Klapoetke et al. 2017).",
    },
    {
      module: "collision avoidance and landing (visual expansion)",
      vfb: ["FBbt_00003731", "FBbt_00003907", "VFB_00102107", "VFB_00102110"],
      relation: "functional association (published)",
      note: "Expansion is computed in the optic lobe's motion pathway (medulla, T4 neurons, lobula plate tangential cells); avoidance and landing are behaviourally separable (Tammero & Dickinson 2002).",
    },
    {
      module: "heading, steering and return to home range",
      vfb: [
        "FBbt_00003632",
        "VFB_00102135",
        "VFB_00102137",
        "VFB_00102134",
        "VFB_00102282",
        "VFB_00102140",
      ],
      relation: "functional association (published)",
      note: "The central complex (ellipsoid body, protocerebral bridge, fan-shaped body, noduli) and lateral accessory lobe carry a heading representation (Seelig & Jayaraman 2015). The home-range tether itself is a simulator constraint.",
    },
    {
      module: "phototaxis",
      vfb: ["FBbt_00004508", "FBbt_00006007"],
      relation: "functional association (published)",
      note: "Phototaxis starts at the compound eye's photoreceptors (Benzer 1967 for the behaviour).",
    },
    {
      module: "walking and grooming motor patterns",
      vfb: ["FBbt_00004052"],
      relation: "functional association (published)",
      note: "Leg coordination and the grooming sequence are produced largely in the ventral nerve cord under descending control (Mendes et al. 2013; Seeds et al. 2014).",
    },
  ],
};

const CLAMP = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Where a spontaneous grooming bout starts: any site, the head most often. A
 * model choice, not fitted; the weights sum to 1.
 */
const GROOM_START: readonly (readonly [GroomSite, number])[] = [
  ["eyes", 0.3],
  ["antennae", 0.25],
  ["abdomen", 0.2],
  ["wings", 0.15],
  ["notum", 0.1],
];

/** The approach law hands over to the body's touchdown within this of its goal (m). */
const APPROACH_DONE_M = 0.001;

/**
 * How long the built-in approach needs from `dist` metres (s): cruise speed
 * until the goal is `approachTauS` away at that speed, then a speed of
 * distance / `approachTauS` down to a millimetre, plus the velocity
 * tracker's time constant. A landing is abandoned `landTimeoutS` after that.
 */
export function approachTimeS(dist: number, P: ResolvedParams): number {
  const cruise = P.cruiseCmS / 100;
  const knee = cruise * P.approachTauS;
  const far = Math.max(0, dist - knee) / cruise;
  const near =
    P.approachTauS * Math.log(Math.max(1, Math.min(dist, knee) / APPROACH_DONE_M));
  return far + near + P.velocityTauS;
}

/** Internal state the controller carries between decisions; part of the fly's state hash. */
export interface ControllerState {
  walkTurn: number;
  walkTurnUntil: number;
  hoverUntil: number;
  targetAltitude: number;
  lastSaccadeEnd: number;
  walkTarget: number;
  /** No new landing site before this time (after an abandoned or aborted landing). */
  landRetryAt: number;
  /** The approach under way is abandoned after this time. */
  landBy: number;
  /** The body site groomed last in this bout (an index into `GROOM_SITES`). */
  groomSite: number;
  prevMode: string;
}

export class ReducedOrderController implements FlyNeuralAdapter {
  readonly descriptor = REDUCED_ORDER_DESCRIPTOR;
  readonly state: ControllerState = {
    walkTurn: 0,
    walkTurnUntil: 0,
    hoverUntil: 0,
    targetAltitude: 1,
    lastSaccadeEnd: -1e9,
    walkTarget: 2,
    landRetryAt: -1e9,
    landBy: -1e9,
    groomSite: 0,
    prevMode: "rest",
  };
  private rng: () => number;
  constructor(rng: () => number) {
    this.rng = rng;
  }

  /** A fly placed in flight starts its controller in flight too. */
  start(body: BodySnapshot): void {
    this.state.prevMode = body.mode;
  }

  private hazard(rate: number, dt: number): boolean {
    return this.rng() < 1 - Math.exp(-rate * dt);
  }

  private weighted<T>(choices: readonly (readonly [T, number])[]): T {
    let u = this.rng();
    for (const [value, weight] of choices) {
      if (u < weight) return value;
      u -= weight;
    }
    return choices[choices.length - 1]![0];
  }

  /** Cruise speed (m/s), slowed in clutter. */
  private cruise(frame: SenseFrame, P: ResolvedParams): number {
    return (
      (P.cruiseCmS / 100) * CLAMP(frame.clearance / P.clutterSlowM, P.clutterSlowFloor, 1)
    );
  }

  /** Vertical speed (m/s): toward the preferred height, and down from the home range's ceiling. */
  private vertical(body: BodySnapshot, frame: SenseFrame, P: ResolvedParams): number {
    const altErr = this.state.targetAltitude - frame.altitude;
    const climb = CLAMP(
      Number.isFinite(altErr) ? altErr * P.altitudeGain : 0,
      -P.climbMaxMS,
      P.climbMaxMS,
    );
    const ceilingErr = body.home.ceiling - 0.3 - body.p[1];
    return ceilingErr < 0 ? CLAMP(ceilingErr * 2, -P.climbMaxMS, 0) : climb;
  }

  private canSaccade(body: BodySnapshot, P: ResolvedParams): boolean {
    return (
      body.sub !== "saccade" && body.t - this.state.lastSaccadeEnd >= P.saccadeRefractoryS
    );
  }

  private amplitude(P: ResolvedParams): number {
    return degToRad(CLAMP(P.saccadeMeanDeg + P.saccadeSdDeg * gauss(this.rng), 30, 170));
  }

  /**
   * The giant-fiber proxy: a looming object strong enough commits an escape
   * jump away from it when perched, and an evasive saccade away from it in the
   * air, breaking off a landing if need be. Null when nothing looms that hard.
   */
  private reflex(input: DecisionInput): MotorCommand | null {
    const { frame, params: P } = input;
    const loom = frame.looming;
    // Responsiveness never exceeds 1, so a drive below the threshold cannot
    // commit an escape; the body is read only past this point.
    if (!loom || loom.drive < P.gfThreshold) return null;
    const body = input.body;
    const S = this.state;
    const drive = loom.drive * body.responsiveness;
    if (drive < P.gfThreshold) return null;
    const what = `looming ${loom.kind} at ${loom.distance.toFixed(2)} m, ${loom.sizeDeg.toFixed(0)}° expanding ${loom.expansionDegS.toFixed(0)}°/s: giant-fiber proxy ${drive.toFixed(2)} ≥ ${P.gfThreshold}`;
    if (PERCHED.has(body.mode)) {
      const short = drive >= P.shortModeThreshold;
      return {
        mode: "escape",
        heading: wrapAngle(body.yaw + loom.bearing + Math.PI),
        prepare: (short ? P.shortModePrepMs : P.takeoffPrepMs) / 1000,
        reason: `${what} → ${short ? "short" : "long"}-mode escape away from it`,
      };
    }
    if ((body.mode !== "flight" && body.mode !== "land") || !this.canSaccade(body, P))
      return null;
    S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
    S.hoverUntil = 0; // a saccade ends any hover pause
    const speed = this.cruise(frame, P);
    const f = forward(body.yaw);
    return {
      mode: "flight",
      saccade: -Math.sign(loom.bearing || 1) * this.amplitude(P),
      velocity: [f[0] * speed, this.vertical(body, frame, P), f[2] * speed],
      reason: `${what} → evasive saccade${body.mode === "land" ? ", landing broken off" : ""}`,
    };
  }

  /** The giant-fiber proxy at the sense rate, between decisions. */
  interrupt(input: DecisionInput): MotorCommand | null {
    return this.reflex(input);
  }

  decide(input: DecisionInput): MotorCommand {
    const { body, frame, params: P, dt } = input;
    const S = this.state;
    // A landing the body aborted (a contact) or the reflex broke off waits
    // before the next site, like an abandoned one.
    if (S.prevMode === "land" && body.mode === "flight")
      S.landRetryAt = body.t + P.landRetryS;
    S.prevMode = body.mode;
    // A new flight's preferred height, drawn at its first decision.
    if (body.mode === "flight" && body.flightT <= dt + 1e-9)
      S.targetAltitude =
        P.cruiseAltMinM + this.rng() * (P.cruiseAltMaxM - P.cruiseAltMinM);

    // 1. The giant-fiber proxy.
    const reflex = this.reflex(input);
    if (reflex) return reflex;

    const activity = CLAMP(frame.light, P.activityFloor, 1);
    // Home tether and phototaxis: steering terms shared by walking and flight.
    const home = body.home;
    const hx = home.center[0] - body.p[0],
      hz = home.center[2] - body.p[2];
    const away = Math.hypot(hx, hz) - home.radius;
    const homeBearing = wrapAngle(yawOf(hx, hz) - body.yaw);
    const homeTurn = away > 0 ? CLAMP(away, 0, 2) * 1.2 * Math.sign(homeBearing) : 0;
    const photo =
      frame.lightBearing !== null
        ? P.phototaxisGain * Math.sin(frame.lightBearing) * activity
        : 0;

    switch (body.mode) {
      case "takeoff":
      case "escape":
        return { mode: body.mode, reason: "takeoff under way" };
      case "rest": {
        if (this.hazard(P.takeoffHz * activity, dt))
          return {
            mode: "takeoff",
            heading: wrapAngle(body.yaw + (this.rng() - 0.5) * 0.6),
            prepare: P.takeoffPrepMs / 1000,
            reason: "spontaneous takeoff (rate × light level)",
          };
        if (this.hazard(P.groomHz, dt)) {
          const site = this.weighted(GROOM_START);
          S.groomSite = GROOM_SITES.indexOf(site);
          return {
            mode: "groom",
            groom: site,
            reason: `spontaneous grooming bout, starting at the ${site}`,
          };
        }
        if (this.hazard(P.walkStartHz * activity, dt)) {
          S.walkTarget =
            P.walkSpeedMinCmS +
            this.rng() * (P.walkSpeedMaxCmS - P.walkSpeedMinCmS) * 0.8;
          return {
            mode: "walk",
            walkSpeed: S.walkTarget,
            reason: "spontaneous walking bout",
          };
        }
        return { mode: "rest", reason: "resting" };
      }
      case "groom": {
        const routine = body.groom ?? GROOM_SITES[S.groomSite] ?? "eyes";
        if (!this.hazard(1 / P.groomPhaseS, dt))
          return { mode: "groom", groom: routine, reason: "grooming" };
        if (routine !== "front legs" && routine !== "hind legs") {
          // A site is done: the legs that cleaned it rub each other.
          S.groomSite = GROOM_SITES.indexOf(routine);
          const legs = S.groomSite <= 1 ? "front legs" : "hind legs";
          return {
            mode: "groom",
            groom: legs,
            reason: `${routine} done: the ${legs} rub each other`,
          };
        }
        // After the leg rubbing: stop, or move on to the next site back.
        const next = GROOM_SITES[S.groomSite + 1];
        if (!next) return { mode: "rest", reason: "grooming bout ends at the notum" };
        if (this.rng() < P.groomStopP)
          return { mode: "rest", reason: "grooming bout ends" };
        S.groomSite++;
        return {
          mode: "groom",
          groom: next,
          reason: `grooming moves back to the ${next} (anterior-to-posterior order)`,
        };
      }
      case "walk": {
        if (this.hazard(P.takeoffHz * activity, dt))
          return {
            mode: "takeoff",
            heading: body.yaw,
            prepare: P.takeoffPrepMs / 1000,
            reason: "spontaneous takeoff while walking",
          };
        if (this.hazard(P.walkStopHz, dt))
          return { mode: "rest", reason: "walking bout ends" };
        if (body.edge && body.t >= S.walkTurnUntil) {
          S.walkTurn = (this.rng() < 0.5 ? -1 : 1) * 3;
          S.walkTurnUntil = body.t + 0.4 + this.rng() * 0.4;
        } else if (body.t >= S.walkTurnUntil && this.hazard(P.walkTurnHz, dt)) {
          S.walkTurn = (this.rng() - 0.5) * 4;
          S.walkTurnUntil = body.t + 0.15 + this.rng() * 0.3;
        }
        const turning = body.t < S.walkTurnUntil ? S.walkTurn : 0;
        return {
          mode: "walk",
          walkSpeed: body.edge ? 0 : S.walkTarget,
          yawRate: CLAMP(turning + homeTurn + photo, -6, 6),
          reason: body.edge
            ? "edge of the surface: stop and turn"
            : away > 0
              ? "walking back toward the home range"
              : "walking",
        };
      }
      case "flight": {
        if (body.flightT >= body.flightBout && body.t >= S.landRetryAt) {
          const choice = this.pickSite(input);
          if (choice) return choice;
        }
        const cruise = this.cruise(frame, P);
        const vy = this.vertical(body, frame, P);
        const fwd = forward(body.yaw);
        const level = (speed: number): V3 => [fwd[0] * speed, vy, fwd[2] * speed];
        if (this.canSaccade(body, P)) {
          const ttc = Math.min(frame.ttcLeft, frame.ttcRight, frame.ttcFront);
          if (ttc < P.avoidTtcS) {
            const turnRight = frame.ttcLeft < frame.ttcRight;
            S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
            S.hoverUntil = 0; // a saccade ends any hover pause
            return {
              mode: "flight",
              saccade: (turnRight ? -1 : 1) * this.amplitude(P),
              velocity: level(cruise * P.avoidSpeedShare),
              reason: `surface ahead, time to contact ${ttc.toFixed(2)} s < ${P.avoidTtcS} s: saccade ${turnRight ? "right" : "left"}, away from the nearer side`,
            };
          }
          if (this.hazard(P.spontaneousSaccadeHz, dt)) {
            const sign = homeTurn !== 0 ? Math.sign(homeTurn) : this.rng() < 0.5 ? -1 : 1;
            S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
            S.hoverUntil = 0; // a saccade ends any hover pause
            return {
              mode: "flight",
              saccade: sign * this.amplitude(P),
              velocity: level(cruise),
              reason:
                homeTurn !== 0
                  ? "saccade back toward the home range"
                  : "spontaneous saccade",
            };
          }
        }
        if (body.t < S.hoverUntil)
          return {
            mode: "flight",
            hover: true,
            velocity: [0, vy, 0],
            reason: "hovering",
          };
        if (body.sub === "cruise" && this.hazard(P.hoverHz, dt)) {
          S.hoverUntil = body.t + P.hoverMeanS * (0.5 + this.rng());
          return {
            mode: "flight",
            hover: true,
            velocity: [0, vy, 0],
            reason: "hover pause",
          };
        }
        return {
          mode: "flight",
          velocity: level(cruise),
          yawRate: CLAMP(homeTurn + photo, -3, 3),
          reason:
            photo !== 0 && Math.abs(photo) > Math.abs(homeTurn)
              ? `cruise, steering toward light (bearing ${radToDeg(frame.lightBearing ?? 0).toFixed(0)}°)`
              : "cruise",
        };
      }
      case "land": {
        const target = body.target;
        if (!target)
          return (
            this.pickSite(input) ?? { mode: "flight", reason: "landing target lost" }
          );
        if (body.t > S.landBy) {
          S.landRetryAt = body.t + P.landRetryS;
          const f = forward(body.yaw);
          return {
            mode: "flight",
            velocity: [f[0] * 0.15, 0.1, f[2] * 0.15],
            reason: `landing abandoned: no touchdown ${P.landTimeoutS} s after the approach should have ended`,
          };
        }
        // The target is where the feet touch; the body (the thorax) aims to
        // arrive its standing height above it.
        const d: V3 = [
          target.point[0] - body.p[0],
          target.point[1] + body.standingHeight - body.p[1],
          target.point[2] - body.p[2],
        ];
        const dist = Math.hypot(...d);
        const speed = Math.min(P.cruiseCmS / 100, dist / P.approachTauS);
        const scale = dist > 0 ? speed / dist : 0;
        return {
          mode: "land",
          land: target,
          velocity: [d[0] * scale, d[1] * scale, d[2] * scale],
          // Straight down needs no turn.
          yawRate:
            Math.hypot(d[0], d[2]) < 0.03
              ? 0
              : CLAMP(wrapAngle(yawOf(d[0], d[2]) - body.yaw) * 4, -6, 6),
          reason: `approach: ${dist.toFixed(2)} m to go, speed held at distance/${P.approachTauS} s`,
        };
      }
    }
  }

  /**
   * Choose a landing site among the ones the eyes offer, preferring those
   * ahead; else the surface below. Sets the approach's deadline: the time the
   * approach needs from here, plus `landTimeoutS`.
   */
  private pickSite(input: DecisionInput): MotorCommand | null {
    const { body, sites, params: P } = input;
    let best: { score: number; point: V3; id: string } | null = null;
    for (const s of sites) {
      if (s.below) continue;
      const dx = s.center[0] - body.p[0],
        dz = s.center[2] - body.p[2];
      const dist = Math.hypot(dx, dz, s.center[1] - body.p[1]);
      if (dist < 0.05 || dist > P.landingSearchM) continue;
      const ahead = Math.cos(wrapAngle(yawOf(dx, dz) - body.yaw));
      const score = ahead + 0.5 * this.rng() - dist / P.landingSearchM;
      if (!best || score > best.score) {
        // A point on the top, kept clear of its edges.
        const u = (this.rng() - 0.5) * 1.2 * s.half[0],
          w = (this.rng() - 0.5) * 1.2 * s.half[1];
        const c = Math.cos(s.angle),
          sn = Math.sin(s.angle);
        best = {
          score,
          id: s.id,
          point: [
            s.center[0] + u * c + w * sn,
            s.center[1],
            s.center[2] - u * sn + w * c,
          ],
        };
      }
    }
    if (best) return this.landOn(body, P, best.id, best.point, `landing on ${best.id}`);
    const below = sites.find((s) => s.below);
    // No visible site: descend onto the surface directly below, the one point
    // known to be under the fly rather than behind an obstacle.
    if (below)
      return this.landOn(
        body,
        P,
        below.id,
        [...below.center],
        `landing on the ${below.kind} below`,
      );
    return null;
  }

  private landOn(
    body: BodySnapshot,
    P: ResolvedParams,
    id: string,
    point: V3,
    what: string,
  ): MotorCommand {
    // The approach brings the thorax to its standing height above the point.
    const reach = Math.hypot(
      point[0] - body.p[0],
      point[1] + body.standingHeight - body.p[1],
      point[2] - body.p[2],
    );
    this.state.landBy = body.t + approachTimeS(reach, P) + P.landTimeoutS;
    return { mode: "land", land: { id, point }, reason: `flight bout over: ${what}` };
  }
}
