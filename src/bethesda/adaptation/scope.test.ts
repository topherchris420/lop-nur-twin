/**
 * What the adaptation suite may depend on, and what it deliberately leaves
 * out. A benchmark that quietly imports an unrelated feature stops measuring
 * what it says it measures, so the boundary is checked, not described.
 *
 * Deferred, not deleted: everything below the allowlist still exists and still
 * has its own tests. It is simply outside what these benchmarks are about.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SUITE = "src/bethesda/adaptation";
const SCRIPT = "scripts/echo-adaptation-evaluate.ts";

/** Imports the suite's modules may use: the yard, the organism, continuity, and the witnesses. */
const ALLOWED: readonly RegExp[] = [
  /^\.\/[A-Za-z]+(\.js)?$/,
  /^\.\.\/life\/(individuality|individualityReport|continuity|snapshot|organism|echoUpgrade|ledger|observation)(\.js)?$/,
  /^\.\.\/fly\/(fly|navigation|neural|units|world)(\.js)?$/,
  /^\.\.\/simulation(\.js)?$/,
  /^\.\.\/live\/publicRecord(\.js)?$/,
  /^\.\.\/firstContact\/clock(\.js)?$/,
  /^\.\.\/\.\.\/garden\/core\/observation(\.js)?$/,
  /^\.\.\/\.\.\/lib\/noise(\.js)?$/,
  /^\.\.\/\.\.\/rain\/sha256(\.js)?$/,
  /^node:/,
];

/** Deferred features, each with why it is not part of these benchmarks. */
const DEFERRED: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /life\/acquired/,
    why: "acquired search is not deployed, and has its own sealed study",
  },
  {
    pattern: /life\/(foraging|immortal)\//,
    why: "the organism's parts are reached through organism.ts only, never through those studies",
  },
  {
    pattern: /fly-neural|augmentation|firstContact\/(?!clock)/,
    why: "connectome and first-contact research are not in ECHO's deployed configuration",
  },
  {
    pattern: /\/city|life\/headless|cityFly/,
    why: "the suite lives in Study B's yard; the city's lives are far costlier and add nothing the benchmarks ask",
  },
  {
    pattern: /\/rain\/(?!sha256)|\/game\/|noeterra|\/components\/|\/routes\/|\/scene\//,
    why: "the lab, the game, the civilization engine and the twin are other products",
  },
];

function specifiers(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) out.push(m[1]!);
  return out;
}

const modules = readdirSync(SUITE)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => join(SUITE, f));

describe("the adaptation suite's scope", () => {
  it("has modules to check", () => {
    expect(modules.length).toBeGreaterThanOrEqual(2);
  });

  it("imports only what its benchmarks need", () => {
    const outside = modules.flatMap((f) =>
      specifiers(f)
        .filter((s) => !ALLOWED.some((a) => a.test(s)))
        .map((s) => `${f}: ${s}`),
    );
    expect(outside).toEqual([]);
  });

  for (const { pattern, why } of DEFERRED)
    it(`defers ${pattern.source}: ${why}`, () => {
      const hits = modules.flatMap((f) =>
        specifiers(f)
          .filter((s) => pattern.test(s))
          .map((s) => `${f}: ${s}`),
      );
      expect(hits).toEqual([]);
    });

  it("its script reaches the simulation only through the suite", () => {
    let text: string;
    try {
      text = readFileSync(SCRIPT, "utf8");
    } catch {
      return; // the script does not exist yet
    }
    const outside = [...text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((s) => !/^(node:|prettier$|\.\.\/src\/bethesda\/adaptation\/)/.test(s));
    expect(outside).toEqual([]);
  });
});
