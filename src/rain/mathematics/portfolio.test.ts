import { describe, expect, it } from "vitest";
import { MathematicalSubstrate } from "./substrate";
import { bundledIndex } from "./bundled";
import { PORTFOLIO_QUESTIONS, scoutPortfolio } from "./portfolio";

describe("portfolio mathematics candidate scouting", () => {
  const substrate = MathematicalSubstrate.load(
    bundledIndex(),
    () => new Date("2026-10-09T12:00:00.000Z"),
  );
  it("covers each featured project once, with a test and an explicit scope", () => {
    expect(PORTFOLIO_QUESTIONS).toHaveLength(8);
    expect(new Set(PORTFOLIO_QUESTIONS.map((x) => x.repository)).size).toBe(8);
    for (const p of PORTFOLIO_QUESTIONS) {
      expect(p.question.length).toBeGreaterThan(30);
      expect(p.next_test.length).toBeGreaterThan(25);
      expect(p.scope.length).toBeGreaterThan(30);
    }
  });
  it("never calls a lexical candidate a proven application", () => {
    const report = scoutPortfolio(substrate);
    expect(report.schema).toBe("rain-math-portfolio/v1");
    expect(report.epistemic_status).toBe("candidate_references_only");
    expect(report.projects).toHaveLength(8);
    for (const p of report.projects) {
      expect(p.findings.some((f) => f.id === "assumptions_unmapped") || p.candidates.length === 0).toBe(true);
      for (const c of p.candidates) {
        expect(c.source_url).toContain(report.provenance.commit);
        expect(c.manuscript_urls.every((url) => url.includes(report.provenance.commit))).toBe(true);
        expect(c.matched_terms.length).toBeGreaterThan(0);
        expect(["formalized", "manuscript", "unverified"]).toContain(c.catalogue_status);
      }
    }
  });
  it("has stable, read-only results for a scoped project and rejects unknown repositories", () => {
    const first = scoutPortfolio(substrate, "circle");
    expect(first.projects).toHaveLength(1);
    expect(first.projects[0]?.repository).toBe("circle");
    expect(scoutPortfolio(substrate, "circle")).toEqual(first);
    expect(() => scoutPortfolio(substrate, "not-a-project")).toThrow(/Unknown portfolio/);
  });
});
