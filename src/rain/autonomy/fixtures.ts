/**
 * A scripted `LocalModel` for the autonomy tests. Test support only; nothing
 * in the runtime imports this module.
 *
 * It is not a model and reasons about nothing: each answer is a fixed
 * function of the prompt the host wrote — usually the first design the prompt
 * lists as NOT RUN — and its words say they are scripted. It reports token
 * counts only when told to, so the loop's "unknown stays unknown" path is
 * testable too.
 */
import type { ProviderKind } from "./config.js";
import {
  ModelFailure,
  type CallOptions,
  type LocalModel,
  type ModelAnswer,
  type StructuredRequest,
} from "./models.js";

export type Answer = Record<string, unknown> | string | ModelFailure;
export type Script = (prompt: string, call: number) => Answer;

/** The first design the researcher's prompt lists as NOT RUN, or null. */
export function firstOpenDesign(prompt: string): string | null {
  return (
    /^- (X\d+-(?:increase|decrease)-(?:primary|replication)) · NOT RUN$/m.exec(
      prompt,
    )?.[1] ?? null
  );
}
export const proposal = (
  design: string,
  ranking: string[] = [],
): Record<string, unknown> => ({
  action: "propose_experiment",
  design,
  experiment: "",
  question: `[scripted] What does ${design} measure?`,
  hypothesis: `[scripted] ${design} moves its metric the way its id says.`,
  competing_hypothesis: `[scripted] ${design} moves it the other way, or not at all.`,
  rationale: "[scripted] The first design the Lab lists as not run.",
  ranking,
  stop_reason: "",
});
export const stop = (reason: string): Record<string, unknown> => ({
  ...proposal(""),
  action: "stop",
  design: "",
  question: "",
  hypothesis: "",
  competing_hypothesis: "",
  rationale: "",
  stop_reason: reason,
});
export const inspectDesign = (design: string): Record<string, unknown> => ({
  ...stop(""),
  action: "inspect_design",
  design,
  stop_reason: "",
});
/** Propose the first open design. */
export const firstOpen: Script = (prompt) => {
  const design = firstOpenDesign(prompt);
  return design ? proposal(design) : stop("[scripted] nothing is listed as not run");
};
/** Read the verdict line and answer the reading it implies — or always `reading`. */
export function analyst(reading?: "supports" | "contradicts" | "inconclusive"): Script {
  return (prompt) => {
    const verdict = /^VERDICT \(the registry's pre-registered criteria\): (.+)$/m.exec(
      prompt,
    )?.[1];
    return {
      action: "record_analysis",
      reading:
        reading ??
        (verdict === "supported"
          ? "supports"
          : verdict === "not supported"
            ? "contradicts"
            : "inconclusive"),
      interpretation: `[scripted] The verdict line reads "${verdict}".`,
      caveats: ["[scripted] three seeds are descriptive only"],
      open_questions: ["[scripted] does the replication panel agree?"],
    };
  };
}

export class ScriptedModel implements LocalModel {
  readonly provider: ProviderKind;
  readonly model: string;
  readonly endpoint: string;
  readonly requests: StructuredRequest[] = [];
  listed: string[] | ModelFailure;
  tokens: boolean;
  private readonly researcher: Script;
  private readonly analyst: Script;
  private researcherCalls = 0;
  private analystCalls = 0;
  constructor(input: {
    researcher: Script;
    analyst?: Script;
    provider?: ProviderKind;
    model?: string;
    listed?: string[] | ModelFailure;
    tokens?: boolean;
  }) {
    this.provider = input.provider ?? "ollama";
    this.model = input.model ?? "scripted-model";
    this.endpoint =
      this.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234";
    this.researcher = input.researcher;
    this.analyst = input.analyst ?? analyst();
    this.listed = input.listed ?? [this.model];
    this.tokens = input.tokens ?? true;
  }
  async listModels(_options?: CallOptions): Promise<string[]> {
    if (this.listed instanceof ModelFailure) throw this.listed;
    return [...this.listed];
  }
  async complete(r: StructuredRequest, _options?: CallOptions): Promise<ModelAnswer> {
    this.requests.push(r);
    const answer =
      r.schemaName === "rain_analysis"
        ? this.analyst(r.user, ++this.analystCalls)
        : this.researcher(r.user, ++this.researcherCalls);
    if (answer instanceof ModelFailure) throw answer;
    const text = typeof answer === "string" ? answer : JSON.stringify(answer);
    return {
      text,
      reportedModel: this.model,
      promptTokens: this.tokens ? Math.ceil((r.system.length + r.user.length) / 4) : null,
      completionTokens: this.tokens ? Math.ceil(text.length / 4) : null,
      latencyMs: 1,
      finishReason: "stop",
    };
  }
}
