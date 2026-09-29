import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateCost,
  findPrice,
  parsePricing,
  PRICING_SCHEMA,
  type PricingConfig,
} from "./pricing";

const ROOT = join(__dirname, "..", "..", "..");

const config = (models: unknown[]): unknown => ({
  schema: PRICING_SCHEMA,
  currency: "USD",
  models,
});

describe("pricing configuration", () => {
  it("accepts the committed config, which prices nothing", () => {
    const parsed = parsePricing(
      JSON.parse(readFileSync(join(ROOT, "config/pricing.json"), "utf8")),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const entry of parsed.value.models) {
      expect([entry.inputPerMTok, entry.outputPerMTok, entry.perRequest]).toEqual([
        null,
        null,
        null,
      ]);
    }
  });

  it("refuses a price without a source and a date", () => {
    const parsed = parsePricing(
      config([{ provider: "anthropic", model: "x", inputPerMTok: 1, outputPerMTok: 2 }]),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toMatch(/needs a source/);
    expect(parsed.errors.join(" ")).toMatch(/needs asOf/);
  });

  it("refuses negative and non-numeric prices", () => {
    const parsed = parsePricing(
      config([
        {
          provider: "a",
          model: "b",
          inputPerMTok: -1,
          outputPerMTok: "cheap",
          source: "s",
          asOf: "2026-01-01",
        },
      ]),
    );
    expect(parsed.ok).toBe(false);
  });

  it("prefers an exact match, then the longest prefix", () => {
    const parsed = parsePricing(
      config([
        {
          provider: "p",
          model: "m-",
          match: "prefix",
          perRequest: 1,
          source: "s",
          asOf: "2026-01-01",
        },
        {
          provider: "p",
          model: "m-1",
          match: "prefix",
          perRequest: 2,
          source: "s",
          asOf: "2026-01-01",
        },
        {
          provider: "p",
          model: "m-1.5",
          match: "exact",
          perRequest: 3,
          source: "s",
          asOf: "2026-01-01",
        },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findPrice(parsed.value, "p", "m-1.5")!.perRequest).toBe(3);
    expect(findPrice(parsed.value, "p", "m-1.4")!.perRequest).toBe(2);
    expect(findPrice(parsed.value, "p", "m-2")!.perRequest).toBe(1);
    expect(findPrice(parsed.value, "q", "m-2")).toBeNull();
  });
});

describe("cost estimates", () => {
  const priced: PricingConfig = {
    schema: PRICING_SCHEMA,
    currency: "USD",
    models: [
      {
        provider: "p",
        model: "tok",
        match: "exact",
        inputPerMTok: 2,
        outputPerMTok: 10,
        perRequest: null,
        source: "test fixture",
        asOf: "2026-01-01",
      },
    ],
  };
  const call = {
    provider: "p",
    model: "tok",
    inputTokens: 1000,
    outputTokens: 100,
    reportedCostUsd: null,
  };

  it("multiplies tokens by the configured price", () => {
    expect(estimateCost(priced, call).usd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 12);
  });

  it("is unknown, not zero, when tokens are missing", () => {
    expect(estimateCost(priced, { ...call, outputTokens: null }).usd).toBeNull();
  });

  it("is unknown, not zero, for an unpriced model or no config", () => {
    expect(estimateCost(priced, { ...call, model: "other" }).usd).toBeNull();
    expect(estimateCost(null, call).usd).toBeNull();
  });

  it("is zero only for local inference", () => {
    expect(estimateCost(null, { ...call, provider: "local" })).toEqual({
      usd: 0,
      basis: "local inference",
    });
  });

  it("uses a provider-reported cost over any estimate", () => {
    expect(estimateCost(priced, { ...call, reportedCostUsd: 0.5 }).usd).toBe(0.5);
  });
});

describe("prices live in one place", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.test\.ts$/.test(entry))
        out.push(path);
    }
    return out;
  }
  it("no source file outside pricing.ts states a per-token or per-request price", () => {
    const files = [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "server")),
      ...walk(join(ROOT, "tools")),
    ];
    const offenders = files
      .filter((path) => !path.endsWith(join("eval", "pricing.ts")))
      .filter((path) =>
        /\$\s?\d+(\.\d+)?\s*(per|\/)\s*(m(illion)?\s*)?(tok|request|call)/i.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
