/**
 * The built-in decision maker: a reduced-order behavioural state machine.
 *
 * Arbitration runs top-down every decision period: escape from a looming
 * object first, then collision avoidance, then landing, then the drives that
 * alternate rest, grooming, walking and flight. Every choice is a validated
 * `MotorCommand` (neural.ts) with a reason the log keeps. The probabilistic
 * choices are hazards drawn from the fly's own seeded stream, so a seed
 * replays exactly. The rates, thresholds and time constants it is built on
 * are named parameters (params.ts) with their provenance. The shaping
 * constants written here (turn rates, spreads and durations, climb and
 * steering gains, clamps, site-scoring weights) are fixed model choices,
 * listed in docs/DIGITAL_FLY.md. Nothing here is a neural simulation.
 */
import { gauss } from "./senses.js";
import {
  GROOM_ROUTINES,
  type AdapterDescriptor,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "./neural.js";
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

  decide(input: DecisionInput): MotorCommand {
    const { body, frame, params: P, dt } = input;
    const S = this.state;
    // A landing the body aborted (a contact) waits before the next site, like an abandoned one.
    if (S.prevMode === "land" && body.mode === "flight")
      S.landRetryAt = body.t + P.landRetryS;
    S.prevMode = body.mode;
    const perched = body.mode === "rest" || body.mode === "groom" || body.mode === "walk";
    const activity = CLAMP(frame.light, 0.2, 1);
    const loom = frame.looming;
    const drive = loom ? loom.drive * body.responsiveness : 0;

    // 1. Escape: a looming object strong enough to commit the giant-fiber proxy.
    if (perched && loom && drive >= P.gfThreshold) {
      const short = drive >= P.shortModeThreshold;
      return {
        mode: "escape",
        heading: wrapAngle(body.yaw + loom.bearing + Math.PI),
        prepare: (short ? P.shortModePrepMs : P.takeoffPrepMs) / 1000,
        reason: `looming ${loom.kind} at ${loom.distance.toFixed(2)} m, ${loom.sizeDeg.toFixed(0)}° expanding ${loom.expansionDegS.toFixed(0)}°/s: giant-fiber proxy ${drive.toFixed(2)} ≥ ${P.gfThreshold} → ${short ? "short" : "long"}-mode escape away from it`,
      };
    }

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
        if (this.hazard(P.groomHz, dt))
          return {
            mode: "groom",
            groom: "eyes",
            reason: "spontaneous grooming bout: head first",
          };
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
        const i = body.groom ? GROOM_ROUTINES.indexOf(body.groom) : 0;
        if (this.hazard(1 / P.groomPhaseS, dt)) {
          const next = GROOM_ROUTINES[i + 1];
          if (!next) return { mode: "rest", reason: "grooming sequence complete" };
          return {
            mode: "groom",
            groom: next,
            reason: `grooming moves on: ${GROOM_ROUTINES[i]} → ${next} (anterior-to-posterior order)`,
          };
        }
        return { mode: "groom", groom: GROOM_ROUTINES[i]!, reason: "grooming" };
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
        if (body.flightT <= dt + 1e-9)
          S.targetAltitude =
            P.cruiseAltMinM + this.rng() * (P.cruiseAltMaxM - P.cruiseAltMinM);
        if (body.flightT >= body.flightBout && body.t >= S.landRetryAt) {
          const choice = this.pickSite(input);
          if (choice) return choice;
        }
        const cruise =
          (P.cruiseCmS / 100) * CLAMP(frame.clearance / P.clutterSlowM, 0.4, 1);
        const altErr = S.targetAltitude - frame.altitude;
        const climb = CLAMP(Number.isFinite(altErr) ? altErr * 1.5 : 0, -0.3, 0.3);
        const ceilingErr = home.ceiling - 0.3 - body.p[1];
        const vy = ceilingErr < 0 ? CLAMP(ceilingErr * 2, -0.3, 0) : climb;
        const sincePrev = body.t - S.lastSaccadeEnd;
        const canSaccade = body.sub !== "saccade" && sincePrev >= P.saccadeRefractoryS;
        const amplitude = () =>
          degToRad(CLAMP(P.saccadeMeanDeg + P.saccadeSdDeg * gauss(this.rng), 30, 170));
        const fwd = forward(body.yaw);
        const level = (speed: number): V3 => [fwd[0] * speed, vy, fwd[2] * speed];
        if (canSaccade) {
          const ttc = Math.min(frame.ttcLeft, frame.ttcRight, frame.ttcFront);
          if (loom && drive >= P.gfThreshold) {
            S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
            S.hoverUntil = 0; // a saccade ends any hover pause
            return {
              mode: "flight",
              saccade: -Math.sign(loom.bearing || 1) * amplitude(),
              velocity: level(cruise),
              reason: `evasive saccade from looming ${loom.kind} (proxy ${drive.toFixed(2)})`,
            };
          }
          if (ttc < P.avoidTtcS) {
            const turnRight = frame.ttcLeft < frame.ttcRight;
            S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
            S.hoverUntil = 0; // a saccade ends any hover pause
            return {
              mode: "flight",
              saccade: (turnRight ? -1 : 1) * amplitude(),
              velocity: level(cruise * 0.7),
              reason: `surface ahead, time to contact ${ttc.toFixed(2)} s < ${P.avoidTtcS} s: saccade ${turnRight ? "right" : "left"}, away from the nearer side`,
            };
          }
          if (this.hazard(P.spontaneousSaccadeHz, dt)) {
            const sign = homeTurn !== 0 ? Math.sign(homeTurn) : this.rng() < 0.5 ? -1 : 1;
            S.lastSaccadeEnd = body.t + P.saccadeMs / 1000;
            S.hoverUntil = 0; // a saccade ends any hover pause
            return {
              mode: "flight",
              saccade: sign * amplitude(),
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
        if (body.modeT > P.landTimeoutS) {
          S.landRetryAt = body.t + P.landRetryS;
          const f = forward(body.yaw);
          return {
            mode: "flight",
            velocity: [f[0] * 0.15, 0.1, f[2] * 0.15],
            reason: `landing abandoned after ${P.landTimeoutS} s without touchdown`,
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

  /** Choose a landing site among the visible ones, preferring those ahead; else the surface below. */
  private pickSite(input: DecisionInput): MotorCommand | null {
    const { body, sites, params: P } = input;
    let best: { score: number; point: V3; id: string; kind: string } | null = null;
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
          kind: s.kind,
          point: [
            s.center[0] + u * c + w * sn,
            s.center[1],
            s.center[2] - u * sn + w * c,
          ],
        };
      }
    }
    if (best)
      return {
        mode: "land",
        land: { id: best.id, point: best.point },
        reason: `flight bout over: landing on ${best.id}`,
      };
    const below = sites.find((s) => s.below);
    if (below)
      // No visible site: descend onto the surface directly below, the one point
      // known to be under the fly rather than behind an obstacle.
      return {
        mode: "land",
        land: { id: below.id, point: [...below.center] },
        reason: `flight bout over: landing on the ${below.kind} below`,
      };
    return null;
  }
}
