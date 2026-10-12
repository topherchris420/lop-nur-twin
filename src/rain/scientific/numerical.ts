/** Bounded deterministic numerical execution. Physical devices are never addressed. */
import { canonicalJson, sha256Json } from "../sha256.js";
import { evaluate } from "../experiments/evaluate.js";
import { schemaErrors } from "../experiments/jsonSchema.js";
import type { Checked } from "../../bethesda/rain/validation.js";
import { OPERATOR } from "../../bethesda/rain/contracts.js";
import {
  boundedData,
  closed,
  NUMERICAL_RECORD,
  type OscillatorParameters,
  type NumericalAuthorization,
  type NumericalRecord,
  type NumericalResult,
  type NumericalArm,
  type NumericalSample,
} from "./contracts.js";
import {
  numericalPlanBody,
  verifyNumericalPlan,
  type NumericalPlan,
} from "./compiler.js";
export type {
  NumericalAuthorization,
  NumericalRecord,
  NumericalResult,
  NumericalArm,
  NumericalSample,
} from "./contracts.js";
const AUTH_SCHEMA = closed({
  schema: { const: "rain-numerical-authorization/v1" },
  experiment_id: { type: "string", pattern: "^NP-[a-f0-9]{24}$" },
  definition_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  operator: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,64}$" },
  attestation: { const: "local-operator" },
  identity_verified: { const: false },
  scope: { const: "numerical-physics-simulation" },
  confirmed_prefix: { type: "string", pattern: "^[a-f0-9]{8}$" },
  authorized_at: { type: "string", maxLength: 40 },
  expires_at: { type: "string", maxLength: 40 },
  authorization_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
});
export function authorizeNumerical(
  plan: NumericalPlan,
  input: { operator: string; typedPrefix: string; reviewed: boolean; now: Date },
): Checked<NumericalAuthorization> {
  const errors = verifyNumericalPlan(plan);
  if (input.reviewed !== true) errors.push("operator must confirm protocol review");
  if (typeof input.operator !== "string" || !OPERATOR.test(input.operator))
    errors.push("operator must be a role label");
  const prefix =
    typeof input.typedPrefix === "string" ? input.typedPrefix.trim().toLowerCase() : "";
  if (prefix.length !== 8 || !plan.definition_sha256.startsWith(prefix))
    errors.push("repeat the first eight characters of this numerical plan digest");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
    errors.push("invalid authorization clock");
  if (errors.length) return { ok: false, errors };
  const body = {
    schema: "rain-numerical-authorization/v1" as const,
    experiment_id: plan.experiment_id,
    definition_sha256: plan.definition_sha256,
    operator: input.operator,
    attestation: "local-operator" as const,
    identity_verified: false as const,
    scope: "numerical-physics-simulation" as const,
    confirmed_prefix: prefix,
    authorized_at: input.now.toISOString(),
    expires_at: new Date(input.now.getTime() + 3600000).toISOString(),
  };
  return { ok: true, value: { ...body, authorization_sha256: sha256Json(body) } };
}
export function verifyNumericalAuthorization(
  raw: unknown,
  plan: NumericalPlan,
  now: Date,
): string[] {
  const bounded = boundedData(raw);
  if (bounded.length) return bounded;
  const errors = schemaErrors(raw, AUTH_SCHEMA);
  if (errors.length) return errors;
  const a = raw as NumericalAuthorization;
  const { authorization_sha256, ...body } = a;
  if (sha256Json(body) !== authorization_sha256)
    errors.push("numerical authorization digest mismatch");
  if (
    a.definition_sha256 !== plan.definition_sha256 ||
    a.experiment_id !== plan.experiment_id ||
    a.confirmed_prefix !== plan.definition_sha256.slice(0, 8)
  )
    errors.push("numerical approval binds a different plan");
  const issued = Date.parse(a.authorized_at),
    expires = Date.parse(a.expires_at),
    clock = now.getTime();
  if (
    ![issued, expires, clock].every(Number.isFinite) ||
    expires - issued !== 3600000 ||
    clock < issued ||
    clock > expires
  )
    errors.push("numerical approval outside its one-hour validity");
  return errors;
}

