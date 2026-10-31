import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BATTERY_DIR,
  HeldTap,
  readBattery,
  runBattery,
  type Battery,
} from "./echo-threat-battery";
import { type ShadowTap } from "./echo-neural-shadow";

function files(dir: string, keep = /\.(ts|tsx|js|mjs)$/, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, keep, out);
    else if (e.isFile() && keep.test(e.name)) out.push(p);
  }
  return out;
}

// One approach from 1 m ahead and to the left, straight at a fly at the origin.
const ONE: Battery = {
  schema: "fly-neural-threat-battery/v1",
  split: "test",
  sha256: "0".repeat(64),
  duration_s: 3,
  sample_s: 0.01,
  fly: { position: [0, 0.01, 0], yaw: 0 },
  looms: [
    {
      start: 0.5,
      period: 0,
      count: 1,
      from: [0.85, 0.27, -0.45],
      to: [0.04, 0.02, -0.02],
      speedMS: 1,
      radiusM: 0.05,
      stimulus: 0,
    },
  ],
};

describe("threat battery recorder", () => {
  it("holds the research subject perched and records ECHO's escapes", () => {
    const run = runBattery(ONE, 5);
    expect(run.header.held).toBe(true);
    expect(String(run.header.subject)).toMatch(/^research-threats-/);
    expect(run.header).not.toHaveProperty("lifeId");
    expect(run.header.counts).toMatchObject({ escapes: 0, takeoffs: 0, walkedM: 0 });
    expect(run.records.length).toBeGreaterThan(250);
    expect(
      run.records.some((r) => r.obs.looming && r.obs.looming.expansionDegS > 0),
    ).toBe(true);
    // ECHO still decides to escape; the hold stops the body, not the decision.
    expect(run.records.some((r) => r.echo?.escape)).toBe(true);
    expect(run.header.commandsHeld).toBeGreaterThan(0);
  }, 60_000);

  it("turns movement into rest and passes everything else through", () => {
    const inner = {
      descriptor: { id: "x", label: "x" },
      decide: () => ({ mode: "escape", reason: "loom", heading: 1 }),
      interrupt: () => ({ mode: "groom", reason: "dust" }),
    } as unknown as ShadowTap;
    const h = new HeldTap(inner);
    const input = {} as Parameters<HeldTap["decide"]>[0];
    expect(h.decide(input)).toEqual({ mode: "rest", reason: "held: loom" });
    expect(h.interrupt(input)).toEqual({ mode: "groom", reason: "dust" });
    expect(h.held).toBe(1);
  });

  it("reads a battery only from its own directory", () => {
    const dir = join(process.cwd(), BATTERY_DIR, "test-tmp");
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, "b.json"), JSON.stringify(ONE));
      expect(readBattery(`${BATTERY_DIR}/test-tmp/b.json`).looms).toHaveLength(1);
      writeFileSync(join(dir, "not.json"), JSON.stringify({ ...ONE, schema: "x" }));
      expect(() => readBattery(`${BATTERY_DIR}/test-tmp/not.json`)).toThrow(
        /not a threat battery/,
      );
      for (const p of [
        "package.json",
        ".fly-neural/shadow/x.json",
        `${BATTERY_DIR}/../x.json`,
      ])
        expect(() => readBattery(p)).toThrow(/read only from/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no way to the deployed organism, and production code has none to it", () => {
    const src = readFileSync(join(__dirname, "echo-threat-battery.ts"), "utf8");
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
        "./echo-neural-shadow.js",
        "node:fs",
        "node:path",
      ].sort(),
    );
    for (const f of [
      ...files(join(__dirname, "..", "src")),
      ...files(join(__dirname, "..", "deploy"), /./),
    ])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/echo-threat-battery|threat-v783/);
  });
});
