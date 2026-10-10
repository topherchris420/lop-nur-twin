/** Scripted test fixture. It never represents Qwen or an Internet retrieval. */
import { DiscoveryFixtureModel } from "../autonomy/discoveryFixtures.js";
import type { StructuredRequest } from "../autonomy/models.js";
import {
  RESEARCH_SECTIONS,
  type ResearchSource,
} from "../../bethesda/rain/researchProtocol.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import { parseCrossref } from "./knowledge.js";
export class ResearchFixtureModel extends DiscoveryFixtureModel {
  override async complete(request: StructuredRequest) {
    if (!request.schemaName.startsWith("rain_research_")) return super.complete(request);
    this.requests.push(request);
    const data = JSON.parse(request.user) as {
      context?: { sources: ResearchSource[] };
      results?: DiscoveryResult[];
      metric_tokens?: { token: string; run_id: string; key: string }[];
    };
    const sources = data.context?.sources ?? [];
    const runs = data.results?.map((r) => r.run_id) ?? [];
    let answer: unknown;
    if (request.schemaName === "rain_research_contribution")
      answer = {
        question:
          "[scripted fixture] Which population conditions alter simulated watching?",
        hypothesis:
          "[scripted fixture] The same fire changes the watching count in different populations.",
        falsification:
          "[scripted fixture] No paired difference under the preregistered criteria would oppose the hypothesis.",
        rationale:
          "[scripted fixture] Use matched controls and retain the observed seed differences.",
        source_ids: sources.slice(0, 1).map((s) => s.id),
        evidence_run_ids: runs,
        disagreements: [
          "[scripted fixture] Absolute counts across seed panels do not establish an interaction.",
        ],
        next_experiment:
          "[scripted fixture] Follow the measured direction with a changed population.",
        search_queries: [],
        mathematical_assumptions: [
          "[scripted fixture] A catalogue match alone does not establish applicability.",
        ],
      };
    else if (request.schemaName === "rain_research_manuscript") {
      const tokens =
        data.metric_tokens
          ?.filter((m) => m.key === "primary_delta_mean")
          .map((m) => m.token) ?? [];
      answer = {
        title: "Illustrative urban disruption and population context",
        paragraphs: RESEARCH_SECTIONS.map((section) => ({
          section,
          text:
            section === "related_work"
              ? "The supplied manuscript excerpts and literature metadata motivate bounded experiments. Their reading scope does not establish empirical validation."
              : section === "limitations"
                ? "The results describe illustrative simulator rules. Seed panels differ between protocols and absolute counts cannot identify a population interaction. There is no real-world validation or significance test."
                : "The paired mean differences were " +
                  tokens.join(" and ") +
                  ". These exploratory measurements motivate further investigation without establishing a general behavioral law.",
          source_ids: sources.slice(0, 1).map((s) => s.id),
          run_ids: runs,
        })),
      };
    } else
      answer = {
        assessment: "ready_for_human_review",
        issues: [],
        unsupported_claims: [],
        alternative_explanations: [
          "[scripted fixture] Different populations and seed panels can explain differing absolute counts.",
        ],
        next_investigations: [
          "[scripted fixture] Consider a preregistered confirmatory replication.",
        ],
      };
    return {
      text: JSON.stringify(answer),
      reportedModel: this.model,
      promptTokens: null,
      completionTokens: null,
      latencyMs: 0,
      finishReason: "stop",
    };
  }
}
export function fixtureLiterature(query: string, limit: number) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(limit));
  return parseCrossref(
    JSON.stringify({
      message: {
        items: [
          {
            DOI: "10.5555/rain-scripted-literature-fixture",
            title: ["SCRIPTED LITERATURE FIXTURE: matched-control simulation"],
            abstract:
              "This explicitly scripted metadata fixture tests research source provenance. It is not a real scientific source.",
            author: [{ given: "Scripted", family: "Fixture" }],
            published: { "date-parts": [[2026]] },
          },
        ],
      },
    }),
    query,
    url.href,
    "2026-01-01T00:00:00.000Z",
    limit,
  );
}
