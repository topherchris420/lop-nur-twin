import { describe, expect, it } from "vitest";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import { fixtureDesign } from "../autonomy/discoveryFixtures.js";
import {
  RESEARCH_SECTIONS,
  researchScope,
  type ManuscriptDraft,
} from "../../bethesda/rain/researchProtocol.js";
import {
  compileManuscript,
  deliveryGaps,
  researchFigure,
  validateManuscript,
  type PaperEvidence,
} from "./manuscript.js";
import { fixtureLiterature } from "./fixtures.js";
const first: DiscoveryResult = {
  design_id: "ND-first",
  question: "Test question",
  design: fixtureDesign(),
  unit: "count",
  operational_hypothesis: "A bounded test hypothesis",
  hypothesis: "An inferred hypothesis",
  purpose: "exploratory",
  parent: null,
  evidence_ids: [],
  run_id: "BX-first",
  registry_run_id: "V3D-EXP-0001-RUN-0001",
  verdict: "supported",
  replay: true,
  measurements: { primary_delta_mean: 2.25 },
  per_seed: [{ seed: 101, control: 1, treatment: 3.25, delta: 2.25 }],
  critique: null,
  record_path: "records/BX-first.json",
};
const second = {
  ...first,
  design_id: "ND-child",
  run_id: "BX-child",
  parent: first.design_id,
};
const evidence: PaperEvidence = {
  goal: "A simulated question",
  generation: "scripted",
  model: "test",
  charter_sha256: "a".repeat(64),
  sources: fixtureLiterature("fixture", 1).sources,
  results: [first, second],
};
const draft = (): ManuscriptDraft => ({
  title: "Test manuscript",
  paragraphs: RESEARCH_SECTIONS.map((section) => ({
    section,
    text: "The paired mean was {{metric:BX-first:primary_delta_mean}}. This describes a simulation.",
    source_ids: evidence.sources.map((s) => s.id),
    run_ids: ["BX-first"],
  })),
});
describe("evidence-bound manuscript compiler", () => {
  it("materializes metrics, seeds and methods from host evidence", () => {
    const output = compileManuscript(draft(), evidence, "figure.svg");
    expect(output).toContain("2.25");
    expect(output).toContain("101");
    expect(output).not.toContain("{{metric:");
    expect(output).toContain("SCRIPTED INTEGRATION DEMONSTRATION");
    expect(output).toContain("requires human scientific review");
    expect(researchFigure(evidence)).toContain('width="180"');
  });
  it("gives heterogeneous measurements separate figure scales", () => {
    const other = structuredClone(second);
    other.unit = "m";
    other.per_seed[0]!.delta = 100;
    const figure = researchFigure({ ...evidence, results: [first, other] });
    expect(figure.match(/width="180"/g)).toHaveLength(2);
    expect(figure).toContain("(m)");
    expect(figure).toContain("Each metric and unit has its own scale");
  });
  it.each([
    [
      "invented source",
      (d: ManuscriptDraft) => {
        d.paragraphs[0]!.source_ids = ["invented"];
      },
    ],
    [
      "invented metric",
      (d: ManuscriptDraft) => {
        d.paragraphs[0]!.text = "{{metric:BX-first:unmeasured}}";
      },
    ],
    [
      "uncited run",
      (d: ManuscriptDraft) => {
        d.paragraphs[0]!.run_ids = [];
      },
    ],
    [
      "invented quantity",
      (d: ManuscriptDraft) => {
        d.paragraphs[0]!.text = "The effect was 99.";
      },
    ],
    [
      "unsafe link",
      (d: ManuscriptDraft) => {
        d.paragraphs[0]!.text = "Read https://untrusted.invalid";
      },
    ],
    [
      "duplicate section",
      (d: ManuscriptDraft) => {
        d.paragraphs[1]!.section = "abstract";
      },
    ],
  ])("rejects %s", (_name, alter) => {
    const d = draft();
    alter(d);
    expect(validateManuscript(d, evidence).length).toBeGreaterThan(0);
    expect(() => compileManuscript(d, evidence, "figure.svg")).toThrow();
  });
  it("keeps delivery incomplete for missing follow-up, literature, replication or registry admission", () => {
    const scope = researchScope(evidence.goal, true);
    expect(deliveryGaps(scope, evidence)).toEqual([]);
    expect(
      deliveryGaps({ ...scope, require_confirmation: true }, evidence).join(" "),
    ).toContain("confirmatory replication");
    expect(deliveryGaps(scope, { ...evidence, sources: [] }).join(" ")).toContain(
      "literature",
    );
    expect(deliveryGaps(scope, { ...evidence, results: [first] }).join(" ")).toContain(
      "follow-up",
    );
    expect(
      deliveryGaps(scope, {
        ...evidence,
        results: [{ ...first, registry_run_id: null }, second],
      }).join(" "),
    ).toContain("admission");
  });
});
