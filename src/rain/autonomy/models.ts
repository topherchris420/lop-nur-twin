/**
 * Local open models, behind one interface: Ollama and LM Studio.
 *
 * The rest of the autonomous researcher sees a `LocalModel` — a name, an
 * endpoint, `listModels()` and `complete()` — and never which server answers.
 * Each adapter asks for schema-constrained JSON in its server's own way:
 *
 *   Ollama     POST /api/chat with `format: <JSON schema>` (structured outputs),
 *              `stream: false`, temperature, `num_predict` and `num_ctx`;
 *              GET /api/tags lists the models.
 *   LM Studio  POST /v1/chat/completions with
 *              `response_format: {type: "json_schema", json_schema: {…, strict: true}}`;
 *              GET /v1/models lists them.
 *
 * Every failure is typed (`ModelFailure`): the server did not answer, timed
 * out, refused, or returned something that is not a completion. A connection
 * that fails before any answer arrives is tried once more — between the
 * researcher's question and the analyst's, an experiment and its replay run,
 * which outlasts many servers' idle keep-alive, and a request sent on the
 * socket they closed fails without reaching them. Nothing else is retried, and nothing is
 * repaired here; whether a completion's JSON is an acceptable action is the
 * host's question (`actions.ts`). A model's words come back as text through
 * one HTTP request (`nodeTransport`) and nothing else: no tool call, URL or
 * command in them is followed. Token counts are reported only when the server
 * reports them, and null otherwise, never estimated.
 *
 * Server only.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { ProviderKind } from "./config.js";

export type ModelFailureCode =
  "unavailable" | "timeout" | "http" | "malformed" | "cancelled";
export class ModelFailure extends Error {
  readonly code: ModelFailureCode;
  constructor(code: ModelFailureCode, message: string) {
    super(message);
    this.name = "ModelFailure";
    this.code = code;
  }
}

export interface ModelSettings {
  provider: ProviderKind;
  model: string;
  /** Without a trailing `/v1` (`normalizeBaseUrl`). */
  baseUrl: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  /** Ollama's `num_ctx`. LM Studio sets the context when the model is loaded. */
  contextTokens: number;
}
export interface StructuredRequest {
  system: string;
  user: string;
  /** A name for the schema, as LM Studio's `json_schema.name` takes it. */
  schemaName: string;
  schema: Record<string, unknown>;
}
export interface ModelAnswer {
  text: string;
  /** The model the server says answered; null when it says nothing. */
  reportedModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  finishReason: string | null;
}
export interface CallOptions {
  signal?: AbortSignal;
}
export interface LocalModel {
  /** Test doubles explicitly identify scripted output; real adapters default to model. */
  readonly generation?: "model" | "scripted";
  readonly provider: ProviderKind;
  readonly model: string;
  readonly endpoint: string;
  listModels(options?: CallOptions): Promise<string[]>;
  complete(request: StructuredRequest, options?: CallOptions): Promise<ModelAnswer>;
}
export interface ModelHooks {
  /** Replaces `nodeTransport`; tests answer through it without a server. */
  fetchImpl?: typeof fetch;
  monotonic?: () => number;
}

/** The largest answer read from a model server, in characters. */
export const MAX_RESPONSE = 512 * 1024;
/** The pause before the one retry of a connection that failed before any answer. */
export const RETRY_MS = 250;

export interface TransportInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string | undefined;
  signal: AbortSignal;
  /** For an injected `fetch`; `nodeTransport` never follows a redirect. */
  redirect: "error";
}

/**
 * The adapters' HTTP client: one request, whose only limit is the caller's
 * signal. Node's global `fetch` stops waiting for a response's headers after
 * 300 s of its own, and a non-streaming completion sends none until the model
 * has finished, so on a slow machine it ended calls the deadline had not —
 * `RAIN_MODEL_TIMEOUT_MS` above five minutes did nothing, and the cut-off was
 * reported as a server that never answered. `node:http` sets no such limit,
 * which leaves the deadline the only one. A redirect is not followed: it is an
 * answer, and not a completion.
 */
