import { envelopeAdmission } from "./discoveryCompiler.js";
import { envelopeErrors, type Envelope } from "./discoveryProtocol.js";
/**
 * Standing authorization: a person's approval, given in advance, of a closed
 * list of exact experiment designs that R.A.I.N.'s autonomous researcher may
 * have run without a person reviewing each one.
 *
 * The lab's rule is that nothing runs without a human authorization bound to
 * a digest (`authorization.ts`). Autonomy keeps it by moving the review, not
 * by removing it:
 *
 *   1. The host writes a **charter** (`rain-autonomy-charter/v1`): every design
 *      the autonomy policy may run — each host option (`session.ts`), tested in
 *      either direction on one of two fixed seed panels — named by the SHA-256
 *      of exactly what would run (`designSha256`), plus the session ceilings,
 *      the model that may direct the work and how long the approval lasts.
 *   2. A person reviews the charter and authorizes its digest the way the lab
 *      authorizes a definition: a role label, a confirmed review and the
 *      digest's first eight characters typed back
 *      (`rain-autonomy-charter-authorization/v1`). It is a local operator
 *      attestation, `identity_verified: false`, and it expires.
 *   3. For each experiment the researcher proposes, the **autonomy policy**
 *      (`admit`, `rain-autonomy-policy/1`) checks a fixed list of rules and,
 *      only if every one holds, issues an admission
 *      (`rain-autonomy-admission/v1`) binding that one definition to the
 *      charter and to the model decision that asked for it.
 *
 * The runner accepts the bundle (`rain-autonomy-standing-authority/v1`) where
 * it accepts a person's authorization, and re-verifies all of it before a tick
 * runs; a sealed record carries it, and replay re-verifies it. A charter never
 * covers a design it does not list: a different seed, threshold, scenario,
 * simulator version or map is a different digest, and nothing admits it.
 *
 * What the model contributes stays outside the definition. The definition's
 * question and hypothesis are the host's sentences for the design, so a
 * model's words never enter what runs, what a person authorized, or what the
 * registry evaluates; the proposal links to the model's decision record only
 * by its id and SHA-256.
 *
 * Pure: no fetch, no filesystem, no clock but the one passed in. Browser-safe,
 * so the lab's replay can verify an autonomous record.
 */
import {
  DIRECTIONS,
  LOCATION_LABELS,
  METRIC_LABELS,
  OPERATOR,
  SCENARIO_LABELS,
  SHA256,
  type Direction,
  type ExperimentProposal,
  type LocationId,
  type MetricId,
  type ScenarioId,
} from "./contracts";
import {
  currentVersions,
  validateExperiment,
  type ExperimentDefinition,
  type Validated,
} from "./experiments";
import { OPTIONS, optionHypothesis, proposalFrom } from "./session";
import { CONFIRMATION_LENGTH } from "./authorization";
import { canonicalJson, sha256Json } from "../../rain/sha256";
import type { Checked } from "./validation";

import { researchScopeErrors, type ResearchScope } from "./researchProtocol.js";

export const CHARTER_SCHEMA = "rain-autonomy-charter/v1" as const;
export const CHARTER_AUTHORIZATION_SCHEMA =
  "rain-autonomy-charter-authorization/v1" as const;
export const POLICY_ADMISSION_SCHEMA = "rain-autonomy-admission/v1" as const;
export const STANDING_SCHEMA = "rain-autonomy-standing-authority/v1" as const;
export const DISCOVERY_POLICY = "rain-autonomy-policy/2" as const;
export const DISCOVERY_CHARTER = "rain-autonomy-charter/v2" as const;
export const POLICY_VERSION = "rain-autonomy-policy/1" as const;

/**
 * The two seed panels a charter offers. The primary panel is the lab's own
 * default; the replication panel is seeds no other design uses, so a
 * hypothesis revised after one panel can be tested on data it has not seen.
 */
export const SEED_PANELS = {
  primary: [101, 202, 303],
  replication: [404, 505, 606],
} as const;
export type Panel = keyof typeof SEED_PANELS;
export const PANELS = ["primary", "replication"] as const satisfies readonly Panel[];
/** The lab's default warm-up and window (`proposalFrom`), fixed for every design. */
export const DESIGN_TICKS = { warmup: 300, window: 1200 } as const;

