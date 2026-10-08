/**
 * A research session in the lab: what the room presents, and what it offers.
 *
 * Presentation only. The embodiment layer is driven by the same neutral event
 * vocabulary R.A.I.N.'s own Godot client consumes
 * (`godot_client/contracts/NEUTRAL_EVENT_CONTRACT.md`: `conversation_started`,
 * `agent_utterance`, `conversation_ended`), derived from a validated meeting
 * record. Staging — who is lit, who turns to whom — is deterministic and
 * carries no information beyond the record: it never animates confidence,
 * agreement or truth.
 */
import {
  EXPERIMENT_PROPOSAL_SCHEMA,
  LOCATION_LABELS,
  METRIC_LABELS,
  SCENARIO_LABELS,
  type Direction,
  type ExperimentProposal,
  type LocationId,
  type MeetingRecord,
  type MetricId,
  type Perspective,
  type ProposalOption,
  type ScenarioId,
} from "./contracts";
import type { MathematicalBasisEntry } from "../../rain/mathematics/contracts";
import type { ExperimentRecord } from "./record";
import type { AvatarObservation } from "./presence";

export type NeutralEvent =
  | { type: "conversation_started"; conversation_id: string; participants: string[] }
  | { type: "agent_utterance"; turn_id: string; agent_id: string; text: string }
  | { type: "conversation_ended"; conversation_id: string };

/** One meeting as R.A.I.N.'s neutral events. The words are the record's, unchanged. */
export function neutralEvents(m: MeetingRecord): NeutralEvent[] {
  const participants = [...new Set(m.turns.map((t) => t.speaker.toLowerCase()))];
  return [
    { type: "conversation_started", conversation_id: m.meeting_id, participants },
    ...m.turns.map((t): NeutralEvent => ({
      type: "agent_utterance",
      turn_id: `${m.meeting_id}:t${t.index}`,
      agent_id: t.speaker.toLowerCase(),
      text: [t.lead, ...t.quotes.map((q) => `“${q.text}”`), t.coda]
        .filter(Boolean)
        .join(" "),
    })),
    { type: "conversation_ended", conversation_id: m.meeting_id },
  ];
}

/** Who is speaking after `revealed` turns, or null between and after turns. */
export function currentSpeaker(
  m: MeetingRecord | null,
  revealed: number,
): Perspective | null {
  if (!m || revealed < 1 || revealed > m.turns.length) return null;
  return m.turns[revealed - 1]!.speaker;
}

/**
 * Disagreement stays branched: the turns that answer a challenge are kept as
 * their own branch, never merged into the verdict's agreement. A meeting
 * without a verdict (R.A.I.N.'s model meeting states none) has no branches:
 * the lab does not infer where the room stands.
 */
export function branches(m: MeetingRecord) {
  if (!m.verdict) return null;
  const challenge = m.turns.filter((t) =>
    /counter|pushback|objection|challenge/i.test(t.move),
  );
  return {
    agreed: m.verdict.agreed,
    contested: m.verdict.contested,
    challengers: [...new Set(challenge.map((t) => t.speaker))],
    turns: challenge.map((t) => t.index),
  };
}

// ---------------------------------------------------------------------------
// The host's experiment options. R.A.I.N.'s bounded router may choose one of
// these, or none; it can never write a definition. Every supported
// scenario/place pair is offered once, with the measurement that pair most
// directly observes — offered by mechanics, never filtered by what seems
// promising.
// ---------------------------------------------------------------------------
interface Template {
  scenario: ScenarioId;
  location: LocationId;
  metric: MetricId;
  direction: Direction;
  effect: number;
}
const TEMPLATES: Template[] = [
  {
    scenario: "metro_closure",
    location: "bethesda_metro",
    metric: "cohort_mean_distance_m",
    direction: "increase",
    effect: 10,
  },
  {
    scenario: "fire",
    location: "bethesda_row",
    metric: "leaving",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "fire",
    location: "veterans_park",
    metric: "leaving",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "fire",
    location: "farm_womens_market",
    metric: "leaving",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "gas_leak",
    location: "bethesda_row",
    metric: "leaving",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "gas_leak",
    location: "farm_womens_market",
    metric: "leaving",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "festival",
    location: "bethesda_row",
    metric: "watching",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "rally",
    location: "veterans_park",
    metric: "watching",
    direction: "increase",
    effect: 3,
  },
  {
    scenario: "crash",
    location: "woodmont_bethesda",
    metric: "vehicles_held",
    direction: "increase",
    effect: 1,
  },
  {
    scenario: "outage",
    location: "downtown",
    metric: "vehicles_held",
    direction: "increase",
    effect: 1,
  },
  {
    scenario: "storm",
    location: "downtown",
    metric: "sheltering",
    direction: "increase",
    effect: 3,
  },
];
export const ESCALATE = "ESCALATE_TO_HUMAN";
export const OPTIONS: (ProposalOption & { template: Template | null })[] = [
  ...TEMPLATES.map((t, i) => ({
    id: `X${i + 1}`,
    description: `${SCENARIO_LABELS[t.scenario]} at ${LOCATION_LABELS[t.location]} against a matched no-event control (3 seeds): prediction — ${METRIC_LABELS[t.metric].toLowerCase()} ${t.direction}s by at least ${t.effect}.`,
    template: t,
  })),
  {
    id: ESCALATE,
    description: "None of these experiments tests the question.",
    template: null,
  },
];

