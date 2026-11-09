/**
 * The legacy adapter reads the 2026-11-07 plasticity study's held-out archive
 * as it is (its schema untouched) and compares a reproduction with it. On the
 * archive's own records, the comparison must find every run identical and
 * recompute the study's primary interval exactly; one changed record must be
 * named.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Interval as StudyInterval } from "../plasticity/analysis.js";
import type { RunRecord as StudyRecord } from "../plasticity/study.js";
import { reproductionSummary, studyKey } from "./legacy.js";
import { parseProtocol } from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };

const dir = "docs/benchmarks/echo-plasticity/heldout";
const all = readFileSync(`${dir}/records.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as StudyRecord);
const weak = all.filter((r) => r.condition === "weak-legs");
const archived = (JSON.parse(readFileSync(`${dir}/summary.json`, "utf8")) as {
  primary: { contrast: { interval: StudyInterval } };
}).primary.contrast.interval;
const p = parseProtocol({ ...source, analysis: { ...source.analysis, resamples: 2000 } });
const meta = { source: dir, sourceCommit: "288b3a8", condition: "weak-legs" };

describe("the legacy adapter", () => {
  it("finds the archive's own weak-legs records identical and its primary interval recomputed exactly", () => {
    expect(weak.length).toBe(96);
    const s = reproductionSummary(all, weak, archived, p, meta);
    expect([s.runs, s.identical, s.differing]).toEqual([96, 96, []]);
    expect(s.primary.same).toBe(true);
    expect(s.benchReading.map((b) => b.metric)).toEqual(["meals", "fedJ"]);
  });

  it("names a reproduced record that differs by one number", () => {
    const changed = weak.map((r, i) => (i === 7 ? { ...r, meals: r.meals + 1 } : r));
    const s = reproductionSummary(all, changed, archived, p, meta);
    expect(s.identical).toBe(95);
    expect(s.differing).toEqual([studyKey(weak[7]!)]);
  });
});
