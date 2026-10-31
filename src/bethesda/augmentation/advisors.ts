/**
 * Advisors: research modules that read only the sensable view.
 *
 * `GiantFiberAdvisor` runs the circuit-informed controller's giant-fiber
 * model (circuits/giantFiber.ts: Ache et al. 2019's fitted membrane
 * potential from the looming object's angular size and expansion, its
 * log-normal threshold and the GF-independent wing raise) on what the fly
 * sees, and predicts an escape when the model's giant fiber spikes or its
 * wing-raise pathway fires, and offers no opinion otherwise. Two approximations, both named in its id's
 * documentation: it does not know the body's habituation (the circuit's gain
 * is held at 1), and, seeing no object identities, it segments trials by the
 * circuit's half-second gap alone. It draws only from a stream of its own.
 *
 * Like the circuit model it reuses, it simulates no neuron, synapse or
 * network: it is a published function of the stimulus with a threshold.
 */
import { mulberry32 } from "../../lib/noise.js";
import { EscapeCircuit } from "../fly/circuits/giantFiber.js";
import { resolveCircuitParams } from "../fly/circuits/params.js";
import type { SenseFrame } from "../fly/senses.js";
import { wrapAngle } from "../fly/units.js";
import type { Advisor, AdvisorValidation, AdvisorView, Prediction } from "./layer.js";

export const GIANT_FIBER_ADVISOR = "giant-fiber-advisor/v1" as const;

export class GiantFiberAdvisor implements Advisor {
  readonly id = GIANT_FIBER_ADVISOR;
  readonly validation: AdvisorValidation | null;
  private readonly circuit: EscapeCircuit;

  constructor(seed: number, validation: AdvisorValidation | null = null) {
    this.validation = validation;
    this.circuit = new EscapeCircuit(
      resolveCircuitParams(),
      mulberry32((seed ^ 0x3c6ef372) >>> 0),
      false,
    );
  }

  predict(v: AdvisorView): Prediction | null {
    // The circuit reads the frame's time and its looming object's size,
    // expansion, bearing and id; the advisor has no ids, so every object is one.
    const frame = {
      t: v.t,
      looming: v.looming
        ? {
            id: "seen",
            kind: "stimulus",
            sizeDeg: v.looming.sizeDeg,
            expansionDegS: v.looming.expansionDegS,
            bearing: v.looming.bearing,
            elevation: v.looming.elevation,
          }
        : null,
    } as unknown as SenseFrame;
    const s = this.circuit.sample(frame, 1);
    if (s.spike || s.wingRaise)
      return {
        mode: "escape",
        // Away from the object: the jump's direction in the circuit model.
        escapeBearing: s.bearing === null ? Math.PI : wrapAngle(s.bearing + Math.PI),
        confidence: s.spike ? 0.9 : 0.6,
      };
    // No escape: no opinion. It recommends nothing else.
    return null;
  }
}

/** An advisor that always fails, for the fallback tests and for drills. */
export class FailingAdvisor implements Advisor {
  readonly id = "failing-advisor (test)";
  readonly validation: AdvisorValidation | null;
  private readonly how: "throw" | "malformed";
  constructor(how: "throw" | "malformed", validation: AdvisorValidation | null = null) {
    this.how = how;
    this.validation = validation;
  }
  predict(): Prediction | null {
    if (this.how === "throw") throw new Error("advisor failure (test)");
    return { mode: "escape", confidence: 7 };
  }
}
