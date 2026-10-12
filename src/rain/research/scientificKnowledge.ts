/** Reconstructible scientific context over native receipts. Never writes or evaluates. */
import { sha256Json } from "../sha256.js";
import { corpusContext, corpusSourceManifest } from "./knowledge.js";
import pinnedCorpus from "../data/corpus.json" with { type: "json" };
import type { DiscoveryEntry } from "../autonomy/store.js";
import type { ResearchAssessment } from "../experiments/research.js";
import { verifyNumericalPlan, type NumericalPlan } from "../scientific/compiler.js";
import type { NumericalRecord } from "../scientific/numerical.js";
import type { NumericalPreregistration } from "../scientific/registry.js";
import type {
  ResearchSource,
  ResearchTurn,
} from "../../bethesda/rain/researchProtocol.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import {
  SCIENTIFIC_GRAPH_SCHEMA,
  type KnowledgeProvenance,
  type KnowledgeStanding,
  type ScientificKnowledgeGraph,
  type ScientificNode,
  type ScientificRelation,
} from "../../bethesda/rain/scientificKnowledgeProtocol.js";

const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const textId = (kind: string, text: string) =>
  kind + "-" + sha256Json(text.trim().toLowerCase().replace(/\s+/g, " ")).slice(0, 24);
export interface ScientificKnowledgeOptions {
  /** Explicit source override for fixtures or charter-restricted namespaces. */
  sources?: readonly ResearchSource[];
  registry?: readonly ResearchAssessment[];
  corpus_commit?: string | null;
}
export function buildScientificKnowledge(
  entries: readonly DiscoveryEntry[],
  options: ScientificKnowledgeOptions = {},
): ScientificKnowledgeGraph {
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const { sha256, ...body } = entry;
    if (
      entry.sequence !== index ||
      entry.previous !== previous ||
      sha256Json(body) !== sha256
    )
      throw new Error("Scientific graph refuses a broken native journal chain");
    previous = sha256;
  });
  const manifest = corpusSourceManifest();
  const sources =
    options.sources ??
    manifest.sources.flatMap((s) =>
      corpusContext("", 1, [s.id]).map((source) => ({
        ...source,
        excerpt:
          pinnedCorpus.files.find((f) => f.sha256 === source.sha256)?.text ??
          source.excerpt,
        reading_scope:
          "Pinned author-supplied manuscript; deterministic scan for explicitly stated assumptions and delimited equations. Content is not independently validated.",
      })),
    );
  const nodes = new Map<string, ScientificNode>();
  const edges = new Map<string, ScientificKnowledgeGraph["edges"][number]>();
  const journal = (entry: DiscoveryEntry): KnowledgeProvenance => ({
    kind: "journal",
    id: String(entry.sequence),
    sha256: entry.sha256,
    locator: "discovery/" + String(entry.sequence).padStart(8, "0") + ".json",
    detail: entry.kind + "; session " + entry.session,
  });
  const add = (
    id: string,
    kind: ScientificNode["kind"],
    label: string,
    status: string,
    standing: KnowledgeStanding,
    provenance: KnowledgeProvenance[],
    limitations: string[] = [],
  ) => {
    const existing = nodes.get(id);
    nodes.set(id, {
      id,
      kind,
      label,
      status,
      standing,
      provenance: [
        ...new Map(
          [...(existing?.provenance ?? []), ...provenance].map((p) => [
            p.sha256 + p.id,
            p,
          ]),
        ).values(),
      ],
      limitations,
    });
    return id;
  };
  const link = (
    from: string,
    to: string,
    relation: ScientificRelation,
    standing: KnowledgeStanding,
    provenance: KnowledgeProvenance[],
  ) => {
    const id = "edge-" + sha256Json({ from, to, relation, standing }).slice(0, 24);
    const prior = edges.get(id);
    edges.set(id, {
      id,
      from,
      to,
      relation,
      standing,
      provenance: [
        ...new Map(
          [...(prior?.provenance ?? []), ...provenance].map((p) => [p.sha256 + p.id, p]),
        ).values(),
      ],
    });
  };
  const gap = (owner: string, reason: string, provenance: KnowledgeProvenance[]) => {
    const id = textId("gap", owner + reason);
    add(id, "missing_evidence", reason, "unresolved", "host_observed", provenance);
    link(owner, id, "requires", "host_observed", provenance);
  };
  const source = (s: ResearchSource, receipt?: KnowledgeProvenance) => {
    const provenance: KnowledgeProvenance[] = [
      {
        kind: "corpus",
        id: s.id,
        sha256: s.sha256,
        locator: s.locator,
        detail: s.reading_scope,
      },
      ...(receipt ? [receipt] : []),
    ];
    add(s.id, "paper", s.title, s.reading_scope, "source_context", provenance, [
      "Source content is context, not independent scientific validation.",
    ]);
    // Only explicitly delimited mathematical text is indexed; no inferred equation.
    const equations = [
      ...s.excerpt.matchAll(/\$\$([\s\S]{1,1000}?)\$\$|\\\[([\s\S]{1,1000}?)\\\]/g),
    ].slice(0, 8);
    equations.forEach((m) => {
      const equation = (m[1] ?? m[2] ?? "").trim();
      const id = textId("equation", s.id + equation);
      add(
        id,
        "equation",
        equation,
        "quoted mathematical expression",
        "source_context",
        provenance,
        ["Expression was not proved, dimensionally verified or executed."],
      );
      link(s.id, id, "states", "source_context", provenance);
    });
    const explicitAssumptions = [
      ...s.excerpt.matchAll(
        /[^\n]{0,300}\bassum(?:e|es|ing|ption|ptions)\b[^\n]{0,600}/gi,
      ),
    ]
      .map((m) => ({ text: m[0].trim(), start: m.index + m[0].indexOf(m[0].trim()) }))
      .filter((m) => m.text.length > 20 && !/^#+\s*assumptions?\s*$/i.test(m.text))
      .slice(0, 8);
    for (const statement of explicitAssumptions) {
      const receipt = provenance.map((p) => ({
        ...p,
        detail:
          p.detail +
          "; quoted character range [" +
          statement.start +
          ", " +
          (statement.start + statement.text.length) +
          ")",
      }));
      const id = add(
        textId("assumption", statement.text),
        "assumption",
        statement.text,
        "explicit source statement; unverified",
        "source_context",
        receipt,
        [
          "Lexical extraction of stated assumptions; no entailment, applicability or truth assessment.",
        ],
      );
      link(s.id, id, "assumes", "source_context", receipt);
    }
  };
  sources.forEach((s) => source(s));
  const designLinks = new Map<string, string[]>();
  for (const entry of entries) {
    const p = object(entry.payload),
      provenance = [journal(entry)];
    if (entry.kind === "scientific-preregistration") {
      const plan = p.plan as NumericalPlan | undefined;
      if (!plan || verifyNumericalPlan(plan).length) continue;
      const id = plan.experiment_id;
      add(
        id,
        "protocol",
        plan.ir.question,
        "preregistered",
        "host_observed",
        provenance,
        plan.ir.limitations,
      );
      const hypothesis = add(
        textId("hypothesis", id + plan.ir.hypothesis),
        "hypothesis",
        plan.ir.hypothesis,
        "preregistered",
        "host_observed",
        provenance,
      );
      link(id, hypothesis, "tests", "host_observed", provenance);
      const question = add(
        textId("question", plan.design.question),
        "question",
        plan.design.question,
        "open",
        "model_suggested",
        provenance,
      );
      link(question, id, "asks", "model_suggested", provenance);
      const competing = add(
        textId("hypothesis", id + plan.design.competing_hypothesis),
        "hypothesis",
        plan.design.competing_hypothesis,
        "proposed competing interpretation",
        "model_suggested",
        provenance,
      );
      link(question, competing, "asks", "model_suggested", provenance);
      for (const paper of plan.design.provenance.source_ids)
        link(paper, id, "informs", "model_suggested", provenance);
      const falsification = add(
        textId("falsification", id + JSON.stringify(plan.ir.falsification)),
        "falsification",
        JSON.stringify(plan.ir.falsification),
        "preregistered",
        "host_observed",
        provenance,
      );
      link(hypothesis, falsification, "falsified_by", "host_observed", provenance);
    } else if (entry.kind === "scientific-record") {
      const record = entry.payload as NumericalRecord;
      const plan = record.plan;
      if (!plan || verifyNumericalPlan(plan).length) continue;
      const { sha256: recordHash, ...body } = record;
      const registration = entries.find(
        (e) =>
          e.session === entry.session &&
          e.sequence < entry.sequence &&
          e.kind === "scientific-preregistration" &&
          object(object(e.payload).plan).definition_sha256 === plan.definition_sha256,
      );
      const receipt = registration
        ? (object(registration.payload).receipt as NumericalPreregistration)
        : null;
      const replay = entries.find((e) => {
        const payload = object(e.payload);
        return (
          e.session === entry.session &&
          e.sequence > entry.sequence &&
          e.kind === "scientific-replay" &&
          payload.run_id === record.run_id &&
          payload.record_sha256 === recordHash &&
          payload.ok === true &&
          typeof payload.registry_run_id === "string" &&
          payload.registry_experiment_id === receipt?.experiment_id &&
          payload.registry_definition_sha256 === receipt?.registry_definition_sha256 &&
          /^[a-f0-9]{64}$/.test(String(payload.replay_sha256))
        );
      });
      const verified =
        !!receipt &&
        receipt.plan_sha256 === plan.definition_sha256 &&
        sha256Json(body) === recordHash &&
        !!replay &&
        record.result.completed &&
        record.result.error === null;
      const receipts = [
        ...provenance,
        ...(registration ? [journal(registration)] : []),
        ...(replay ? [journal(replay)] : []),
      ];
      add(
        plan.experiment_id,
        "protocol",
        plan.ir.question,
        verified ? "validated" : "unverified",
        "host_observed",
        receipts,
        plan.ir.limitations,
      );
      const hypothesis = add(
        textId("hypothesis", plan.experiment_id + plan.ir.hypothesis),
        "hypothesis",
        plan.ir.hypothesis,
        verified ? record.result.verdict : "not_evaluated",
        "host_observed",
        receipts,
      );
      link(plan.experiment_id, hypothesis, "tests", "host_observed", receipts);
      add(
        record.run_id,
        "measurement",
        plan.ir.question,
        verified ? record.result.verdict : "quarantined or incomplete",
        verified ? "verified_simulator" : "host_observed",
        receipts,
        plan.ir.limitations,
      );
      const units: Record<string, string> = {
        arms_completed: "count",
        reference_max_error_m: "m",
        reference_max_velocity_error_m_per_s: "m/s",
        rms_control_m: "m",
        rms_treatment_m: "m",
        rms_displacement_delta_m: "m",
        execution_steps: "count",
        retained_samples: "count",
      };
      nodes.get(record.run_id)!.quantities = Object.entries(
        record.result.measurements,
      ).map(([metric, value]) => ({
        metric,
        value,
        unit: units[metric] ?? "not stated",
      }));
      link(
        plan.experiment_id,
        record.run_id,
        "measures",
        verified ? "verified_simulator" : "host_observed",
        receipts,
      );
      if (!verified)
        gap(
          plan.experiment_id,
          "Numerical evidence requires a sealed record, exact preregistration, completed run, successful independent replay and matching native registry admission.",
          receipts,
        );
    }
    if (entry.kind === "research-source")
      source(entry.payload as ResearchSource, provenance[0]);
    if (entry.kind === "research-start") {
      const id = String(p.program_id);
      add(id, "question", String(p.goal), "open", "host_observed", provenance);
    } else if (entry.kind === "research-turn") {
      const turn = entry.payload as ResearchTurn;
      const c = turn.contribution;
      if (!c || typeof turn.decision_id !== "string") continue;
      const standing = turn.generation === "model" ? "model_suggested" : "host_observed";
      const hypothesis = add(
        turn.decision_id,
        "hypothesis",
        c.hypothesis,
        "proposed",
        standing,
        provenance,
        ["Perspective interpretation is not an authoritative scientific result."],
      );
      const question = add(
        textId("question", c.question),
        "question",
        c.question,
        "open",
        standing,
        provenance,
      );
      link(question, hypothesis, "asks", standing, provenance);
      for (const id of c.source_ids)
        link(id, hypothesis, "informs", standing, provenance);
      for (const id of c.evidence_run_ids)
        link(id, hypothesis, "informs", standing, provenance);
      for (const statement of c.mathematical_assumptions) {
        const id = add(
          textId("assumption", statement),
          "assumption",
          statement,
          "unverified",
          standing,
          provenance,
        );
        link(hypothesis, id, "assumes", standing, provenance);
        for (const paper of c.source_ids)
          link(paper, id, "assumes", standing, provenance);
      }
      if (c.falsification) {
        const id = add(
          textId("falsification", hypothesis + c.falsification),
          "falsification",
          c.falsification,
          "proposed criterion",
          standing,
          provenance,
        );
        link(hypothesis, id, "falsified_by", standing, provenance);
      }
      c.disagreements.forEach((statement) => {
        const id = add(
          textId("objection", hypothesis + statement),
          "contradiction",
          statement,
          "unverified objection",
          standing,
          provenance,
        );
        link(id, hypothesis, "challenges", standing, provenance);
      });
    } else if (entry.kind === "research-design") {
      const id = String(p.design_id);
      add(
        id,
        "protocol",
        String(p.hypothesis),
        "proposed",
        "model_suggested",
        provenance,
      );
      // A perspective informing a design does not establish that its prediction
      // was operationalized. Only explicit test bindings establish that relation.
      strings(p.perspectives).forEach((h) =>
        link(h, id, "informs", "model_suggested", provenance),
      );
      const hypotheses = strings(p.tested_hypothesis_ids);
      designLinks.set(id, hypotheses);
      hypotheses.forEach((h) => link(id, h, "tests", "model_suggested", provenance));
    } else if (entry.kind === "result") {
      const r = entry.payload as DiscoveryResult;
      const earlier = entries.filter(
        (e) => e.session === entry.session && e.sequence < entry.sequence,
      );
      const replay = [...earlier]
        .reverse()
        .find(
          (e) =>
            e.kind === "replay" &&
            object(e.payload).run_id === r.run_id &&
            object(object(e.payload).verification).ok === true &&
            /^[a-f0-9]{64}$/.test(String(object(e.payload).artifact_sha256)),
        );
      const admission = [...earlier]
        .reverse()
        .find(
          (e) =>
            e.kind === "registry-admission" &&
            object(e.payload).run_id === r.run_id &&
            object(object(e.payload).admission).run_id === r.registry_run_id,
        );
      const verified = r.replay && r.registry_run_id !== null && !!replay && !!admission;
      const receipt = [
        ...provenance,
        ...(replay ? [journal(replay)] : []),
        ...(admission ? [journal(admission)] : []),
      ];
      add(
        r.design_id,
        "protocol",
        r.operational_hypothesis,
        verified ? "validated" : "unverified",
        "host_observed",
        receipt,
        ["A simulator protocol does not authorize physical laboratory execution."],
      );
      const operational = add(
        textId("hypothesis", r.design_id + r.operational_hypothesis),
        "hypothesis",
        r.operational_hypothesis,
        verified ? r.verdict : "unverified",
        "host_observed",
        receipt,
      );
      link(r.design_id, operational, "tests", "host_observed", receipt);
      (designLinks.get(r.design_id) ?? []).forEach((id) =>
        link(r.design_id, id, "tests", "model_suggested", receipt),
      );
      add(
        r.run_id,
        "measurement",
        r.question,
        verified ? r.verdict : "quarantined",
        verified ? "verified_simulator" : "host_observed",
        receipt,
        [
          "Simulated measurements; descriptive native criteria, not real-world observations.",
        ],
      );
      nodes.get(r.run_id)!.quantities = Object.entries(r.measurements).map(
        ([metric, value]) => ({
          metric,
          value,
          unit:
            metric === r.design.primary_metric ? r.unit : "not stated in result summary",
        }),
      );
      link(
        r.design_id,
        r.run_id,
        "measures",
        verified ? "verified_simulator" : "host_observed",
        receipt,
      );
      if (!verified)
        gap(
          r.design_id,
          "Result lacks a successful native replay and matching registry admission receipt.",
          receipt,
        );
      if (r.parent) link(r.parent, r.design_id, "revises", "host_observed", provenance);
      for (const id of r.evidence_ids)
        link(id, r.design_id, "informs", "model_suggested", provenance);
      const limitation = add(
        textId("limitation", "native-simulator"),
        "limitation",
        "Native simulator evidence does not establish physical-world validity or statistical significance.",
        "applies",
        "host_observed",
        receipt,
      );
      link(limitation, r.run_id, "limits", "host_observed", receipt);
    }
  }
  for (const assessment of options.registry ?? [])
    for (const claim of assessment.claims) {
      const provenance: KnowledgeProvenance[] = [
        {
          kind: "registry",
          id: claim.id,
          sha256: sha256Json(assessment),
          locator: "registry-research-assessment:" + claim.id,
          detail:
            "Supplied native assessResearch projection; verdict not re-evaluated by graph.",
        },
      ];
      add(
        claim.id,
        "hypothesis",
        claim.statement ?? claim.id,
        claim.status,
        "operator_assessed",
        provenance,
        claim.uncertainty,
      );
      const links = assessment.edges.filter(
        (e) => e.from === claim.id && e.relation === "assumes",
      );
      for (const edge of links) {
        if (!nodes.has(edge.to))
          add(
            edge.to,
            "assumption",
            edge.to,
            "operator assessment refers to assumption",
            "operator_assessed",
            provenance,
          );
        link(edge.from, edge.to, "assumes", "operator_assessed", provenance);
      }
      for (const evidence of claim.evidence.filter((e) => e.admissible)) {
        const receipt = [
          ...provenance,
          {
            kind: "registry" as const,
            id: evidence.run_id,
            sha256: evidence.sha256 ?? sha256Json(evidence),
            locator: "registry-run:" + evidence.run_id,
            detail:
              "Native registry assessment admissible evidence; " +
              evidence.evidence_class,
          },
        ];
        const standing =
          evidence.evidence_class === "simulated"
            ? "verified_simulator"
            : "operator_assessed";
        add(
          evidence.run_id,
          "measurement",
          evidence.run_id,
          evidence.verdict,
          standing,
          receipt,
        );
        if (claim.contrary_runs.includes(evidence.run_id))
          link(evidence.run_id, claim.id, "contradicts", standing, receipt);
        if (claim.supporting_runs.includes(evidence.run_id))
          link(evidence.run_id, claim.id, "supports", standing, receipt);
      }
      claim.reasons.forEach((reason) => {
        if (["untested", "not_evaluated", "needs_reassessment"].includes(claim.status))
          gap(claim.id, reason, provenance);
      });
    }
  // Test coverage requires explicit design links and actual replay/admission receipts.
  for (const assumption of [...nodes.values()].filter(
    (n) => n.kind === "assumption" && n.standing === "source_context",
  )) {
    const tested = [...edges.values()].some(
      (e) =>
        e.to === assumption.id &&
        e.relation === "tests" &&
        e.standing === "verified_simulator",
    );
    if (!tested) {
      const question = add(
        textId("question", assumption.id),
        "question",
        "Which recorded experiment tests this source assumption: " + assumption.label,
        "unresolved in current records",
        "host_observed",
        assumption.provenance,
        [
          "Absence of an explicit local test link is not proof that the assumption is false or untested elsewhere.",
        ],
      );
      link(question, assumption.id, "asks", "host_observed", assumption.provenance);
      gap(
        question,
        "The current admitted experiment records do not explicitly test this source assumption.",
        assumption.provenance,
      );
    }
  }
  for (const hypothesis of [...nodes.values()].filter((n) => n.kind === "hypothesis")) {
    const protocols = [...edges.values()]
      .filter((e) => e.to === hypothesis.id && e.relation === "tests")
      .map((e) => e.from);
    const covered =
      [...edges.values()].some(
        (e) =>
          e.relation === "measures" &&
          e.standing === "verified_simulator" &&
          protocols.includes(e.from),
      ) ||
      [...edges.values()].some(
        (e) => e.to === hypothesis.id && ["supports", "contradicts"].includes(e.relation),
      );
    if (!covered)
      gap(
        hypothesis.id,
        "No explicit admitted, replay-verified experiment tests this hypothesis.",
        hypothesis.provenance,
      );
  }
  return {
    schema: SCIENTIFIC_GRAPH_SCHEMA,
    journal_head_sha256: previous,
    corpus_commit:
      options.corpus_commit !== undefined
        ? options.corpus_commit
        : options.sources
          ? null
          : manifest.commit,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()]
      .filter((e) => nodes.has(e.from) && nodes.has(e.to))
      .sort((a, b) => a.id.localeCompare(b.id)),
    limitations: [
      "Derived view only; authoritative definitions, criteria and research standing remain in native records and registry.",
      "Corpus reading scope is bounded; missing extracted assumptions/equations do not prove their absence.",
      "Model-suggested relationships and objections require independent scientific review.",
    ],
  };
}
