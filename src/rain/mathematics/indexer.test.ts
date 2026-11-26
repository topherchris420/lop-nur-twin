import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256 } from "../sha256";
import bundled from "./data/openai-math.json" with { type: "json" };
import { FIXTURE_COMMIT, REAL_FAMILIES, fixtureFile, fixtureIndex } from "./fixture";
import { markdownLink, parseContents, parseManuscriptReadme, texGroups } from "./indexer";
import { contentSha256, indexErrors, type SubstrateIndex } from "./substrateIndex";

const pinned = bundled as unknown as SubstrateIndex;
const family = (ix: SubstrateIndex, id: string) => {
  const f = ix.families.find((x) => x.id === id);
  if (!f) throw new Error(`no family ${id}`);
  return f;
};
const clone = <T>(v: T): T => structuredClone(v);

describe("catalogue family anchors", () => {
  it("starts a new family at a named anchor rather than attaching papers to the preceding family", () => {
    const catalogue = [
      "**378. Prior family.** Old summary.",
      "&emsp;[Earlier paper](preprints/earlier/paper.pdf)",
      "Earlier abstract.",
      '<a name="family-379"></a>**379. New family.** New summary. ([Lean](lean/docs/379.md))',
      "&emsp;[New paper](preprints/new/paper.pdf)",
      "New abstract.",
    ].join("\n");
    const result = parseContents(catalogue);
    expect(result.rejected).toEqual([]);
    expect(result.families.map((f) => [f.id, f.manuscripts.map((m) => m.title)])).toEqual(
      [
        ["378", ["Earlier paper"]],
        ["379", ["New paper"]],
      ],
    );
    expect(result.families[0]?.manuscripts[0]?.abstract).toBe("Earlier abstract.");
    expect(result.families[1]?.lean).toBe("lean/docs/379.md");
  });

  it("refuses an anchor that disagrees with its family number", () => {
    const result = parseContents(
      [
        "**378. Prior family.**",
        '<a name="family-380"></a>**379. Mismatched family.**',
        "&emsp;[New paper](preprints/new/paper.pdf)",
      ].join("\n"),
    );
    expect(result.families).toHaveLength(1);
    expect(result.families[0]?.manuscripts).toEqual([]);
    expect(result.rejected.map((entry) => entry.reason)).toContain(
      "family anchor and title number disagree",
    );
  });
});

describe("comparator destinations", () => {
  const scope = fixtureFile("lean/docs/017.md")!;
  const flat = "../ComparatorChallenges/PiExponent.lean";

  it.each(["#L1", "#L1-L3"])(
    "looks up the plain file for a %s scope link",
    (fragment) => {
      const index = fixtureIndex({
        overrides: { "lean/docs/017.md": scope.replace(flat, flat + fragment) },
      });
      const result = family(index, "017");
      expect(result.status).toBe("formalized");
      expect(result.formalization?.statements[0]?.statement_path).toBe(
        "lean/ComparatorChallenges/PiExponent.lean",
      );
      expect(result.formalization?.statements[0]?.config_path).toBe(
        "lean/ComparatorChallenges/PiExponent.json",
      );
    },
  );

  it("does not treat arbitrary fragments as file metadata", () => {
    const index = fixtureIndex({
      overrides: { "lean/docs/017.md": scope.replace(flat, flat + "#not-a-line") },
    });
    expect(family(index, "017").status).toBe("unverified");
    expect(family(index, "017").formalization?.statements).toEqual([]);
  });

  it("uses a unique explicitly catalogued nested config naming the requested challenge", () => {
    const config = (challenge_module: string) =>
      JSON.stringify({
        ...JSON.parse(fixtureFile("lean/ComparatorChallenges/PiExponent.json")!),
        challenge_module,
      });
    const challenge = "ComparatorChallenges.Nested.Challenge";
    const yaml = fixtureFile("lean/formalization.yaml")!;
    const overrides = {
      "lean/docs/017.md": scope.replace(
        flat,
        "../ComparatorChallenges/Nested/Challenge.lean",
      ),
      "lean/ComparatorChallenges/Nested/Challenge.lean": null,
      "lean/ComparatorChallenges/Nested/main.json": config(challenge),
      "lean/formalization.yaml": yaml.replace(
        "  main_results:",
        "  main_results:\n    - comparator_config: ComparatorChallenges/Nested/main.json",
      ),
    };
    const resolved = family(fixtureIndex({ overrides }), "017");
    expect(resolved.status).toBe("formalized");
    expect(resolved.formalization?.statements[0]?.config_path).toBe(
      "lean/ComparatorChallenges/Nested/main.json",
    );
    const wrong = fixtureIndex({
      overrides: {
        ...overrides,
        "lean/ComparatorChallenges/Nested/main.json": config(
          "ComparatorChallenges.Other",
        ),
      },
    });
    expect(family(wrong, "017").status).toBe("unverified");
    const ambiguous = fixtureIndex({
      overrides: {
        ...overrides,
        "lean/ComparatorChallenges/Nested/second.json": config(challenge),
        "lean/formalization.yaml": overrides["lean/formalization.yaml"].replace(
          "  main_results:",
          "  main_results:\n    - comparator_config: ComparatorChallenges/Nested/second.json",
        ),
      },
    });
    expect(family(ambiguous, "017").status).toBe("unverified");
  });
});

