import { canonicalHash } from "./hash";
import {
  ACTION_CONTRACT_VERSION,
  AXES,
  CONTROL_MODES,
  OBSERVATION_SCHEMA_VERSION,
  isAxisAction,
  type ControlFrame,
  type ControlMode,
  type NavigationMode,
  NAVIGATION_MODES,
} from "./contract";
import type { DecisionAxes } from "./decision";
import type { LegalActions, PreviousOutcome } from "./observation";

/**
 * The gameplay trace: every decision a brain made, what it was shown, what it
 * chose, and what the game did with it.
 *
 * Written as JSON Lines — one header, then one object per decision or event —
 * because a trace is read by people and by `tools/jev-replay.mjs` alike, and a
 * truncated JSONL file is still readable up to the cut. The header pins the
 * trace, action-contract and observation versions; replay refuses anything
 * else rather than guess.
 *
 * What is recorded is what happened. Probabilities and confidence appear only
 * when TypeSafe returned them; the random baseline and replays carry `null`.
 * The API key never reaches the browser, so it cannot be in a trace.
 */

export const TRACE_VERSION = "blacksite-jev-trace/v3";
export const MAX_TRACE_RECORDS = 5000;
export const MAX_TRACE_EVENTS = 2000;

export type DecisionSource =
  "jev" | "glide" | "llm" | "random" | "script" | "replay" | "fallback-random";

export interface TraceHeader {
  type: "header";
  traceVersion: typeof TRACE_VERSION;
  actionContract: typeof ACTION_CONTRACT_VERSION;
  observationSchema: typeof OBSERVATION_SCHEMA_VERSION;
  brain: "jev" | "glide" | "llm" | "random" | "script" | "replay";
  /** The scripted policy, for a `script` trace; null otherwise. */
  policy: string | null;
  seed: number;
  /**
   * How the frames reached the view. A `precision` trace's target choices were
   * executed by the local tracking controller, not by the brain frame by frame.
   */
  control: ControlMode;
  /** How the frames reached the feet: stepped, or a place walked to by the navigator. */
  navigation: NavigationMode;
  /**
   * The negotiated interface: decision interval, any injected latency (local
   * brains only, for experiments), where inference ran, and every request
   * that was not granted as asked.
   */
  interface: {
    intervalMs: number;
    injectedLatencyMs: number;
    inference: "local" | "remote";
    /** The loop's limits for this brain; absent in traces before they were recorded. */
    requestTimeoutMs?: number;
    maxDecisionAgeMs?: number;
    notes: string[];
  } | null;
  mode: string;
  matchId: string;
  startedAt: string;
  build: string | null;
  /**
   * Evaluation provenance, added with `blacksite-decision/v1`. Optional so
   * traces recorded before it still replay: what the brain declared itself to
   * be, the execution-time staleness policy, the motor profile, the option
   * orders, the seat rules and the schema of the decision records.
   */
  evaluation?: {
    brain: { id: string; provider: string; model: string | null; confidence: string };
    stale: string;
    motor: string;
    placeOrder: string;
    targetOrder: string;
    seat: string;
    decisionRecordSchema: string;
  };
}

export interface PlayerSnapshot {
  alive: boolean;
  health: number;
  position: [number, number, number];
  headingDeg: number;
  ammo: number;
  reserve: number;
}

export interface TraceRecord {
  type: "decision";
  /** ISO wall-clock time the decision was accepted. */
  timestamp: string;
  sequence: number;
  source: DecisionSource;
  /** FNV-1a over the canonical observation JSON: identifies it without storing it. */
  observationHash: string;
  legal: LegalActions;
  frame: ControlFrame;
  axes: DecisionAxes | null;
  model: string | null;
  latencyMs: number | null;
  serverLatencyMs: number | null;
  /** Simulation seconds; null until the frame starts executing. */
  actionStart: number | null;
  actionExpiry: number | null;
  actionEnd: number | null;
  endReason: "expired" | "replaced" | "cleared" | null;
  execution: PreviousOutcome | null;
  /** Precision control only: whether the chosen slot bound a target. */
  engagement?: { targetBound: boolean };
  /** Places navigation only, for a PLACE_n choice: whether it bound a place, and which kind. */
  travel?: { placeBound: boolean; kind: string | null };
  playerAfter: PlayerSnapshot | null;
  matchId: string;
  seed: number;
}

export interface TraceEvent {
  type: "event";
  timestamp: string;
  sequence: number | null;
  kind:
    | "timeout"
    | "stale"
    | "duplicate"
    | "error"
    | "unavailable"
    | "invalid"
    | "rate_limited"
    | "takeover"
    | "death"
    | "respawn"
    | "skipped"
    | "target_released"
    | "travel_ended"
    | "debrief"
    | "rejected_stale"
    | "refused";
  detail: string;
}

