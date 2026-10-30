/** Portable observations, not checkpoints: this data cannot resume a life. */
import type { Observation } from "./observation.js";
import { BROADCAST_DELAY_S, type Interval } from "./timeline.js";

/** Match the timeline's discrete facts, even when a paused interval is no longer buffered. */
export function observationIn(interval: Interval | null): Observation | null {
  if (!interval) return null;
  return interval.tau >= 1 ? interval.next : interval.prev;
}

export interface RecordContext {
  interval: Interval;
  presentedAt: number;
  paused: boolean;
  exportedAt: string;
  source: string;
  connection: string;
}

export function observationRecord(context: RecordContext) {
  const { interval } = context;
  return {
    schema: "garden-observation/v1" as const,
    exportedAt: context.exportedAt,
    source: { endpoint: context.source, method: "GET" as const },
    scope:
      "Validated, normalized public observation of a simulated fly. Not a checkpoint, complete history, or measurement of a real insect.",
    presentation: {
      at: context.presentedAt,
      paused: context.paused,
      connection: context.connection,
      broadcastDelaySeconds: BROADCAST_DELAY_S,
      interpolation: interval.tau,
      lateSeconds: interval.late,
      discontinuous: interval.discontinuous,
    },
    observation: observationIn(interval)!,
    // Preserve the reported endpoints behind an interpolated picture. Never
    // export an interpolated pose as a state the server actually reported.
    nextObservation: interval.tau < 1 ? interval.next : null,
  };
}
