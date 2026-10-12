/** Procedural guidance is a journal projection, separate from scientific verdicts. */
import { sha256Json } from "../sha256.js";
import type { DiscoveryEntry, ResearchStore } from "../autonomy/store.js";
import type {
  GuidanceProposal,
  GuidanceScope,
  LearningEvaluation,
  LearningView,
  ProcessErrorCode,
} from "../../bethesda/rain/learningProtocol.js";
import { validateLearningEvaluation } from "./learningEvaluation.js";
import { SCENARIO_IDS } from "../../bethesda/rain/contracts.js";

const patterns: [ProcessErrorCode, RegExp][] = [
  ["parameter-grid", /100-tick|20-agent|multiple|tick.*step|warm.?up.*100|window.*100/],
  [
    "evidence-reference",
    /unavailable.*evidence|unverified.*evidence|parent must|completed parent/,
  ],
  [
    "unsupported-capability",
    /unsupported|unknown.*metric|scenario.*location|not.*supported/,
  ],
  ["hypothesis-distinction", /competing hypotheses must differ/],
  [
    "protocol-novelty",
    /equivalent protocol|duplicate measured|confirmation.*freeze|seeds were already/,
  ],
  [
    "resource-envelope",
    /resource ceiling|outside.*envelope|seed count differs|minimum effect exceeds/,
  ],
];
export function verifyLearningJournal(entries: readonly DiscoveryEntry[]): void {
  let previous: string | null = null;
  for (const [sequence, entry] of entries.entries()) {
    const { sha256, ...body } = entry;
    if (
      entry.sequence !== sequence ||
      entry.previous !== previous ||
      sha256Json(body) !== sha256
    )
      throw new Error("Learning journal integrity failure");
    previous = sha256;
  }
}
/** Only deterministic design-validation errors qualify. A scientifically negative result never does. */
export function recurringProcessErrors(entries: readonly DiscoveryEntry[]) {
  verifyLearningJournal(entries);
  const groups = new Map<
    ProcessErrorCode,
    { evidence: Set<string>; sessions: Set<string> }
  >();
  for (const entry of entries) {
    const p = entry.payload as { ok?: unknown; errors?: unknown };
    if (entry.kind !== "validation" || p?.ok !== false || !Array.isArray(p.errors))
      continue;
    for (const [code, pattern] of patterns) {
      if (
        !p.errors.some(
          (e: unknown) => typeof e === "string" && pattern.test(e.toLowerCase()),
        )
      )
        continue;
      const group = groups.get(code) ?? {
        evidence: new Set<string>(),
        sessions: new Set<string>(),
      };
      group.evidence.add(entry.sha256);
      group.sessions.add(entry.session);
      groups.set(code, group);
    }
  }
  return [...groups]
    .filter(([, g]) => g.evidence.size >= 2)
    .map(([code, g]) => ({
      code,
      count: g.evidence.size,
      evidence: [...g.evidence],
      sessions: [...g.sessions],
    }));
}
function scopeOK(scope: GuidanceScope): boolean {
  return (
    !!scope &&
    Object.keys(scope).sort().join(",") === "backend,domain,error,scenario,stage" &&
    scope.domain === "urban-simulation" &&
    scope.backend === "bethesda" &&
    ["design", "deliberation"].includes(scope.stage) &&
    (scope.scenario === null || SCENARIO_IDS.some((id) => id === scope.scenario)) &&
    patterns.some(([code]) => code === scope.error)
  );
}
function proposalOK(proposal: GuidanceProposal): boolean {
  return (
    proposal?.schema === "rain-guidance-proposal/v1" &&
    typeof proposal.instructions === "string" &&
    proposal.instructions.trim() === proposal.instructions &&
    proposal.instructions.length > 0 &&
    proposal.instructions.length <= 2000 &&
    !Array.from(proposal.instructions).some((c) => {
      const code = c.charCodeAt(0);
      return (
        code <= 8 || (code >= 11 && code <= 31) || (code >= 0x200b && code <= 0x200f)
      );
    }) &&
    scopeOK(proposal.scope) &&
    proposal.id ===
      "RG-" +
        sha256Json({
          scope: proposal.scope,
          parent: proposal.parent,
          instructions: proposal.instructions,
        }).slice(0, 24) &&
    Number.isSafeInteger(proposal.version) &&
    proposal.version >= 1 &&
    Array.isArray(proposal.evidence) &&
    new Set(proposal.evidence).size === proposal.evidence.length &&
    proposal.evidence.length <= 100 &&
    ["host", "model", "scripted"].includes(proposal.generation) &&
    typeof proposal.proposer === "string" &&
    proposal.proposer.length > 0 &&
    proposal.proposer.length <= 120
  );
}
export function proposeGuidance(
  store: ResearchStore,
  session: string,
  input: {
    scope: GuidanceScope;
    instructions: string;
    evidence: string[];
    proposer: string;
    generation: GuidanceProposal["generation"];
    parent?: string | null;
  },
) {
  const entries = store.discoveryEntries();
  const previous = input.parent
    ? learningView(entries).proposals.find((p) => p.sha256 === input.parent)
    : undefined;
  if (input.parent && !previous) throw new Error("Guidance parent is unavailable");
  if (previous && sha256Json(previous.proposal.scope) !== sha256Json(input.scope))
    throw new Error("Guidance revision must retain its scope");
  const proposal: GuidanceProposal = {
    schema: "rain-guidance-proposal/v1",
    id:
      "RG-" +
      sha256Json({
        scope: input.scope,
        parent: input.parent ?? null,
        instructions: input.instructions.trim(),
      }).slice(0, 24),
    version: previous ? previous.proposal.version + 1 : 1,
    parent: input.parent ?? null,
    scope: structuredClone(input.scope),
    instructions: input.instructions.trim(),
    evidence: [...new Set(input.evidence)],
    generation: input.generation,
    proposer: input.proposer,
  };
  const recurrence = recurringProcessErrors(entries).find(
    (r) => r.code === input.scope.error,
  );
  if (
    !proposalOK(proposal) ||
    proposal.evidence.length < 2 ||
    !recurrence ||
    proposal.evidence.some((id) => !recurrence.evidence.includes(id))
  )
    throw new Error(
      "Guidance requires bounded scope and at least two matching procedural-error receipts",
    );
  return store.appendDiscovery(session, "learning-proposal", proposal);
}
export function learningView(entries: readonly DiscoveryEntry[]): LearningView {
  verifyLearningJournal(entries);
  const view: LearningView = {
    schema: "rain-learning-view/v1",
    recurring: recurringProcessErrors(entries),
    proposals: [],
    activations: [],
    rollbacks: [],
  };
  for (const entry of entries) {
    if (entry.kind === "learning-proposal") {
      const proposal = entry.payload as GuidanceProposal;
      const parent = view.proposals.find((p) => p.sha256 === proposal.parent);
      const recurrence = recurringProcessErrors(entries.slice(0, entry.sequence)).find(
        (r) => r.code === proposal.scope?.error,
      );
      if (
        !proposalOK(proposal) ||
        proposal.version !== (parent ? parent.proposal.version + 1 : 1) ||
        (proposal.parent !== null && !parent) ||
        (parent && sha256Json(parent.proposal.scope) !== sha256Json(proposal.scope)) ||
        !recurrence ||
        proposal.evidence.length < 2 ||
        proposal.evidence.some((id) => !recurrence.evidence.includes(id))
      )
        throw new Error("Invalid retained guidance proposal");
      view.proposals.push({
        sha256: entry.sha256,
        proposal: structuredClone(proposal),
        evaluations: [],
        status: "proposed",
      });
    } else if (entry.kind === "learning-evaluation") {
      const evaluation = entry.payload as LearningEvaluation;
      const proposal = view.proposals.find((p) => p.sha256 === evaluation.proposal);
      if (
        !proposal ||
        !validateLearningEvaluation(entries.slice(0, entry.sequence), evaluation)
      )
        throw new Error("Invalid retained learning evaluation");
      proposal.evaluations.push({
        sha256: entry.sha256,
        evaluation: structuredClone(evaluation),
      });
      if (proposal.status === "proposed") proposal.status = "evaluated";
    } else if (entry.kind === "learning-activation") {
      const a = entry.payload as {
        proposal: string;
        evaluation: string;
        operator: string;
        reviewed: boolean;
        typedDigest: string;
      };
      const p = view.proposals.find((p) => p.sha256 === a.proposal);
      const e = p?.evaluations.find((e) => e.sha256 === a.evaluation);
      if (
        !e?.evaluation.beneficial ||
        a.reviewed !== true ||
        a.typedDigest !== a.evaluation ||
        !validOperator(a.operator)
      )
        throw new Error("Invalid retained guidance activation");
      for (const other of view.proposals)
        if (
          other.status === "active" &&
          sha256Json(other.proposal.scope) === sha256Json(p!.proposal.scope)
        )
          other.status = "evaluated";
      p!.status = "active";
      view.activations.push({
        sha256: entry.sha256,
        proposal: a.proposal,
        evaluation: a.evaluation,
        operator: a.operator,
      });
    } else if (entry.kind === "learning-rollback") {
      const r = entry.payload as {
        activation: string;
        operator: string;
        reason: string;
        reviewed: boolean;
        typedDigest: string;
      };
      const a = view.activations.find((a) => a.sha256 === r.activation);
      if (
        !a ||
        r.reviewed !== true ||
        r.typedDigest !== r.activation ||
        !validOperator(r.operator) ||
        typeof r.reason !== "string" ||
        !r.reason.trim() ||
        r.reason.length > 1000
      )
        throw new Error("Invalid retained guidance rollback");
      const p = view.proposals.find((p) => p.sha256 === a.proposal)!;
      const latest = [...view.activations].reverse().find((a) => a.proposal === p.sha256);
      if (latest?.sha256 === r.activation && p.status === "active")
        p.status = "rolled-back";
      view.rollbacks.push({
        sha256: entry.sha256,
        activation: r.activation,
        operator: r.operator,
        reason: r.reason,
      });
    }
  }
  return view;
}
function validOperator(operator: string) {
  return (
    typeof operator === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,119}$/.test(operator)
  );
}
export function approveGuidance(
  store: ResearchStore,
  session: string,
  input: {
    proposal: string;
    evaluation: string;
    operator: string;
    reviewed: boolean;
    typedDigest: string;
  },
) {
  const view = learningView(store.discoveryEntries());
  const p = view.proposals.find((p) => p.sha256 === input.proposal);
  const e = p?.evaluations.find((e) => e.sha256 === input.evaluation);
  if (
    !e?.evaluation.beneficial ||
    input.reviewed !== true ||
    input.typedDigest !== input.evaluation ||
    !validOperator(input.operator)
  )
    throw new Error(
      "Operator must review and bind the exact beneficial evaluation digest",
    );
  return store.appendDiscovery(session, "learning-activation", structuredClone(input));
}
export function rollbackGuidance(
  store: ResearchStore,
  session: string,
  input: {
    activation: string;
    operator: string;
    reason: string;
    reviewed: boolean;
    typedDigest: string;
  },
) {
  const view = learningView(store.discoveryEntries());
  const activation = view.activations.find((a) => a.sha256 === input.activation);
  if (
    !activation ||
    view.rollbacks.some((r) => r.activation === input.activation) ||
    input.reviewed !== true ||
    input.typedDigest !== input.activation ||
    !validOperator(input.operator) ||
    !input.reason.trim() ||
    input.reason.length > 1000
  )
    throw new Error(
      "Operator must review the exact activation and state a bounded rollback reason",
    );
  return store.appendDiscovery(session, "learning-rollback", structuredClone(input));
}
export function activeResearchGuidance(
  entries: readonly DiscoveryEntry[],
  context: Pick<GuidanceScope, "domain" | "backend" | "stage"> & {
    scenario?: string;
    errors?: readonly ProcessErrorCode[];
  },
) {
  return learningView(entries)
    .proposals.filter(
      (p) =>
        p.status === "active" &&
        p.proposal.scope.domain === context.domain &&
        p.proposal.scope.backend === context.backend &&
        p.proposal.scope.stage === context.stage &&
        (p.proposal.scope.scenario === null ||
          p.proposal.scope.scenario === context.scenario) &&
        (!context.errors || context.errors.includes(p.proposal.scope.error)),
    )
    .map((p) => ({
      proposal_sha256: p.sha256,
      version: p.proposal.version,
      scope: p.proposal.scope,
      instructions: p.proposal.instructions,
      standing: "evaluated-operator-approved-procedure" as const,
    }));
}
