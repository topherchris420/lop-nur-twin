/**
 * Research lineage over the existing experiment registry. No second set of
 * experiments or verdicts: claims name a registered hypothesis and immutable
 * run digests; their current standing is re-derived from those sources.
 * Server only. This module reads through Registry and never writes files.
 */
import { basename } from "node:path";
import { seal, type RecordBody } from "../../bethesda/rain/record.js";
import { verifyRecord } from "../../bethesda/rain/replay.js";
import type { Registry } from "./registry.js";
import { credentialFormatsIn } from "./provenance.js";
import { ExperimentError, sha256Json, type Json } from "./schema.js";
import { verifyRun } from "./verify.js";

export const RESEARCH_SCHEMA = "rain-research-lineage/v1" as const;
export const MAX_RESEARCH_REVISIONS = 256;
export const MAX_RESEARCH_BYTES = 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SHA = /^[a-f0-9]{64}$/;
export interface SourceRef {
  id: string;
  sha256: string;
}
export interface ResearchAssumption {
  id: string;
  statement: string;
  /** Acceptance is an operator's assumption, never a scientific measurement. */
  status: "untested" | "accepted" | "invalidated";
}
export interface ResearchClaim {
  id: string;
  experiment: SourceRef;
  runs: SourceRef[];
  assumptions: string[];
  depends_on: string[];
}
export interface ResearchPlan {
  schema: typeof RESEARCH_SCHEMA;
  branch: string;
  based_on: number | null;
  assumptions: ResearchAssumption[];
  claims: ResearchClaim[];
}
export interface ResearchReview {
  origin: "human";
  operator: string;
  reviewed: true;
  plan_sha256: string;
}
export type ClaimStatus =
  | "untested"
  | "supported"
  | "not_supported"
  | "inconclusive"
  | "contested"
  | "not_evaluated"
  | "needs_reassessment";
export interface EvidenceLink {
  run_id: string;
  sha256: string | null;
  reviewed: boolean;
  admissible: boolean;
  verdict: string;
  evidence_class: string | null;
  measurements: Json;
  provenance: Json;
  artifacts: unknown[];
  problems: string[];
}
export interface ClaimAssessment {
  id: string;
  question: string | null;
  statement: string | null;
  experiment_id: string;
  status: ClaimStatus;
  evidence: EvidenceLink[];
  supporting_runs: string[];
  contrary_runs: string[];
  reasons: string[];
  uncertainty: string[];
  confidence: null;
}
export interface FollowUp {
  claim_id: string;
  kind:
    | "repair_evidence"
    | "resolve_conflict"
    | "test_assumption"
    | "add_control"
    | "replicate"
    | "run_registered_design";
  rationale: string;
  prerequisites: string[];
  expected_observations: unknown;
  falsification_conditions: unknown;
  estimated_cost: { simulator_ticks: number | null; wall_time_ms: null; model_calls: 0 };
  required_approval: "human authorization of the exact experiment or a covering charter";
}
export interface ResearchAssessment {
  claims: ClaimAssessment[];
  /** Dependency edges point from the prerequisite to its consumer. */
  edges: {
    from: string;
    to: string;
    relation: "assumes" | "depends_on" | "tests" | "supports" | "contradicts" | "reports";
  }[];
  follow_ups: FollowUp[];
  note: string;
}
export interface ResearchRevision {
  schema: "rain-research-revision/v1";
  revision: number;
  previous_sha256: string | null;
  created_at: string;
  review: ResearchReview & { identity_verified: false };
  plan: ResearchPlan;
  /** What the sources established when saved; current reads always reassess. */
  assessment: ResearchAssessment;
  sha256: string;
}

