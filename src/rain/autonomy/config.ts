/**
 * The autonomous researcher's settings.
 *
 * Read from an environment handed in by value — `tools/rain-autonomous.mjs`
 * passes the shell's — so nothing here reads the process environment, and no
 * setting here is a credential: the loop talks to a model server on this
 * machine or its network and sends it no key. A malformed setting is refused
 * by name, never by value, and nothing is guessed: the model has no default,
 * because which model directs research is the operator's choice to state.
 *
 *   RAIN_AUTONOMY_ENABLED       true | false (default): a live session runs only when true
 *   RAIN_MODEL_PROVIDER         ollama (default) | lmstudio
 *   RAIN_MODEL                  the model exactly as the server lists it (no default)
 *   RAIN_OLLAMA_URL             default http://127.0.0.1:11434
 *   RAIN_LMSTUDIO_URL           default http://127.0.0.1:1234
 *   RAIN_MODEL_TIMEOUT_MS       per model answer, 5000–3600000 (default 120000)
 *   RAIN_MODEL_TEMPERATURE      0–2 (default 0.2)
 *   RAIN_MODEL_MAX_TOKENS       per answer, 128–8192 (default 1024)
 *   RAIN_MODEL_CONTEXT          Ollama's context window, 2048–131072 (default 8192)
 *   RAIN_MAX_ITERATIONS         1–100 (default 10)
 *   RAIN_MAX_EXPERIMENTS        1–100 (default 10)
 *   RAIN_MAX_RUNTIME_MS         10000–86400000 (default 1800000, 30 minutes)
 *   RAIN_MAX_FAILED_PROPOSALS   1–50 (default 3)
 *   RAIN_MAX_MODEL_CALLS        1–1000 (default 60)
 *   RAIN_MAX_MODEL_TOKENS       optional, 1000–100000000: unset, no token ceiling
 *   RAIN_AUTONOMY_CHARTER_HOURS how long an authorization of the charter stands, 1–168 (default 24)
 *   RAIN_AUTONOMY_DIR           the research state's directory (default .rain-research)
 *   RAIN_AUTONOMY_OPERATOR      the role label an authorization names (default R.A.I.N.Operator)
 *
 * The ceilings are written into the charter a person authorizes; a session may
 * run under lower budgets (`--iterations`), never higher ones.
 */
import { enabled, type Env } from "../judgment/config.js";
import { MODEL_ID } from "../protocol.js";
import { OPERATOR } from "../../bethesda/rain/contracts.js";
import type { Ceilings } from "../../bethesda/rain/standing.js";

