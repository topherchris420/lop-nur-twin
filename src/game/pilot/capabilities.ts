import {
  CONTROL_MODES,
  MAX_DECISION_AGE_MS,
  MIN_DECISION_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  NAVIGATION_MODES,
  type ControlMode,
  type NavigationMode,
} from "./contract.js";

/**
 * Capability negotiation between the seat and whatever sits in it.
 *
 * A brain declares what it can use; the host declares what it can accept; the
 * seat runs the best interface both support and records which. Nothing in the
 * simulation changes with the outcome — the rules a round, a wall or a body
 * obeys are the same under every interface. What changes is how a brain's
 * choices reach the input: which axes it is asked, how often, and what the
 * local controllers execute for it.
 *
 * The point is headroom. The host already accepts more than today's remote
 * model can use at speed — places, precision control, decisions ten times a
 * second — so a faster or better model arrives into an interface that is
 * waiting for it, and says so by declaring it, instead of by a rewrite.
 * Conversely a brain that cannot use something (a trace recorded under steps
 * navigation, a future adapter without places) is not offered it.
 *
 * Declared, not measured: a brain's `minIntervalMs` is what it says it can
 * sustain; the loop still keeps one request in flight, so a slow answer slows
 * the cadence whatever was declared. The measured rate is in the metrics.
 */

export const OBSERVATION_FORMATS = ["structured-v4"] as const;
export type ObservationFormat = (typeof OBSERVATION_FORMATS)[number];

export interface Capabilities {
  /** Engagement interfaces, most capable first. */
  control: readonly ControlMode[];
  /** Movement interfaces, most capable first. */
  navigation: readonly NavigationMode[];
  /** The shortest interval between decisions it can use, milliseconds. */
  minIntervalMs: number;
  /** Where its inference runs. A remote brain's cadence is bound by the network. */
  inference: "local" | "remote";
  /** It keeps its own memory across decisions, beyond the observation's. */
  memory: boolean;
  /** It reads rendered frames. No brain does yet, and the host offers none. */
  vision: boolean;
  observations: readonly ObservationFormat[];
  /**
   * How long the loop waits for an answer, and the oldest observation an
   * answer may be about. Omitted means the contract's 2.2 s and 1.5 s. A brain
   * that needs longer declares it; the host caps it; the negotiated values are
   * recorded with every result, because a brain allowed to answer late is
   * being judged under different rules — and the execution-time revalidation
   * (`staleness.ts`) still refuses a late answer whose choice has become
   * illegal.
   */
  requestTimeoutMs?: number;
  maxDecisionAgeMs?: number;
}

/**
 * What this build of the game accepts. Ten decisions a second is the
 * fastest the executor's control window is designed around (a window is
 * 0.4 s, so a frame is always replaced long before it expires); no remote
 * model reaches it today.
 */
export const HOST_CAPABILITIES: Capabilities = {
  control: ["precision", "direct"],
  navigation: ["places", "steps"],
  minIntervalMs: 100,
  inference: "local",
  memory: false,
  vision: false,
  observations: ["structured-v4"],
  // The longest the host will wait for, or accept, an answer.
  requestTimeoutMs: 15_000,
  maxDecisionAgeMs: 15_000,
};

/**
 * The Jev adapter: the server's question builder speaks every interface, and
 * the endpoint's pacing allows a request every 150 ms per session; the
 * browser asks at most every 200 ms, one at a time. Measured TypeSafe latency
 * (130–260 ms) is what actually sets its rate.
 */
export const JEV_CAPABILITIES: Capabilities = {
  control: ["precision", "direct"],
  navigation: ["places", "steps"],
  minIntervalMs: MIN_DECISION_INTERVAL_MS,
  inference: "remote",
  memory: false,
  vision: false,
  observations: ["structured-v4"],
};

/**
 * A conventional LLM behind `/api/llm/decision`. The server builds it the
 * same question Jev gets for every interface, so it is offered the same ones;
 * its cadence is bound by its own latency (typically far above Jev's), with
 * one request in flight, exactly as for Jev. It has no memory beyond the
 * observation: each request is a fresh conversation.
 */
export const LLM_CAPABILITIES: Capabilities = {
  control: ["precision", "direct"],
  navigation: ["places", "steps"],
  minIntervalMs: MIN_DECISION_INTERVAL_MS,
  inference: "remote",
  memory: false,
  vision: false,
  observations: ["structured-v4"],
  // A conventional LLM answers in seconds, not Jev's ~200 ms: under the
  // contract's 1.5 s age limit it would never act. These are its limits, and
  // they are the most important stated difference between the two seats.
  requestTimeoutMs: 12_000,
  maxDecisionAgeMs: 12_000,
};

