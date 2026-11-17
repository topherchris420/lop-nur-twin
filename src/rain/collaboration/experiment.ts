/**
 * The bridge from a collaboration design to the existing numerical backend.
 *
 * Nothing here simulates: a design becomes a `NumericalDesign`, the existing
 * compiler checks it (and refuses unsafe timesteps or ceilings), the existing
 * digest ritual authorizes it, the existing executor runs it on a fresh
 * simulator and `verifyNumericalRecord` re-checks the sealed record. The
 * authorization's operator is `Scripted.DemoOperator`: these are the
 * collaboration demonstration's own host-written designs, authorized by a
 * script and labelled so, never presented as a person's review.
 */
import {
  compileNumericalExperiment,
  type NumericalPlan,
} from "../scientific/compiler.js";
import { NUMERICAL_DESIGN, type NumericalDesign } from "../scientific/contracts.js";
import {
  authorizeNumerical,
  executeNumerical,
  verifyNumericalRecord,
  type NumericalRecord,
} from "../scientific/numerical.js";
import { gamma, omega0, type Oscillator } from "./physics.js";

export const SCRIPTED_OPERATOR = "Scripted.DemoOperator";
/** The compiler's ceilings, restated so a seat can plan within them. */
export const MAX_STEPS_PER_ARM = 100_000;
export const MAX_SAMPLES = 10_001;

export interface Window {
  duration_s: number;
  timestep_s: number;
  sample_every_steps: number;
}

/** The lab's existing numerical template window (`scientific/example.ts`). */
export const TEMPLATE_WINDOW: Window = {
  duration_s: 10,
  timestep_s: 0.01,
  sample_every_steps: 10,
};

/**
 * A window of about `duration` seconds whose timestep keeps dt times the
 * fastest rate at `rate_fraction`, with an integer number of steps and a
 * sample interval inside the compiler's bounds. Null when it cannot fit.
 */
export function windowFor(
  s: Oscillator,
  w: number,
  duration: number,
  rateFraction = 0.02,
): Window | null {
  const fastest = Math.max(omega0(s), w, 2 * gamma(s));
  const target = rateFraction / fastest;
  const steps = Math.ceil(duration / target);
  if (steps > MAX_STEPS_PER_ARM) return null;
  const timestep = duration / steps;
  // About 2,000 samples per arm keeps sealed records small; the compiler's
  // eight-samples-per-period rule bounds the interval from above.
  const finest = Math.floor(Math.PI / 4 / (timestep * Math.max(omega0(s), w)));
  const sampleEvery = Math.min(finest, Math.max(1, Math.ceil(steps / 2000)));
  if (sampleEvery < 1 || 1 + Math.ceil(steps / sampleEvery) > MAX_SAMPLES) return null;
  return { duration_s: duration, timestep_s: timestep, sample_every_steps: sampleEvery };
}

export function designFor(
  s: Oscillator,
  w: number,
  win: Window,
  purpose: string,
): NumericalDesign {
  const steps = Math.round(win.duration_s / win.timestep_s);
  return {
    schema: NUMERICAL_DESIGN,
    question: `How large is the RMS displacement when this oscillator is driven at ${w} rad/s? (${purpose})`,
    hypothesis: "Driving increases RMS displacement over the matched free oscillator.",
    competing_hypothesis: "Driving does not increase RMS displacement over this window.",
    parameters: {
      mass: { value: s.mass, unit: "kg" },
      damping: { value: s.damping, unit: "kg/s" },
      stiffness: { value: s.stiffness, unit: "N/m" },
      force_amplitude: { value: s.force, unit: "N" },
      angular_frequency: { value: w, unit: "rad/s" },
      initial_displacement: { value: 0, unit: "m" },
      initial_velocity: { value: 0, unit: "m/s" },
      duration: { value: win.duration_s, unit: "s" },
      timestep: { value: win.timestep_s, unit: "s" },
      sample_every_steps: win.sample_every_steps,
    },
    analysis: {
      method: "matched_rms_displacement",
      expected_direction: "increase",
      minimum_effect_m: 1e-9,
      max_reference_error_m: 1e-6,
      max_reference_velocity_error_m_per_s: 1e-6,
    },
    budget: {
      max_steps: steps,
      max_samples: 1 + Math.ceil(steps / win.sample_every_steps),
    },
    provenance: {
      generation: "scripted",
      decision_sha256: null,
      source_ids: [],
      parent_record_sha256: null,
    },
  };
}

export interface Measured {
  w: number;
  plan: NumericalPlan;
  record: NumericalRecord;
  rms: number | null;
  reference_error_m: number;
  steps: number;
  replay_verified: boolean;
}

export class ExperimentRefused extends Error {}

/** Compiles, authorizes (scripted), executes and re-verifies one drive frequency. */
export function measure(
  s: Oscillator,
  w: number,
  win: Window,
  purpose: string,
  at: Date,
): Measured {
  const compiled = compileNumericalExperiment(designFor(s, w, win, purpose));
  if (!compiled.ok)
    throw new ExperimentRefused(
      `compiler refused the design: ${compiled.errors.join("; ")}`,
    );
  const plan = compiled.value;
  const auth = authorizeNumerical(plan, {
    operator: SCRIPTED_OPERATOR,
    typedPrefix: plan.definition_sha256.slice(0, 8),
    reviewed: true,
    now: at,
  });
  if (!auth.ok)
    throw new ExperimentRefused(`authorization refused: ${auth.errors.join("; ")}`);
  // A clock function, so finished_at is the case clock too and the record digest reproduces.
  const record = executeNumerical(plan, auth.value, () => at);
  const verified = verifyNumericalRecord(record);
  const m = record.result.measurements;
  return {
    w,
    plan,
    record,
    rms: typeof m.rms_treatment_m === "number" ? m.rms_treatment_m : null,
    reference_error_m: Math.max(Number(m.reference_max_error_m ?? Infinity), 0),
    steps: Number(m.execution_steps ?? 0),
    replay_verified: verified.ok,
  };
}