/** Independent closed-form particular + homogeneous solution, not RK4 or a finer numerical integrator. */
export function oscillatorReference(
  p: OscillatorParameters,
  force: number,
  t: number,
): { x: number; v: number } {
  const m = p.mass.value,
    gamma = p.damping.value / (2 * m),
    w0sq = p.stiffness.value / m;
  const w = p.angular_frequency.value,
    wd = Math.sqrt(w0sq - gamma * gamma);
  const detuning = w0sq - w * w,
    loss = 2 * gamma * w;
  const denom = detuning * detuning + loss * loss;
  const cosAmplitude = ((force / m) * detuning) / denom,
    sinAmplitude = ((force / m) * loss) / denom;
  const c = p.initial_displacement.value - cosAmplitude;
  const d = (p.initial_velocity.value - w * sinAmplitude + gamma * c) / wd;
  const co = Math.cos(wd * t),
    si = Math.sin(wd * t),
    decay = Math.exp(-gamma * t);
  const homogeneous = c * co + d * si;
  return {
    x:
      cosAmplitude * Math.cos(w * t) +
      sinAmplitude * Math.sin(w * t) +
      decay * homogeneous,
    v:
      -w * cosAmplitude * Math.sin(w * t) +
      w * sinAmplitude * Math.cos(w * t) +
      decay * (-gamma * homogeneous + wd * (-c * si + d * co)),
  };
}

