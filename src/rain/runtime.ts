/**
 * The R.A.I.N. research runtime, in-process.
 *
 * What the Bethesda lab's `/api/rain/*` route serves: an identity, meetings
 * (the offline engine, or model meetings as jobs), R.A.I.N.'s bounded choice
 * among the host's experiment options, pre-registration in an experiment
 * registry, and the admission of a run's measurements against the
 * pre-registered criteria. It is configured from the server's environment,
 * handed in by the entry point (`api/rain/_config.ts`, `vite.config.ts`);
 * nothing here reads the process environment, and no secret's name appears here.
 *
 * Boundaries kept here, as the bridge kept them before the consolidation:
 *
 * - Every request has a closed set of fields, checked by the route before it
 *   reaches this module; nothing in a request names a path, URL, module,
 *   command or code.
 * - No shell and no subprocess but `git`, for this checkout's revision. A
 *   model's words only ever come back as text.
 * - The registry is a scratch directory unless `RAIN_REGISTRY_DIR` names one.
 *   Every pre-registration carries a certificate — an HMAC under the registry
 *   key over the definition — so an instance that never saw it can still check
 *   a submission against exactly the definition that was registered.
 * - A remote decision engine is consulted only when the operator said so.
 * - The mathematical substrate is a bundled, version-pinned index served
 *   read-only (`./mathematics/`): it is checked when the runtime starts, a
 *   pre-registration's mathematical basis is checked against it, and nothing
 *   it holds is evidence. An index that fails its checks is not served.
 * - `RAIN_RUNTIME=off` switches the runtime off: the lab runs OFFLINE.
 *
 * Server only.
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  corpusFingerprint,
  discoverCorpus,
  hashCorpusDocuments,
  type CorpusDocument,
} from "./corpus.js";
import corpusData from "./data/corpus.json" with { type: "json" };
import { Refused } from "./errors.js";
import {
  canonicalJson,
  ExperimentError,
  sha256Json,
  validateDefinition,
  type Json,
} from "./experiments/schema.js";
import {
  assembleDefinition,
  checkExperimentId,
  Registry,
} from "./experiments/registry.js";
import { recordSubmission, recordedBy } from "./experiments/runner.js";
import {
  createDecisionRouter,
  enabled,
  type DecisionConfig,
  type Env,
} from "./judgment/config.js";
import { decisionRequest, envelopeToDict } from "./judgment/routing.js";
import {
  ModelMeetings,
  type MeetingFailedAnswer,
  type MeetingPending,
} from "./meeting/jobs.js";
import {
  buildOfflineMeeting,
  loadCorpus,
  OFFLINE_ENGINE,
  type LoadedCorpus,
} from "./meeting/offline.js";
import { enforceMeetingPrivacy, PrivacyError, type Privacy } from "./meeting/privacy.js";
import { bundledIndex } from "./mathematics/bundled.js";
import { MATHEMATICS_SCHEMA, parseBasis } from "./mathematics/contracts.js";
import {
  MathematicalSubstrate,
  SubstrateUnavailable,
  type SearchInput,
} from "./mathematics/substrate.js";
import {
  MODEL_ENGINE,
  MODEL_ID,
  offlineMeetingRecord,
  RAIN_BETHESDA_SCHEMA,
  type MeetingRecord,
  type Revision,
} from "./meeting/record.js";

export const LAB_REPOSITORY = "topherchris420/lop-nur-twin" as const;
/** The runtime's own name and version, reported in its identity. */
export const RUNTIME = { name: "lop-nur-twin-rain", version: "1" } as const;
export const DEFAULT_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";
/** Fields `experiment create --from` accepts; the registry assigns the rest. */
export const DRAFT_FIELDS = [
  "title",
  "question",
  "hypothesis",
  "rationale",
  "subsystem",
  "created_by",
  "evidence_class",
  "runner",
  "seed",
  "parameters",
  "procedure",
  "variables",
  "metrics",
  "criteria",
  "dependencies",
  "data_policy",
  "limitations",
] as const;
/** A scratch registry is bounded; a configured one is the operator's. */
export const SCRATCH_REGISTRY_CAP = 1000;
/** The shortest registry secret accepted, in characters. */
export const REGISTRY_SECRET_MIN = 32;
/** Domain separation: this key signs pre-registrations and nothing else. */
const CERTIFICATE_CONTEXT = "rain-preregistration-certificate/v1\n";
const HEX64 = /^[0-9a-f]{64}$/;