const object = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string[]): asserts v is Json {
  if (
    !object(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new ExperimentError(`Expected exactly: ${keys.join(", ")}`);
}
function list(v: unknown, max = 128): asserts v is unknown[] {
  if (!Array.isArray(v) || v.length > max)
    throw new ExperimentError(`Expected an array with at most ${max} entries`);
}
function ref(v: unknown, pattern: RegExp): asserts v is SourceRef {
  exact(v, ["id", "sha256"]);
  if (
    typeof v.id !== "string" ||
    !pattern.test(v.id) ||
    typeof v.sha256 !== "string" ||
    !SHA.test(v.sha256)
  )
    throw new ExperimentError("Invalid research source reference");
}
const fail = (message: string): never => {
  throw new ExperimentError(message);
};

/** Closed, bounded, acyclic contract. A claim cannot supply its own verdict or prose. */
export function validateResearchPlan(raw: unknown): ResearchPlan {
  exact(raw, ["schema", "branch", "based_on", "assumptions", "claims"]);
  if (
    raw.schema !== RESEARCH_SCHEMA ||
    typeof raw.branch !== "string" ||
    !ID.test(raw.branch)
  )
    fail("Invalid research schema or branch");
  if (
    raw.based_on !== null &&
    (!Number.isSafeInteger(raw.based_on) || (raw.based_on as number) < 1)
  )
    fail("Invalid parent revision");
  list(raw.assumptions);
  list(raw.claims);
  const ids = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id !== "string" || !ID.test(id) || ids.has(id))
      fail("Invalid or duplicate research node id");
    ids.add(id as string);
  };
  for (const a of raw.assumptions) {
    exact(a, ["id", "statement", "status"]);
    add(a.id);
    if (
      typeof a.statement !== "string" ||
      !a.statement.trim() ||
      a.statement.length > 2000 ||
      typeof a.status !== "string" ||
      !["untested", "accepted", "invalidated"].includes(a.status)
    )
      fail("Invalid assumption");
  }
  let runCount = 0;
  for (const c of raw.claims) {
    exact(c, ["id", "experiment", "runs", "assumptions", "depends_on"]);
    add(c.id);
    ref(c.experiment, /^V3D-EXP-\d{4,}$/);
    list(c.runs);
    list(c.assumptions);
    list(c.depends_on);
    const seen = new Set<string>();
    for (const r of c.runs) {
      ref(r, /^V3D-EXP-\d{4,}-RUN-\d{4,}$/);
      if (!r.id.startsWith(`${c.experiment.id}-RUN-`) || seen.has(r.id))
        fail("Duplicate or foreign run reference");
      seen.add(r.id);
      runCount++;
    }
    for (const links of [c.assumptions, c.depends_on])
      if (
        links.some((x) => typeof x !== "string") ||
        new Set(links).size !== links.length
      )
        fail("Invalid dependency list");
  }
  if (runCount > 512) fail("Research plan exceeds 512 run references");
  const plan = raw as unknown as ResearchPlan;
  const assumptions = new Set(plan.assumptions.map((a) => a.id));
  const claims = new Set(plan.claims.map((c) => c.id));
  for (const c of plan.claims) {
    if (
      c.assumptions.some((id) => !assumptions.has(id)) ||
      c.depends_on.some((id) => !claims.has(id))
    )
      fail("Missing dependency endpoint");
  }
  researchOrder(plan);
  const text = JSON.stringify(plan);
  if (Buffer.byteLength(text) > MAX_RESEARCH_BYTES || credentialFormatsIn(text))
    fail("Research plan is oversized or contains credential-like text");
  return plan;
}

export function validateResearchReview(plan: ResearchPlan, raw: unknown): ResearchReview {
  exact(raw, ["origin", "operator", "reviewed", "plan_sha256"]);
  if (
    raw.origin !== "human" ||
    raw.reviewed !== true ||
    typeof raw.operator !== "string" ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(raw.operator) ||
    raw.plan_sha256 !== sha256Json(plan)
  )
    fail("Research changes require human review bound to the exact plan digest");
  return raw as unknown as ResearchReview;
}

/** Topological order, bounded by the closed plan; dependency cycles fail closed. */
export function researchOrder(plan: ResearchPlan): ResearchClaim[] {
  const pending = new Map(plan.claims.map((c) => [c.id, c]));
  const ordered: ResearchClaim[] = [];
  while (pending.size) {
    const ready = [...pending.values()]
      .filter((c) => c.depends_on.every((id) => !pending.has(id)))
      .sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (!ready.length) fail("Research dependencies must be acyclic");
    for (const c of ready) {
      pending.delete(c.id);
      ordered.push(c);
    }
  }
  return ordered;
}

