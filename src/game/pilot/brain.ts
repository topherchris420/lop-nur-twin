import type { Axis } from "./contract";
import type { DecisionAxes } from "./decision";
import type { Capabilities } from "./capabilities";
import type {
  ConfidenceSource,
  DecisionAccounting,
  DecisionConfidence,
} from "../eval/records";

/**
 * Who is in the seat, in a form every brain fills the same way.
 *
 * The seat has one decision pipeline and every brain enters it at the same
 * point:
 *
 *   OBSERVATION → LEGAL OPTIONS → MODEL DECISION → CONFIDENCE → VALIDATION
 *     → DETERMINISTIC EXECUTION → WORLD OUTCOME → EVALUATION
 *
 * A brain implements `DecisionProvider` (`loop.ts`): it takes the observation
 * — which carries its legal options — and returns a control frame drawn from
 * those options, or a typed failure. It never sees past the observation and
 * its whole output is that frame; validation, execution and the outcome are
 * the host's. This module adds the two things an evaluation needs from every
 * brain alike: a descriptor saying what it is, and accounting saying what each
 * decision cost. Neither changes what the brain can do.
 *
 * The interface the task description sketched —
 * `decide(observation, options): Promise<BrainDecision>` — is this one:
 * the options are `observation.legal`, and `ProviderResult` is the decision or
 * the failure. Keeping the existing seam, rather than adding a second one
 * beside it, is what keeps Jev, the scripts, random and replay on one path.
 */

export interface BrainDescriptor {
  /** Stable id for reports: `jev`, `llm`, `random`, `script:marksman`, `replay`. */
  id: string;
  kind: "jev" | "llm" | "random" | "script" | "replay";
  /** Who serves the decision: `typesafe`, the LLM provider name, or `local`. */
  provider: string;
  /** The configured model alias, when known before the first answer. */
  model: string | null;
  capabilities: Capabilities;
  /** What its confidence numbers are, if it states any. */
  confidence: ConfidenceSource;
}

/** Accounting a provider fills in; the loop adds the wall-clock latency. */
export type ProviderAccounting = Omit<
  DecisionAccounting,
  "wallLatencyMs" | "injectedLatencyMs"
>;

export function localAccounting(): ProviderAccounting {
  return {
    provider: "local",
    model: null,
    providerLatencyMs: null,
    requestBytes: null,
    responseBytes: null,
    inputTokens: null,
    outputTokens: null,
    reportedCostUsd: null,
    retries: null,
    traceId: null,
    questionHash: null,
  };
}

/**
 * TypeSafe's answers as confidence records: the probability it gave the
 * option chosen, and its separate confidence figure, per asked axis. An axis
 * that was not asked has no entry — nothing is invented for it.
 */
export function confidenceFromAxes(axes: DecisionAxes | null): DecisionConfidence {
  if (!axes) return { source: "none", perAxis: {} };
  const perAxis: DecisionConfidence["perAxis"] = {};
  for (const axis of Object.keys(axes) as Axis[]) {
    const answer = axes[axis];
    if (!answer) continue;
    const chosen = answer.probabilities.find(([option]) => option === answer.choice);
    perAxis[axis] = {
      probability: chosen ? chosen[1] : null,
      confidence: answer.confidence,
    };
  }
  return { source: "provider-probability", perAxis };
}

/** Byte length of a string as UTF-8, for request and response sizes. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