/**
 * Fastino's Glide behind `/api/glide/decision`. It speaks the same SystemOne
 * Choice protocol as Jev and is asked the same question for every interface,
 * so it is offered the same ones, with one request in flight.
 *
 * Its answers are slower than Jev's, and how much slower depends on the
 * question. Measured on 2026-10-05 from a cloud container: the test fixture's
 * questions took 0.69–1.0 s under precision control and 3.6–5.7 s under
 * direct (five requests each; Fastino reported 902 output tokens for every
 * direct answer and 6 for every precision one). In live play the same day
 * (45 s per control) the server measured a median of 0.8–0.9 s, a 95th
 * percentile of 3.0–3.3 s and a maximum of 5.3 s. Under the contract's 1.5 s
 * age limit a large share of those answers could never act, so it declares
 * 8 s — a stated difference between seats, like the LLM's 12 s. The server
 * gives up on Fastino at 7.5 s, before the browser does.
 */
export const GLIDE_CAPABILITIES: Capabilities = {
  control: ["precision", "direct"],
  navigation: ["places", "steps"],
  minIntervalMs: MIN_DECISION_INTERVAL_MS,
  inference: "remote",
  memory: false,
  vision: false,
  observations: ["structured-v4"],
  requestTimeoutMs: 8_000,
  maxDecisionAgeMs: 8_000,
};

/** The seeded random policy and the scripted policies run in the page. */
export const LOCAL_POLICY_CAPABILITIES: Capabilities = {
  control: ["precision", "direct"],
  navigation: ["places", "steps"],
  minIntervalMs: 50,
  inference: "local",
  memory: true,
  vision: false,
  observations: ["structured-v4"],
};

export interface NegotiationRequest {
  control: ControlMode;
  navigation: NavigationMode;
  /** An experiment's requested decision interval; null for the default. */
  intervalMs: number | null;
}

export interface Negotiated {
  observationFormat: ObservationFormat;
  control: ControlMode;
  navigation: NavigationMode;
  intervalMs: number;
  inference: "local" | "remote";
  /** The loop's request timeout and maximum answer age, after the host's caps. */
  requestTimeoutMs: number;
  maxDecisionAgeMs: number;
  /** Every place a request was not granted as asked, in words. */
  notes: string[];
}

function pick<T extends string>(
  wanted: T,
  brain: readonly T[],
  host: readonly T[],
  all: readonly T[],
  what: string,
  notes: string[],
): T {
  if (brain.includes(wanted) && host.includes(wanted)) return wanted;
  const common = all.find((mode) => brain.includes(mode) && host.includes(mode));
  if (!common) throw new Error(`no common ${what} interface`);
  notes.push(`${what} ${wanted} not supported by both sides; using ${common}`);
  return common;
}

/**
 * The interface a seat runs. Asked-for modes are granted when both sides
 * support them; otherwise the first mode both support, noted. The interval
 * is never shorter than either side's floor, and defaults to the contract's
 * 200 ms so results stay comparable with every benchmark before this one.
 */
export function negotiate(
  brain: Capabilities,
  request: NegotiationRequest,
  host: Capabilities = HOST_CAPABILITIES,
): Negotiated {
  const notes: string[] = [];
  const observationFormat = OBSERVATION_FORMATS.find(
    (format) => brain.observations.includes(format) && host.observations.includes(format),
  );
  if (!observationFormat) throw new Error("no common observation interface");
  const control = pick(
    request.control,
    brain.control,
    host.control,
    CONTROL_MODES,
    "control",
    notes,
  );
  const navigation = pick(
    request.navigation,
    brain.navigation,
    host.navigation,
    NAVIGATION_MODES,
    "navigation",
    notes,
  );
  const floor = Math.max(brain.minIntervalMs, host.minIntervalMs);
  const wanted = request.intervalMs ?? MIN_DECISION_INTERVAL_MS;
  if (wanted < floor)
    notes.push(`interval ${wanted} ms below the floor; using ${floor} ms`);
  const cap = (
    wantedMs: number | undefined,
    fallback: number,
    hostMax: number | undefined,
  ): number => Math.min(wantedMs ?? fallback, hostMax ?? fallback);
  return {
    observationFormat,
    control,
    navigation,
    intervalMs: Math.max(floor, wanted),
    inference: brain.inference,
    requestTimeoutMs: cap(
      brain.requestTimeoutMs,
      REQUEST_TIMEOUT_MS,
      host.requestTimeoutMs,
    ),
    maxDecisionAgeMs: cap(
      brain.maxDecisionAgeMs,
      MAX_DECISION_AGE_MS,
      host.maxDecisionAgeMs,
    ),
    notes,
  };
}