export interface RainIdentity {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "identity";
  runtime: { name: string; version: string };
  rain: Revision;
  corpus: { files: number; sha256: string };
  meeting_engine: string;
  meeting_generation: "scripted" | "model";
  model: string | null;
  bounded_decision: string;
  remote_decisions: boolean;
  /** `reason` says why a registry is not available, and is null when it is. */
  registry: { available: boolean; scratch: boolean; reason: string | null };
}
/**
 * What a submission brings back so that any instance can check it against its
 * pre-registration: the draft as it was sent, when the registry took it, and
 * the certificate the registry issued.
 */
export interface CertifiedPreregistration {
  draft: Json;
  created_at: string;
  certificate: string;
}
export interface ProposalOption {
  id: string;
  description: string;
}

/** Secrets reach the runtime by value, from the entry point, never by name. */
export interface RuntimeSecrets {
  /** TypeSafe's key, for Jev as a decision engine. */
  typesafeApiKey?: string | undefined;
  typesafeModel?: string | undefined;
  /** A bearer token for the model server, when it wants one. */
  modelApiKey?: string | undefined;
  /**
   * The key that certifies pre-registrations. Shared by every instance of a
   * deployment, it lets one instance check what another registered; unset,
   * each process makes a key of its own.
   */
  registrySecret?: string | undefined;
}
export interface RuntimeOptions {
  env: Env;
  secrets?: RuntimeSecrets;
  /** The checkout whose revision is reported; defaults to the working directory. */
  cwd?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Reads `RAIN_DECISION_CALIBRATION`; injectable for tests. */
  readFile?: (path: string) => string;
  /** Resolves a model endpoint's host for the privacy rule; injectable for tests. */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Creates the scratch registry directory; injectable for tests. */
  scratchDir?: () => string;
  /** The substrate index to serve instead of the bundled one; injectable for tests. */
  mathematicsIndex?: unknown;
  sleep?: (ms: number) => Promise<void>;
}

/** What the route calls. `RainRuntime` implements it; a test may stand one in. */
export interface RuntimeApi {
  identity(): RainIdentity;
  meeting(question: string, requestId: string): unknown;
  meetingStatus(jobId: string, requestId: string): unknown;
  meetingCancel(jobId: string, requestId: string): unknown;
  proposal(
    question: string,
    options: readonly ProposalOption[],
    requestId: string,
  ): Promise<unknown> | unknown;
  preregister(draft: unknown, requestId: string): unknown;
  /** The mathematical substrate: which repository, commit and index, or why none is served. */
  mathStatus(): unknown;
  mathSearch(input: SearchInput, requestId: string): unknown;
  mathInspect(family: string, requestId: string): unknown;
  submission(
    experimentId: string,
    submission: unknown,
    requestId: string,
    preregistration?: CertifiedPreregistration | null,
  ): unknown;
}
export type RuntimeConfiguration =
  | { mode: "off" }
  | { mode: "misconfigured"; reason: string }
  | { mode: "local"; runtime: RuntimeApi };

/** This checkout's revision: the CI commit when it says, else `git`, else unknown. */
export function labRevision(env: Env, cwd: string): Revision {
  const ci = env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA ?? "";
  if (/^[0-9a-f]{40}$/.test(ci))
    return { repository: LAB_REPOSITORY, commit: ci, dirty: null };
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const commit = git("rev-parse", "HEAD");
    if (!/^[0-9a-f]{40}$/.test(commit))
      return { repository: LAB_REPOSITORY, commit: null, dirty: null };
    const dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
    return { repository: LAB_REPOSITORY, commit, dirty };
  } catch {
    return { repository: LAB_REPOSITORY, commit: null, dirty: null };
  }
}