export const DESIGN_ID =
  /^X(?:[1-9]|1[0-9])-(?:increase|decrease)-(?:primary|replication)$/;
export const designId = (option: string, direction: Direction, panel: Panel) =>
  `${option}-${direction}-${panel}`;

export interface CharterDesign {
  design_id: string;
  option: string;
  scenario: ScenarioId;
  location: LocationId;
  primary_metric: MetricId;
  expected_direction: Direction;
  minimum_effect: number;
  panel: Panel;
  seeds: number[];
  warmup_ticks: number;
  window_ticks: number;
  /** Seeds × 2 arms × (warm-up + window). */
  simulated_ticks: number;
  /** SHA-256 of what runs: the definition without its narrative (`designSha256`). */
  design_sha256: string;
}
/** The most one session may spend. A session may run under less, never more. */
export interface Ceilings {
  iterations: number;
  experiments: number;
  runtime_ms: number;
  failed_proposals: number;
  model_calls: number;
  /** Null: no token ceiling. Set, a provider that reports no count stops the session. */
  model_tokens: number | null;
}
export interface CharterModel {
  provider: string;
  model: string;
  endpoint: string;
}
export interface Charter {
  schema: typeof CHARTER_SCHEMA | typeof DISCOVERY_CHARTER;
  family?: Envelope;
  /** Optional, separately versioned research services included in the reviewed digest. */
  research?: ResearchScope;
  scope: "bethesda-simulation";
  policy_version: typeof POLICY_VERSION | typeof DISCOVERY_POLICY;
  covers: string;
  designs: CharterDesign[];
  ceilings: Ceilings;
  model: CharterModel;
  /** Hours an authorization of this charter stands. */
  valid_hours: number;
  versions: ExperimentDefinition["versions"];
}
export interface CharterAuthorization {
  schema: typeof CHARTER_AUTHORIZATION_SCHEMA;
  charter_sha256: string;
  operator: string;
  attestation: "local-operator";
  identity_verified: false;
  scope: "bethesda-simulation";
  confirmed_prefix: string;
  authorized_at: string;
  expires_at: string;
  authorization_sha256: string;
}
export interface PolicyRule {
  id: string;
  ok: boolean;
  detail: string;
}
export interface PolicyAdmission {
  schema: typeof POLICY_ADMISSION_SCHEMA;
  policy_version: typeof POLICY_VERSION | typeof DISCOVERY_POLICY;
  session_id: string;
  iteration: number;
  /** The model decision that asked for this design, by id and SHA-256. */
  decision_id: string;
  decision_sha256: string;
  charter_sha256: string;
  charter_authorization_sha256: string;
  design_id: string;
  design_sha256: string;
  experiment_id: string;
  definition_sha256: string;
  rules: PolicyRule[];
  admitted_at: string;
  admission_sha256: string;
}
/** What the runner accepts in place of a person's authorization of one definition. */
export interface StandingAuthority {
  schema: typeof STANDING_SCHEMA;
  charter: Charter;
  authorization: CharterAuthorization;
  admission: PolicyAdmission;
}

export const COVERS =
  "The experiment designs listed here — each a host option tested in one direction on one fixed seed panel, identified by the SHA-256 of what would run — proposed by the named local model acting as R.A.I.N.'s autonomous researcher and admitted one at a time by rain-autonomy-policy/1, within these ceilings, until the authorization expires. Nothing else.";

const HOUR = 3_600_000;
export const charterSha256 = (charter: Charter) => sha256Json(charter);
export const charterIdOf = (sha256: string) => `CH-${sha256.slice(0, 12)}`;

/**
 * What runs, without what it is called: the definition minus its question,
 * hypothesis and proposal. Two definitions with the same design digest run
 * the same arms, are measured the same way and are judged by the same
 * criteria, whatever their narrative says.
 */
export function designSha256(definition: ExperimentDefinition): string {
  const {
    question: _question,
    hypothesis: _hypothesis,
    proposal: _proposal,
    ...design
  } = definition;
  return sha256Json(design);
}