describe("index integrity", () => {
  it("is deterministic: the same files give the same index, and the content hash ignores when it was made", () => {
    const a = fixtureIndex();
    const b = fixtureIndex();
    expect(b).toEqual(a);
    const later = fixtureIndex({ generatedAt: "2027-01-01T00:00:00.000Z" });
    expect(later.content_sha256).toBe(a.content_sha256);
    expect(later.generated_at).not.toBe(a.generated_at);
    expect(contentSha256(a)).toBe(a.content_sha256);
    expect(indexErrors(a)).toEqual([]);
  });
  it("sorts families by number and keeps each family's manuscripts in the catalogue's order, whatever order the catalogue lists the families in", () => {
    // Each family's block runs from its entry to the next family's; reverse the
    // real families' blocks. (The synthetic duplicates are left out: for a
    // duplicate, the first listing wins, so their order is the point of them.)
    const contents = fixtureFile("CONTENTS.md")!;
    const SEP = "<tbody><tr>\n<td>\n\n**";
    const [head, ...chunks] = contents.replace("\n</table>\n", "\n").split(SEP);
    const real = chunks.filter(
      (c) =>
        !c.includes("SYNTHETIC") && REAL_FAMILIES.some((id) => c.startsWith(`${id}. `)),
    );
    const reversed = [head, ...real.reverse()].join(SEP) + "</table>\n";
    const a = fixtureIndex();
    const b = fixtureIndex({ overrides: { "CONTENTS.md": reversed } });
    expect(b.families.map((f) => f.id)).toEqual([...REAL_FAMILIES]);
    expect(b.families).toEqual(a.families.filter((f) => f.id !== "998"));
    expect(family(b, "003").manuscripts.map((m) => m.id)).toEqual(
      family(a, "003").manuscripts.map((m) => m.id),
    );
  });
  it("preserves the four Oct 6 fixture families independently of the shipped snapshot", () => {
    const ix = fixtureIndex();
    expect(ix.commit).toBe("adc7f1241b42e322a6451854ab7e4b4c146bf78a");
    // SHA-256 of the four family records in the previous bundled index. The
    // production snapshot can advance without silently changing this fixture.
    expect(REAL_FAMILIES.map((id) => sha256(JSON.stringify(family(ix, id))))).toEqual([
      "96295dd8b47720c33ea5cff0b08d311dd29850bb3cabdb24de269b38af97b748",
      "92ade4ac81fc8cd9b197743bd03232c86f5737ad52e32823def0e0ebd7721a1f",
      "447b44436f4eb29ce301b0b0ee09f69b167039c08266430b45c2943698e39764",
      "9a18c76f6cad865d727bcde3f5fecf9c104c28b0cb97bf7a97b7f913b55cd432",
    ]);
  });
  it("refuses duplicates and malformed entries, and records why", () => {
    const ix = fixtureIndex();
    const reasons = ix.rejected.map((r) => r.reason);
    expect(reasons).toContain("duplicate family 017");
    expect(reasons.some((r) => /listed twice/.test(r))).toBe(true);
    expect(reasons.some((r) => /three-digit number/.test(r))).toBe(true);
    expect(reasons.some((r) => /inside the repository/.test(r))).toBe(true);
    expect(ix.counts.rejected).toBe(ix.rejected.length);
    // A refused entry is in no record: not searchable, not citable.
    const text = JSON.stringify(ix.families);
    expect(text).not.toContain("passwd");
    expect(text).not.toContain("a two-digit family number");
    expect(text).not.toContain("a second family 017");
    expect(ix.families.filter((f) => f.id === "017")).toHaveLength(1);
  });
  it("marks missing metadata unverified, with the issue, and never repairs it", () => {
    const ix = fixtureIndex();
    const f = family(ix, "998");
    expect(f.status).toBe("unverified");
    expect(f.discipline).toBeNull();
    expect(f.issues).toContain("the overview classifies it under no discipline");
    const [noReadme, noPdf] = f.manuscripts;
    expect(noReadme?.status).toBe("unverified");
    expect(noReadme?.issues).toContain("it has no README, so no citation");
    expect(noReadme?.citation).toBeNull();
    expect(noPdf?.status).toBe("unverified");
    expect(noPdf?.issues).toContain("its PDF is not in the repository at this commit");
    expect(ix.counts.unverified_families).toBe(1);
    expect(ix.counts.unverified_manuscripts).toBe(2);
    // Taking a real family's README away makes that manuscript unverified, nothing else.
    const missing = fixtureIndex({
      overrides: {
        "preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/README.md":
          undefined,
      },
    });
    expect(family(missing, "017").manuscripts[0]?.status).toBe("unverified");
    expect(family(missing, "017").status).toBe("formalized");
  });
  it("pins the index to one commit: the commit is recorded, part of the content, and a malformed one is refused", () => {
    const ix = fixtureIndex();
    expect(ix.commit).toBe(FIXTURE_COMMIT);
    const other = fixtureIndex({ commit: "f".repeat(40) });
    expect(other.content_sha256).not.toBe(ix.content_sha256);
    const unpinned = { ...clone(ix), commit: "main" };
    expect(indexErrors(unpinned).join(" ")).toMatch(/pinned to one commit/);
  });
  it("detects any change after generation, and statuses that do not follow from the records", () => {
    const ix = fixtureIndex();
    const edited = clone(ix);
    edited.families[0]!.summary += " Also proves everything.";
    expect(indexErrors(edited)).toEqual([
      "the content does not match its SHA-256: the index was changed after it was generated",
    ]);
    const promoted = clone(ix);
    const f195 = promoted.families.find((f) => f.id === "195")!;
    f195.status = "formalized";
    f195.manuscripts[0]!.status = "formalized";
    expect(indexErrors(promoted).join(" ")).toMatch(
      /does not follow from what the index holds/,
    );
    const unsorted = clone(ix);
    unsorted.families.reverse();
    expect(indexErrors(unsorted).join(" ")).toMatch(/not sorted/);
    const escaped = clone(ix);
    escaped.families[0]!.manuscripts[0]!.path = "preprints/../../etc/passwd.pdf";
    expect(indexErrors(escaped).join(" ")).toMatch(/malformed path/);
  });
});

