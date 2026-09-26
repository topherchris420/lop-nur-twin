import {
  AXES,
  DECISION_SCHEMA_VERSION,
  isAxisAction,
  type Axis,
  type AxisActions,
  type ControlFrame,
} from "./contract.js";
import type { LegalActions, Validated } from "./observation.js";

/**
 * The shape of a decision, and the checks both ends apply to it.
 *
 * The server validates TypeSafe's answers before it returns anything; the
 * browser validates the server's response again before anything is executed.
 * Defence in depth is cheap here, and the failure it prevents — an unknown
 * control reaching the input layer — is the one this whole contract exists to
 * rule out.
 *
 * Probabilities and confidence are TypeSafe's own numbers, carried through
 * unchanged. When they are missing or malformed the decision is rejected; a
 * value is never filled in.
 */

export interface AxisDecision<A extends Axis> {
  choice: AxisActions[A];
  /** TypeSafe's confidence for this answer, 0..1. */
  confidence: number;
  /** Every legal option with the probability TypeSafe gave it, highest first. */
  probabilities: [AxisActions[A], number][];
}

export type DecisionAxes = { [A in Axis]: AxisDecision<A> };

export interface JevDecision {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  sequence: number;
  /** Where the answer came from. The only value the server ever sends. */
  source: "typesafe";
  /** The versioned model id TypeSafe reports, e.g. `jev-1.13.0`. */
  model: string;
  frame: ControlFrame;
  axes: DecisionAxes;
  /** Server-measured duration of the TypeSafe call, in milliseconds. */
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export const DECISION_ERROR_CODES = [
  "invalid_request",
  "method_not_allowed",
  "payload_too_large",
  "unsupported_media_type",
  "forbidden_origin",
  "rate_limited",
  "not_configured",
  "upstream_auth",
  "upstream_rate_limited",
  "upstream_timeout",
  "upstream_error",
  "upstream_invalid",
] as const;

export type DecisionErrorCode = (typeof DECISION_ERROR_CODES)[number];

export interface DecisionErrorBody {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  sequence: number | null;
  error: { code: DecisionErrorCode; message: string };
  retryAfterMs: number | null;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** TypeSafe rounds each probability; a dozen options can drift this far from 1. */
const PROBABILITY_SUM_TOLERANCE = 0.08;
/** `choice` is the highest-probability option; allow for the same rounding. */
const ARGMAX_TOLERANCE = 0.011;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID.test(value);
}

/** Highest probability first; ties fall back to contract order, so output is stable. */
function sortProbabilities<A extends Axis>(
  legal: readonly AxisActions[A][],
  probabilities: ReadonlyMap<AxisActions[A], number>,
): [AxisActions[A], number][] {
  const order = new Map(legal.map((action, i) => [action, i]));
  return [...probabilities.entries()].sort(
    ([a, pa], [b, pb]) => pb - pa || (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
}

/**
 * Validate one TypeSafe Choice answer against the options that were offered.
 * Accepts either TypeSafe's wire shape (`probabilities` as a map) or this
 * contract's sorted pair list, so the same check serves both ends.
 */
export function parseAxisDecision<A extends Axis>(
  axis: A,
  answer: unknown,
  legal: readonly AxisActions[A][],
): Validated<AxisDecision<A>> {
  if (!isRecord(answer)) return { ok: false, error: `${axis}: answer is not an object` };
  const choice = answer["choice"];
  if (!isAxisAction(axis, choice) || !legal.includes(choice)) {
    return { ok: false, error: `${axis}: choice is not an offered option` };
  }
  if (!isUnit(answer["confidence"])) {
    return { ok: false, error: `${axis}: confidence missing or outside [0, 1]` };
  }

  const raw = answer["probabilities"];
  const entries: [unknown, unknown][] = Array.isArray(raw)
    ? raw.map((pair) => (Array.isArray(pair) ? [pair[0], pair[1]] : [null, null]))
    : isRecord(raw)
      ? Object.entries(raw)
      : [];
  if (entries.length !== legal.length) {
    return {
      ok: false,
      error: `${axis}: probabilities do not cover the offered options`,
    };
  }
  const probabilities = new Map<AxisActions[A], number>();
  let sum = 0;
  let max = 0;
  for (const [option, p] of entries) {
    if (!isAxisAction(axis, option) || !legal.includes(option)) {
      return {
        ok: false,
        error: `${axis}: probability for an option that was not offered`,
      };
    }
    if (!isUnit(p)) return { ok: false, error: `${axis}: probability outside [0, 1]` };
    if (probabilities.has(option)) {
      return { ok: false, error: `${axis}: duplicate probability entry` };
    }
    probabilities.set(option, p);
    sum += p;
    max = Math.max(max, p);
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    return { ok: false, error: `${axis}: probabilities sum to ${sum.toFixed(3)}` };
  }
  if ((probabilities.get(choice) ?? 0) < max - ARGMAX_TOLERANCE) {
    return { ok: false, error: `${axis}: choice is not the most probable option` };
  }
  return {
    ok: true,
    value: {
      choice,
      confidence: answer["confidence"],
      probabilities: sortProbabilities(legal, probabilities),
    },
  };
}

/** Validate all four axis answers; the first failure is reported. */
export function parseAllAxes(
  answers: Record<string, unknown>,
  legal: LegalActions,
): Validated<DecisionAxes> {
  const move = parseAxisDecision("move", answers["move"], legal.move);
  if (!move.ok) return move;
  const turn = parseAxisDecision("turn", answers["turn"], legal.turn);
  if (!turn.ok) return turn;
  const tilt = parseAxisDecision("tilt", answers["tilt"], legal.tilt);
  if (!tilt.ok) return tilt;
  const weapon = parseAxisDecision("weapon", answers["weapon"], legal.weapon);
  if (!weapon.ok) return weapon;
  return {
    ok: true,
    value: { move: move.value, turn: turn.value, tilt: tilt.value, weapon: weapon.value },
  };
}

/** The frame the axis answers select. */
export function frameOf(axes: DecisionAxes): ControlFrame {
  return {
    move: axes.move.choice,
    turn: axes.turn.choice,
    tilt: axes.tilt.choice,
    weapon: axes.weapon.choice,
  };
}

/**
 * Validate a decision response from `/api/jev/decision` before it can reach the
 * input layer: right schema, right sequence, only offered controls, and real
 * probabilities for every axis.
 */
export function validateDecision(
  value: unknown,
  expected: { sequence: number; legal: LegalActions },
): Validated<JevDecision> {
  if (!isRecord(value)) return { ok: false, error: "decision is not an object" };
  if (value["schemaVersion"] !== DECISION_SCHEMA_VERSION) {
    return { ok: false, error: "unsupported decision schema" };
  }
  if (value["sequence"] !== expected.sequence) {
    return { ok: false, error: "sequence does not match the observation" };
  }
  if (value["source"] !== "typesafe")
    return { ok: false, error: "unknown decision source" };
  if (!isModelId(value["model"]))
    return { ok: false, error: "model id missing or malformed" };
  const latency = value["latencyMs"];
  if (typeof latency !== "number" || !Number.isFinite(latency) || latency < 0) {
    return { ok: false, error: "latency missing or malformed" };
  }
  const axesRaw = value["axes"];
  const frameRaw = value["frame"];
  if (!isRecord(axesRaw) || !isRecord(frameRaw)) {
    return { ok: false, error: "frame or axes missing" };
  }

  const parsed = parseAllAxes(axesRaw, expected.legal);
  if (!parsed.ok) return parsed;
  const axes = parsed.value;
  const frame = frameOf(axes);
  if (AXES.some((axis) => frameRaw[axis] !== frame[axis])) {
    return { ok: false, error: "frame disagrees with the axis answers" };
  }

  let usage: JevDecision["usage"] = null;
  const usageRaw = value["usage"];
  if (isRecord(usageRaw)) {
    const input = usageRaw["inputTokens"];
    const output = usageRaw["outputTokens"];
    if (
      typeof input === "number" &&
      typeof output === "number" &&
      Number.isInteger(input) &&
      Number.isInteger(output) &&
      input >= 0 &&
      output >= 0
    ) {
      usage = { inputTokens: input, outputTokens: output };
    }
  }

  return {
    ok: true,
    value: {
      schemaVersion: DECISION_SCHEMA_VERSION,
      sequence: expected.sequence,
      source: "typesafe",
      model: value["model"],
      frame,
      axes,
      latencyMs: latency,
      usage,
    },
  };
}

/** Read a structured error body; anything else is reported as unreadable. */
export function readDecisionError(
  value: unknown,
): { code: string; message: string; retryAfterMs: number | null } | null {
  if (!isRecord(value) || !isRecord(value["error"])) return null;
  const code = value["error"]["code"];
  const message = value["error"]["message"];
  const retry = value["retryAfterMs"];
  if (typeof code !== "string" || typeof message !== "string") return null;
  return {
    code: code.slice(0, 64),
    message: message.slice(0, 200),
    retryAfterMs:
      typeof retry === "number" && Number.isFinite(retry) && retry >= 0
        ? Math.min(retry, 60_000)
        : null,
  };
}