/** The host's question for a design. Fixed text; a model's question is kept elsewhere. */
export function designQuestion(design: Pick<CharterDesign, "option">): string | null {
  const t = OPTIONS.find((o) => o.id === design.option)?.template;
  if (!t) return null;
  return `In the Bethesda simulator, what does ${SCENARIO_LABELS[t.scenario].toLowerCase()} at ${LOCATION_LABELS[t.location]} do to ${METRIC_LABELS[t.metric].toLowerCase()}, against a matched no-event control?`;
}

/** Parse a design id into its option, direction and panel, or null. */
export function parseDesignId(
  id: string,
): { option: string; direction: Direction; panel: Panel } | null {
  if (typeof id !== "string" || !DESIGN_ID.test(id)) return null;
  const [option, direction, panel] = id.split("-") as [string, Direction, Panel];
  if (!OPTIONS.some((o) => o.id === option && o.template)) return null;
  return { option, direction, panel };
}

/**
 * The proposal the host writes for a design, on behalf of R.A.I.N.'s
 * autonomous researcher: the host's question and hypothesis, the design's
 * direction and seeds, and the decision that asked for it.
 */
export function autonomousProposal(
  id: string,
  decision: { decision_id: string; envelope_hash: string },
): ExperimentProposal | null {
  const d = parseDesignId(id);
  if (!d) return null;
  return proposalFrom(d.option, {
    question: designQuestion(d)!,
    meetingId: null,
    origin: "rain",
    decision,
    hypothesis: optionHypothesis(d.option, d.direction)!,
    direction: d.direction,
    seeds: SEED_PANELS[d.panel],
  });
}

/** Every design a charter offers, in a fixed order, each validated by the host. */
export function charterDesigns(): CharterDesign[] {
  const out: CharterDesign[] = [];
  const placeholder = { decision_id: "charter-design", envelope_hash: "0".repeat(64) };
  for (const option of OPTIONS) {
    const t = option.template;
    if (!t) continue;
    const directions = [t.direction, ...DIRECTIONS.filter((x) => x !== t.direction)];
    for (const panel of PANELS)
      for (const direction of directions) {
        const id = designId(option.id, direction, panel);
        const v = validateExperiment(autonomousProposal(id, placeholder));
        if (!v.ok)
          throw new Error(`design ${id} does not validate: ${v.errors.join("; ")}`);
        const seeds = [...SEED_PANELS[panel]];
        out.push({
          design_id: id,
          option: option.id,
          scenario: t.scenario,
          location: t.location,
          primary_metric: t.metric,
          expected_direction: direction,
          minimum_effect: t.effect,
          panel,
          seeds,
          warmup_ticks: DESIGN_TICKS.warmup,
          window_ticks: DESIGN_TICKS.window,
          simulated_ticks: seeds.length * 2 * (DESIGN_TICKS.warmup + DESIGN_TICKS.window),
          design_sha256: designSha256(v.value.definition),
        });
      }
  }
  return out;
}

export function buildCharter(input: {
  ceilings: Ceilings;
  model: CharterModel;
  validHours: number;
}): Charter {
  return {
    schema: CHARTER_SCHEMA,
    scope: "bethesda-simulation",
    policy_version: POLICY_VERSION,
    covers: COVERS,
    designs: charterDesigns(),
    ceilings: { ...input.ceilings },
    model: { ...input.model },
    valid_hours: input.validHours,
    versions: currentVersions(),
  };
}

export function buildDiscoveryCharter(
  input: Parameters<typeof buildCharter>[0] & {
    envelope: Envelope;
    research?: ResearchScope;
  },
): Charter {
  const errors = [
    ...envelopeErrors(input.envelope),
    ...(input.research ? researchScopeErrors(input.research) : []),
  ];
  if (errors.length) throw new Error(errors.join("; "));
  return {
    ...buildCharter(input),
    schema: DISCOVERY_CHARTER,
    policy_version: DISCOVERY_POLICY,
    covers:
      "Generated matched-control Bethesda experiments within this parameter envelope; host criteria, independent replay, fresh withheld seeds and per-session ceilings. No external world actions.",
    family: structuredClone(input.envelope),
    ...(input.research
      ? {
          research: structuredClone(input.research),
          covers:
            "Native Bethesda experiments plus a research program using the pinned corpus, mathematical index, four local-model perspectives and draft manuscript artifacts. Public Crossref query text is permitted only when explicitly enabled in the research scope. No arbitrary code execution or external-world interventions.",
        }
      : {}),
  };
}

