/**
 * Model prices: configuration, not constants.
 *
 * Prices change, differ by account and are sometimes not published at all, so
 * this project ships none it cannot source. The evaluation reads
 * `config/pricing.json` (or `--pricing <file>`), in the format below; every
 * entry with a price must name where the price came from and when. A model with
 * no entry, or an entry whose price is null, has an *unknown* cost, which
 * prints as "n/a" — never as $0. Local brains (random, scripted, replay) are
 * genuinely free and are the only thing that prints $0.
 *
 * Nothing else in the repository may hold a price. `pricing.test.ts` scans for
 * dollar figures near the words "token" and "price" outside this file and the
 * config.
 */

export const PRICING_SCHEMA = "blacksite-pricing/v1";

export interface PriceEntry {
  provider: string;
  /** Exact model id, or a prefix when `match` is "prefix" (e.g. `jev-`). */
  model: string;
  match: "exact" | "prefix";
  /** US dollars per million input / output tokens; null when unknown. */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  /** US dollars per request, for providers that bill per call; null when unknown or not applicable. */
  perRequest: number | null;
  /** Where the figures came from: a URL, an invoice, a contract. Required with any price. */
  source: string | null;
  /** The date the source was read, YYYY-MM-DD. Required with any price. */
  asOf: string | null;
}

export interface PricingConfig {
  schema: typeof PRICING_SCHEMA;
  currency: "USD";
  models: PriceEntry[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function price(value: unknown, path: string, errors: string[]): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${path}: must be a non-negative number or null`);
    return null;
  }
  return value;
}

export function parsePricing(value: unknown): Parsed<PricingConfig> {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["pricing: expected an object"] };
  }
  const raw = value as Record<string, unknown>;
  if (raw["schema"] !== PRICING_SCHEMA) errors.push(`schema: expected ${PRICING_SCHEMA}`);
  if (raw["currency"] !== "USD") errors.push("currency: only USD is supported");
  const list = raw["models"];
  if (!Array.isArray(list)) {
    errors.push("models: expected an array");
    return { ok: false, errors };
  }
  const models: PriceEntry[] = [];
  list.forEach((entry, i) => {
    const path = `models[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${path}: expected an object`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const provider = e["provider"];
    const model = e["model"];
    const match = e["match"] ?? "exact";
    if (typeof provider !== "string" || provider.length === 0)
      errors.push(`${path}.provider: required`);
    // An empty prefix matches any model of the provider; an exact id cannot be empty.
    if (typeof model !== "string" || (model.length === 0 && match !== "prefix"))
      errors.push(`${path}.model: required`);
    if (match !== "exact" && match !== "prefix")
      errors.push(`${path}.match: exact or prefix`);
    const inputPerMTok = price(e["inputPerMTok"], `${path}.inputPerMTok`, errors);
    const outputPerMTok = price(e["outputPerMTok"], `${path}.outputPerMTok`, errors);
    const perRequest = price(e["perRequest"], `${path}.perRequest`, errors);
    const source = typeof e["source"] === "string" && e["source"] ? e["source"] : null;
    const asOf = typeof e["asOf"] === "string" && e["asOf"] ? e["asOf"] : null;
    const priced = inputPerMTok !== null || outputPerMTok !== null || perRequest !== null;
    if (priced && source === null) errors.push(`${path}: a price needs a source`);
    if (priced && (asOf === null || !DATE.test(asOf)))
      errors.push(`${path}: a price needs asOf as YYYY-MM-DD`);
    models.push({
      provider: String(provider),
      model: String(model),
      match: match === "prefix" ? "prefix" : "exact",
      inputPerMTok,
      outputPerMTok,
      perRequest,
      source,
      asOf,
    });
  });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { schema: PRICING_SCHEMA, currency: "USD", models } };
}

/** Exact matches win over prefixes; the longest prefix wins among prefixes. */
export function findPrice(
  config: PricingConfig,
  provider: string,
  model: string | null,
): PriceEntry | null {
  if (model === null) return null;
  const candidates = config.models.filter((e) => e.provider === provider);
  const exact = candidates.find((e) => e.match === "exact" && e.model === model);
  if (exact) return exact;
  return (
    candidates
      .filter((e) => e.match === "prefix" && model.startsWith(e.model))
      .sort((a, b) => b.model.length - a.model.length)[0] ?? null
  );
}

export interface CostEstimate {
  usd: number | null;
  /** How the figure was obtained, or why there is none. */
  basis: string;
}

/** Providers whose inference runs in the page and costs nothing. */
export const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["local"]);

/**
 * Estimated cost of one call. Null unless every component it needs is known:
 * token prices need both token counts; a per-request price needs nothing else.
 */
export function estimateCost(
  config: PricingConfig | null,
  call: {
    provider: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    reportedCostUsd: number | null;
  },
): CostEstimate {
  if (call.reportedCostUsd !== null) {
    return { usd: call.reportedCostUsd, basis: "reported by the provider" };
  }
  if (LOCAL_PROVIDERS.has(call.provider)) return { usd: 0, basis: "local inference" };
  if (!config) return { usd: null, basis: "no pricing configuration loaded" };
  const entry = findPrice(config, call.provider, call.model);
  if (!entry) {
    return {
      usd: null,
      basis: `no price configured for ${call.provider}/${call.model ?? "?"}`,
    };
  }
  let usd = 0;
  let used = false;
  if (entry.perRequest !== null) {
    usd += entry.perRequest;
    used = true;
  }
  if (entry.inputPerMTok !== null || entry.outputPerMTok !== null) {
    if (
      entry.inputPerMTok === null ||
      entry.outputPerMTok === null ||
      call.inputTokens === null ||
      call.outputTokens === null
    ) {
      return { usd: null, basis: "token price or token counts unknown" };
    }
    usd +=
      (call.inputTokens * entry.inputPerMTok + call.outputTokens * entry.outputPerMTok) /
      1e6;
    used = true;
  }
  if (!used)
    return { usd: null, basis: `price for ${entry.model} is not configured (null)` };
  return { usd, basis: `config: ${entry.source} (${entry.asOf})` };
}
