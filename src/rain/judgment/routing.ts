/**
 * Selective bounded proposals over explicit host options.
 *
 * A port of R.A.I.N.'s `judgment/routing.py` (james_library, MIT). The rule
 * the module exists to keep: no decision engine receives a workflow, an
 * executor, a recorder or an authorization. The host supplies deterministic
 * validation and retains all action authority; the router returns an
 * envelope that is a proposal at most, with every engine it consulted and
 * what each returned, even when it acted on none of them.
 *
 * Shared with the server: imports siblings only.
 */
import { digestJson, profileSupports, type CalibrationProfile } from "./calibration.js";
import {
  boundedNumber,
  questionSetToDict,
  validAnswers,
  type JudgmentProvider,
  type JudgmentResult,
  type JudgmentState,
  type QuestionSet,
} from "./contracts.js";
import { containsSensitiveMaterial } from "./sensitive.js";
import { sha256 } from "../sha256.js";

export const DECISION_SCHEMA = "rain-bounded-decision/v1" as const;
export const POLICY_VERSION = "rain-routing-1" as const;
export const QUESTION_SET_VERSION = "rain-bounded-choice-1" as const;

export const ESCALATION_REASONS = [
  "LOW_CONFIDENCE",
  "MARGIN_TOO_SMALL",
  "MODEL_UNAVAILABLE",
  "INVALID_OUTPUT",
  "OUT_OF_DISTRIBUTION",
  "POLICY_REQUIRES_REVIEW",
  "EVIDENCE_REQUIRED",
  "HIGH_CONSEQUENCE",
  "ENGINE_DISAGREEMENT",
  "TIMEOUT",
  "INSUFFICIENT_CALIBRATION",
  "VALIDATION_FAILED",
  "DISABLED",
  "SENSITIVE_INPUT",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];
export type Engine = "laya" | "typesafe";
export type DecisionMode = "off" | "laya" | "jev" | "cascade";

/** Provider error codes an attempt may carry; anything else becomes a generic one. */
export const PROVIDER_ERRORS = [
  "provider_not_configured",
  "provider_timeout",
  "provider_transport_error",
  "provider_authentication_error",
  "provider_rate_limited",
  "provider_overloaded",
  "provider_http_error",
  "provider_response_too_large",
  "provider_malformed_response",
  "provider_input_too_large",
  "provider_runtime_unsupported",
  "state_contains_secret",
  "provider_internal_error",
] as const;
export const SAFE_PROVIDER_ERRORS: ReadonlySet<string> = new Set(PROVIDER_ERRORS);

export interface DecisionRequest {
  decisionClass: string;
  state: string;
  instructions: string;
  choices: readonly (readonly [string, string])[];
  consequence: "low" | "high";
  requiresEvidence: boolean;
  requiresReview: boolean;
  outOfDistribution: boolean;
  remoteAllowed: boolean;
  deterministicChoice: string | null;
}

/** A validated request. Throws on anything outside the bounds, before any inference. */
export function decisionRequest(
  input: Partial<DecisionRequest> &
    Pick<DecisionRequest, "decisionClass" | "state" | "instructions" | "choices">,
): DecisionRequest {
  const request: DecisionRequest = {
    consequence: "high",
    requiresEvidence: false,
    requiresReview: false,
    outOfDistribution: false,
    remoteAllowed: false,
    deterministicChoice: null,
    ...input,
  };
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(request.decisionClass))
    throw new Error("invalid decision class");
  if (
    typeof request.state !== "string" ||
    !request.state.trim() ||
    request.state.length > 24_000 ||
    typeof request.instructions !== "string" ||
    !request.instructions.trim() ||
    request.instructions.length > 1000
  )
    throw new Error("invalid bounded state or instructions");
  if (
    !Array.isArray(request.choices) ||
    request.choices.length < 2 ||
    request.choices.length > 16
  )
    throw new Error("expected 2 to 16 explicit choices");
  for (const choice of request.choices)
    if (
      !Array.isArray(choice) ||
      choice.length !== 2 ||
      typeof choice[0] !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(choice[0]) ||
      typeof choice[1] !== "string" ||
      !choice[1].trim() ||
      choice[1].length > 500
    )
      throw new Error("invalid bounded choice");
  if (new Set(request.choices.map(([key]) => key)).size !== request.choices.length)
    throw new Error("duplicate choices");
  if (request.consequence !== "low" && request.consequence !== "high")
    throw new Error("invalid consequence");
  for (const flag of [
    "requiresEvidence",
    "requiresReview",
    "outOfDistribution",
    "remoteAllowed",
  ] as const)
    if (typeof request[flag] !== "boolean")
      throw new Error("policy flags must be booleans");
  if (
    request.deterministicChoice !== null &&
    !request.choices.some(([key]) => key === request.deterministicChoice)
  )
    throw new Error("deterministic choice outside candidates");
  return request;
}