/** The host's own sentence for what an option tests, in one direction. */
export function optionHypothesis(optionId: string, direction: Direction): string | null {
  const t = OPTIONS.find((o) => o.id === optionId)?.template;
  if (!t) return null;
  const label = METRIC_LABELS[t.metric].toLowerCase();
  return `In the Bethesda simulator, ${SCENARIO_LABELS[t.scenario].toLowerCase()} at ${LOCATION_LABELS[t.location]} makes ${label} ${direction === "increase" ? "rise" : "fall"} by at least ${t.effect} against a matched no-event control, in every seed.`;
}

export function proposalFrom(
  optionId: string,
  input: {
    question: string;
    meetingId: string | null;
    origin: ExperimentProposal["origin"];
    decision: ExperimentProposal["rain_decision"];
    hypothesis?: string;
    /** The mathematics the proposal cites; the host copies it, never writes it. */
    basis?: readonly MathematicalBasisEntry[];
    /**
     * The pre-registered direction, when it is not the option's own. The
     * option's threshold stays: only which way it is tested changes.
     */
    direction?: Direction;
    seeds?: readonly number[];
  },
): ExperimentProposal | null {
  const t = OPTIONS.find((o) => o.id === optionId)?.template;
  if (!t) return null;
  const direction = input.direction ?? t.direction;
  return {
    schema: EXPERIMENT_PROPOSAL_SCHEMA,
    proposal_id: `${input.origin}-${optionId}-${Date.now().toString(36)}`,
    origin: input.origin,
    question: input.question.slice(0, 500),
    hypothesis: input.hypothesis ?? optionHypothesis(optionId, direction)!,
    scenario: t.scenario,
    location: t.location,
    primary_metric: t.metric,
    expected_direction: direction,
    minimum_effect: t.effect,
    comparison: "matched_seed_control",
    seeds: [...(input.seeds ?? [101, 202, 303])],
    warmup_ticks: 300,
    observation_window_ticks: 1200,
    rain_decision: input.decision,
    meeting_id: input.meetingId,
    mathematical_basis: (input.basis ?? []).map((e) => structuredClone(e)),
  };
}

// ---------------------------------------------------------------------------
// The six evidence categories. They never blur: each item has exactly one,
// shown as a word and a glyph, not by colour alone.
// ---------------------------------------------------------------------------
export const CATEGORIES = {
  SOURCE: {
    glyph: "▤",
    note: "Verbatim text from a corpus document, located by R.A.I.N.'s verifier.",
  },
  INTERPRETATION: { glyph: "◌", note: "A perspective's words. Prose, not evidence." },
  HYPOTHESIS: { glyph: "◇", note: "A claim put up for testing. Not a result." },
  OBSERVATION: {
    glyph: "◉",
    note: "A typed packet from the simulator's state at one tick.",
  },
  "SIMULATION RESULT": {
    glyph: "▲",
    note: "Matched-arm measurements. They describe the simulator, not Bethesda.",
  },
  "VALIDATED CHECK": {
    glyph: "✓",
    note: "A deterministic check that passed. A passed check is not a true claim.",
  },
} as const;
export type Category = keyof typeof CATEGORIES;
export interface EvidenceItem {
  id: string;
  category: Category;
  title: string;
  body: string;
  provenance: string;
  grounded: boolean | null;
}

