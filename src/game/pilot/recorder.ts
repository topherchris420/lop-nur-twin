import { canonicalize } from "@/lib/canonicalJson";
import {
  ACTION_CONTRACT_VERSION,
  AXES,
  CONTROL_MODES,
  OBSERVATION_SCHEMA_VERSION,
  isAxisAction,
  type ControlFrame,
  type ControlMode,
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

export const TRACE_VERSION = "blacksite-jev-trace/v2";
export const MAX_TRACE_RECORDS = 5000;
export const MAX_TRACE_EVENTS = 2000;

export type DecisionSource = "jev" | "random" | "replay" | "fallback-random";

export interface TraceHeader {
  type: "header";
  traceVersion: typeof TRACE_VERSION;
  actionContract: typeof ACTION_CONTRACT_VERSION;
  observationSchema: typeof OBSERVATION_SCHEMA_VERSION;
  brain: "jev" | "random" | "replay";
  seed: number;
  /**
   * How the frames reached the view. A `precision` trace's target choices were
   * executed by the local tracking controller, not by the brain frame by frame.
   */
  control: ControlMode;
  mode: string;
  matchId: string;
  startedAt: string;
  build: string | null;
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
    | "target_released";
  detail: string;
}

/** 64-bit FNV-1a as two 32-bit halves, hex. Stable across runtimes. */
export function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function hashObservation(observation: unknown): string {
  return fnv1a64(JSON.stringify(canonicalize(observation)));
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