export type { Env };
export const PROVIDER_KINDS = ["ollama", "lmstudio"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export const PROVIDERS: Record<
  ProviderKind,
  { label: string; setting: string; defaultUrl: string }
> = {
  ollama: {
    label: "Ollama",
    setting: "RAIN_OLLAMA_URL",
    defaultUrl: "http://127.0.0.1:11434",
  },
  lmstudio: {
    label: "LM Studio",
    setting: "RAIN_LMSTUDIO_URL",
    defaultUrl: "http://127.0.0.1:1234",
  },
};
export const CEILING_DEFAULTS: Ceilings = {
  iterations: 10,
  experiments: 10,
  runtime_ms: 1_800_000,
  failed_proposals: 3,
  model_calls: 60,
  model_tokens: null,
};
export const DEFAULT_DIR = ".rain-research";
export const DEFAULT_OPERATOR = "R.A.I.N.Operator";

export interface AutonomyConfig {
  enabled: boolean;
  provider: ProviderKind;
  /** Null when unset: a session refuses to start, and says which setting to give. */
  model: string | null;
  baseUrl: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  contextTokens: number;
  ceilings: Ceilings;
  charterHours: number;
  dir: string;
  operator: string;
}

const integer = (
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
};

/**
 * An endpoint as the adapters expect it: http(s), no credentials, no query,
 * no fragment, without a trailing slash or a trailing `/v1` (LM Studio's and
 * Ollama's OpenAI-compatible prefix, which the adapters add themselves).
 */
export function normalizeBaseUrl(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${name} must be an http:// or https:// URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} must be an http:// or https:// URL`);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${name} must not carry credentials, a query or a fragment`);
  return url.toString().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
}

/** The settings, or the reason they cannot be used — naming the setting, never its value. */
export function autonomyConfig(
  env: Env,
): { ok: true; config: AutonomyConfig } | { ok: false; reason: string } {
  try {
    const provider = (env.RAIN_MODEL_PROVIDER ?? "ollama").trim().toLowerCase();
    if (!(PROVIDER_KINDS as readonly string[]).includes(provider))
      throw new Error("RAIN_MODEL_PROVIDER must be ollama or lmstudio");
    const kind = provider as ProviderKind;
    const rawModel = (env.RAIN_MODEL ?? "").trim();
    if (rawModel && !MODEL_ID.test(rawModel))
      throw new Error(
        "RAIN_MODEL must be a model name as the server lists it (letters, digits, . _ / : -), never a URL",
      );
    if (rawModel.endsWith(":cloud"))
      throw new Error(
        "RAIN_MODEL names an Ollama ':cloud' model, which runs on a hosted service; the autonomous researcher runs local models only",
      );
    const { setting, defaultUrl } = PROVIDERS[kind];
    const baseUrl = normalizeBaseUrl(env[setting] || defaultUrl, setting);
    const temperatureRaw = (env.RAIN_MODEL_TEMPERATURE ?? "").trim();
    const temperature = temperatureRaw === "" ? 0.2 : Number(temperatureRaw);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
      throw new Error("RAIN_MODEL_TEMPERATURE must be a number from 0 to 2");
    const tokensRaw = (env.RAIN_MAX_MODEL_TOKENS ?? "").trim();
    const operator = (env.RAIN_AUTONOMY_OPERATOR ?? DEFAULT_OPERATOR).trim();
    if (!OPERATOR.test(operator))
      throw new Error(
        "RAIN_AUTONOMY_OPERATOR must be a role label (letters, digits, . _ -), not a name",
      );
    const dir = (env.RAIN_AUTONOMY_DIR ?? "").trim() || DEFAULT_DIR;
    return {
      ok: true,
      config: {
        enabled: enabled(env, "RAIN_AUTONOMY_ENABLED"),
        provider: kind,
        model: rawModel || null,
        baseUrl,
        timeoutMs: integer(env, "RAIN_MODEL_TIMEOUT_MS", 120_000, 5_000, 3_600_000),
        temperature,
        maxTokens: integer(env, "RAIN_MODEL_MAX_TOKENS", 1024, 128, 8192),
        contextTokens: integer(env, "RAIN_MODEL_CONTEXT", 8192, 2048, 131_072),
        ceilings: {
          iterations: integer(
            env,
            "RAIN_MAX_ITERATIONS",
            CEILING_DEFAULTS.iterations,
            1,
            100,
          ),
          experiments: integer(
            env,
            "RAIN_MAX_EXPERIMENTS",
            CEILING_DEFAULTS.experiments,
            1,
            100,
          ),
          runtime_ms: integer(
            env,
            "RAIN_MAX_RUNTIME_MS",
            CEILING_DEFAULTS.runtime_ms,
            10_000,
            86_400_000,
          ),
          failed_proposals: integer(
            env,
            "RAIN_MAX_FAILED_PROPOSALS",
            CEILING_DEFAULTS.failed_proposals,
            1,
            50,
          ),
          model_calls: integer(
            env,
            "RAIN_MAX_MODEL_CALLS",
            CEILING_DEFAULTS.model_calls,
            1,
            1000,
          ),
          model_tokens:
            tokensRaw === ""
              ? null
              : integer(env, "RAIN_MAX_MODEL_TOKENS", 0, 1000, 100_000_000),
        },
        charterHours: integer(env, "RAIN_AUTONOMY_CHARTER_HOURS", 24, 1, 168),
        dir,
        operator,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "the settings could not be read",
    };
  }
}