export const questionsOf = (request: DecisionRequest): QuestionSet => ({
  version: QUESTION_SET_VERSION,
  questions: [
    {
      questionId: "next_action",
      type: "choice",
      instructions: request.instructions,
      choices: request.choices,
      levels: [],
    },
  ],
});
export const questionHash = (request: DecisionRequest) => {
  const questions = questionsOf(request);
  return digestJson({
    version: questions.version,
    questions: questionSetToDict(questions),
  });
};
export const requestHash = (request: DecisionRequest) =>
  digestJson({
    decision_class: request.decisionClass,
    state: request.state,
    instructions: request.instructions,
    choices: request.choices.map((c) => [...c]),
    consequence: request.consequence,
    requires_evidence: request.requiresEvidence,
    requires_review: request.requiresReview,
    out_of_distribution: request.outOfDistribution,
    remote_allowed: request.remoteAllowed,
    deterministic_choice: request.deterministicChoice,
  });

export interface DecisionAttempt {
  engine: Engine;
  model: string | null;
  selected: string | null;
  probabilities: [string, number][];
  confidence: number | null;
  latencyMs: number;
  reason: EscalationReason | null;
  calibrationProfile: string | null;
  threshold: number | null;
  margin: number | null;
  errorCode: string | null;
}
export interface DecisionEnvelope {
  decisionId: string;
  timestamp: string;
  requestHash: string;
  questionHash: string;
  decisionClass: string;
  choices: string[];
  selected: string | null;
  destination: "rain" | "proposal" | "rejected";
  reason: EscalationReason | null;
  attempts: DecisionAttempt[];
  validatorResult: boolean;
  latencyMs: number;
}

/** The envelope as R.A.I.N. serialises it, sealed by its own hash. */
export function envelopeToDict(e: DecisionEnvelope): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    decision_id: e.decisionId,
    timestamp: e.timestamp,
    request_hash: e.requestHash,
    question_hash: e.questionHash,
    decision_class: e.decisionClass,
    choices: [...e.choices],
    selected: e.selected,
    destination: e.destination,
    reason: e.reason,
    attempts: e.attempts.map((a) => ({
      engine: a.engine,
      model: a.model,
      selected: a.selected,
      probabilities: a.probabilities.map((p) => [...p]),
      confidence: a.confidence,
      latency_ms: a.latencyMs,
      reason: a.reason,
      calibration_profile: a.calibrationProfile,
      threshold: a.threshold,
      margin: a.margin,
      error_code: a.errorCode,
    })),
    validator_result: e.validatorResult,
    latency_ms: e.latencyMs,
    schema_version: DECISION_SCHEMA,
    final_action: null,
    policy_version: POLICY_VERSION,
  };
  payload.envelope_hash = digestJson(payload);
  return payload;
}

export type Validator = (request: DecisionRequest, selected: string | null) => boolean;

function validate(
  validator: Validator,
  request: DecisionRequest,
  selected: string | null,
): boolean {
  try {
    return validator(request, selected) === true;
  } catch {
    return false;
  }
}

const PROVIDER_ERROR_REASONS: Record<string, EscalationReason> = {
  provider_timeout: "TIMEOUT",
  provider_malformed_response: "INVALID_OUTPUT",
  provider_input_too_large: "OUT_OF_DISTRIBUTION",
  state_contains_secret: "SENSITIVE_INPUT",
};

export interface RouterOptions {
  mode?: DecisionMode;
  laya?: JudgmentProvider | null;
  jev?: JudgmentProvider | null;
  profiles?: readonly CalibrationProfile[];
  minimumSamples?: number;
  /** Seconds a provider may take before the attempt times out. */
  timeout?: number;
  compare?: boolean;
  /** The environment whose configured secrets a request must not contain. */
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  monotonic?: () => number;
  uuid?: () => string;
}

