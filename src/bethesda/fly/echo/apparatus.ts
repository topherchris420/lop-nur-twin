/** Researcher-only reduced-order perturbations. Never passed to EchoModel.
 * These are kinematic interventions, not wind aerodynamics or muscle damage.
 */
import type { V3 } from "../units.js";
export interface MotionPerturbation {
  movementGain: number;
  turningGain: number;
  driftMPerS: V3;
  sensorNoiseCmS: number;
  sensorBiasCmS: number;
}
export const NO_PERTURBATION: MotionPerturbation = Object.freeze({
  movementGain: 1,
  turningGain: 1,
  driftMPerS: [0, 0, 0] as V3,
  sensorNoiseCmS: 0,
  sensorBiasCmS: 0,
});
export function checkedPerturbation(p: MotionPerturbation): MotionPerturbation {
  if (
    !p ||
    !Array.isArray(p.driftMPerS) ||
    p.driftMPerS.length !== 3 ||
    ![
      p.movementGain,
      p.turningGain,
      ...p.driftMPerS,
      p.sensorNoiseCmS,
      p.sensorBiasCmS,
    ].every(Number.isFinite) ||
    p.movementGain < 0.2 ||
    p.movementGain > 1.6 ||
    p.turningGain < 0.2 ||
    p.turningGain > 1.6 ||
    Math.hypot(...p.driftMPerS) > 0.05 ||
    p.sensorNoiseCmS < 0 ||
    p.sensorNoiseCmS > 4 ||
    Math.abs(p.sensorBiasCmS) > 3
  )
    throw new Error("Invalid ECHO research perturbation");
  return { ...p, driftMPerS: [...p.driftMPerS] };
}