/** One RK4 step; the reference above has no dependency on this integration path. */
function rk4(
  p: OscillatorParameters,
  force: number,
  t: number,
  x: number,
  v: number,
): [number, number] {
  const h = p.timestep.value,
    mass = p.mass.value;
  const acceleration = (clock: number, displacement: number, velocity: number) =>
    (force * Math.cos(p.angular_frequency.value * clock) -
      p.damping.value * velocity -
      p.stiffness.value * displacement) /
    mass;
  const x1 = v,
    v1 = acceleration(t, x, v);
  const x2 = v + (h * v1) / 2,
    v2 = acceleration(t + h / 2, x + (h * x1) / 2, v + (h * v1) / 2);
  const x3 = v + (h * v2) / 2,
    v3 = acceleration(t + h / 2, x + (h * x2) / 2, v + (h * v2) / 2);
  const x4 = v + h * v3,
    v4 = acceleration(t + h, x + h * x3, v + h * v3);
  return [
    x + (h * (x1 + 2 * x2 + 2 * x3 + x4)) / 6,
    v + (h * (v1 + 2 * v2 + 2 * v3 + v4)) / 6,
  ];
}
function simulate(
  plan: NumericalPlan,
  shouldStop?: () => boolean,
  retainedStop: NumericalResult["stop_checkpoint"] = null,
): NumericalResult {
  const p = plan.design.parameters,
    arms: NumericalArm[] = [];
  let stop: NumericalResult["stop_checkpoint"] = null;
  let error: string | null = null;
  for (const name of ["control", "treatment"] as const) {
    const force = name === "control" ? 0 : p.force_amplitude.value;
    let x = p.initial_displacement.value,
      v = p.initial_velocity.value,
      step = 0,
      dx = 0,
      dv = 0;
    const samples: NumericalSample[] = [];
    const sample = () =>
      samples.push({
        step,
        time_s: step * p.timestep.value,
        displacement_m: x,
        velocity_m_per_s: v,
        mechanical_energy_j: 0.5 * p.mass.value * v * v + 0.5 * p.stiffness.value * x * x,
      });
    sample();
    for (; step < plan.steps;) {
      if (shouldStop?.() || (retainedStop?.arm === name && retainedStop.step === step)) {
        stop = { arm: name, step };
        break;
      }
      const next = rk4(p, force, step * p.timestep.value, x, v);
      x = next[0];
      v = next[1];
      step++;
      const reference = oscillatorReference(p, force, step * p.timestep.value);
      if (
        ![x, v, reference.x, reference.v].every(Number.isFinite) ||
        Math.abs(x) > 1e12 ||
        Math.abs(v) > 1e12
      ) {
        error = "nonfinite or unbounded oscillator state";
        break;
      }
      dx = Math.max(dx, Math.abs(x - reference.x));
      dv = Math.max(dv, Math.abs(v - reference.v));
      if (step % p.sample_every_steps === 0 || step === plan.steps) sample();
    }
    if (samples.at(-1)?.step !== step && !error) sample();
    arms.push({
      arm: name,
      force_amplitude_n: force,
      completed_steps: step,
      samples,
      reference_max_error_m: dx,
      reference_max_velocity_error_m_per_s: dv,
      rms_displacement_m:
        step === plan.steps && !error
          ? Math.sqrt(
              samples.reduce((sum, s) => sum + s.displacement_m * s.displacement_m, 0) /
                samples.length,
            )
          : null,
    });
    if (stop || error) break;
  }
  const completed =
    arms.length === 2 &&
    arms.every((a) => a.completed_steps === plan.steps) &&
    !stop &&
    !error;
  const control = arms[0]?.rms_displacement_m ?? null,
    treatment = arms[1]?.rms_displacement_m ?? null;
  const measurements = {
    arms_completed: arms.filter((a) => a.completed_steps === plan.steps).length,
    reference_max_error_m: Math.max(...arms.map((a) => a.reference_max_error_m)),
    reference_max_velocity_error_m_per_s: Math.max(
      ...arms.map((a) => a.reference_max_velocity_error_m_per_s),
    ),
    rms_control_m: control,
    rms_treatment_m: treatment,
    rms_displacement_delta_m:
      completed && control !== null && treatment !== null ? treatment - control : null,
    execution_steps: arms.reduce((sum, a) => sum + a.completed_steps, 0),
    retained_samples: arms.reduce((sum, a) => sum + a.samples.length, 0),
  };
  if (!completed)
    return {
      arms,
      completed,
      stop_checkpoint: stop,
      measurements,
      status: "error",
      verdict: "not_evaluated",
      evaluation: null,
      error: error ?? "operator interrupted execution",
    };
  const evaluated = evaluate(plan.criteria, measurements);
  return {
    arms,
    completed,
    stop_checkpoint: null,
    measurements,
    ...evaluated,
    error: null,
  };
}
export class NumericalRunRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("Numerical run refused: " + reasons.join("; "));
    this.reasons = reasons;
  }
}
export function executeNumerical(
  plan: NumericalPlan,
  authorization: unknown,
  now: Date | (() => Date) = () => new Date(),
  shouldStop?: () => boolean,
): NumericalRecord {
  const started = typeof now === "function" ? now() : now;
  const errors = verifyNumericalPlan(plan);
  if (!errors.length)
    errors.push(...verifyNumericalAuthorization(authorization, plan, started));
  if (errors.length) throw new NumericalRunRefused(errors);
  // Snapshot before running; caller mutation cannot change preregistered criteria in flight.
  const frozen = structuredClone(plan),
    auth = structuredClone(authorization) as NumericalAuthorization;
  const startedAt = started.toISOString();
  const result = simulate(frozen, shouldStop);
  const body = {
    schema: NUMERICAL_RECORD,
    run_id: `NR-${sha256Json({ plan: frozen.definition_sha256, authorization: auth.authorization_sha256, started_at: startedAt }).slice(0, 24)}`,
    plan: frozen,
    authorization: auth,
    started_at: startedAt,
    finished_at: (typeof now === "function" ? now() : new Date()).toISOString(),
    result,
    evidence_class: "simulated" as const,
  };
  return { ...body, sha256: sha256Json(body) };
}
export function verifyNumericalRecord(raw: unknown): {
  ok: boolean;
  errors: string[];
  replay_sha256: string | null;
} {
  const errors = boundedData(raw, 250000);
  if (errors.length) return { ok: false, errors, replay_sha256: null };
  try {
    const r = raw as NumericalRecord;
    const { sha256, ...body } = r;
    const keys = [
      "schema",
      "run_id",
      "plan",
      "authorization",
      "started_at",
      "finished_at",
      "result",
      "evidence_class",
      "sha256",
    ];
    if (
      Object.keys(r).length !== keys.length ||
      Object.keys(r).some((k) => !keys.includes(k)) ||
      r.schema !== NUMERICAL_RECORD ||
      r.evidence_class !== "simulated"
    )
      errors.push("unsupported numerical record shape/classification");
    if (sha256Json(body) !== sha256) errors.push("numerical record digest mismatch");
    const started = new Date(r.started_at),
      finished = new Date(r.finished_at);
    if (
      ![started.getTime(), finished.getTime()].every(Number.isFinite) ||
      finished < started
    )
      errors.push("invalid numerical record clocks");
    errors.push(
      ...verifyNumericalPlan(r.plan),
      ...verifyNumericalAuthorization(r.authorization, r.plan, started),
    );
    const id = `NR-${sha256Json({ plan: r.plan.definition_sha256, authorization: r.authorization.authorization_sha256, started_at: r.started_at }).slice(0, 24)}`;
    if (id !== r.run_id)
      errors.push("run identity does not bind plan, approval and start");
    if (errors.length) return { ok: false, errors, replay_sha256: null };
    const stop = r.result.stop_checkpoint;
    if (
      stop &&
      ((stop.arm !== "control" && stop.arm !== "treatment") ||
        !Number.isInteger(stop.step) ||
        stop.step < 0 ||
        stop.step >= r.plan.steps)
    )
      errors.push("invalid numerical interruption checkpoint");
    if (errors.length) return { ok: false, errors, replay_sha256: null };
    const replay = simulate(r.plan, undefined, stop);
    if (canonicalJson(replay) !== canonicalJson(r.result))
      errors.push(
        "numerical samples, reference verification, measurements or frozen evaluation differ on replay",
      );
    // A replayed inconclusive/negative/failed run is retained but cannot claim successful evidence sufficiency.
    return {
      ok: !errors.length,
      errors,
      replay_sha256: sha256Json({ plan: numericalPlanBody(r.plan), result: replay }),
    };
  } catch {
    return { ok: false, errors: ["malformed numerical record"], replay_sha256: null };
  }
}
