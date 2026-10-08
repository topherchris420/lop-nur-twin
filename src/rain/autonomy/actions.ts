/**
 * What the autonomous researcher may ask for: a closed vocabulary.
 *
 * The model answers every question with one JSON object, constrained by a
 * JSON schema built for that question (the design and result ids it may name
 * are enumerated), and every answer is checked here before anything acts on
 * it. The model has no tool beyond these:
 *
 *   inspect_result      read one recorded result (read-only)
 *   inspect_design      read one design's protocol (read-only)
 *   propose_experiment  ask for one of the charter's designs, in its own words
 *   stop                say that no listed design would tell it anything new
 *   record_analysis     the analyst's reading of one result
 *
 * There is no action that writes a file, opens a URL, runs a command, edits a
 * definition, a record, the evidence or the registry, or touches the city —
 * there is no field to put any of that in. A proposal names a design id; the
 * host writes the experiment (`standing.ts`), the policy decides whether it
 * may run, and the model's words are kept, labelled, beside it. Text is
 * bounded and refused if it holds control, bidirectional or zero-width
 * characters (`UNSAFE_TEXT`), so nothing a model writes can rewrite a
 * terminal or read differently from what it contains.
 *
 * Shared with the tests; imports nothing that acts.
 */
import { UNSAFE_TEXT } from "../protocol.js";
import type { Checked } from "../../bethesda/rain/validation.js";

export const RESEARCH_ACTIONS = [
  "propose_experiment",
  "inspect_result",
  "inspect_design",
  "stop",
] as const;
export type ResearchActionKind = (typeof RESEARCH_ACTIONS)[number];
export const READINGS = ["supports", "contradicts", "inconclusive"] as const;
export type Reading = (typeof READINGS)[number];

export const TEXT_LIMITS = {
  id: 40,
  question: 400,
  hypothesis: 600,
  rationale: 1000,
  stop: 400,
  interpretation: 1500,
  note: 300,
  ranking: 3,
  notes: 3,
} as const;

export interface ResearchAction {
  action: ResearchActionKind;
  design: string;
  experiment: string;
  question: string;
  hypothesis: string;
  competing_hypothesis: string;
  rationale: string;
  ranking: string[];
  stop_reason: string;
}
export const RESEARCH_KEYS = [
  "action",
  "design",
  "experiment",
  "question",
  "hypothesis",
  "competing_hypothesis",
  "rationale",
  "ranking",
  "stop_reason",
] as const satisfies readonly (keyof ResearchAction)[];

export interface Analysis {
  action: "record_analysis";
  reading: Reading;
  interpretation: string;
  caveats: string[];
  open_questions: string[];
}
export const ANALYSIS_KEYS = [
  "action",
  "reading",
  "interpretation",
  "caveats",
  "open_questions",
] as const satisfies readonly (keyof Analysis)[];

const str = (maxLength: number, values?: readonly string[]) =>
  values ? { type: "string", enum: [...values] } : { type: "string", maxLength };

/**
 * The schema the researcher's answer is constrained to. Ids are enumerated, so
 * a schema-following server cannot name a design the charter does not list;
 * the host checks again regardless.
 */
export function researchActionSchema(
  designs: readonly string[],
  experiments: readonly string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [...RESEARCH_KEYS],
    properties: {
      action: str(0, RESEARCH_ACTIONS),
      design: str(TEXT_LIMITS.id, ["", ...designs]),
      experiment: str(TEXT_LIMITS.id, ["", ...experiments]),
      question: str(TEXT_LIMITS.question),
      hypothesis: str(TEXT_LIMITS.hypothesis),
      competing_hypothesis: str(TEXT_LIMITS.hypothesis),
      rationale: str(TEXT_LIMITS.rationale),
      ranking: {
        type: "array",
        items: str(TEXT_LIMITS.id, designs),
        maxItems: TEXT_LIMITS.ranking,
      },
      stop_reason: str(TEXT_LIMITS.stop),
    },
  };
}

export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...ANALYSIS_KEYS],
  properties: {
    action: str(0, ["record_analysis"]),
    reading: str(0, READINGS),
    interpretation: str(TEXT_LIMITS.interpretation),
    caveats: { type: "array", items: str(TEXT_LIMITS.note), maxItems: TEXT_LIMITS.notes },
    open_questions: {
      type: "array",
      items: str(TEXT_LIMITS.note),
      maxItems: TEXT_LIMITS.notes,
    },
  },
};

class Check {
  readonly errors: string[] = [];
  fail(message: string) {
    this.errors.push(message);
  }
  text(v: unknown, field: string, max: number, required: boolean): string {
    if (typeof v !== "string") {
      this.fail(`${field} must be a string`);
      return "";
    }
    const t = v.trim();
    if (UNSAFE_TEXT.test(t)) this.fail(`${field} holds control or invisible characters`);
    if (t.length > max) this.fail(`${field} exceeds ${max} characters`);
    if (required && !t) this.fail(`${field} is required for this action`);
    return t;
  }
  list(v: unknown, field: string, max: number, each: number): string[] {
    if (!Array.isArray(v)) {
      this.fail(`${field} must be an array`);
      return [];
    }
    if (v.length > max) this.fail(`${field} holds more than ${max} items`);
    return v.slice(0, max).map((x, i) => this.text(x, `${field}[${i}]`, each, true));
  }
}