export { fnv1a64 } from "./hash";

export function hashObservation(observation: unknown): string {
  return canonicalHash(observation);
}

export class TraceRecorder {
  header: TraceHeader | null = null;
  readonly records: TraceRecord[] = [];
  readonly events: TraceEvent[] = [];
  /** Records dropped because the trace hit its size cap. */
  dropped = 0;

  begin(
    header: Omit<
      TraceHeader,
      "type" | "traceVersion" | "actionContract" | "observationSchema"
    >,
  ): void {
    this.header = {
      type: "header",
      traceVersion: TRACE_VERSION,
      actionContract: ACTION_CONTRACT_VERSION,
      observationSchema: OBSERVATION_SCHEMA_VERSION,
      ...header,
    };
    this.records.length = 0;
    this.events.length = 0;
    this.dropped = 0;
  }

  record(record: TraceRecord): TraceRecord | null {
    if (this.records.length >= MAX_TRACE_RECORDS) {
      this.dropped += 1;
      return null;
    }
    this.records.push(record);
    return record;
  }

  event(event: Omit<TraceEvent, "type" | "timestamp">): void {
    if (this.events.length >= MAX_TRACE_EVENTS) return;
    this.events.push({ type: "event", timestamp: new Date().toISOString(), ...event });
  }

  get size(): number {
    return this.records.length;
  }

  toJsonl(): string {
    if (!this.header) return "";
    const lines: string[] = [JSON.stringify(this.header)];
    const merged: (TraceRecord | TraceEvent)[] = [...this.records, ...this.events];
    merged.sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );
    for (const entry of merged) lines.push(JSON.stringify(entry));
    return `${lines.join("\n")}\n`;
  }
}

export interface ParsedTrace {
  header: TraceHeader;
  records: TraceRecord[];
}

/**
 * Read a trace for replay. Refuses a missing or foreign header, a different
 * trace, contract or observation version, and any decision whose controls are
 * not in this build's contract — a replay executes nothing it cannot validate.
 */
export function parseTrace(
  text: string,
): { ok: true; trace: ParsedTrace } | { ok: false; error: string } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { ok: false, error: "The trace is empty." };
  let header: TraceHeader;
  try {
    header = JSON.parse(lines[0]!) as TraceHeader;
  } catch {
    return { ok: false, error: "The first line is not a trace header." };
  }
  if (header?.type !== "header")
    return { ok: false, error: "The first line is not a trace header." };
  if (header.traceVersion !== TRACE_VERSION) {
    return {
      ok: false,
      error: `Unsupported trace version ${String(header.traceVersion)}.`,
    };
  }
  if (header.actionContract !== ACTION_CONTRACT_VERSION) {
    return {
      ok: false,
      error: `Trace uses action contract ${String(header.actionContract)}; this build speaks ${ACTION_CONTRACT_VERSION}.`,
    };
  }
  if (!(CONTROL_MODES as readonly unknown[]).includes(header.control)) {
    return { ok: false, error: `Unknown control mode ${String(header.control)}.` };
  }
  if (!(NAVIGATION_MODES as readonly unknown[]).includes(header.navigation)) {
    return { ok: false, error: `Unknown navigation mode ${String(header.navigation)}.` };
  }
  if (header.observationSchema !== OBSERVATION_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported observation schema ${String(header.observationSchema)}.`,
    };
  }
  const records: TraceRecord[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i]!);
    } catch {
      return { ok: false, error: `Line ${i + 1} is not JSON.` };
    }
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<TraceRecord>;
    if (candidate.type !== "decision") continue;
    const frame = candidate.frame as Record<string, unknown> | undefined;
    if (!frame || !AXES.every((axis) => isAxisAction(axis, frame[axis]))) {
      return {
        ok: false,
        error: `Line ${i + 1} holds a control this build does not know.`,
      };
    }
    if (
      typeof candidate.actionStart !== "number" ||
      !Number.isFinite(candidate.actionStart)
    ) {
      // Decided but never executed (the player died first): nothing to replay.
      continue;
    }
    records.push(candidate as TraceRecord);
  }
  records.sort(
    (a, b) => (a.actionStart ?? 0) - (b.actionStart ?? 0) || a.sequence - b.sequence,
  );
  if (records.length === 0)
    return { ok: false, error: "The trace has no executed decisions." };
  return { ok: true, trace: { header, records } };
}
