/**
 * Calibration profiles: the held-out evidence under which R.A.I.N. acts on a
 * decision engine's answer instead of handing the choice back. A port of the
 * loading and support checks of R.A.I.N.'s `judgment/calibration.py`
 * (james_library, MIT). Fitting new profiles (`fit_profile`) was a workbench
 * command there and is not part of the runtime: a profile is brought in as a
 * file (`RAIN_DECISION_CALIBRATION`) and never computed here.
 *
 * Shared with the server: imports siblings only. The file is read by the
 * caller; this module validates its contents.
 */
import { sha256 } from "../sha256.js";
import { boundedNumber } from "./contracts.js";

export const CALIBRATION_SCHEMA = "rain-decision-calibration/v1" as const;

/** SHA-256 over compact, key-sorted JSON (R.A.I.N.'s `digest_json`). */
export function digestJson(value: unknown): string {
  return sha256(JSON.stringify(sortKeys(value)));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // Defined, not assigned, so a "__proto__" key is kept as data.
    for (const key of Object.keys(value).sort())
      Object.defineProperty(out, key, {
        value: sortKeys((value as Record<string, unknown>)[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("non-finite number in hashed JSON");
  return value;
}

export interface CalibrationSample {
  sample_id: string;
  expected: string;
  selected: string;
  probability: number;
  margin: number;
}
export interface CalibrationProfile {
  schema_version: typeof CALIBRATION_SCHEMA;
  engine: "laya" | "typesafe";
  model: string;
  decision_class: string;
  question_hash: string;
  threshold: number;
  margin: number;
  target_accuracy: number;
  fit_samples: CalibrationSample[];
  heldout_samples: CalibrationSample[];
  expires_at: string;
}

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

function sample(value: unknown): CalibrationSample {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid calibration sample");
  const s = value as Record<string, unknown>;
  const keys = Object.keys(s).sort().join();
  if (keys !== "expected,margin,probability,sample_id,selected")
    throw new Error("invalid calibration sample");
  if (
    ![s.sample_id, s.expected, s.selected].every((v) => typeof v === "string" && v) ||
    !boundedNumber(s.probability, 0, 1) ||
    !boundedNumber(s.margin, 0, 1)
  )
    throw new Error("invalid calibration sample");
  return s as unknown as CalibrationSample;
}

/** A profile's declared fields, checked as R.A.I.N.'s dataclass checks them. */
export function calibrationProfile(value: unknown): CalibrationProfile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid calibration profile");
  const p = value as Record<string, unknown>;
  const schema = p.schema_version ?? CALIBRATION_SCHEMA;
  if (schema !== CALIBRATION_SCHEMA) throw new Error("unsupported calibration schema");
  if (p.engine !== "laya" && p.engine !== "typesafe")
    throw new Error("invalid calibration engine");
  for (const label of [p.model, p.decision_class])
    if (typeof label !== "string" || !IDENTITY.test(label))
      throw new Error("invalid calibration identity");
  if (typeof p.question_hash !== "string" || !/^[0-9a-f]{64}$/.test(p.question_hash))
    throw new Error("invalid question hash");
  if (![p.threshold, p.margin, p.target_accuracy].every((v) => boundedNumber(v, 0, 1)))
    throw new Error("invalid calibration threshold");
  if ((p.target_accuracy as number) < 0.5)
    throw new Error("calibration target must be at least 0.5");
  if (typeof p.expires_at !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(p.expires_at))
    throw new Error("calibration expiry must have a timezone");
  if (Number.isNaN(Date.parse(p.expires_at)))
    throw new Error("invalid calibration expiry");
  if (!Array.isArray(p.fit_samples) || !Array.isArray(p.heldout_samples))
    throw new Error("calibration splits must be lists");
  const fit = p.fit_samples.map(sample),
    heldout = p.heldout_samples.map(sample);
  const ids = [...fit, ...heldout].map((s) => s.sample_id);
  if (new Set(ids).size !== ids.length)
    throw new Error("fit and held-out sample IDs must be unique and disjoint");
  return {
    schema_version: CALIBRATION_SCHEMA,
    engine: p.engine,
    model: p.model as string,
    decision_class: p.decision_class as string,
    question_hash: p.question_hash,
    threshold: p.threshold as number,
    margin: p.margin as number,
    target_accuracy: p.target_accuracy as number,
    fit_samples: fit,
    heldout_samples: heldout,
    expires_at: p.expires_at,
  };
}

export const profileId = (p: CalibrationProfile) => digestJson(p);

/** Lower bound of the Wilson score interval at 95%. */
export function wilsonLower(correct: number, count: number): number {
  if (!count) return 0.0;
  const p = correct / count,
    z = 1.96;
  return (
    (p +
      (z * z) / (2 * count) -
      z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) /
    (1 + (z * z) / count)
  );
}

/**
 * Whether the profile still supports acting: unexpired, with at least
 * `minimum` accepted samples in each split and a held-out accuracy whose
 * Wilson lower bound meets the target.
 */
export function profileSupports(
  p: CalibrationProfile,
  minimum: number,
  now = new Date(),
): boolean {
  if (now.getTime() >= Date.parse(p.expires_at)) return false;
  for (const samples of [p.fit_samples, p.heldout_samples]) {
    const accepted = samples.filter(
      (s) => s.probability >= p.threshold && s.margin >= p.margin,
    );
    if (accepted.length < minimum) return false;
    const correct = accepted.filter((s) => s.selected === s.expected).length;
    if (wilsonLower(correct, accepted.length) < p.target_accuracy) return false;
  }
  return true;
}

/**
 * The profiles in a calibration file's text: a list of at most 100 profiles
 * with distinct (engine, model, decision class, question hash) identities.
 * Anything else fails closed as "invalid calibration file".
 */
export function parseProfiles(text: string): CalibrationProfile[] {
  try {
    if (text.length > 2_000_000) throw new Error("too large");
    if (/\bNaN\b|\bInfinity\b/.test(text)) throw new Error("nonfinite JSON");
    const payload: unknown = JSON.parse(text);
    if (!Array.isArray(payload) || payload.length > 100) throw new Error("not a list");
    const profiles = payload.map(calibrationProfile);
    const keys = profiles.map((p) =>
      [p.engine, p.model, p.decision_class, p.question_hash].join("\0"),
    );
    if (new Set(keys).size !== keys.length) throw new Error("duplicate identity");
    return profiles;
  } catch (error) {
    throw new Error("invalid calibration file", { cause: error });
  }
}
