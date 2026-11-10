/**
 * The claims register and the README are held to the committed records, and
 * the instrument that holds them is itself tested: its counting rule, its
 * arithmetic, and that every binding can fail.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BINDINGS, NOT_RECOMPUTED } from "./bindings";
import { check, reportJson, type Binding, type DocumentProfile } from "./check";
import { PROFILES, REGISTER } from "./documents";
import { numerals } from "./numerals";
import { at, num, only, readJson, traced } from "./records";
import { renderReport, REPORT_JSON, REPORT_MD } from "./report";
import { fixed, grouped, says, signed, type Statement } from "./statement";
import { median, signTest, upperTailHalf } from "./stats";

const ROOT = process.cwd();
const report = check(BINDINGS, PROFILES);

describe("what counts as a quantity", () => {
  const kinds = (text: string) => numerals(text).map((n) => `${n.text}:${n.kind[0]}`);

  it("counts numbers in prose, with their separators and decimals", () => {
    expect(kinds("9 of 12 flies; 1,347,336 s; p = 0.016; 83.5 → 120.0")).toEqual([
      "9:q",
      "12:q",
      "1,347,336:q",
      "0.016:q",
      "83.5:q",
      "120.0:q",
    ]);
    expect(kinds("seeds (301, 306, 312) and 0/48 against 25–45×")).toEqual([
      "301:q",
      "306:q",
      "312:q",
      "0:q",
      "48:q",
      "25:q",
      "45:q",
    ]);
  });

  it("does not count dates, times or identifiers", () => {
    expect(
      kinds("on 2026-11-04 at 19:27 UTC, 4 November 2026, the 2026-11 set, 264 BC"),
    ).toEqual(["2026-11-04:d", "19:27:d", "4 November 2026:d", "2026-11:d", "264 BC:d"]);
    expect(kinds("FAFB v783, H2, ECHO-01, ECHO-03–05, MN9, Node 24.19.0, arm64")).toEqual(
      ["783:i", "2:i", "01:i", "03:i", "05:i", "9:i", "24.19.0:i", "64:i"],
    );
    expect(kinds("commit 288b3a8, section 07, building 1011267786")).toEqual([
      "288:i",
      "3:i",
      "8:i",
      "07:i",
      "1011267786:i",
    ]);
  });

  it("does not look inside code, link targets, URLs or tags", () => {
    expect(
      kinds(
        'run `digital-fly/9` ([report 3](benchmarks/v2/report-12.md)) at https://x.test/41 <img width="33%"> 7 times',
      ),
    ).toEqual(["3:q", "7:q"]);
  });
});

describe("printing and arithmetic", () => {
  it("rounds a record's written value half away from zero", () => {
    expect(fixed(0.3025, 3)).toBe("0.303");
    expect(fixed(-1.675, 2)).toBe("−1.68");
    expect(fixed(0.275, 2)).toBe("0.28");
    expect(fixed(0.07329224786685237, 3)).toBe("0.073");
    expect(fixed(-0.0004, 2)).toBe("0.00");
    expect(signed(0.1667, 2)).toBe("+0.17");
    expect(signed(-0.381, 3)).toBe("−0.381");
    expect(grouped(54492922)).toBe("54,492,922");
  });

  it("computes exact sign tests", () => {
    expect(upperTailHalf(9, 9)).toBe(0.001953125);
    expect(upperTailHalf(10, 10)).toBe(0.0009765625);
    expect(upperTailHalf(5, 2)).toBe(0.8125);
    const seven = signTest([36, 12, 5, 1, 90, 20, 66, 0, 0, 0, 0, 0]);
    expect(seven).toMatchObject({
      positive: 7,
      negative: 0,
      ties: 5,
      pTwoSided: 0.015625,
    });
    expect(signTest([1, -1]).pTwoSided).toBe(1);
    // A tail of a large sample is still exact, where 2 ** -n would underflow a sum.
    expect(upperTailHalf(2000, 0)).toBe(1);
    expect(upperTailHalf(2000, 2000)).toBeCloseTo(0, 300);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("keeps computed text apart from quoted text", () => {
    const s = says`  It ran ${12} flies
      and 3 died (${fixed(0.25, 2)}) `;
    expect(s.text).toBe("It ran 12 flies and 3 died (0.25)");
    expect(s.computed.map(([a, b]) => s.text.slice(a, b))).toEqual(["12", "0.25"]);
    expect(() => says`nothing computed`).toThrow();
    expect(() => says`a fraction ${0.5}`).toThrow();
  });

  it("stops at a record that is not shaped as the binding assumed", () => {
    const record = {
      cells: [
        { arm: "full", mean: 1 },
        { arm: "bare", mean: 2 },
      ],
    };
    expect(num(record, "cells[1].mean")).toBe(2);
    expect(() => at(record, "cells[2].mean")).toThrow(/nothing at cells.2/);
    expect(() => num(record, "cells[0].arm")).toThrow(/finite number/);
    expect(() => only(record.cells, (c) => c.mean > 0, "cell")).toThrow(/found 2/);
    expect(() => readJson("../outside.json")).toThrow(/repository path/);
  });
});

describe("the check", () => {
  const profile: DocumentProfile = {
    path: "doc.md",
    name: "A document",
    keyFor: (h) => {
      const m = /^(\d+)\. (.*)$/.exec(h);
      return m ? { key: m[1]!, title: m[2]! } : null;
    },
  };
  const doc = [
    "# Title",
    "",
    "## 1. First",
    "",
    "It ran 12 flies and 3 died",
    "(p = 0.5).",
    "",
    "## 2. Second",
    "",
    "It ran 12 flies and 3 died.",
  ].join("\n");
  const binding = (statement: () => Statement, section = "1"): Binding => ({
    id: "t",
    doc: "doc.md",
    section,
    model: "a test",
    statement,
  });
  const run = (b: Binding, text = doc) => check([b], [profile], () => text);

  it("counts a quantity only where a binding computed it", () => {
    const r = run(binding(() => says`It ran ${12} flies and 3 died`));
    expect(r.results[0]).toMatchObject({ ok: true, occurrences: 1 });
    expect(
      r.documents[0]!.sections.map((s) => [s.key, s.quantities, s.recomputed]),
    ).toEqual([
      ["1", 3, 1],
      ["2", 2, 0],
    ]);
    expect(r.documents[0]!.sections[0]!.copied).toEqual(["3", "0.5"]);
  });

  it("fails when the document says something else, across a line break or not", () => {
    expect(run(binding(() => says`3 died (p = ${fixed(0.5, 1)})`)).results[0]!.ok).toBe(
      true,
    );
    const wrong = run(binding(() => says`It ran ${13} flies`)).results[0]!;
    expect(wrong.ok).toBe(false);
    expect(wrong.problem).toContain("does not say: It ran 13 flies");
  });

  it("looks only in the section a binding names", () => {
    const elsewhere = run(binding(() => says`(p = ${fixed(0.5, 1)})`, "2")).results[0]!;
    expect(elsewhere.ok).toBe(false);
    expect(run(binding(() => says`${12} flies`, "9")).results[0]!.problem).toContain(
      'no section "9"',
    );
  });

  it("fails, and does not throw, when a record is missing or recomputes nothing", () => {
    const missing = run(
      binding(() => says`${num(readJson("docs/claims/no-such-record.json"), "n")} flies`),
    ).results[0]!;
    expect(missing.ok).toBe(false);
    expect(missing.problem).toContain("its records no longer give the sentence");
    const idle = check(
      [{ id: "t", doc: "doc.md", section: "1", statement: () => says`${12} flies` }],
      [profile],
      () => doc,
    ).results[0]!;
    expect(idle.problem).toContain("recomputes nothing");
    expect(() =>
      check([binding(() => says`${1}`), binding(() => says`${1}`)], [profile]),
    ).toThrow(/two bindings/);
  });

  it("names the records a sentence read", () => {
    const { value, files } = traced(() =>
      num(readJson("docs/benchmarks/fly-individuality/report.json"), "a.individuals"),
    );
    expect(value).toBe(24);
    expect(files).toEqual(["docs/benchmarks/fly-individuality/report.json"]);
  });
});

describe("the claims register and the README", () => {
  it("say what their records give", () => {
    const failed = report.results
      .filter((r) => !r.ok)
      .map((r) => `${r.id}: ${r.problem}`);
    expect(failed).toEqual([]);
  });

  it("are held by bindings that can each fail", () => {
    // Alter the first computed part of each sentence wherever its document says
    // it, and require the check to notice.
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const unnoticed: string[] = [];
    for (const b of BINDINGS) {
      const { text, computed } = b.statement();
      const [start, end] = computed[0]!;
      const part = text.slice(start, end);
      const altered = /\d/.test(part)
        ? part.replace(/\d/, (d) => String((Number(d) + 1) % 10))
        : `not ${part}`;
      const pattern = new RegExp(text.split(" ").map(escape).join("\\s+"), "g");
      const original = readFileSync(join(ROOT, b.doc), "utf8");
      const changed = original.replace(
        pattern,
        () => text.slice(0, start) + altered + text.slice(end),
      );
      if (changed === original) {
        unnoticed.push(`${b.id}: its sentence could not be found to alter`);
        continue;
      }
      const result = check([b], PROFILES, (path) =>
        path === b.doc ? changed : readFileSync(join(ROOT, path), "utf8"),
      ).results[0]!;
      if (result.ok) unnoticed.push(`${b.id}: held after "${part}" became "${altered}"`);
    }
    expect(unnoticed).toEqual([]);
  }, 120_000);

  it("leave no register entry both unbound and unexplained", () => {
    const register = report.documents.find((d) => d.path === REGISTER)!;
    const entries = register.sections.filter((s) => s.key !== "summary");
    expect(entries.length).toBeGreaterThanOrEqual(25);
    const silent = entries.filter((s) => s.bindings.length === 0).map((s) => s.key);
    expect(silent.filter((key) => !NOT_RECOMPUTED[key])).toEqual([]);
    // An explanation outlives its use the moment its entry is bound.
    expect(Object.keys(NOT_RECOMPUTED).filter((key) => !silent.includes(key))).toEqual(
      [],
    );
  });

  it("are described by docs/claims/ exactly as the bindings give it", () => {
    for (const [path, text] of [
      [REPORT_MD, renderReport(report, NOT_RECOMPUTED)],
      [REPORT_JSON, reportJson(report)],
    ] as const) {
      expect(existsSync(join(ROOT, path)), `${path} is missing`).toBe(true);
      expect(
        readFileSync(join(ROOT, path), "utf8") === text,
        `${path} is stale: run "node scripts/run-ts.mjs scripts/claim-bindings.ts --write" and commit it`,
      ).toBe(true);
    }
  });
});
