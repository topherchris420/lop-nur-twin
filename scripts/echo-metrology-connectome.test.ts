/**
 * The bench's connectome adapter re-derives each sealed fly-neural result's
 * Python seal from the file's text alone. Every committed seal must verify, a
 * one-digit change must break it, and the report must keep neural-model
 * validation apart from any behavioural verdict.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFlyNeuralSeal,
  neuralReport,
  parseKeepingNumbers,
  pythonCanonical,
  readNeuralResult,
} from "./echo-metrology-connectome.js";

const BASE = "docs/benchmarks/fly-neural";
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory()
      ? walk(p)
      : n.endsWith(".json")
        ? [p.split("\\").join("/")]
        : [];
  });
const results = walk(BASE).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("Python's canonical JSON, without Python", () => {
  it("keeps every number exactly as written and sorts keys by code point", () => {
    const text = '{"b": 1.0, "a": [1e-05, -0.0, 3], "\u00e9": "x", "Z": NaN}';
    expect(pythonCanonical(parseKeepingNumbers(text))).toBe(
      '{"Z":NaN,"a":[1e-05,-0.0,3],"b":1.0,"\u00e9":"x"}',
    );
  });
});

describe("the committed sealed results", () => {
  it("all verify, except the two that carry no seal", () => {
    expect(results.length).toBeGreaterThanOrEqual(30);
    const states = results.map(
      (r) => [r.path.slice(BASE.length + 1), checkFlyNeuralSeal(r.text)] as const,
    );
    expect(states.filter(([, s]) => s === false)).toEqual([]);
    expect(states.filter(([, s]) => s === null).map(([f]) => f)).toEqual([
      "adaptive/echo-mb-v2-dev.json",
      "adaptive/echo-mb-v2-heldout.json",
    ]);
  });

  it("break when one digit changes", () => {
    const r = results.find((x) => x.path.endsWith("shiu2024-v783-heldout.json"))!;
    const m = /"(\w+)": (\d+\.\d+)/.exec(r.text)!;
    const digit = m[2]!.at(-1) === "9" ? "8" : "9";
    const edited = r.text.replace(m[0], `"${m[1]}": ${m[2]!.slice(0, -1)}${digit}`);
    expect(checkFlyNeuralSeal(r.text)).toBe(true);
    expect(checkFlyNeuralSeal(edited)).toBe(false);
    expect(readNeuralResult(r.path, edited).seal).toBe("broken");
  });
});

describe("the neural report", () => {
  const report = neuralReport(results, []);

  it("keeps the two connectomes apart and never gives a behavioural verdict", () => {
    const banc = report.results.filter((r) => r.file.includes("/banc/"));
    expect(banc.length).toBeGreaterThan(0);
    expect(banc.every((r) => r.dataset === "BANC v888")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/"verdict"|IMPROVEMENT|REGRESSION/);
    expect(report.scope).toMatch(/no behavioural verdict/);
    expect(report.limits.join(" ")).toMatch(/never pooled/);
  });

  it("reports the full connectome comparison as not run, with its cost taken from a sealed result", () => {
    expect(report.notRun[0]).toMatch(/not run/);
    expect(report.notRun[0]).toMatch(/feeding-reduced-v783-heldout\.json/);
    expect(report.notRun[0]).toMatch(/6\.5 hours/);
  });
});