export class DecisionRouter {
  readonly mode: DecisionMode;
  readonly laya: JudgmentProvider | null;
  readonly jev: JudgmentProvider | null;
  profiles: readonly CalibrationProfile[];
  readonly minimumSamples: number;
  readonly timeout: number;
  readonly compare: boolean;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly now: () => Date;
  private readonly monotonic: () => number;
  private readonly uuid: () => string;
  // One live invocation per engine, even after a timeout. Hung providers
  // cannot accumulate unbounded background calls as a session continues.
  private readonly busy: Record<Engine, boolean> = { laya: false, typesafe: false };

  constructor(options: RouterOptions = {}) {
    const mode = options.mode ?? "off";
    if (!["off", "laya", "jev", "cascade"].includes(mode))
      throw new Error("invalid decision mode");
    const minimum = options.minimumSamples ?? 100;
    if (!Number.isInteger(minimum) || minimum < 1)
      throw new Error("invalid minimum calibration samples");
    const timeout = options.timeout ?? 30.0;
    if (
      !boundedNumber(timeout, 0.01, 300) ||
      typeof (options.compare ?? false) !== "boolean"
    )
      throw new Error("invalid routing configuration");
    this.mode = mode;
    this.laya = options.laya ?? null;
    this.jev = options.jev ?? null;
    this.profiles = options.profiles ?? [];
    this.minimumSamples = minimum;
    this.timeout = timeout;
    this.compare = options.compare ?? false;
    this.env = options.env ?? {};
    this.now = options.now ?? (() => new Date());
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  async decide(
    request: DecisionRequest,
    validator: Validator,
  ): Promise<DecisionEnvelope> {
    const started = this.monotonic();
    const attempts: DecisionAttempt[] = [];
    const sensitive = containsSensitiveMaterial(JSON.stringify(request), this.env);
    const finish = (
      selected: string | null = null,
      destination: DecisionEnvelope["destination"] = "rain",
      reason: EscalationReason | null = null,
      valid = false,
    ): DecisionEnvelope => ({
      decisionId: this.uuid(),
      timestamp: this.now().toISOString(),
      requestHash: requestHash(request),
      questionHash: questionHash(request),
      decisionClass: sensitive ? "withheld" : request.decisionClass,
      choices: sensitive ? [] : request.choices.map(([key]) => key),
      selected,
      destination,
      reason,
      attempts: [...attempts],
      validatorResult: valid,
      latencyMs: Math.round((this.monotonic() - started) * 1000) / 1000,
    });

    if (sensitive) return finish(null, "rejected", "SENSITIVE_INPUT");
    if (!validate(validator, request, null))
      return finish(null, "rejected", "VALIDATION_FAILED");
    if (this.mode === "off") return finish(null, "rain", "DISABLED");
    const policy: [boolean, EscalationReason][] = [
      [request.consequence !== "low", "HIGH_CONSEQUENCE"],
      [request.requiresReview, "POLICY_REQUIRES_REVIEW"],
      [request.requiresEvidence, "EVIDENCE_REQUIRED"],
      [request.outOfDistribution, "OUT_OF_DISTRIBUTION"],
    ];
    for (const [condition, reason] of policy)
      if (condition) return finish(null, "rain", reason);
    if (request.deterministicChoice !== null) {
      if (validate(validator, request, request.deterministicChoice))
        return finish(request.deterministicChoice, "proposal", null, true);
      return finish(null, "rejected", "VALIDATION_FAILED");
    }
    let engines: [Engine, JudgmentProvider | null][] =
      this.mode === "laya" ? [["laya", this.laya]] : [["typesafe", this.jev]];
    if (this.mode === "cascade")
      engines = [
        ["laya", this.laya],
        ["typesafe", this.jev],
      ];
    let candidate: string | null = null;
    for (const [engine, provider] of engines) {
      const attempt =
        engine === "typesafe" && !request.remoteAllowed
          ? emptyAttempt(engine, "POLICY_REQUIRES_REVIEW", 0, null)
          : await this.attempt(engine, provider, request);
      attempts.push(attempt);
      // Explicit comparison preserves even an uncertain engine's differing
      // candidate. Never resolve disagreement by comparing confidence.
      const outputs = new Set(attempts.map((a) => a.selected).filter((s) => s !== null));
      if (this.compare && outputs.size > 1)
        return finish(null, "rain", "ENGINE_DISAGREEMENT");
      if (attempt.reason === null) {
        candidate = attempt.selected;
        if (!this.compare || this.mode !== "cascade") break;
      } else if (this.compare) candidate = null;
    }
    if (this.compare && attempts.some((a) => a.reason !== null)) candidate = null;
    if (candidate === null) {
      const reason =
        [...attempts].reverse().find((a) => a.reason !== null)?.reason ??
        "MODEL_UNAVAILABLE";
      return finish(null, "rain", reason);
    }
    if (!validate(validator, request, candidate))
      return finish(null, "rejected", "VALIDATION_FAILED");
    return finish(candidate, "proposal", null, true);
  }

  private async attempt(
    engine: Engine,
    provider: JudgmentProvider | null,
    request: DecisionRequest,
  ): Promise<DecisionAttempt> {
    const started = this.monotonic();
    let result: JudgmentResult | null = null;
    let reason: EscalationReason | null = null;
    if (provider === null) reason = "MODEL_UNAVAILABLE";
    else {
      const text = request.state;
      const state: JudgmentState = { canonicalText: text, stateHash: sha256(text) };
      if (this.busy[engine]) reason = "TIMEOUT";
      else {
        this.busy[engine] = true;
        const evaluation = provider
          .evaluate(state, questionsOf(request))
          .then(
            (r) => r,
            () => null,
          )
          .finally(() => {
            this.busy[engine] = false;
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), this.timeout * 1000);
        });
        const outcome = await Promise.race([evaluation, timedOut]);
        clearTimeout(timer);
        if (outcome === "timeout") reason = "TIMEOUT";
        else result = outcome;
      }
      if (reason === null) {
        try {
          if (result === null || typeof result !== "object") reason = "INVALID_OUTPUT";
          else if (result.errorCode)
            reason = PROVIDER_ERROR_REASONS[result.errorCode] ?? "MODEL_UNAVAILABLE";
          else if (
            result.provider !== engine ||
            typeof result.model !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(result.model) ||
            containsSensitiveMaterial(result.model, this.env) ||
            result.stateHash !== state.stateHash ||
            result.questionSetVersion !== QUESTION_SET_VERSION ||
            !validAnswers(result, questionsOf(request))
          )
            reason = "INVALID_OUTPUT";
        } catch {
          reason = "INVALID_OUTPUT";
        }
      }
    }
    const latency = Math.round((this.monotonic() - started) * 1000) / 1000;
    if (reason !== null) {
      let error = result?.errorCode ?? null;
      if (typeof error !== "string" || !SAFE_PROVIDER_ERRORS.has(error))
        error = reason === "TIMEOUT" ? "provider_timeout" : "provider_internal_error";
      if (provider === null) error = "provider_not_configured";
      return emptyAttempt(engine, reason, latency, error);
    }
    const answer = result!.answers[0]!;
    const profile =
      this.profiles.find(
        (p) =>
          p.engine === engine &&
          p.model === result!.model &&
          p.decision_class === request.decisionClass &&
          p.question_hash === questionHash(request),
      ) ?? null;
    if (profile === null || !profileSupports(profile, this.minimumSamples, this.now()))
      reason = "INSUFFICIENT_CALIBRATION";
    else {
      const probabilities = [...new Map(answer.probabilities).values()].sort(
        (a, b) => b - a,
      );
      if (probabilities[0]! < profile.threshold) reason = "LOW_CONFIDENCE";
      else if (probabilities[0]! - probabilities[1]! < profile.margin)
        reason = "MARGIN_TOO_SMALL";
    }
    return {
      engine,
      model: result!.model,
      selected: String(answer.value),
      probabilities: answer.probabilities.map(([k, v]) => [k, v]),
      confidence: answer.confidence,
      latencyMs: latency,
      reason,
      calibrationProfile: profile ? digestJson(profile) : null,
      threshold: profile ? profile.threshold : null,
      margin: profile ? profile.margin : null,
      errorCode: null,
    };
  }
}

const emptyAttempt = (
  engine: Engine,
  reason: EscalationReason,
  latencyMs: number,
  errorCode: string | null,
): DecisionAttempt => ({
  engine,
  model: null,
  selected: null,
  probabilities: [],
  confidence: null,
  latencyMs,
  reason,
  calibrationProfile: null,
  threshold: null,
  margin: null,
  errorCode,
});
