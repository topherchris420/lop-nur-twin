import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/lib/canonicalJson";
import { EchoAdapter } from "../src/bethesda/fly/echo/adapter";
import { DigitalFly } from "../src/bethesda/fly/fly";
import {
  guard,
  PRODUCTION_PATHS,
  researchWorld,
  runShadow,
  ShadowTap,
  type Readouts,
} from "./echo-neural-shadow";

const SENSABLE_KEYS = ["airflow", "airflowFrom", "looming", "odour", "onFood"];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("ECHO Neural Shadow recorder", () => {
  it("leaves the research fly exactly as it is untapped", () => {
    for (const scenario of ["looms", "food"] as const) {
      const make = (tapped: boolean) => {
        const { world, start, config } = researchWorld(scenario);
        const taps: ShadowTap[] = [];
        const fly = new DigitalFly({
          seed: 11,
          world,
          start,
          config,
          adapter: tapped
            ? ShadowTap.factory("baseline", 11, 100_000, taps)
            : EchoAdapter.factory({ variant: "full", seed: 11 }),
        });
        for (let k = 0; k < 1500; k++) fly.advance(0.01);
        return fly;
      };
      expect(canonicalJson(make(true).state)).toBe(canonicalJson(make(false).state));
    }
  }, 120_000);

  it("records only what the fly can sense, and ECHO's actions", async () => {
    const run = await runShadow({
      scenario: "looms",
      seed: 3,
      mode: "baseline",
      seconds: 15,
    });
    expect(run.records.length).toBeGreaterThan(1000);
    expect(String(run.header.subject)).toMatch(/^research-/);
    expect(run.header).not.toHaveProperty("lifeId");
    let looms = 0;
    for (const r of run.records) {
      expect(Object.keys(r.obs).sort()).toEqual(SENSABLE_KEYS);
      expect(typeof r.obs.onFood).toBe("boolean");
      if (r.obs.looming) {
        looms++;
        expect(Object.keys(r.obs.looming).sort()).toEqual([
          "bearing",
          "expansionDegS",
          "sizeDeg",
        ]);
      }
    }
    expect(looms).toBeGreaterThan(0);
    const text = JSON.stringify(run.records.map((r) => r.obs));
    for (const hidden of [
      '"distance"',
      '"kind"',
      '"id"',
      '"drive"',
      '"p"',
      '"yaw"',
      '"landmarks"',
    ])
      expect(text).not.toContain(hidden);
    // The arena's looms make ECHO escape at least once in 15 s.
    expect(run.records.some((r) => r.echo?.escape)).toBe(true);
  }, 120_000);

  it("lets readouts decide feeding and escape only in neural-experimental mode", async () => {
    const quiet: Readouts = {
      feed: { predicted: false, mean_rate_hz: 0, spikes: 0 },
      escape: { predicted: false, mean_rate_hz: 0, spikes: 0 },
    };
    const run = await runShadow({
      scenario: "looms",
      seed: 3,
      mode: "neural-experimental",
      seconds: 15,
      neural: async () => quiet,
    });
    // A giant fiber that never fires: the research subject never escapes.
    expect(run.header.counts).toMatchObject({ escapes: 0 });
    expect(String(run.header.controller)).toContain("gated by fly-neural readouts");
    await expect(
      runShadow({ scenario: "looms", seed: 3, mode: "neural-experimental", seconds: 1 }),
    ).rejects.toThrow(/needs the model's readouts/);
  }, 120_000);

  it("refuses the production host and production paths", () => {
    expect(() => guard(".fly-neural/shadow/x.jsonl", () => false)).not.toThrow();
    for (const p of PRODUCTION_PATHS) {
      expect(() => guard(".fly-neural/x.jsonl", (q) => q === p)).toThrow(
        /production host/,
      );
      expect(() => guard(`${p}/store/x.jsonl`, () => false)).toThrow(/refusing to write/);
    }
  });

  it("has no way to the deployed organism, and production code has none to it", () => {
    const src = readFileSync(join(__dirname, "echo-neural-shadow.ts"), "utf8");
    // Everything the recorder imports: the fly, ECHO and a research world; no
    // store, checkpoint, backup, continuation or life module, and no file reader.
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
        "node:child_process",
        "node:fs",
        "node:path",
        "node:readline",
      ].sort(),
    );
    expect(src).toMatch(
      /^import \{ existsSync, mkdirSync, writeFileSync \} from "node:fs";$/m,
    );
    for (const f of files(join(__dirname, "..", "src")))
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /fly-neural|fly_neural|echo-neural-shadow/,
      );
    for (const f of readdirSync(join(__dirname, "..", "deploy"), {
      recursive: true,
    }) as string[]) {
      const p = join(__dirname, "..", "deploy", f);
      if (statSync(p).isFile())
        expect(readFileSync(p, "utf8"), p).not.toMatch(
          /fly-neural|fly_neural|echo-neural-shadow/,
        );
    }
  });
});