describe("classification", () => {
  const ix = fixtureIndex();
  it("calls a result formalized only when its family's Lean scope page lists it", () => {
    const f = family(ix, "003");
    expect(f.status).toBe("formalized");
    expect(f.formalization?.path).toBe("lean/docs/003.md");
    const byId = Object.fromEntries(f.manuscripts.map((m) => [m.id, m]));
    expect(byId["The-Quasi-Riemann-Hypothesis-September-30-2026"]?.status).toBe(
      "formalized",
    );
    expect(byId["Uniform-exclusion-of-Landau-Siegel-zeros-October-1-2026"]?.status).toBe(
      "formalized",
    );
    // The alternate proof is in a formalized family, but its scope page does not list it.
    expect(byId["The-Quasi-Riemann-Hypothesis-October-5-2026"]?.status).toBe(
      "manuscript",
    );
  });
  it("never labels an unformalized result formalized", () => {
    for (const id of ["195", "223"]) {
      const f = family(ix, id);
      expect(f.formalization).toBeNull();
      expect(f.status).toBe("manuscript");
      expect(f.manuscripts.every((m) => m.status === "manuscript")).toBe(true);
    }
  });
  it("keeps the Lean statements, their declarations and the catalogue's own review status", () => {
    const f = family(ix, "003").formalization!;
    expect(f.statements.map((s) => s.statement_path)).toEqual([
      "lean/ComparatorChallenges/QuasiRiemannHypothesis.lean",
      "lean/ComparatorChallenges/DirichletSevenEighths.lean",
      "lean/ComparatorChallenges/HeckeSevenEighths.lean",
      "lean/ComparatorChallenges/SiegelZeros.lean",
    ]);
    expect(f.statements[0]?.theorems).toEqual([
      "OAI.riemannZeta_ne_zero_of_seven_eighths_lt_re",
    ]);
    expect(f.statements.every((s) => s.solution_present)).toBe(true);
    expect(f.scope).toMatch(/The paper's later applications are not included/);
    expect(ix.catalogue.review_status).toBe("unchecked");
    expect(ix.catalogue.formalization_scope).toBe("Partial progress.");
  });
  it("keeps a reasoning summary apart, with its own status", () => {
    const f = family(ix, "017");
    expect(f.reasoning_summary).toEqual({
      path: "reasoning_traces/irrationality-exponent-of-pi.pdf",
      subject: "The irrationality exponent of π",
      status: "reasoning-summary",
    });
    expect(f.status).toBe("formalized");
    expect(family(ix, "003").reasoning_summary).toBeNull();
  });
  it("holds a family with several manuscripts, each with its own citation and abstract", () => {
    const f = family(ix, "223");
    expect(f.manuscripts).toHaveLength(6);
    for (const m of f.manuscripts) {
      expect(m.citation?.key).toBe(`OAI:${m.id}`);
      expect(m.citation?.author).toBe("OpenAI");
      expect(m.abstract.length).toBeGreaterThan(50);
      expect(m.path.startsWith(`preprints/${m.id}/`)).toBe(true);
    }
  });
  it("makes counterexamples first-class, in the repository's own words", () => {
    const f = family(ix, "195");
    expect(f.kinds).toContain("counterexample");
    expect(f.kind_basis).toContainEqual({
      kind: "counterexample",
      field: "title",
      phrase: "counterexample",
    });
  });
  it("never flattens attribution: a manuscript written with human assistance says so", () => {
    const m = family(ix, "003").manuscripts.find(
      (x) => x.id === "The-Quasi-Riemann-Hypothesis-October-5-2026",
    )!;
    expect(m.notes).toEqual(["This paper was written with human assistance."]);
    expect(ix.collection.sections.map((s) => s.heading)).toEqual([
      "Readme",
      "How the results were produced",
    ]);
    expect(ix.collection.sections[1]?.text).toMatch(/human edited for readability/);
    expect(ix.catalogue.related_formalizations[0]).toEqual({
      id: "https://github.com/leanprover-community/mathlib4",
      relationship: "builds-on",
    });
    expect(ix.license.spdx).toBe("Apache-2.0");
  });
});

describe("the catalogue's own formats", () => {
  it("reads a link whose path holds parentheses", () => {
    expect(
      markdownLink(
        "[Sharp integral fillings in CAT(0) spaces](preprints/Sharp-integral-fillings-in-CAT(0)-spaces-September-23-2026/paper.pdf) — note",
      ),
    ).toMatchObject({
      label: "Sharp integral fillings in CAT(0) spaces",
      target:
        "preprints/Sharp-integral-fillings-in-CAT(0)-spaces-September-23-2026/paper.pdf",
    });
    const line = "[a](b(c)d) — rest";
    expect(line.slice(markdownLink(line)!.end)).toBe(" — rest");
  });
  it("reads nested TeX groups and escaped braces", () => {
    expect(
      texGroups(
        "\\resultentry{001}{A $\\{x\\}$ title}{$\\overline{\\mathbb Q}$}{x}",
        12,
        4,
      ),
    ).toEqual(["001", "A $\\{x\\}$ title", "$\\overline{\\mathbb Q}$", "x"]);
  });
  it("reads a citation fenced with tildes as well as with backticks", () => {
    const readme = [
      "# [Title](paper.pdf)",
      "",
      "**Author:** OpenAI",
      "",
      "**Date:** October 5, 2026",
      "",
      "## Citation",
      "",
      "~~~bibtex",
      "@misc{OAI:Title-October-5-2026,",
      "  author = {{OpenAI}},",
      "  title = {{Title}},",
      "  howpublished = {OpenAI Math Release preprint \\href{https://github.com/openai/math/blob/main/preprints/Title-October-5-2026/paper.pdf}{OAI:Title}},",
      "  year = {2026}",
      "}",
      "~~~",
    ].join("\n");
    const r = parseManuscriptReadme(readme);
    expect(r.citation?.key).toBe("OAI:Title-October-5-2026");
    expect(r.date).toBe("October 5, 2026");
    expect(r.notes).toEqual([]);
  });
});

describe("the pinned index", () => {
  it("passes every check, and the licence beside it is the one it hashed", () => {
    expect(indexErrors(pinned)).toEqual([]);
    expect(pinned.repository).toBe("openai/math");
    expect(pinned.commit).toBe("3344da59991ed94f9ba711217b29c1d760badfa6");
    expect(pinned.counts).toEqual({
      disciplines: 17,
      families: 375,
      formalizations: 248,
      manuscripts: 730,
      reasoning_summaries: 10,
      rejected: 0,
      statements: 464,
      unverified_families: 6,
      unverified_manuscripts: 9,
    });
    const license = readFileSync(new URL("./data/LICENSE.md", import.meta.url), "utf8");
    const fenced = /```\n([\s\S]*?)```/.exec(license)?.[1] ?? "";
    expect(sha256(fenced)).toBe(pinned.license.sha256);
    expect(fenced).toMatch(/Apache License\s+Version 2\.0/);
  });

  it("keeps the Hodge family's narrower CM scope and excludes withdrawn October 7 papers", () => {
    const hodge = family(pinned, "032");
    expect(hodge.title).toBe("The rational Hodge conjecture for CM abelian varieties");
    expect(hodge.formalization?.path).toBe("lean/docs/032.md");
    expect(hodge.formalization?.papers).toEqual([
      "preprints/The-rational-Hodge-conjecture-for-CM-abelian-varieties-October-6-2026/paper.pdf",
    ]);
    expect(hodge.manuscripts.some(({ id }) => id.endsWith("-October-7-2026"))).toBe(
      false,
    );
  });
});