/** A person's authorization of one charter: the lab's ritual, applied to the charter's digest. */
export function authorizeCharter(input: {
  charter: Charter;
  operator: string;
  typedPrefix: string;
  reviewed: boolean;
  now: Date;
}): Checked<CharterAuthorization> {
  const sha = charterSha256(input.charter);
  const errors: string[] = [];
  if (!input.reviewed) errors.push("the charter review was not confirmed");
  if (!OPERATOR.test(input.operator))
    errors.push("operator must be a role label (letters, digits, . _ -), not a name");
  const typed = input.typedPrefix.trim().toLowerCase();
  if (typed.length !== CONFIRMATION_LENGTH || !sha.startsWith(typed))
    errors.push(
      `type the first ${CONFIRMATION_LENGTH} characters of the charter digest to confirm`,
    );
  if (errors.length) return { ok: false, errors };
  const body = {
    schema: CHARTER_AUTHORIZATION_SCHEMA,
    charter_sha256: sha,
    operator: input.operator,
    attestation: "local-operator" as const,
    identity_verified: false as const,
    scope: "bethesda-simulation" as const,
    confirmed_prefix: typed,
    authorized_at: input.now.toISOString(),
    expires_at: new Date(
      input.now.getTime() + input.charter.valid_hours * HOUR,
    ).toISOString(),
  };
  return { ok: true, value: { ...body, authorization_sha256: sha256Json(body) } };
}