const closed = (raw: Record<string, unknown>, keys: readonly string[], c: Check) => {
  const extra = Object.keys(raw).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in raw));
  if (extra.length)
    c.fail(`unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
  if (missing.length)
    c.fail(`missing field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
};

/**
 * Check the researcher's answer. `designs` are the charter's design ids,
 * `experiments` the results it may inspect, `toolsLeft` how many read-only
 * calls remain this iteration.
 */
export function parseResearchAction(
  raw: Record<string, unknown>,
  allowed: {
    designs: ReadonlySet<string>;
    experiments: ReadonlySet<string>;
    toolsLeft: number;
  },
): Checked<ResearchAction> {
  const c = new Check();
  closed(raw, RESEARCH_KEYS, c);
  const action = raw.action;
  if (!(RESEARCH_ACTIONS as readonly unknown[]).includes(action))
    c.fail(`action must be one of ${RESEARCH_ACTIONS.join(", ")}`);
  const kind = action as ResearchActionKind;
  const proposing = kind === "propose_experiment";
  const value: ResearchAction = {
    action: kind,
    design: c.text(raw.design, "design", TEXT_LIMITS.id, false),
    experiment: c.text(raw.experiment, "experiment", TEXT_LIMITS.id, false),
    question: c.text(raw.question, "question", TEXT_LIMITS.question, proposing),
    hypothesis: c.text(raw.hypothesis, "hypothesis", TEXT_LIMITS.hypothesis, proposing),
    competing_hypothesis: c.text(
      raw.competing_hypothesis,
      "competing_hypothesis",
      TEXT_LIMITS.hypothesis,
      proposing,
    ),
    rationale: c.text(raw.rationale, "rationale", TEXT_LIMITS.rationale, proposing),
    ranking: c.list(raw.ranking, "ranking", TEXT_LIMITS.ranking, TEXT_LIMITS.id),
    stop_reason: c.text(
      raw.stop_reason,
      "stop_reason",
      TEXT_LIMITS.stop,
      kind === "stop",
    ),
  };
  if ((proposing || kind === "inspect_design") && !allowed.designs.has(value.design))
    c.fail(`design ${JSON.stringify(value.design)} is not one the charter lists`);
  if (kind === "inspect_result" && !allowed.experiments.has(value.experiment))
    c.fail(`experiment ${JSON.stringify(value.experiment)} is not a recorded result`);
  if ((kind === "inspect_result" || kind === "inspect_design") && allowed.toolsLeft < 1)
    c.fail(
      "no read-only tool calls are left this iteration: propose an experiment or stop",
    );
  // One action per answer: a stop that names designs, or a proposal that
  // gives a reason to stop, is ambiguous, and an ambiguous answer is refused.
  if (kind === "stop" && (value.design || value.ranking.length))
    c.fail(
      "a stop names no design and no ranking: answer either stop or propose_experiment",
    );
  if (proposing && value.stop_reason)
    c.fail("a proposal gives no stop_reason: answer either propose_experiment or stop");
  for (const id of value.ranking)
    if (!allowed.designs.has(id))
      c.fail(`ranking names ${JSON.stringify(id)}, not a listed design`);
  if (new Set(value.ranking).size !== value.ranking.length)
    c.fail("ranking names a design twice");
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value };
}

export function parseAnalysis(raw: Record<string, unknown>): Checked<Analysis> {
  const c = new Check();
  closed(raw, ANALYSIS_KEYS, c);
  if (raw.action !== "record_analysis") c.fail("action must be record_analysis");
  if (!(READINGS as readonly unknown[]).includes(raw.reading))
    c.fail(`reading must be one of ${READINGS.join(", ")}`);
  const value: Analysis = {
    action: "record_analysis",
    reading: raw.reading as Reading,
    interpretation: c.text(
      raw.interpretation,
      "interpretation",
      TEXT_LIMITS.interpretation,
      true,
    ),
    caveats: c.list(raw.caveats, "caveats", TEXT_LIMITS.notes, TEXT_LIMITS.note),
    open_questions: c.list(
      raw.open_questions,
      "open_questions",
      TEXT_LIMITS.notes,
      TEXT_LIMITS.note,
    ),
  };
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value };
}

/**
 * The reading the pre-registered criteria imply. A model's reading is checked
 * against it and its disagreement is recorded; the criteria stand either way.
 */
export function readingFor(verdict: string): Reading {
  return verdict === "supported"
    ? "supports"
    : verdict === "not_supported"
      ? "contradicts"
      : "inconclusive";
}
