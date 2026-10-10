/** Pure contracts for a native research program. Data never grants execution authority. */
import { closed, checkData } from "./discoveryProtocol.js";
import { UNSAFE_TEXT } from "./contracts.js";

export const RESEARCH_SCOPE_SCHEMA = "rain-research-scope/v1" as const;
export const RESEARCH_SECTIONS = [
  "abstract",
  "introduction",
  "related_work",
  "discussion",
  "limitations",
  "conclusion",
] as const;
export interface ResearchScope {
  schema: typeof RESEARCH_SCOPE_SCHEMA;
  goal: string;
  literature: "offline" | "crossref";
  max_queries: number;
  results_per_query: number;
  minimum_experiments: number;
  require_confirmation: boolean;
  manuscript_revisions: number;
}
const words = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const texts = (maxItems: number, maxLength = 400) => ({
  type: "array",
  items: words(maxLength),
  maxItems,
});
export const RESEARCH_SCOPE = closed({
  schema: { type: "string", const: RESEARCH_SCOPE_SCHEMA },
  goal: words(400),
  literature: { type: "string", enum: ["offline", "crossref"] },
  max_queries: integer(0, 6),
  results_per_query: integer(1, 8),
  minimum_experiments: integer(2, 10),
  require_confirmation: { type: "boolean" },
  manuscript_revisions: integer(1, 3),
});
export function researchScope(goal: string, online: boolean): ResearchScope {
  const scope: ResearchScope = {
    schema: RESEARCH_SCOPE_SCHEMA,
    goal,
    literature: online ? "crossref" : "offline",
    max_queries: online ? 3 : 0,
    results_per_query: 5,
    minimum_experiments: 2,
    require_confirmation: false,
    manuscript_revisions: 2,
  };
  const errors = researchScopeErrors(scope);
  if (errors.length) throw new Error(errors.join("; "));
  return scope;
}
export function researchScopeErrors(raw: unknown): string[] {
  const checked = checkData<ResearchScope>(raw, RESEARCH_SCOPE);
  if (!checked.ok) return checked.errors;
  const s = checked.value;
  const errors: string[] = [];
  if (!s.goal.trim() || UNSAFE_TEXT.test(s.goal)) errors.push("Invalid research goal");
  if ((s.literature === "offline") !== (s.max_queries === 0))
    errors.push(
      "Offline scope must allow zero external queries; online scope requires a query budget",
    );
  return errors;
}
export interface ResearchSource {
  id: string;
  kind: "corpus" | "mathematics" | "literature";
  title: string;
  locator: string;
  sha256: string;
  excerpt: string;
  reading_scope: string;
  retrieved_at: string | null;
  authors: string[];
  year: string | null;
  doi: string | null;
}
export interface Contribution {
  question: string;
  hypothesis: string;
  falsification: string;
  rationale: string;
  source_ids: string[];
  evidence_run_ids: string[];
  disagreements: string[];
  next_experiment: string;
  search_queries: string[];
  mathematical_assumptions: string[];
}
export const CONTRIBUTION_SCHEMA = closed({
  question: words(400),
  hypothesis: words(600),
  falsification: words(600),
  rationale: words(1200),
  source_ids: texts(8, 100),
  evidence_run_ids: texts(6, 120),
  disagreements: texts(4, 600),
  next_experiment: words(800),
  search_queries: texts(2, 200),
  mathematical_assumptions: texts(4, 600),
});
export interface ResearchTurn {
  perspective: string;
  role: string;
  generation: "model" | "scripted";
  decision_id: string;
  contribution: Contribution;
}
export interface ManuscriptParagraph {
  section: (typeof RESEARCH_SECTIONS)[number];
  text: string;
  source_ids: string[];
  run_ids: string[];
}
export interface ManuscriptDraft {
  title: string;
  paragraphs: ManuscriptParagraph[];
}
export const MANUSCRIPT_SCHEMA = closed({
  title: words(200),
  paragraphs: {
    type: "array",
    minItems: 6,
    maxItems: 6,
    items: closed({
      section: { type: "string", enum: [...RESEARCH_SECTIONS] },
      text: words(2200),
      source_ids: texts(10, 100),
      run_ids: texts(10, 120),
    }),
  },
});
export interface ManuscriptReview {
  assessment: "ready_for_human_review" | "revise";
  issues: string[];
  unsupported_claims: string[];
  alternative_explanations: string[];
  next_investigations: string[];
}
export const MANUSCRIPT_REVIEW_SCHEMA = closed({
  assessment: { type: "string", enum: ["ready_for_human_review", "revise"] },
  issues: texts(8, 600),
  unsupported_claims: texts(8, 600),
  alternative_explanations: texts(6, 600),
  next_investigations: texts(6, 600),
});
export interface ResearchGraph {
  nodes: { id: string; kind: string; label: string; status: string }[];
  edges: { from: string; to: string; relation: string }[];
}
export interface ResearchView {
  program_id: string;
  goal: string;
  sources: ResearchSource[];
  turns: ResearchTurn[];
  graph: ResearchGraph;
  delivery: "in_progress" | "needs_revision" | "ready_for_human_review";
  gaps: string[];
  manuscript: string | null;
  artifacts: { name: string; path: string; sha256: string }[];
  review: ManuscriptReview | null;
}