export function evidenceItems(
  meeting: MeetingRecord | null,
  records: readonly ExperimentRecord[],
  avatar: readonly AvatarObservation[] = [],
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const o of avatar)
    items.push({
      id: `avatar:${o.who}:${o.tick}`,
      category: "OBSERVATION",
      title: `${o.place} · tick ${o.tick} · requested by ${o.who}`,
      body: Object.entries(o.packet.metrics)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
      provenance: `${o.note} World ${o.packet.world_hash} · map ${o.packet.data_hash.slice(0, 12)}…`,
      grounded: null,
    });
  if (meeting) {
    const model = meeting.generation === "model";
    for (const t of meeting.turns) {
      items.push({
        id: `${meeting.meeting_id}:i${t.index}`,
        category: "INTERPRETATION",
        title: `${t.speaker} · ${t.move}`,
        body: [t.lead, t.coda].filter(Boolean).join(" "),
        // Each turn says who wrote it: in a model meeting, R.A.I.N.'s own fixed
        // lines are its code's, not the model's.
        provenance:
          t.generation === "model"
            ? `generated by ${meeting.model} through ${meeting.engine}`
            : model
              ? `a fixed line in R.A.I.N.'s code (${meeting.engine}), not the model's`
              : `scripted by ${meeting.engine}`,
        grounded: t.quotes.some((q) => q.verified),
      });
      t.quotes.forEach((q, i) =>
        items.push({
          id: `${meeting.meeting_id}:s${t.index}.${i}`,
          category: "SOURCE",
          title: `${q.source}:${q.line}`,
          body: q.text,
          provenance: q.verified
            ? `verified verbatim at characters ${q.span_start}–${q.span_end} by the runtime's verifyQuote; corpus ${meeting.audit.corpus_sha256.slice(0, 12)}… (${meeting.audit.corpus_files} files) at ${meeting.rain.repository} ${meeting.rain.commit?.slice(0, 12) ?? "unknown"}`
            : "NOT VERIFIED: the span was not found in the corpus",
          grounded: q.verified,
        }),
      );
    }
    // Quotations that did not verify are not carried as sources; they are counted.
    const unverified = meeting.turns.reduce((n, t) => n + t.unverified, 0);
    items.push({
      id: `${meeting.meeting_id}:audit`,
      category: "VALIDATED CHECK",
      title: "Citation audit",
      body: `${meeting.audit.verified} of ${meeting.audit.checked} quotes verified verbatim${unverified ? `; ${unverified} more quotation${unverified === 1 ? "" : "s"} did not verify and ${unverified === 1 ? "is" : "are"} not shown as a source` : ""}. A citation audit, not validated claims: a verified quote occurs in a source; it does not show the source is right or supports the conclusion.`,
      provenance: model
        ? "R.A.I.N.'s citation check in its model meeting, every quote re-verified by the runtime with verifyQuote, re-checked against the record by the lab"
        : "R.A.I.N. offline engine audit, re-checked against the record by the lab",
      grounded: meeting.audit.checked === meeting.audit.verified && unverified === 0,
    });
  }
  // The registry holds only records replay verified, but a record is data:
  // one of an unexpected shape loses its own items and never the library.
  const list = <T>(v: readonly T[]): readonly T[] => (Array.isArray(v) ? v : []);
  const isText = (v: unknown) => typeof v === "string";
  const itemsOf = (r: ExperimentRecord, out: EvidenceItem[]) => {
    if (r.definition)
      out.push({
        id: `${r.run_id}:h`,
        category: "HYPOTHESIS",
        title: `${r.experiment_id} hypothesis`,
        body: r.definition.hypothesis,
        // The mathematics a hypothesis cites is named here and listed nowhere
        // in this library: it is context for the claim, never evidence for it.
        provenance:
          `proposal ${r.definition.proposal.proposal_id} (${r.definition.proposal.origin})` +
          (r.definition.mathematical_basis?.length
            ? ` · cites ${r.definition.mathematical_basis.length} mathematical result${r.definition.mathematical_basis.length === 1 ? "" : "s"} as context, not evidence`
            : ""),
        grounded: null,
      });
    for (const check of list(r.validation))
      // The mathematical basis's form check stays in the Experiment Bay: in
      // this library it would read as mathematics validated, and mathematics
      // is never evidence here.
      if (check.ok && check.id !== "mathematics")
        out.push({
          id: `${r.run_id}:c:${check.id}`,
          category: "VALIDATED CHECK",
          title: check.label,
          body: check.detail,
          provenance: `host validation of ${r.experiment_id ?? "a rejected proposal"}`,
          grounded: null,
        });
    if (!r.run) return;
    for (const arm of list(r.run.arms)) {
      const last = arm.observations.at(-1);
      if (last)
        out.push({
          id: `${arm.id}:o`,
          category: "OBSERVATION",
          title: `${arm.arm} · seed ${arm.seed} · tick ${last.tick}`,
          body: Object.entries(last.metrics)
            .map(([k, v]) => `${k} ${v ?? "not measured"}`)
            .join(" · "),
          provenance: `${last.schema} from ${last.source}; world ${last.world_hash} · map ${last.data_hash.slice(0, 12)}…`,
          grounded: null,
        });
    }
    out.push({
      id: `${r.run_id}:result`,
      category: "SIMULATION RESULT",
      title: `${r.experiment_id} · ${r.outcome.state} · ${r.outcome.verdict.replaceAll("_", " ")}`,
      body: list(r.run.per_seed)
        .map(
          (s) =>
            `seed ${s.seed}: control ${s.control ?? "not measured"}, treatment ${s.treatment ?? "not measured"}, difference ${s.delta ?? "not computable"}`,
        )
        .join(" · "),
      provenance: `${r.run.evaluation.rule}: ${r.run.evaluation.summary}`,
      grounded: null,
    });
  };
  for (const r of records) {
    const out: EvidenceItem[] = [];
    try {
      itemsOf(r, out);
    } catch {
      continue;
    }
    // Every word shown is text; anything else would break the page that shows it.
    if (out.every((i) => [i.id, i.title, i.body, i.provenance].every(isText)))
      items.push(...out);
  }
  return items;
}