const keysExactly = (o: object, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** Does this record authorize exactly this charter? Every check, every time. */
export function verifyCharterAuthorization(auth: unknown, charter: Charter): string[] {
  const a = auth as CharterAuthorization | null;
  if (!a || typeof a !== "object") return ["no charter authorization"];
  const errors: string[] = [];
  if (
    !keysExactly(a, [
      "schema",
      "charter_sha256",
      "operator",
      "attestation",
      "identity_verified",
      "scope",
      "confirmed_prefix",
      "authorized_at",
      "expires_at",
      "authorization_sha256",
    ])
  )
    errors.push("charter authorization has unexpected or missing fields");
  if (a.schema !== CHARTER_AUTHORIZATION_SCHEMA)
    errors.push("unsupported charter authorization schema");
  if (a.attestation !== "local-operator" || a.identity_verified !== false)
    errors.push("charter authorization claims an identity this lab cannot verify");
  if (a.scope !== "bethesda-simulation")
    errors.push("charter authorization scope is not this simulation");
  let sha = "";
  try {
    sha = charterSha256(charter);
  } catch {
    errors.push("the charter is not hashable JSON");
  }
  if (a.charter_sha256 !== sha) errors.push("authorization is for a different charter");
  if (typeof a.operator !== "string" || !OPERATOR.test(a.operator))
    errors.push("operator is not a role label");
  if (
    typeof a.confirmed_prefix !== "string" ||
    a.confirmed_prefix.length !== CONFIRMATION_LENGTH ||
    !sha.startsWith(a.confirmed_prefix)
  )
    errors.push("the confirmation does not repeat the charter digest");
  const from = Date.parse(a.authorized_at),
    to = Date.parse(a.expires_at);
  if (Number.isNaN(from) || Number.isNaN(to))
    errors.push("charter authorization times are missing");
  else if (to - from !== charter.valid_hours * HOUR)
    errors.push("the expiry is not the charter's validity");
  if (!errors.length) {
    const { authorization_sha256, ...body } = a;
    if (sha256Json(body) !== authorization_sha256)
      errors.push("charter authorization does not match its digest");
  }
  return errors;
}

/** Budgets one session runs under: each at most the charter's ceiling. */
export interface SessionBudgets {
  iterations: number;
  experiments: number;
  runtime_ms: number;
  failed_proposals: number;
  model_calls: number;
  model_tokens: number | null;
}
/** Lower a charter's ceilings for one session; never raise one. */
export function budgetsWithin(
  ceilings: Ceilings,
  requested: Partial<SessionBudgets>,
): Checked<SessionBudgets> {
  const errors: string[] = [];
  const pick = (k: Exclude<keyof Ceilings, "model_tokens">) => {
    const v = requested[k];
    if (v === undefined) return ceilings[k];
    if (!Number.isInteger(v) || v < 1) errors.push(`${k} must be a positive integer`);
    else if (v > ceilings[k])
      errors.push(`${k} ${v} exceeds the charter's ceiling of ${ceilings[k]}`);
    return v;
  };
  const value: SessionBudgets = {
    iterations: pick("iterations"),
    experiments: pick("experiments"),
    runtime_ms: pick("runtime_ms"),
    failed_proposals: pick("failed_proposals"),
    model_calls: pick("model_calls"),
    model_tokens: ceilings.model_tokens,
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** What the policy is asked to admit, with everything it judges by. */
export interface AdmissionRequest {
  charter: Charter;
  /** Null in a dry run that has no authorization: the policy says what else would hold. */
  authorization: CharterAuthorization | null;
  sessionId: string;
  iteration: number;
  decision: { decision_id: string; decision_sha256: string };
  designId: string;
  /** The host's validation of the proposal it wrote for the design; null if it failed. */
  validated: Validated | null;
  /**
   * Seed panels already measured, as `option:panel` → the design that measured
   * it: every recorded run, and in a dry run every design it would execute.
   */
  measured: ReadonlyMap<string, string>;
  experimentsThisSession: number;
  budgets: SessionBudgets;
  runtimeLeftMs: number;
  now: Date;
}

/**
 * The autonomy policy. Deterministic: the same request is always judged the
 * same way, every rule is reported whether it holds or not, and an admission
 * is issued only when all of them hold.
 */
export function admit(
  q: AdmissionRequest,
):
  | { ok: true; rules: PolicyRule[]; standing: StandingAuthority }
  | { ok: false; rules: PolicyRule[] } {
  const rules: PolicyRule[] = [];
  const rule = (id: string, ok: boolean, detail: string) => {
    rules.push({ id, ok, detail });
    return ok;
  };
  const sha = charterSha256(q.charter);
  const authErrors = q.authorization
    ? verifyCharterAuthorization(q.authorization, q.charter)
    : ["no person has authorized this charter"];
  if (!authErrors.length && q.now.getTime() > Date.parse(q.authorization!.expires_at))
    authErrors.push(`the authorization expired at ${q.authorization!.expires_at}`);
  rule(
    "charter-authorized",
    !authErrors.length,
    authErrors.join("; ") ||
      `charter ${charterIdOf(sha)} authorized by local operator ${q.authorization!.operator} at ${q.authorization!.authorized_at}, until ${q.authorization!.expires_at} (not authenticated identity)`,
  );
  const family =
    q.charter.schema === DISCOVERY_CHARTER &&
    q.charter.policy_version === DISCOVERY_POLICY
      ? q.charter.family
      : undefined;
  const listed =
    q.charter.designs.find((d) => d.design_id === q.designId) ??
    (family && q.validated
      ? {
          design_id: q.designId,
          design_sha256: designSha256(q.validated.definition),
          option: q.designId,
          panel: "primary" as const,
          seeds: q.validated.definition.seeds,
          expected_direction: q.validated.definition.expected_direction,
        }
      : null);
  if (family)
    rule(
      "family-envelope",
      !!q.validated && envelopeAdmission(q.validated.definition, family).length === 0,
      q.validated
        ? envelopeAdmission(q.validated.definition, family).join("; ") ||
            "parameters within the authorized family"
        : "no validated design",
    );
  rule(
    family ? "family-design" : "design-listed",
    !!listed,
    listed
      ? family
        ? `${q.designId} is compiled within the charter family`
        : `${q.designId} is one of the charter's ${q.charter.designs.length} designs`
      : `${q.designId || "(none)"} is not a design the charter lists`,
  );
  const v = q.validated;
  rule(
    "validated",
    !!v,
    v
      ? `${v.checks.length} deterministic checks passed: ${v.experimentId}`
      : "the host's deterministic validation did not pass",
  );
  const actual = v ? designSha256(v.definition) : null;
  rule(
    "design-digest",
    !!listed && actual === listed.design_sha256,
    !listed || !v
      ? "nothing to compare"
      : actual === listed.design_sha256
        ? `what would run is exactly the authorized design ${actual.slice(0, 12)}…`
        : `what would run (${actual?.slice(0, 12)}…) is not the authorized design (${listed.design_sha256.slice(0, 12)}…)`,
  );
  const hostWritten =
    !!v &&
    !!listed &&
    v.proposal.origin === "rain" &&
    (family
      ? envelopeAdmission(v.definition, family).length === 0
      : v.proposal.question === designQuestion(listed) &&
        v.proposal.hypothesis ===
          optionHypothesis(listed.option, listed.expected_direction)) &&
    v.proposal.rain_decision?.decision_id === q.decision.decision_id &&
    v.proposal.rain_decision?.envelope_hash === q.decision.decision_sha256 &&
    v.proposal.mathematical_basis.length === 0;
  rule(
    "host-written",
    hostWritten,
    hostWritten
      ? "the question and hypothesis are the host's sentences for the design; the model's words stay in its decision record, linked by SHA-256"
      : "the proposal is not the one the host writes for this design and decision",
  );
  const panelKey = listed ? `${listed.option}:${listed.panel}` : "";
  const measuredBy = listed ? (q.measured.get(panelKey) ?? null) : null;
  rule(
    "fresh-seeds",
    !!listed && measuredBy === null,
    !listed
      ? "nothing to compare"
      : measuredBy === null
        ? `${listed.option} uses the host-selected ${listed.panel} seeds (${listed.seeds.join(", ")}); the discovery compiler checks persisted protocol history for family designs`
        : measuredBy === listed.design_id
          ? `${listed.design_id} has already run: the simulator is deterministic, so it would repeat the same result; its record replays instead`
          : `${listed.option}'s ${listed.panel} seeds were already measured by ${measuredBy}: these arms would repeat it exactly, and a hypothesis revised after seeing them must be tested on seeds it has not seen`,
  );
  const experiments = Math.min(q.budgets.experiments, q.charter.ceilings.experiments);
  rule(
    "experiment-budget",
    q.experimentsThisSession < experiments,
    `${q.experimentsThisSession} of ${experiments} experiments run this session`,
  );
  rule(
    "runtime-budget",
    q.runtimeLeftMs > 0,
    q.runtimeLeftMs > 0
      ? `${Math.round(q.runtimeLeftMs / 1000)} s of the session's runtime left`
      : "the session's runtime is spent",
  );
  if (!rules.every((r) => r.ok) || !v || !listed || !q.authorization)
    return { ok: false, rules };
  const body = {
    schema: POLICY_ADMISSION_SCHEMA,
    policy_version: q.charter.policy_version,
    session_id: q.sessionId,
    iteration: q.iteration,
    decision_id: q.decision.decision_id,
    decision_sha256: q.decision.decision_sha256,
    charter_sha256: sha,
    charter_authorization_sha256: q.authorization.authorization_sha256,
    design_id: listed.design_id,
    design_sha256: listed.design_sha256,
    experiment_id: v.experimentId,
    definition_sha256: v.definitionSha256,
    rules: structuredClone(rules),
    admitted_at: q.now.toISOString(),
  };
  return {
    ok: true,
    rules,
    standing: {
      schema: STANDING_SCHEMA,
      charter: structuredClone(q.charter),
      authorization: structuredClone(q.authorization),
      admission: { ...body, admission_sha256: sha256Json(body) },
    },
  };
}

/**
 * Does this standing authority bind exactly this definition? Checks the
 * charter's authorization, the admission's every binding, that the design is
 * listed with this digest, and that the proposal is the host's for the design.
 * With `now` (at run time) the authorization must also still stand; replay
 * passes no clock, and judges the expiry at the moment of admission instead.
 */
export function verifyStanding(
  raw: unknown,
  experimentId: string,
  definition: ExperimentDefinition,
  definitionSha256: string,
  options: { now?: Date } = {},
): string[] {
  const s = raw as StandingAuthority | null;
  if (!s || typeof s !== "object") return ["no standing authority"];
  if (
    !keysExactly(s, ["schema", "charter", "authorization", "admission"]) ||
    s.schema !== STANDING_SCHEMA
  )
    return [`not a ${STANDING_SCHEMA} bundle`];
  const charter = s.charter;
  if (
    !charter ||
    typeof charter !== "object" ||
    !([CHARTER_SCHEMA, DISCOVERY_CHARTER] as string[]).includes(charter.schema) ||
    !([POLICY_VERSION, DISCOVERY_POLICY] as string[]).includes(charter.policy_version) ||
    !Array.isArray(charter.designs)
  )
    return ["the charter is not a charter this lab can read"];
  const errors = verifyCharterAuthorization(s.authorization, charter);
  const a = s.admission;
  if (!a || typeof a !== "object") return [...errors, "no policy admission"];
  if (
    !keysExactly(a, [
      "schema",
      "policy_version",
      "session_id",
      "iteration",
      "decision_id",
      "decision_sha256",
      "charter_sha256",
      "charter_authorization_sha256",
      "design_id",
      "design_sha256",
      "experiment_id",
      "definition_sha256",
      "rules",
      "admitted_at",
      "admission_sha256",
    ]) ||
    a.schema !== POLICY_ADMISSION_SCHEMA ||
    a.policy_version !== charter.policy_version
  )
    return [...errors, "the policy admission is malformed"];
  let sha = "";
  try {
    sha = charterSha256(charter);
  } catch {
    sha = "";
  }
  if (a.charter_sha256 !== sha) errors.push("the admission is for a different charter");
  if (a.charter_authorization_sha256 !== s.authorization?.authorization_sha256)
    errors.push("the admission names a different authorization of the charter");
  if (a.experiment_id !== experimentId || a.definition_sha256 !== definitionSha256)
    errors.push("the admission is for a different definition");
  const family =
    charter.schema === DISCOVERY_CHARTER && charter.policy_version === DISCOVERY_POLICY
      ? charter.family
      : undefined;
  if (charter.schema === DISCOVERY_CHARTER && !family)
    errors.push("family charter has no envelope");
  if (family) errors.push(...envelopeAdmission(definition, family));
  const listed = charter.designs.find((d) => d.design_id === a.design_id);
  if (!family && (!listed || listed.design_sha256 !== a.design_sha256))
    errors.push("the admitted design is not one the charter lists");
  let actual = "";
  try {
    actual = designSha256(definition);
  } catch {
    actual = "";
  }
  if (actual !== a.design_sha256)
    errors.push("what this definition runs is not the admitted design");
  if (!Array.isArray(a.rules) || !a.rules.length || !a.rules.every((r) => r?.ok === true))
    errors.push("the admission does not show every policy rule holding");
  if (
    typeof a.decision_sha256 !== "string" ||
    !SHA256.test(a.decision_sha256) ||
    definition.proposal?.origin !== "rain" ||
    definition.proposal.rain_decision?.decision_id !== a.decision_id ||
    definition.proposal.rain_decision?.envelope_hash !== a.decision_sha256
  )
    errors.push(
      "the definition's proposal does not name the decision the admission names",
    );
  if (
    !family &&
    listed &&
    (definition.question !== designQuestion(listed) ||
      definition.hypothesis !==
        optionHypothesis(listed.option, listed.expected_direction))
  )
    errors.push(
      "the definition's question or hypothesis is not the host's for the design",
    );
  const admitted = Date.parse(a.admitted_at);
  const from = Date.parse(s.authorization?.authorized_at ?? ""),
    to = Date.parse(s.authorization?.expires_at ?? "");
  if (Number.isNaN(admitted) || !(admitted >= from && admitted <= to))
    errors.push("the admission falls outside the authorization's validity");
  if (options.now && options.now.getTime() > to)
    errors.push(`the charter's authorization expired at ${s.authorization.expires_at}`);
  if (!errors.length) {
    const { admission_sha256, ...body } = a;
    if (sha256Json(body) !== admission_sha256)
      errors.push("the admission does not match its digest");
  }
  if (canonicalJson(charter.versions) !== canonicalJson(definition.versions))
    errors.push("the charter was written for a different build");
  return errors;
}

export const isStanding = (v: unknown): v is StandingAuthority =>
  !!v && typeof v === "object" && (v as { schema?: unknown }).schema === STANDING_SCHEMA;
