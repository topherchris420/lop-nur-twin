import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Refused } from "../errors";
import { bundledIndex } from "./bundled";
import {
  MATH_LIMITS,
  parseBasis,
  parseBasisEntry,
  type MathematicalBasisEntry,
} from "./contracts";
import { FIXTURE_COMMIT, fixtureIndex } from "./fixture";
import {
  MathematicalSubstrate,
  SubstrateUnavailable,
  type SearchInput,
} from "./substrate";
import { contentSha256 } from "./substrateIndex";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const fixture = () => MathematicalSubstrate.load(fixtureIndex(), () => NOW);
const REQ = "a".repeat(32);
const search = (over: Partial<SearchInput> = {}): SearchInput => ({
  query: "Cohen–Macaulay module conjecture",
  discipline: null,
  formalization: "any",
  limit: 5,
  mode: "context",
  hypothesis: null,
  ...over,
});
const refusal = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof Refused
      ? { status: e.status, code: e.code }
      : { error: String(e) };
  }
  return null;
};

describe("loading fails closed", () => {
  it("serves an index only when every check passes", () => {
    expect(() => fixture()).not.toThrow();
    const tampered = fixtureIndex();
    tampered.families[0]!.title = "A result nobody proved";
    expect(() => MathematicalSubstrate.load(tampered)).toThrow(SubstrateUnavailable);
    expect(() => MathematicalSubstrate.load({ schema: "something else" })).toThrow(
      SubstrateUnavailable,
    );
  });
  it("loads the pinned index", () => {
    const s = MathematicalSubstrate.load(bundledIndex(), () => NOW);
    expect(s.status().substrate.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(s.status().substrate.counts.families).toBe(372);
  });
});

describe("retrieval", () => {
  const s = fixture();
  it("finds a result by its own words, and says what that does and does not establish", () => {
    const a = s.searchMathematics(search(), REQ);
    expect(a.results[0]?.family).toBe("195");
    expect(a.results[0]?.matched.map((m) => m.term)).toEqual(
      expect.arrayContaining(["cohen", "macaulay", "module"]),
    );
    expect(a.findings.map((f) => f.id)).toEqual([
      "results_found",
      "formalization_absent",
      "assumptions_unmapped",
    ]);
    expect(a.request_id).toBe(REQ);
    expect(a.results.every((r, i) => r.rank === i + 1)).toBe(true);
  });
  it("is bounded in and out", () => {
    expect(
      s.searchMathematics(search({ query: "zero free half plane", limit: 1 }), REQ)
        .results,
    ).toHaveLength(1);
    for (const bad of [
      search({ limit: 0 }),
      search({ limit: MATH_LIMITS.results + 1 }),
      search({ limit: 2.5 }),
      search({ query: "" }),
      search({ query: "x".repeat(MATH_LIMITS.query + 1) }),
      search({ query: "conjecture\u202e" }),
      search({ discipline: "Astrology" }),
      search({ mode: "challenge", hypothesis: null }),
      search({ hypothesis: "h".repeat(MATH_LIMITS.hypothesis + 1) }),
    ])
      expect(refusal(() => s.searchMathematics(bad, REQ))?.status).toBe(422);
  });
  it("says so when nothing relevant is found", () => {
    const a = s.searchMathematics(
      search({ query: "pedestrian umbrella timetable" }),
      REQ,
    );
    expect(a.results).toEqual([]);
    expect(a.matches).toBe(0);
    expect(a.findings).toEqual([{ id: "no_result", n: null, of: null }]);
  });
  it("says when the grounding is thin: shared words are not relevance", () => {
    const a = s.searchMathematics(
      search({ query: "local interfaces of pedestrian crowds near transit entrances" }),
      REQ,
    );
    expect(a.findings.some((f) => f.id === "insufficient_grounding")).toBe(true);
  });
  it("filters by discipline and by formalization", () => {
    const algebra = s.searchMathematics(
      search({ query: "conjecture", discipline: "Algebra" }),
      REQ,
    );
    expect(algebra.results.every((r) => r.discipline?.name === "Algebra")).toBe(true);
    const required = s.searchMathematics(
      search({ query: "conjecture hypothesis zero", formalization: "required" }),
      REQ,
    );
    expect(required.results.length).toBeGreaterThan(0);
    expect(required.results.every((r) => r.formalization_path !== null)).toBe(true);
    const preferred = s.searchMathematics(
      search({ query: "conjecture", formalization: "preferred", limit: 8 }),
      REQ,
    );
    const firstUnformalized = preferred.results.findIndex((r) => !r.formalization_path);
    expect(
      preferred.results.slice(firstUnformalized).every((r) => !r.formalization_path),
    ).toBe(true);
  });
  it("looks up one family exactly, with every manuscript, its Lean statements and bounded excerpts", () => {
    const r = s.inspectMathematicalResult({ family: "003" }, REQ);
    expect(r.family.manuscripts).toHaveLength(3);
    expect(r.family.formalization?.statements).toHaveLength(4);
    expect(r.family.summary.source).toBe("CONTENTS.md");
    expect(r.family.formalization?.scope.source).toBe("lean/docs/003.md");
    for (const m of r.family.manuscripts) {
      expect(m.abstract.text.length).toBeLessThanOrEqual(MATH_LIMITS.abstract);
      expect(m.abstract.truncated).toBe(m.abstract.chars > m.abstract.text.length);
    }
  });
  it("answers a missing result with a typed refusal, and a malformed one before looking", () => {
    expect(
      refusal(() => s.inspectMathematicalResult({ family: "999" }, REQ))?.status,
    ).toBe(404);
    for (const family of ["../../etc/passwd", "https://example.com", "17", "0170", ""])
      expect(refusal(() => s.inspectMathematicalResult({ family }, REQ))?.status).toBe(
        422,
      );
  });
  it("truncates a long Lean scope and says so", () => {
    const pinned = MathematicalSubstrate.load(bundledIndex(), () => NOW);
    const long = pinned.index.families.filter(
      (f) => (f.formalization?.scope.length ?? 0) > MATH_LIMITS.scope,
    );
    expect(long.length).toBeGreaterThan(0);
    const r = pinned.inspectMathematicalResult({ family: long[0]!.id }, REQ);
    expect(r.family.formalization?.scope.truncated).toBe(true);
    expect(r.family.formalization?.scope.text).toHaveLength(MATH_LIMITS.scope);
    expect(r.family.formalization?.scope.chars).toBe(
      long[0]!.formalization!.scope.length,
    );
  });
});

describe("challenge mode", () => {
  const s = fixture();
  it("looks first for what could weaken a hypothesis, and groups it by the repository's own words", () => {
    const a = s.searchMathematics(
      search({
        mode: "challenge",
        hypothesis:
          "Every complete local domain has a small Cohen–Macaulay module, so the module conjecture holds.",
      }),
      REQ,
    );
    expect(a.results[0]?.family).toBe("195");
    expect(a.results[0]?.group).toBe("counterexamples");
    expect(a.findings).toContainEqual({ id: "challenge_material", n: 1, of: null });
    expect(a.hypothesis).toMatch(/small Cohen–Macaulay module/);
  });
  it("says when nothing challenges the hypothesis, and that this is not support", () => {
    const a = s.searchMathematics(
      search({
        mode: "challenge",
        hypothesis: "The zeta function has a zero-free half-plane.",
      }),
      REQ,
    );
    expect(a.findings.some((f) => f.id === "no_challenge_found")).toBe(true);
  });
});

describe("provenance", () => {
  const s = fixture();
  it("names the repository, the commit, the index and when, on every answer", () => {
    const expected = {
      repository: "openai/math",
      repository_url: "https://github.com/openai/math",
      commit: FIXTURE_COMMIT,
      index_sha256: s.index.content_sha256,
      generated_at: s.index.generated_at,
      retrieved_at: NOW.toISOString(),
    };
    expect(s.searchMathematics(search(), REQ).provenance).toMatchObject(expected);
    expect(s.inspectMathematicalResult({ family: "017" }, REQ).provenance).toMatchObject(
      expected,
    );
    expect(s.status().substrate).toMatchObject({
      repository: "openai/math",
      commit: FIXTURE_COMMIT,
      index_sha256: s.index.content_sha256,
      review_status: "unchecked",
    });
  });
  it("records the formalization's path and the manuscript's path", () => {
    const r = s.inspectMathematicalResult({ family: "017" }, REQ);
    expect(r.family.formalization?.path).toBe("lean/docs/017.md");
    expect(r.family.manuscripts[0]?.path).toBe(
      "preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/paper.pdf",
    );
    expect(r.family.reasoning_summary?.path).toBe(
      "reasoning_traces/irrationality-exponent-of-pi.pdf",
    );
  });
});

describe("the substrate cannot be changed by what it serves", () => {
  it("freezes the index, and an answer edited by its reader changes nothing", () => {
    const s = fixture();
    const before = contentSha256(s.index);
    expect(Object.isFrozen(s.index.families[0])).toBe(true);
    const a = s.searchMathematics(search(), REQ);
    a.results[0]!.title = "edited";
    a.results[0]!.kinds.push("counterexample");
    const r = s.inspectMathematicalResult({ family: "195" }, REQ);
    r.family.status = "formalized";
    r.family.manuscripts[0]!.status = "formalized";
    expect(() => {
      (s.index.families[0] as { title: string }).title = "x";
    }).toThrow();
    expect(contentSha256(s.index)).toBe(before);
    expect(s.inspectMathematicalResult({ family: "195" }, REQ).family.status).toBe(
      "manuscript",
    );
  });
  it("has no operation that writes", () => {
    const methods = Object.getOwnPropertyNames(MathematicalSubstrate.prototype).sort();
    expect(methods).toEqual([
      "constructor",
      "family",
      "inspectMathematicalResult",
      "provenance",
      "searchMathematics",
      "status",
      "summary",
      "verifyBasis",
    ]);
  });
});

describe("security", () => {
  const dir = new URL(".", import.meta.url);
  const source = (f: string) => readFileSync(new URL(f, dir), "utf8");
  it("reads no file, fetches nothing, starts nothing and evaluates nothing", () => {
    for (const f of [
      "substrate.ts",
      "contracts.ts",
      "substrateIndex.ts",
      "indexer.ts",
      "bundled.ts",
    ]) {
      const text = source(f);
      expect(text, f).not.toMatch(
        /node:fs|node:child_process|node:net|node:http|fetch\(|XMLHttpRequest|\beval\(|new Function|import\(|process\.env/,
      );
    }
  });
  it("treats a URL in a query as text and never fetches it", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const s = fixture();
    const a = s.searchMathematics(
      search({ query: "https://evil.example/payload.lean" }),
      REQ,
    );
    expect(a.query).toBe("https://evil.example/payload.lean");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("a mathematical basis", () => {
  const s = fixture();
  const entry = (over: Partial<MathematicalBasisEntry> = {}): MathematicalBasisEntry => ({
    repository: "openai/math",
    commit: s.index.commit,
    index_sha256: s.index.content_sha256,
    result_family: "017",
    title: s.index.families.find((f) => f.id === "017")!.title,
    manuscript_path: null,
    formalization_path: "lean/docs/017.md",
    reasoning_summary_path: null,
    status: "formalized",
    relation: "provides_definition",
    assumptions: [
      "Distances in the simulator are finite decimals, so rational approximation applies.",
    ],
    rationale: "Fixes what a sharp approximation exponent means.",
    assessed_by: "person",
    ...over,
  });
  it("verifies against the substrate exactly as the index holds the result", () => {
    expect(s.verifyBasis([entry()])).toEqual([]);
    const reasoning = entry({
      formalization_path: null,
      reasoning_summary_path: "reasoning_traces/irrationality-exponent-of-pi.pdf",
      status: "reasoning-summary",
      relation: "suggests_hypothesis",
    });
    expect(s.verifyBasis([reasoning])).toEqual([]);
  });
  it("refuses a basis read at another commit or another index: the substrate revision never changes silently", () => {
    expect(s.verifyBasis([entry({ commit: "f".repeat(40) })]).join(" ")).toMatch(
      /Attach it again from the substrate in use/,
    );
    expect(s.verifyBasis([entry({ index_sha256: "0".repeat(64) })]).join(" ")).toMatch(
      /this substrate is/,
    );
  });
  it("refuses an unformalized result labelled formalized, and a reasoning summary passed off as a manuscript", () => {
    const f223 = s.index.families.find((f) => f.id === "223")!;
    const claimed = entry({
      result_family: "223",
      title: f223.title,
      formalization_path: "lean/docs/223.md",
      status: "formalized",
    });
    expect(s.verifyBasis([claimed]).join(" ")).toMatch(
      /holds this result as manuscript, not formalized/,
    );
    const borrowed = entry({
      manuscript_path: f223.manuscripts[0]!.path,
    });
    expect(s.verifyBasis([borrowed]).join(" ")).toMatch(/holds no such manuscript/);
    expect(s.verifyBasis([entry({ result_family: "999" })]).join(" ")).toMatch(
      /no result family 999/,
    );
  });
  it("needs stated assumptions and a rationale for any relation that asserts a connection", () => {
    const bare = parseBasisEntry(entry({ assumptions: [], rationale: "" }));
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.errors.join(" ")).toMatch(/must state the assumptions/);
    expect(
      parseBasisEntry(
        entry({ relation: "insufficient_context", assumptions: [], rationale: "" }),
      ).ok,
    ).toBe(true);
  });
  it("lets a host rule say only that the context is insufficient or the result not applicable", () => {
    expect(parseBasisEntry(entry({ assessed_by: "host-rule" })).ok).toBe(false);
    expect(
      parseBasisEntry(
        entry({
          assessed_by: "host-rule",
          relation: "related_but_not_applicable",
          assumptions: [],
        }),
      ).ok,
    ).toBe(true);
  });
  it("never treats a reasoning summary as a proof", () => {
    for (const relation of [
      "supports_hypothesis",
      "provides_counterexample",
      "contradicts_candidate",
    ] as const) {
      const r = parseBasisEntry(
        entry({
          formalization_path: null,
          reasoning_summary_path: "reasoning_traces/irrationality-exponent-of-pi.pdf",
          status: "reasoning-summary",
          relation,
        }),
      );
      expect(r.ok, relation).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/not a proof/);
    }
  });
  it("refuses an unverified result, an extra field, a URL and a path that leaves the repository", () => {
    expect(
      parseBasisEntry(entry({ status: "unverified", formalization_path: null })).ok,
    ).toBe(false);
    expect(parseBasisEntry({ ...entry(), verdict: "proved" }).ok).toBe(false);
    expect(
      parseBasisEntry(entry({ manuscript_path: "https://evil.example/paper.pdf" })).ok,
    ).toBe(false);
    expect(
      parseBasisEntry(entry({ manuscript_path: "preprints/../../etc/passwd.pdf" })).ok,
    ).toBe(false);
    expect(parseBasisEntry(entry({ formalization_path: "lean/docs/003.md" })).ok).toBe(
      false,
    );
  });
  it("holds one substrate revision and cites each result once", () => {
    expect(parseBasis([entry(), entry()]).ok).toBe(false);
    const other = entry({
      result_family: "003",
      title: s.index.families.find((f) => f.id === "003")!.title,
      formalization_path: "lean/docs/003.md",
      commit: "e".repeat(40),
    });
    const mixed = parseBasis([entry(), other]);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok)
      expect(mixed.errors.join(" ")).toMatch(/more than one substrate revision/);
    expect(
      parseBasis(Array.from({ length: MATH_LIMITS.basisEntries + 1 }, () => entry())).ok,
    ).toBe(false);
  });
});