export function bindResearchRun(registry: Registry, runId: string): SourceRef {
  return { id: runId, sha256: sha256Json(registry.resolveRun(runId).record) };
}

/** Recompute source validity, retain contrary/negative/error results, then propagate. */
export function assessResearch(
  registry: Registry,
  raw: ResearchPlan,
): ResearchAssessment {
  const plan = validateResearchPlan(raw);
  const assessments = new Map<string, ClaimAssessment>();
  const definitions = new Map<string, Json>();
  const assumptions = new Map(plan.assumptions.map((a) => [a.id, a]));
  const edges: ResearchAssessment["edges"] = [];
  let examinedRuns = 0;
  let replayTicks = 0;
  const replayDeadline = performance.now() + 30_000;
  const replayChecks = new Map<string, boolean>();
  for (const claim of researchOrder(plan)) {
    const out: ClaimAssessment = {
      id: claim.id,
      question: null,
      statement: null,
      experiment_id: claim.experiment.id,
      status: "untested",
      evidence: [],
      supporting_runs: [],
      contrary_runs: [],
      reasons: [],
      uncertainty: [
        "Confidence is not estimated. Criteria describe the recorded conditions, not a general scientific truth.",
      ],
      confidence: null,
    };
    assessments.set(claim.id, out);
    let definition: Json;
    try {
      definition = registry.loadDefinition(claim.experiment.id);
      definitions.set(claim.id, definition);
      out.question = definition.question as string;
      out.statement = definition.hypothesis as string;
      if (sha256Json(definition) !== claim.experiment.sha256)
        out.reasons.push("Pre-registered definition changed since review");
      out.uncertainty.push(...(definition.limitations as string[]));
    } catch {
      out.reasons.push("Pre-registered definition is missing or invalid");
      out.status = "needs_reassessment";
      continue;
    }
    edges.push({
      from: `experiment:${claim.experiment.id}`,
      to: claim.id,
      relation: "tests",
    });
    for (const id of claim.assumptions) {
      edges.push({ from: id, to: claim.id, relation: "assumes" });
      const a = assumptions.get(id)!;
      if (a.status === "invalidated")
        out.reasons.push(`Assumption ${id} was invalidated`);
      else
        out.uncertainty.push(
          `Assumption ${id} is ${a.status} by the operator, not established by this experiment: ${a.statement}`,
        );
    }
    const pinned = new Map(claim.runs.map((r) => [r.id, r.sha256]));
    // New sibling runs cannot be hidden by omitting an inconvenient result from a claim.
    let dirs: string[];
    try {
      dirs = registry.runDirs(claim.experiment.id);
    } catch {
      out.reasons.push("Run directories are unavailable or unsafe");
      out.status = "needs_reassessment";
      continue;
    }
    if (dirs.length > 128) {
      out.reasons.push("Run budget exceeded (128 per investigation)");
      out.status = "needs_reassessment";
      continue;
    }
    const runIds = new Set([
      ...pinned.keys(),
      ...dirs.map((d) => `${claim.experiment.id}-${basename(d)}`),
    ]);
    for (const runId of [...runIds].sort()) {
      if (++examinedRuns > 128) {
        out.reasons.push("Assessment source budget exceeded (128 run inspections)");
        break;
      }
      const e: EvidenceLink = {
        run_id: runId,
        sha256: null,
        reviewed: pinned.has(runId),
        admissible: false,
        verdict: "not_evaluated",
        evidence_class: null,
        measurements: {},
        provenance: {},
        artifacts: [],
        problems: [],
      };
      out.evidence.push(e);
      try {
        const { record, runDir } = registry.resolveRun(runId);
        e.sha256 = sha256Json(record);
        if (pinned.has(runId) && pinned.get(runId) !== e.sha256)
          e.problems.push("Run changed since review");
        e.problems.push(
          ...verifyRun(registry, claim.experiment.id, definition, runDir)[0],
        );
        if (e.problems.length) continue;
        e.verdict = record.hypothesis_verdict as string;
        e.evidence_class = record.evidence_class as string;
        e.measurements = record.measurements as Json;
        e.provenance = record.provenance as Json;
        e.artifacts = record.artifacts as unknown[];
        if (
          record.definition_sha256 !== claim.experiment.sha256 ||
          sha256Json(record.parameters) !== sha256Json(definition.parameters) ||
          (definition.seed !== null && record.seed !== definition.seed)
        )
          e.problems.push("Run configuration differs from the registered design");
        if (record.evidence_class === "model_inferred")
          e.problems.push("Model inference cannot establish a research claim");
        if (record.status === "running" || record.status === "error") {
          out.uncertainty.push(
            `${runId}: ${record.status}; the hypothesis was not evaluated`,
          );
        } else if (
          !(record.artifacts as Json[]).length ||
          (record.artifacts as Json[]).some((a) => !a.stored)
        ) {
          e.problems.push(
            "Raw artifacts are unavailable; a declared hash alone is not evidence",
          );
        } else {
          // A file with a matching hash but unrelated numbers cannot support a claim.
          let bound = false;
          for (const artifact of record.artifacts as Json[]) {
            if (!["measurements", "replay"].includes(String(artifact.kind))) continue;
            const raw: unknown = JSON.parse(
              registry.readArtifact(runId, artifact.name as string),
            );
            const bethesda =
              object(raw) && raw.schema === "bethesda-rain-experiment-record/v3";
            const registeredBethesda = (definition.parameters as Json)
              .bethesda_definition_sha256;
            if (
              registeredBethesda &&
              (!bethesda ||
                raw.definition_sha256 !== registeredBethesda ||
                raw.experiment_id !==
                  (definition.parameters as Json).bethesda_experiment_id ||
                raw.run_id !== (record.inputs as Json).bethesda_run_id)
            )
              e.problems.push(
                "Bethesda artifact does not match the registered design and run",
              );
            if (artifact.kind === "replay" || bethesda || registeredBethesda) {
              const digest = artifact.sha256 as string;
              if (!replayChecks.has(digest)) {
                if (!bethesda) {
                  replayChecks.set(digest, false);
                } else {
                  const steps = verifyRecord(
                    seal({ ...raw, rain_admission: null } as unknown as RecordBody),
                  );
                  for (;;) {
                    if (performance.now() > replayDeadline || replayTicks >= 60_000) {
                      e.problems.push(
                        "Assessment replay budget exceeded (60,000 ticks / 30 seconds)",
                      );
                      replayChecks.set(digest, false);
                      break;
                    }
                    const next = steps.next();
                    if (next.done) {
                      replayChecks.set(digest, next.value.ok);
                      break;
                    }
                    replayTicks++;
                  }
                }
              }
              if (replayChecks.get(digest) !== true)
                e.problems.push("Bethesda artifact did not pass deterministic replay");
            }
            const values =
              object(raw) && raw.schema === "bethesda-rain-experiment-record/v3"
                ? raw.run
                : raw;
            if (
              !object(values) ||
              sha256Json(values.measurements ?? null) !==
                sha256Json(record.measurements) ||
              sha256Json(values.series ?? null) !== sha256Json(record.series)
            )
              e.problems.push("Raw artifact measurements or series differ from the run");
            else bound = true;
          }
          if (!bound)
            e.problems.push(
              "No raw measurement artifact is bound to the recorded values",
            );
          e.admissible = e.problems.length === 0;
        }
        edges.push({
          from: `run:${runId}`,
          to: claim.id,
          relation:
            e.admissible && e.verdict === "supported"
              ? "supports"
              : e.admissible && e.verdict === "not_supported"
                ? "contradicts"
                : "reports",
        });
      } catch {
        e.problems.push("Run or artifact is missing, unreadable, or invalid");
      }
    }
    const valid = out.evidence.filter((e) => e.admissible);
    const commits = new Set(
      valid.map((e) => (e.provenance.producer as Json | undefined)?.commit ?? null),
    );
    const comparable = commits.size <= 1 && !commits.has(null);
    if (!comparable)
      out.reasons.push(
        "Evidence comes from different or unknown code revisions; establish comparability before combining it",
      );
    out.supporting_runs = valid
      .filter((e) => e.verdict === "supported")
      .map((e) => e.run_id);
    out.contrary_runs = valid
      .filter((e) => e.verdict === "not_supported")
      .map((e) => e.run_id);
    for (const e of out.evidence) {
      out.reasons.push(...e.problems.map((p) => `${e.run_id}: ${p}`));
      if (!e.reviewed) out.reasons.push(`${e.run_id}: new result requires review`);
    }
    if (!(definition.variables as { controls: string[] }).controls.length)
      out.reasons.push("No control is registered");
    const damaged = out.reasons.some(
      (reason) => !reason.endsWith("new result requires review"),
    );
    if (damaged) out.status = "needs_reassessment";
    else if (out.supporting_runs.length && out.contrary_runs.length)
      out.status = "contested";
    else if (out.reasons.length) out.status = "needs_reassessment";
    else if (out.supporting_runs.length) out.status = "supported";
    else if (out.contrary_runs.length) out.status = "not_supported";
    else if (valid.length) out.status = "inconclusive";
    else if (out.evidence.length) out.status = "not_evaluated";
    for (const id of claim.depends_on) {
      edges.push({ from: id, to: claim.id, relation: "depends_on" });
      const dependency = assessments.get(id)!;
      if (dependency.status !== "supported") {
        out.reasons.push(`Dependency ${id} is ${dependency.status}`);
        out.status = "needs_reassessment";
      }
    }
  }
  const claims = plan.claims.map((c) => assessments.get(c.id)!);
  const follow_ups = claims
    .flatMap((c): FollowUp[] => {
      const d = definitions.get(c.id);
      if (!d) return [];
      const claim = plan.claims.find((x) => x.id === c.id)!;
      const untested = claim.assumptions.filter(
        (id) => assumptions.get(id)!.status === "untested",
      );
      const kind: FollowUp["kind"] = !(d.variables as { controls: string[] }).controls
        .length
        ? "add_control"
        : c.status === "needs_reassessment"
          ? "repair_evidence"
          : c.status === "contested"
            ? "resolve_conflict"
            : untested.length
              ? "test_assumption"
              : c.status === "untested"
                ? "run_registered_design"
                : "replicate";
      const p = d.parameters as Json;
      const seeds = Array.isArray(p.seeds) ? p.seeds.length : 1;
      const ticks =
        typeof p.warmup_ticks === "number" && typeof p.window_ticks === "number"
          ? 2 * seeds * (p.warmup_ticks + p.window_ticks)
          : null;
      return [
        {
          claim_id: c.id,
          kind,
          rationale: c.reasons.length
            ? c.reasons.join("; ").slice(0, 2000)
            : untested.length
              ? `Test unresolved assumptions: ${untested.join(", ")}`
              : "Check the registered result on independent seeds; repeating identical seeds checks reproducibility, not independent replication.",
          prerequisites: [
            "Valid source artifacts and controls",
            "Review the pre-registered design and resource budget",
            ...untested.map((id) => `Operationalize assumption ${id}`),
          ],
          expected_observations: (d.criteria as Json).success,
          falsification_conditions: (d.criteria as Json).failure,
          estimated_cost: { simulator_ticks: ticks, wall_time_ms: null, model_calls: 0 },
          required_approval:
            "human authorization of the exact experiment or a covering charter",
        },
      ];
    })
    .sort((a, b) => {
      const priority = [
        "repair_evidence",
        "resolve_conflict",
        "add_control",
        "test_assumption",
        "run_registered_design",
        "replicate",
      ];
      return (
        priority.indexOf(a.kind) - priority.indexOf(b.kind) ||
        a.claim_id.localeCompare(b.claim_id, "en")
      );
    })
    .slice(0, 8);
  return {
    claims,
    edges,
    follow_ups,
    note: "Derived from registered criteria and available artifacts, with deterministic replay for Bethesda artifacts. Integrity checks are not authentication or scientific validation. Simulation claims remain conditional on the simulator. No recommendation executes or grants permission.",
  };
}