/** The bundled corpus, as the runtime's discovery rules see it. */
export const corpusDocuments = (): CorpusDocument[] =>
  discoverCorpus(corpusData.files.map((f) => ({ path: f.path, text: f.text })));

const bounded = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  what: string,
) => {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${what} must be an integer from ${min} to ${max}`);
  return n;
};

/**
 * Read the environment and build the runtime, or say why not. The reason is
 * safe to log and to show: it names a setting, never its value.
 */
export async function configureRuntime(
  options: RuntimeOptions,
): Promise<RuntimeConfiguration> {
  const env = options.env;
  const switchValue = (env.RAIN_RUNTIME ?? "local").trim().toLowerCase();
  if (switchValue === "off") return { mode: "off" };
  if (switchValue !== "local")
    return { mode: "misconfigured", reason: "RAIN_RUNTIME must be local or off" };
  try {
    const runtime = await RainRuntime.create(options);
    return { mode: "local", runtime };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the runtime could not start";
    return { mode: "misconfigured", reason: reason.slice(0, 300) };
  }
}

interface RuntimeParts {
  env: Env;
  cwd: string;
  documents: CorpusDocument[];
  loaded: LoadedCorpus;
  corpus: { files: number; sha256: string };
  meetings: ModelMeetings | null;
  decision: DecisionConfig;
  registry: Registry;
  scratch: boolean;
  certificateKey: Buffer;
  registryReason: string | null;
  mathematics: MathematicalSubstrate | null;
  mathematicsReason: string | null;
  now: () => Date;
}

export class RainRuntime implements RuntimeApi {
  private readonly env: Env;
  private readonly cwd: string;
  private readonly documents: CorpusDocument[];
  private readonly loaded: LoadedCorpus;
  private readonly corpus: { files: number; sha256: string };
  private readonly meetings: ModelMeetings | null;
  private readonly decision: DecisionConfig;
  private readonly registry: Registry;
  private readonly scratch: boolean;
  private readonly certificateKey: Buffer;
  private readonly registryReason: string | null;
  /** Definitions certified elsewhere, each held in a scratch registry of its own. */
  private readonly certified = new Map<string, Registry>();
  private readonly mathematics: MathematicalSubstrate | null;
  private readonly mathematicsReason: string | null;
  private readonly now: () => Date;
  private constructor(parts: RuntimeParts) {
    this.env = parts.env;
    this.cwd = parts.cwd;
    this.documents = parts.documents;
    this.loaded = parts.loaded;
    this.corpus = parts.corpus;
    this.meetings = parts.meetings;
    this.decision = parts.decision;
    this.registry = parts.registry;
    this.scratch = parts.scratch;
    this.certificateKey = parts.certificateKey;
    this.registryReason = parts.registryReason;
    this.mathematics = parts.mathematics;
    this.mathematicsReason = parts.mathematicsReason;
    this.now = parts.now;
  }

  static async create(options: RuntimeOptions): Promise<RainRuntime> {
    const env = options.env;
    const secrets = options.secrets ?? {};
    const cwd = options.cwd ?? process.cwd();
    const now = options.now ?? (() => new Date());
    const documents = corpusDocuments();
    if (!documents.length) throw new Error("the bundled corpus is empty");
    const rows = hashCorpusDocuments(documents);
    const corpus = { files: rows.length, sha256: corpusFingerprint(rows) };
    const loaded = loadCorpus(documents);

    // The scan for configured secrets in a question needs the values under
    // secret-like names; the names themselves stay in the entry point.
    const scanEnv: Record<string, string | undefined> = { ...env };
    if (secrets.typesafeApiKey)
      scanEnv.CONFIGURED_DECISION_API_KEY = secrets.typesafeApiKey;
    if (secrets.modelApiKey) scanEnv.CONFIGURED_MODEL_API_KEY = secrets.modelApiKey;
    if (secrets.registrySecret)
      scanEnv.CONFIGURED_REGISTRY_SECRET = secrets.registrySecret;
    const decision = createDecisionRouter(scanEnv, {
      decisionApiKey: secrets.typesafeApiKey,
      decisionModel: secrets.typesafeModel,
      calibrationText: env.RAIN_DECISION_CALIBRATION?.trim()
        ? (options.readFile ?? ((p) => readFileSync(p, "utf8")))(
            resolve(cwd, env.RAIN_DECISION_CALIBRATION.trim()),
          )
        : null,
      fetchImpl: options.fetchImpl,
    });

    const registryDir = env.RAIN_REGISTRY_DIR?.trim();
    // A function deployment has no disk its instances share: a configured
    // directory would be a different one on each of them.
    if (registryDir && env.VERCEL)
      throw new Error(
        "RAIN_REGISTRY_DIR needs one disk every request reaches; this deployment runs functions",
      );
    const scratch = !registryDir;
    const registrySecret = secrets.registrySecret ?? "";
    if (registrySecret && registrySecret.length < REGISTRY_SECRET_MIN)
      throw new Error(
        `the registry secret must be at least ${REGISTRY_SECRET_MIN} characters`,
      );
    const certificateKey = registrySecret
      ? Buffer.from(registrySecret, "utf8")
      : randomBytes(32);
    // Each function instance holds a scratch registry of its own, and a run is
    // reported long after it was pre-registered: without a key every instance
    // shares, the instance that admits it cannot check the certificate.
    const registryReason =
      env.VERCEL && !registrySecret
        ? "this deployment runs functions, whose instances share no registry, and has no registry secret to let one check another's pre-registration"
        : null;
    const registry = new Registry(
      registryDir
        ? resolve(cwd, registryDir)
        : (options.scratchDir ?? (() => mkdtempSync(join(tmpdir(), "rain-registry-"))))(),
      now,
    );

    let meetings: ModelMeetings | null = null;
    const engine = (env.RAIN_MEETING_ENGINE ?? "offline").trim().toLowerCase();
    if (engine !== "offline" && engine !== "model")
      throw new Error("RAIN_MEETING_ENGINE must be offline or model");
    if (engine === "model") {
      if (env.VERCEL)
        throw new Error(
          "RAIN_MEETING_ENGINE=model needs one long-lived server process; this deployment runs functions",
        );
      const model = (env.RAIN_LLM_MODEL ?? "").trim();
      if (!model || !MODEL_ID.test(model))
        throw new Error(
          "RAIN_LLM_MODEL must name the local model to run, for example qwen2.5:7b in Ollama or qwen2.5-7b-instruct in LM Studio",
        );
      const baseUrl = (env.RAIN_LLM_BASE_URL ?? DEFAULT_MODEL_BASE_URL).trim();
      try {
        const url = new URL(baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
        if (url.username || url.password) throw new Error();
      } catch {
        throw new Error("RAIN_LLM_BASE_URL must be an http(s) URL without credentials");
      }
      const privacyValue = (env.RAIN_MEETING_PRIVACY ?? "local").trim().toLowerCase();
      if (privacyValue !== "local" && privacyValue !== "hybrid")
        throw new Error("RAIN_MEETING_PRIVACY must be local or hybrid");
      const privacy: Privacy = privacyValue;
      try {
        await enforceMeetingPrivacy(privacy, baseUrl, model, options.resolveHost);
      } catch (error) {
        if (error instanceof PrivacyError) throw error;
        throw new Error("the model endpoint's host could not be classified");
      }
      const turns = bounded(env.RAIN_MEETING_TURNS, 25, 1, 30, "RAIN_MEETING_TURNS");
      const timeoutMinutes = bounded(
        env.RAIN_MEETING_TIMEOUT_MIN,
        45,
        5,
        60,
        "RAIN_MEETING_TIMEOUT_MIN",
      );
      const lmTimeout = bounded(env.RAIN_LM_TIMEOUT, 300, 30, 3600, "RAIN_LM_TIMEOUT");
      const recursion =
        env.RAIN_MEETING_RECURSION === undefined
          ? true
          : enabled(env, "RAIN_MEETING_RECURSION");
      meetings = new ModelMeetings({
        settings: {
          baseUrl,
          model,
          apiKey: secrets.modelApiKey,
          maxTurns: turns,
          recursiveIntellect: recursion,
          timeoutMs: lmTimeout * 1000,
        },
        timeoutMinutes,
        documents,
        revision: () => labRevision(env, cwd),
        archiveDir: env.RAIN_MEETING_ARCHIVE_DIR?.trim()
          ? resolve(cwd, env.RAIN_MEETING_ARCHIVE_DIR.trim())
          : null,
        hooks: { fetchImpl: options.fetchImpl, now, sleep: options.sleep },
        now,
      });
    }
    // The substrate is served only if its index passes every check; otherwise
    // the runtime still starts, and says why no mathematics is available.
    let mathematics: MathematicalSubstrate | null = null;
    let mathematicsReason: string | null = null;
    try {
      mathematics = MathematicalSubstrate.load(
        options.mathematicsIndex ?? bundledIndex(),
        now,
      );
    } catch (error) {
      if (!(error instanceof SubstrateUnavailable)) throw error;
      mathematicsReason = error.message.slice(0, 300);
    }
    return new RainRuntime({
      env,
      cwd,
      documents,
      loaded,
      corpus,
      meetings,
      decision,
      registry,
      scratch,
      certificateKey,
      registryReason,
      mathematics,
      mathematicsReason,
      now,
    });
  }

  revision(): Revision {
    return labRevision(this.env, this.cwd);
  }

  identity(): RainIdentity {
    return {
      schema: RAIN_BETHESDA_SCHEMA,
      kind: "identity",
      runtime: { ...RUNTIME },
      rain: this.revision(),
      corpus: { ...this.corpus },
      meeting_engine: this.meetings ? MODEL_ENGINE : OFFLINE_ENGINE,
      meeting_generation: this.meetings ? "model" : "scripted",
      model: this.meetings?.model ?? null,
      bounded_decision: this.decision.mode,
      remote_decisions: this.decision.remoteAllowed,
      registry: {
        available: this.registryReason === null,
        scratch: this.scratch,
        reason: this.registryReason,
      },
    };
  }

  /** One meeting: the offline engine answers at once; a model meeting answers with a job. */
  meeting(question: string, requestId: string): MeetingRecord | MeetingPending {
    if (this.meetings) return this.meetings.start(question, requestId);
    const meeting = buildOfflineMeeting(question, this.documents, this.loaded);
    return offlineMeetingRecord(
      meeting,
      this.documents,
      requestId,
      this.revision(),
      this.now().toISOString(),
    );
  }

  meetingStatus(
    jobId: string,
    requestId: string,
  ): MeetingRecord | MeetingPending | MeetingFailedAnswer {
    if (!this.meetings) throw new Refused(422, "this runtime holds no model meetings");
    return this.meetings.status(jobId, requestId);
  }

  meetingCancel(jobId: string, requestId: string): MeetingFailedAnswer {
    if (!this.meetings) throw new Refused(422, "this runtime holds no model meetings");
    return this.meetings.cancel(jobId, requestId);
  }

  /** R.A.I.N.'s bounded choice among the host's options, or the reason it made none. */
  async proposal(
    question: string,
    options: readonly ProposalOption[],
    requestId: string,
  ) {
    const offered = new Set(options.map((o) => o.id));
    const request = decisionRequest({
      decisionClass: "bethesda_experiment",
      state: "Research question: " + question,
      instructions:
        "Which of these host-defined Bethesda simulation experiments, if any, would test the research question?",
      choices: options.map((o) => [o.id, o.description] as const),
      consequence: "low",
      // The question goes to a remote engine (Jev) only when the operator said so.
      remoteAllowed: this.decision.remoteAllowed,
    });
    const envelope = await this.decision.router.decide(
      request,
      (_, selected) => selected === null || offered.has(selected),
    );
    const payload = envelopeToDict(envelope);
    return {
      schema: RAIN_BETHESDA_SCHEMA,
      kind: "proposal-choice" as const,
      request_id: requestId,
      decision: {
        schema_version: payload.schema_version,
        decision_id: payload.decision_id,
        destination: payload.destination,
        selected: payload.selected,
        reason: payload.reason,
        envelope_hash: payload.envelope_hash,
        attempts: envelope.attempts.slice(0, 4).map((a) => ({
          engine: a.engine,
          model: a.model,
          selected: a.selected,
          probabilities: a.probabilities.map(
            ([k, v]) => [String(k), Number(v)] as [string, number],
          ),
          confidence: a.confidence,
          reason: a.reason,
          error_code: a.errorCode,
          latency_ms: a.latencyMs,
        })),
        latency_ms: payload.latency_ms,
      },
    };
  }

  /** The substrate's identity, or why none is served. */
  mathStatus() {
    if (this.mathematics) return this.mathematics.status();
    return {
      schema: MATHEMATICS_SCHEMA,
      kind: "math-status" as const,
      available: false,
      reason: this.mathematicsReason ?? "no mathematical substrate is configured",
      substrate: null,
    };
  }

  private substrate(): MathematicalSubstrate {
    if (!this.mathematics)
      throw new Refused(
        503,
        "the mathematical substrate is not available: " +
          (this.mathematicsReason ?? "none is configured"),
      );
    return this.mathematics;
  }

  /** `search_mathematics`: results that share terms with a query, and what that does and does not establish. */
  mathSearch(input: SearchInput, requestId: string) {
    return this.substrate().searchMathematics(input, requestId);
  }

  /** `inspect_mathematical_result`: one result family, bounded. */
  mathInspect(family: string, requestId: string) {
    return this.substrate().inspectMathematicalResult({ family }, requestId);
  }

  /**
   * A draft that cites mathematics must cite it exactly as this substrate
   * holds it — the same repository, commit and index, the same status and
   * paths — or it is not registered. The registry's definition then carries
   * the basis, and its certificate covers it.
   */
  private checkBasis(d: Record<string, unknown>) {
    const parameters = d.parameters as Record<string, unknown> | null;
    if (
      !parameters ||
      typeof parameters !== "object" ||
      !("mathematical_basis" in parameters)
    )
      return;
    const parsed = parseBasis(parameters.mathematical_basis);
    if (!parsed.ok)
      throw new Refused(
        422,
        "the mathematical basis is malformed: " + parsed.errors.slice(0, 3).join("; "),
      );
    if (!parsed.value.length) return;
    const errors = this.substrate().verifyBasis(parsed.value);
    if (errors.length)
      throw new Refused(
        422,
        "the mathematical basis does not match the substrate: " +
          errors.slice(0, 3).join("; ").slice(0, 300),
      );
  }

  /** Pre-register the lab's draft: the registry assigns `V3D-EXP-NNNN`. */
  preregister(draft: unknown, requestId: string) {
    if (this.registryReason)
      throw new Refused(503, "the registry is not available: " + this.registryReason);
    if (!draft || typeof draft !== "object" || Array.isArray(draft))
      throw new Refused(400, "draft must carry exactly the create --from fields");
    const d = draft as Record<string, unknown>;
    if (Object.keys(d).sort().join() !== [...DRAFT_FIELDS].sort().join())
      throw new Refused(400, "draft must carry exactly the create --from fields");
    if (
      (d.runner as { kind?: unknown } | undefined)?.kind !== "external" ||
      d.evidence_class !== "simulated"
    )
      throw new Refused(400, "only external, simulated experiments are registered here");
    this.checkBasis(d);
    if (this.scratch && this.registry.experimentIds().length >= SCRATCH_REGISTRY_CAP)
      throw new Refused(
        422,
        "the scratch registry is full; configure RAIN_REGISTRY_DIR or restart the server",
      );
    let definition: Record<string, unknown>;
    try {
      definition = this.registry.create(d);
    } catch (error) {
      if (error instanceof ExperimentError)
        throw new Refused(
          422,
          "R.A.I.N. refused the definition: " + error.message.slice(0, 300),
        );
      throw error;
    }
    return {
      schema: RAIN_BETHESDA_SCHEMA,
      kind: "preregistration" as const,
      request_id: requestId,
      experiment_id: definition.experiment_id as string,
      experiment_version: definition.experiment_version as number,
      definition_sha256: sha256Json(definition),
      created_at: definition.created_at as string,
      registry: this.scratch ? ("scratch" as const) : ("configured" as const),
      certificate: this.certify(definition),
    };
  }

  /** An HMAC-SHA256 under the registry key over the canonical definition. */
  private certify(definition: Json): string {
    return createHmac("sha256", this.certificateKey)
      .update(CERTIFICATE_CONTEXT)
      .update(canonicalJson(definition))
      .digest("hex");
  }

  /**
   * The registry that holds exactly the definition a submission was
   * pre-registered with, once its certificate checks out: this one when it
   * does; otherwise, for a scratch registry, one of its own for that
   * definition, written once. A run is never judged against another experiment
   * that happens to carry the same ID on this instance.
   */
  private registryFor(experimentId: string, p: CertifiedPreregistration): Registry {
    let definition: Json;
    try {
      definition = assembleDefinition(
        p.draft,
        checkExperimentId(experimentId),
        p.created_at,
      );
      validateDefinition(definition);
    } catch (error) {
      if (error instanceof ExperimentError)
        throw new Refused(
          422,
          "the pre-registration is not a valid definition: " +
            error.message.slice(0, 300),
        );
      throw error;
    }
    const given = HEX64.test(p.certificate) ? Buffer.from(p.certificate, "hex") : null;
    if (!given || !timingSafeEqual(given, Buffer.from(this.certify(definition), "hex")))
      throw new Refused(
        422,
        "the pre-registration certificate does not verify: this registry did not issue it for that definition",
      );
    const sha = sha256Json(definition);
    if (
      this.registry.holds(experimentId) &&
      sha256Json(this.registry.loadDefinition(experimentId)) === sha
    )
      return this.registry;
    if (!this.scratch)
      throw new Refused(
        422,
        `${experimentId} is not in this registry with that definition`,
      );
    let held = this.certified.get(sha);
    if (!held) {
      if (this.certified.size >= SCRATCH_REGISTRY_CAP)
        throw new Refused(422, "the scratch registry on this instance is full");
      held = new Registry(join(this.registry.root, ".certified", sha), this.now);
      try {
        held.adopt(definition);
      } catch (error) {
        if (error instanceof ExperimentError)
          throw new Refused(
            422,
            "R.A.I.N. could not hold the pre-registration: " +
              error.message.slice(0, 300),
          );
        throw error;
      }
      this.certified.set(sha, held);
    }
    return held;
  }

  /**
   * Admit one run's measurements; the registry evaluates the pre-registered
   * criteria itself. A submission that brings its certified pre-registration
   * is admitted by whichever instance it reaches.
   */
  submission(
    experimentId: string,
    submission: unknown,
    requestId: string,
    preregistration: CertifiedPreregistration | null = null,
  ) {
    if (this.registryReason)
      throw new Refused(503, "the registry is not available: " + this.registryReason);
    const registry = preregistration
      ? this.registryFor(experimentId, preregistration)
      : this.registry;
    let record: Record<string, unknown>;
    try {
      record = recordSubmission(registry, experimentId, submission, {
        recordedBy: recordedBy(this.cwd, registry),
        now: this.now,
      });
    } catch (error) {
      if (error instanceof ExperimentError)
        throw new Refused(
          422,
          "R.A.I.N. refused the submission: " + error.message.slice(0, 300),
        );
      throw error;
    }
    const interpretation = record.interpretation as { deterministic: string };
    return {
      schema: RAIN_BETHESDA_SCHEMA,
      kind: "admission" as const,
      request_id: requestId,
      run_id: record.run_id as string,
      status: record.status as string,
      hypothesis_verdict: record.hypothesis_verdict as string,
      evaluation: record.evaluation,
      interpretation: { deterministic: interpretation.deterministic, model: null },
      definition_sha256: record.definition_sha256 as string,
      recorded_at: (record.provenance as { recorded_at: string }).recorded_at,
    };
  }

  /** Whether a model meeting is in progress (the browser checks say so before a preview stops). */
  get meetingRunning(): boolean {
    return this.meetings?.running ?? false;
  }
}
