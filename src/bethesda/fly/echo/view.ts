/**
 * The only door from a decision's input into the self-model: the fields the
 * fly can legitimately know about itself. Its mode (which motor program is
 * running), how fast its legs are stepping, whether its legs met an edge, the
 * self-motion sense over the last period, the clock, and its own body schema
 * (the parameter table every decision maker is handed), the sky's compass
 * when there is one, and the air its antennae feel going by.
 *
 * Deliberately absent: the body's position, velocity and heading, the
 * world, the landing sites, and anything about a perturbation. The self-model
 * modules import nothing from the simulator but types and this view, and
 * echo.test.ts checks both that they never read those fields and that
 * scrambling them changes nothing the self-model does.
 */
import type { DecisionInput, Mode } from "../neural.js";
import type { SelfMotionSample } from "../selfMotion.js";

export interface SelfModelView {
  t: number;
  mode: Mode;
  sub: string;
  /** Proprioception: the legs' stepping speed (cm/s). Under an impairment it is not the ground speed. */
  legSpeedCmS: number;
  /** Touch: the legs are at an edge or against a solid. */
  edge: boolean;
  self: SelfMotionSample | null;
  /**
   * The celestial compass: the sun's bearing (rad, + left) when the fly is
   * under an open sky and sees it, else null. A point light in an arena is
   * no compass (its bearing changes as the fly moves), and is not given.
   */
  compass: number | null;
  /**
   * The antennae: how fast the air goes by (m/s) and the bearing it comes
   * from (rad, + left), or null when they give no bearing (still or nearly
   * still air, or no air to feel).
   */
  air: { speedMS: number; from: number } | null;
  /** The body schema: the decision period, the physics step, the walking speed's time constant and top speed, the wings' top air speed and the flight velocity's time constant. */
  schema: {
    decisionS: number;
    stepS: number;
    walkTauS: number;
    walkMaxCmS: number;
    airMaxMS: number;
    flightTauS: number;
  };
}

export function selfModelView(input: DecisionInput): SelfModelView {
  const { body, params } = input;
  return {
    t: body.t,
    mode: body.mode,
    sub: body.sub,
    legSpeedCmS: body.walkSpeed,
    edge: body.edge,
    self: input.self ?? null,
    compass:
      input.frame.sky && input.frame.lightBearing !== null
        ? input.frame.lightBearing
        : null,
    air:
      input.frame.airflowFrom !== null
        ? { speedMS: input.frame.airflow, from: input.frame.airflowFrom }
        : null,
    schema: {
      decisionS: params.decisionPeriodMs / 1000,
      stepS: params.physicsStepMs / 1000,
      walkTauS: params.walkSpeedTauS,
      walkMaxCmS: params.walkSpeedMaxCmS,
      airMaxMS: params.maxAirspeedCmS / 100,
      flightTauS: params.velocityTauS,
    },
  };
}
