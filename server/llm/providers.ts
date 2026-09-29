import Anthropic from "@anthropic-ai/sdk";
import type { LlmProviderName } from "../../src/game/pilot/llmDecision.js";
import type { LlmPrompt } from "./prompt.js";

/**
 * Provider adapters: one call, one answer, one typed failure.
 *
 * An adapter turns an `LlmPrompt` into a provider request and the provider's
 * reply into text plus accounting. It never retries (the handler does, and
 * counts), never interprets the answer (the handler validates it against the
 * offered options) and never sees the observation. Adding a provider means
 * adding an adapter here; nothing in the game changes.
 *
 * Claude goes through `anthropic`, which uses the official SDK. The
 * `openai-compatible` adapter speaks the Chat Completions shape that many
 * providers and local servers accept; it is for those, not for Claude.
 */

export interface AdapterCall {
  prompt: LlmPrompt;
  model: string;
  maxTokens: number;
  signal: AbortSignal;
}

export type AdapterFailureKind =
  "timeout" | "rate_limited" | "auth" | "refused" | "upstream_error" | "network";

export type AdapterResult =
  | {
      ok: true;
      text: string;
      /** The model the provider says answered — which can differ from the one asked. */
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      traceId: string | null;
    }
  | {
      ok: false;
      kind: AdapterFailureKind;
      status: number | null;
      retryAfterMs: number | null;
      /** Safe to log: never the provider's body, never the key. */
      detail: string;
    };

export interface LlmAdapter {
  readonly provider: LlmProviderName;
  call(call: AdapterCall): Promise<AdapterResult>;
}

const intOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

function retryAfter(headers: Headers | undefined | null): number | null {
  const value = headers?.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(60_000, Math.round(seconds * 1000))
    : null;
}

export interface AnthropicOptions {
  apiKey: string;
  /** `output_config.effort`, when the operator sets one; the model's default otherwise. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  fetchImpl?: typeof fetch;
  baseURL?: string;
}

/**
 * Claude through the Messages API. Structured output constrains the reply to
 * the answer schema. Server-side refusal fallbacks are deliberately not
 * enabled: in an evaluation a different model silently answering some of an
 * arm's decisions is a confound, so a refusal is recorded as a refusal.
 */
export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // The handler owns retries so it can count them; the SDK's would be invisible.
      maxRetries: 0,
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async call({ prompt, model, maxTokens, signal }: AdapterCall): Promise<AdapterResult> {
    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          output_config: {
            format: { type: "json_schema", schema: prompt.schema },
            ...(this.options.effort ? { effort: this.options.effort } : {}),
          },
        },
        { signal },
      );
      if (response.stop_reason === "refusal") {
        return {
          ok: false,
          kind: "refused",
          status: 200,
          retryAfterMs: null,
          detail: `refusal${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`,
        };
      }
      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      return {
        ok: true,
        text,
        model: response.model,
        inputTokens: intOrNull(response.usage.input_tokens),
        outputTokens: intOrNull(response.usage.output_tokens),
        traceId: response.id,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError || signal.aborted) {
        return {
          ok: false,
          kind: "timeout",
          status: null,
          retryAfterMs: null,
          detail: "aborted at the deadline",
        };
      }
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      ) {
        return {
          ok: false,
          kind: "auth",
          status: error.status ?? null,
          retryAfterMs: null,
          detail: "credentials rejected",
        };
      }
      if (error instanceof Anthropic.RateLimitError) {
        return {
          ok: false,
          kind: "rate_limited",
          status: 429,
          retryAfterMs: retryAfter(error.headers),
          detail: "rate limited",
        };
      }
      if (error instanceof Anthropic.APIConnectionError) {
        return {
          ok: false,
          kind: "network",
          status: null,
          retryAfterMs: null,
          detail: "connection failed",
        };
      }
      if (error instanceof Anthropic.APIError) {
        const status = typeof error.status === "number" ? error.status : null;
        // 529 is the API's "overloaded": transient, like a rate limit.
        return {
          ok: false,
          kind: status === 529 ? "rate_limited" : "upstream_error",
          status,
          retryAfterMs: retryAfter(error.headers),
          detail: `HTTP ${status ?? "?"}`,
        };
      }
      return {
        ok: false,
        kind: "upstream_error",
        status: null,
        retryAfterMs: null,
        detail: "unexpected error",
      };
    }
  }
}

export interface OpenAiCompatibleOptions {
  apiKey: string;
  /** e.g. `https://api.example.com/v1`; `http://` only for localhost. */
  baseUrl: string;
  /** How the reply is constrained: a JSON schema, JSON mode, or not at all. */
  responseFormat: "json_schema" | "json_object" | "none";
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly provider = "openai-compatible" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call({ prompt, model, maxTokens, signal }: AdapterCall): Promise<AdapterResult> {
    const format =
      this.options.responseFormat === "json_schema"
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "blacksite_decision",
                schema: prompt.schema,
                strict: true,
              },
            },
          }
        : this.options.responseFormat === "json_object"
          ? { response_format: { type: "json_object" } }
          : {};
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            ...format,
          }),
          signal,
        },
      );
    } catch {
      return signal.aborted
        ? {
            ok: false,
            kind: "timeout",
            status: null,
            retryAfterMs: null,
            detail: "aborted at the deadline",
          }
        : {
            ok: false,
            kind: "network",
            status: null,
            retryAfterMs: null,
            detail: "connection failed",
          };
    }
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      return {
        ok: false,
        kind:
          status === 401 || status === 403
            ? "auth"
            : status === 429 || status === 529 || status === 503
              ? "rate_limited"
              : "upstream_error",
        status,
        retryAfterMs: retryAfter(response.headers),
        detail: `HTTP ${status}`,
      };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        kind: "upstream_error",
        status: response.status,
        retryAfterMs: null,
        detail: "reply is not JSON",
      };
    }
    const reply = body as {
      id?: unknown;
      model?: unknown;
      choices?: {
        message?: { content?: unknown; refusal?: unknown };
        finish_reason?: unknown;
      }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const choice = reply.choices?.[0];
    if (
      (typeof choice?.message?.refusal === "string" &&
        choice.message.refusal.length > 0) ||
      choice?.finish_reason === "content_filter"
    ) {
      return {
        ok: false,
        kind: "refused",
        status: 200,
        retryAfterMs: null,
        detail: "refusal",
      };
    }
    return {
      ok: true,
      text: typeof choice?.message?.content === "string" ? choice.message.content : "",
      model: typeof reply.model === "string" ? reply.model : model,
      inputTokens: intOrNull(reply.usage?.prompt_tokens),
      outputTokens: intOrNull(reply.usage?.completion_tokens),
      traceId: typeof reply.id === "string" ? reply.id.slice(0, 128) : null,
    };
  }
}