export function nodeTransport(url: string, init: TransportInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const headers = { ...init.headers };
    if (init.body !== undefined)
      headers["Content-Length"] = String(Buffer.byteLength(init.body));
    const req = send(
      target,
      { method: init.method, headers, signal: init.signal, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        // A failure mid-body reaches the caller through the web stream; this
        // only keeps an unheard "error" event from ending the process.
        res.on("error", () => undefined);
        const abort = () => res.destroy(new Error("aborted"));
        init.signal.addEventListener("abort", abort, { once: true });
        res.once("close", () => init.signal.removeEventListener("abort", abort));
        try {
          const empty = status === 204 || status === 205 || status === 304;
          if (empty) res.resume();
          const fields = new Headers();
          for (const [name, value] of Object.entries(res.headers))
            if (value !== undefined)
              fields.set(name, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), {
              status,
              headers: fields,
            }),
          );
        } catch (error) {
          res.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function call(
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
  settings: Pick<ModelSettings, "timeoutMs">,
  hooks: ModelHooks,
  options: CallOptions,
): Promise<unknown> {
  const send = hooks.fetchImpl ?? nodeTransport;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    let response: Response | null = null;
    for (let attempt = 0; !response; attempt++) {
      if (options.signal?.aborted)
        throw new ModelFailure("cancelled", "the call was cancelled");
      try {
        response = await send(url, {
          method: init.method,
          headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
          redirect: "error",
        });
      } catch {
        if (options.signal?.aborted)
          throw new ModelFailure("cancelled", "the call was cancelled");
        if (controller.signal.aborted)
          throw new ModelFailure(
            "timeout",
            `no answer within ${Math.round(settings.timeoutMs / 1000)} s`,
          );
        if (attempt >= 1)
          throw new ModelFailure(
            "unavailable",
            `nothing answered at ${new URL(url).origin}`,
          );
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelFailure("http", `the model server answered HTTP ${response.status}`);
    }
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw controller.signal.aborted
        ? new ModelFailure(
            "timeout",
            `no answer within ${Math.round(settings.timeoutMs / 1000)} s`,
          )
        : new ModelFailure("malformed", "the answer could not be read");
    }
    if (body.length > MAX_RESPONSE)
      throw new ModelFailure(
        "malformed",
        `the answer exceeds ${MAX_RESPONSE} characters`,
      );
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new ModelFailure("malformed", "the answer is not JSON");
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

const messages = (r: StructuredRequest) => [
  { role: "system", content: r.system },
  { role: "user", content: r.user },
];

class OllamaModel implements LocalModel {
  readonly provider = "ollama" as const;
  readonly model: string;
  readonly endpoint: string;
  private readonly settings: ModelSettings;
  private readonly hooks: ModelHooks;
  constructor(settings: ModelSettings, hooks: ModelHooks) {
    this.settings = settings;
    this.hooks = hooks;
    this.model = settings.model;
    this.endpoint = settings.baseUrl;
  }
  async listModels(options: CallOptions = {}): Promise<string[]> {
    const payload = (await call(
      `${this.endpoint}/api/tags`,
      { method: "GET" },
      this.settings,
      this.hooks,
      options,
    )) as { models?: unknown };
    if (!Array.isArray(payload?.models))
      throw new ModelFailure("malformed", "/api/tags did not list models");
    return payload.models
      .map((m) => text((m as { name?: unknown })?.name))
      .filter((m): m is string => m !== null);
  }
  async complete(r: StructuredRequest, options: CallOptions = {}): Promise<ModelAnswer> {
    const monotonic = this.hooks.monotonic ?? (() => performance.now());
    const started = monotonic();
    const payload = (await call(
      `${this.endpoint}/api/chat`,
      {
        method: "POST",
        body: {
          model: this.model,
          messages: messages(r),
          stream: false,
          format: r.schema,
          options: {
            temperature: this.settings.temperature,
            num_predict: this.settings.maxTokens,
            num_ctx: this.settings.contextTokens,
          },
        },
      },
      this.settings,
      this.hooks,
      options,
    )) as {
      model?: unknown;
      message?: { content?: unknown };
      done_reason?: unknown;
      prompt_eval_count?: unknown;
      eval_count?: unknown;
    };
    const content = text(payload?.message?.content);
    if (content === null)
      throw new ModelFailure("malformed", "/api/chat returned no message");
    return {
      text: content,
      reportedModel: text(payload.model),
      promptTokens: count(payload.prompt_eval_count),
      completionTokens: count(payload.eval_count),
      latencyMs: Math.round(monotonic() - started),
      finishReason: text(payload.done_reason),
    };
  }
}

class LmStudioModel implements LocalModel {
  readonly provider = "lmstudio" as const;
  readonly model: string;
  readonly endpoint: string;
  private readonly settings: ModelSettings;
  private readonly hooks: ModelHooks;
  constructor(settings: ModelSettings, hooks: ModelHooks) {
    this.settings = settings;
    this.hooks = hooks;
    this.model = settings.model;
    this.endpoint = settings.baseUrl;
  }
  async listModels(options: CallOptions = {}): Promise<string[]> {
    const payload = (await call(
      `${this.endpoint}/v1/models`,
      { method: "GET" },
      this.settings,
      this.hooks,
      options,
    )) as { data?: unknown };
    if (!Array.isArray(payload?.data))
      throw new ModelFailure("malformed", "/v1/models did not list models");
    return payload.data
      .map((m) => text((m as { id?: unknown })?.id))
      .filter((m): m is string => m !== null);
  }
  async complete(r: StructuredRequest, options: CallOptions = {}): Promise<ModelAnswer> {
    const monotonic = this.hooks.monotonic ?? (() => performance.now());
    const started = monotonic();
    const payload = (await call(
      `${this.endpoint}/v1/chat/completions`,
      {
        method: "POST",
        body: {
          model: this.model,
          messages: messages(r),
          temperature: this.settings.temperature,
          max_tokens: this.settings.maxTokens,
          stream: false,
          response_format: {
            type: "json_schema",
            json_schema: { name: r.schemaName, strict: true, schema: r.schema },
          },
        },
      },
      this.settings,
      this.hooks,
      options,
    )) as {
      model?: unknown;
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const content = text(choice?.message?.content);
    if (content === null)
      throw new ModelFailure("malformed", "/v1/chat/completions returned no message");
    return {
      text: content,
      reportedModel: text(payload.model),
      promptTokens: count(payload.usage?.prompt_tokens),
      completionTokens: count(payload.usage?.completion_tokens),
      latencyMs: Math.round(monotonic() - started),
      finishReason: text(choice?.finish_reason),
    };
  }
}

/** The adapter for the configured provider. The caller never branches on which. */
export function createLocalModel(
  settings: ModelSettings,
  hooks: ModelHooks = {},
): LocalModel {
  return settings.provider === "ollama"
    ? new OllamaModel(settings, hooks)
    : new LmStudioModel(settings, hooks);
}

/**
 * Whether a server's list holds the configured model. Exact, except that
 * Ollama names an untagged model `name:latest`.
 */
export function listsModel(listed: readonly string[], model: LocalModel): boolean {
  if (listed.includes(model.model)) return true;
  if (model.provider !== "ollama") return false;
  return listed.some(
    (name) => name === `${model.model}:latest` || `${name}:latest` === model.model,
  );
}

/**
 * The JSON object a structured answer holds. A schema-constrained server
 * returns the object alone; one fenced block (```json … ```) is unwrapped,
 * and nothing else is repaired.
 */
export function parseStructured(
  answer: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let t = answer.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fenced) t = fenced[1]!.trim();
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    return { ok: false, error: "the answer is not one JSON object" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "the answer is not one JSON object" };
  return { ok: true, value: value as Record<string, unknown> };
}
