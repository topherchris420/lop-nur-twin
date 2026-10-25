/**
 * An experimental checkpoint of the ECHO self-model, and its strict restore.
 *
 * What it holds: the self-model's whole state (beliefs, trust in its sense,
 * heading estimate, change detector, open inquiry, the prediction for the
 * period under way, short-term history, episodic memory and its counters),
 * with the self-model's and the fly's versions, the variant, the seed and the
 * time it was taken, sealed by a digest of its canonical JSON.
 *
 * What it does not hold, and why that matters: the body, the reduced-order
 * controller's state, the senses' pending frames and every random stream.
 * Restored into the same running fly at the same moment it continues
 * exactly (echo.test.ts checks it); restored anywhere else it gives another
 * body this self-model, which is a different fly with this one's
 * self-knowledge, and is recorded as such (`EchoAdapter.restoredFrom`). It is
 * not durable recovery of the city's fly (docs/BETHESDA_CONTINUOUS_LIFE.md
 * lists what that would need).
 *
 * A checkpoint from another self-model version, fly version or variant, or
 * whose digest does not hold, is refused with the reason: never
 * reinterpreted.
 */
import { canonicalHash } from "../../../game/pilot/hash.js";
import { canonicalJson } from "../../../lib/canonicalJson.js";
import { N } from "./forward.js";
import { ECHO_VERSION, EP } from "./params.js";
import { ECHO_STATE, type EchoState } from "./selfModel.js";

export const ECHO_CHECKPOINT = "echo-checkpoint/v1" as const;
export const ECHO_CHECKPOINT_NOTE =
  "Experimental checkpoint of the ECHO self-model only. It does not hold the body, the reduced-order controller or any random stream: restored into another fly it gives that fly this self-model, it does not bring this fly back.";

export interface EchoCheckpoint {
  schema: typeof ECHO_CHECKPOINT;
  note: typeof ECHO_CHECKPOINT_NOTE;
  echo: string;
  fly: string;
  variant: string;
  seed: number | null;
  t: number;
  period: number;
  state: EchoState;
  /** 64-bit FNV-1a of the state's canonical JSON: detects a changed byte, authenticates nothing. */
  digest: string;
}

/** A sealed copy of the self-model's state. */
export function echoCheckpoint(state: EchoState): EchoCheckpoint {
  const copy = JSON.parse(canonicalJson(state)) as EchoState;
  return {
    schema: ECHO_CHECKPOINT,
    note: ECHO_CHECKPOINT_NOTE,
    echo: copy.version,
    fly: copy.fly,
    variant: copy.variant,
    seed: copy.seed,
    t: copy.t,
    period: copy.period,
    state: copy,
    digest: canonicalHash(copy),
  };
}

export const serializeEchoCheckpoint = (c: EchoCheckpoint): string => canonicalJson(c);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const numbers = (v: unknown, n: number) =>
  Array.isArray(v) &&
  v.length === n &&
  v.every((x) => typeof x === "number" && Number.isFinite(x));

/**
 * Parse and check a serialized checkpoint for a self-model of `variant` on
 * fly version `fly`. Every refusal says why.
 */
export function parseEchoCheckpoint(
  text: string,
  expect: { fly: string; variant: string },
): { ok: true; checkpoint: EchoCheckpoint } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["not JSON"] };
  }
  if (!isObject(raw)) return { ok: false, errors: ["not a checkpoint object"] };
  const errors: string[] = [];
  if (raw.schema !== ECHO_CHECKPOINT) errors.push(`not an ${ECHO_CHECKPOINT}`);
  if (raw.note !== ECHO_CHECKPOINT_NOTE)
    errors.push("the checkpoint's note is not this format's");
  if (raw.echo !== ECHO_VERSION)
    errors.push(`made by ${String(raw.echo)}, not ${ECHO_VERSION}: never reinterpreted`);
  if (raw.fly !== expect.fly)
    errors.push(`made on fly ${String(raw.fly)}, not ${expect.fly}: never reinterpreted`);
  if (raw.variant !== expect.variant)
    errors.push(
      `a ${String(raw.variant)} self-model cannot restore into a ${expect.variant} one`,
    );
  const s = raw.state;
  if (!isObject(s)) return { ok: false, errors: [...errors, "no state"] };
  if (s.schema !== ECHO_STATE || s.version !== ECHO_VERSION)
    errors.push("the state is not this self-model's");
  if (
    s.fly !== raw.fly ||
    s.variant !== raw.variant ||
    s.seed !== raw.seed ||
    s.t !== raw.t ||
    s.period !== raw.period
  )
    errors.push("the checkpoint's header does not match its state");
  const b = s.belief;
  if (!isObject(b) || !numbers(b.x, N) || !numbers(b.P, N * N))
    errors.push("the beliefs are malformed");
  if (!Array.isArray(s.history) || s.history.length > EP.historyPeriods)
    errors.push("the short-term history is malformed or over its bound");
  if (!Array.isArray(s.episodes) || s.episodes.length > EP.episodesKept)
    errors.push("the episodic memory is malformed or over its bound");
  let digest: string | null = null;
  try {
    digest = canonicalHash(s);
  } catch {
    errors.push("the state holds a value that cannot be hashed (a non-finite number)");
  }
  if (digest !== null && digest !== raw.digest)
    errors.push("the digest does not hold: the checkpoint changed after it was taken");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, checkpoint: raw as unknown as EchoCheckpoint };
}
