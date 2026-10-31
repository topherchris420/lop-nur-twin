import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/lib/canonicalJson";
import { EchoAdapter } from "../src/bethesda/fly/echo/adapter";
import { DigitalFly } from "../src/bethesda/fly/fly";
import {
  checkAnswer,
  closedLoopWorld,
  ClosedLoopTap,
  DEFAULT_LIMITS,
  readConfig,
  runClosedLoop,
} from "./echo-closed-loop";
import type { Readouts } from "./echo-neural-shadow";

const quiet: Readouts = {
  feed: { predicted: false, mean_rate_hz: 0, spikes: 0 },
  escape: { predicted: false, mean_rate_hz: 0, spikes: 0 },
};
const firing: Readouts = {
  ...quiet,
  escape: { predicted: true, mean_rate_hz: 50, spikes: 2 },
};
const answer = (r: Readouts) => async (t: number) => ({ t, readouts: r });

function files(dir: string, keep = /\.(ts|tsx|js|mjs)$/, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, keep, out);
    else if (e.isFile() && keep.test(e.name)) out.push(p);
  }
  return out;
}

describe("ECHO closed loop", () => {
  it("leaves a baseline research subject exactly as it is untapped", () => {
    for (const scenario of ["passes", "food"] as const) {
      const make = (tapped: boolean) => {
        const { world, start, config } = closedLoopWorld(scenario);
        const fly = new DigitalFly({
          seed: 11,
          world,
          start,
          config,
          adapter: tapped
            ? ClosedLoopTap.factory("baseline", 11, DEFAULT_LIMITS, [])
            : EchoAdapter.factory({ variant: "full", seed: 11 }),
        });
        for (let k = 0; k < 1500; k++) fly.advance(0.01);
        return fly;
      };
      expect(canonicalJson(make(true).state)).toBe(canonicalJson(make(false).state));
    }
  }, 120_000);

  it("accepts only well-formed answers to the sample asked about", () => {
    expect(checkAnswer({ t: 1, readouts: quiet }, 1).ok).toBe(true);
    const bad = [
      [null, "malformed answer"],
      [{ t: 0.99, readouts: quiet }, "stale answer"],
      [
        { t: 1, readouts: { ...quiet, feed: { predicted: "yes" } } },
        "malformed readouts",
      ],
      [
        { t: 1, readouts: { ...quiet, escape: { ...quiet.escape, spikes: Number.NaN } } },
        "malformed readouts",
      ],
      [
        { t: 1, readouts: { ...quiet, escape: { ...quiet.escape, spikes: -1 } } },
        "malformed readouts",
      ],
      [{ t: 1, error: "no answer in 5 ms", timeout: true }, "timeout"],
      [{ t: 1, error: "ValueError: bad time" }, "server: ValueError: bad time"],
    ] as const;
    for (const [a, reason] of bad)
      expect(checkAnswer(a, 1)).toMatchObject({ ok: false, reason });
    expect(
      checkAnswer({ t: 1, error: "budget: wall time", fatal: true }, 1),
    ).toMatchObject({
      fatal: true,
    });
  });

  it("lets the giant fiber decide escape, and every neural escape is produced", async () => {
    const never = await runClosedLoop({
      scenario: "looms",
      seed: 3,
      arm: "neural-merged",
      seconds: 15,
      neural: answer(quiet),
    });
    expect(never.counts.escapes).toBe(0);
    expect(never.neural.suppressed_escape).toBeGreaterThan(0);
    expect(never.fallbacks.count).toBe(1); // the first step, before any observation
    const always = await runClosedLoop({
      scenario: "passes",
      seed: 3,
      arm: "neural-merged",
      seconds: 3,
      neural: answer(firing),
    });
    expect(always.counts.escapes).toBeGreaterThan(0);
    expect(always.neural.executed_escape).toBe(always.neural.issued_escape);
    expect(always.counts.escapesSpurious! + always.counts.escapesDuringLoom!).toBe(
      always.counts.escapes,
    );
    await expect(
      runClosedLoop({ scenario: "looms", seed: 3, arm: "neural-selected", seconds: 1 }),
    ).rejects.toThrow(/needs the model's readouts/);
  }, 120_000);

  it("falls back to ECHO for a bad sample, logs it, and stops past the bound", async () => {
    let k = 0;
    const flaky = async (t: number) =>
      ++k % 50 === 0 ? { t, readouts: { feed: "?" } } : { t, readouts: quiet };
    const some = await runClosedLoop({
      scenario: "food",
      seed: 5,
      arm: "neural-merged",
      seconds: 5,
      neural: flaky,
    });
    expect(some.outcome.aborted).toBe(false);
    expect(some.fallbacks.byReason["malformed readouts"]).toBeGreaterThan(0);
    expect(some.fallbacks.log[1]).toMatchObject({ reason: "malformed readouts" });
    expect(some.fallbacks.fraction).toBeLessThan(DEFAULT_LIMITS.maxFallbackFraction);
    const broken = await runClosedLoop({
      scenario: "food",
      seed: 5,
      arm: "neural-merged",
      seconds: 10,
      neural: async (t) => ({ t, error: "no answer in 5 ms", timeout: true }),
    });
    expect(broken.outcome).toMatchObject({ aborted: true });
    expect(broken.outcome.reason).toMatch(/fallbacks over/);
    expect(broken.fallbacks.samples).toBeLessThan(DEFAULT_LIMITS.minSamples + 5);
    expect(broken.fallbacks.log.length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxLog);
    const fatal = await runClosedLoop({
      scenario: "food",
      seed: 5,
      arm: "neural-merged",
      seconds: 10,
      neural: async (t) => ({ t, error: "budget: stop file present", fatal: true }),
    });
    expect(fatal.outcome.reason).toMatch(/server stopped/);
    expect(fatal.outcome.simulatedS).toBeLessThan(0.1);
  }, 120_000);

  it("reads its limits from the pre-registered config", () => {
    const { limits, sha256 } = readConfig(
      join(__dirname, "..", "fly-neural", "experiments", "closed-loop-v783.json"),
    );
    expect(limits.maxFallbackFraction).toBe(0.05);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has no way to the deployed organism, and production code has none to it", () => {
    const src = readFileSync(join(__dirname, "echo-closed-loop.ts"), "utf8");
    const imports = [...src.matchAll(/^import [^;]*? from "([^"]+)";/gms)].map(
      (m) => m[1],
    );
    expect(imports.sort()).toEqual(
      [
        "../src/bethesda/fly/arena.js",
        "../src/bethesda/fly/echo/adapter.js",
        "../src/bethesda/fly/echo/params.js",
        "../src/bethesda/fly/fly.js",
        "../src/bethesda/fly/neural.js",
        "../src/bethesda/fly/units.js",
        "../src/bethesda/fly/world.js",
        "./echo-neural-shadow.js",
        "node:child_process",
        "node:crypto",
        "node:fs",
        "node:path",
        "node:readline",
      ].sort(),
    );
    // It reads one file: the pre-registered config.
    expect(src.match(/readFileSync\(/g)).toHaveLength(1);
    for (const f of files(join(__dirname, "..", "src")))
      expect(readFileSync(f, "utf8"), f).not.toMatch(/echo-closed-loop|closed-loop-v783/);
    for (const p of files(join(__dirname, "..", "deploy"), /./))
      expect(readFileSync(p, "utf8"), p).not.toMatch(/echo-closed-loop|closed-loop-v783/);
  });
});
