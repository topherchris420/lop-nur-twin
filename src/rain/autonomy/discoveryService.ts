/** Local operator service. Construction and status never start or resume research. */
import { autonomyConfig, normalizeBaseUrl } from "./config.js";
import {
  createLocalModel,
  createOpenAIResearchModel,
  type LocalModel,
} from "./models.js";
import { ResearchStore } from "./store.js";
import { runDiscovery, discoveryHistory } from "./discovery.js";
import { configureRuntime } from "../runtime.js";
import { classifyUrl } from "../meeting/privacy.js";
import {
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
  type Charter,
} from "../../bethesda/rain/standing.js";
import {
  DEFAULT_ENVELOPE,
  DISCOVERY_QUESTION,
  envelopeErrors,
  type Envelope,
} from "../../bethesda/rain/discoveryProtocol.js";
import type { DiscoveryView } from "../../bethesda/rain/discoveryView.js";
import {
  researchScope,
  type ResearchScope,
  type ResearchView,
} from "../../bethesda/rain/researchProtocol.js";
import { UNSAFE_TEXT } from "../protocol.js";
import type { Partnership } from "../../bethesda/rain/inceptionProtocol.js";
import { approveWorld, descendantLabs, type ResearchWorld } from "../research/worlds.js";
import { descendantCharter, runDescendant } from "./descendants.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";
import type { SessionPolicy } from "../../bethesda/rain/scheduleProtocol.js";
import { createSessionScheduler } from "./scheduler.js";
import { inheritanceCatalog } from "../research/inheritance.js";
import { evaluateInstitution } from "../research/institutionEvaluation.js";
import type { InstitutionAssessment } from "../../bethesda/rain/institutionProtocol.js";
import { archiveInstitution } from "../research/archive.js";
import { sha256Json } from "../sha256.js";
import { verifyRecord } from "../../bethesda/rain/replay.js";

export function createDiscoveryService(
  env: Record<string, string | undefined>,
  cwd: string,
) {
  const configured = autonomyConfig({
    ...env,
    RAIN_MODEL_PROVIDER: env.RAIN_MODEL_PROVIDER ?? "lmstudio",
    RAIN_MODEL_MAX_TOKENS: env.RAIN_MODEL_MAX_TOKENS ?? "4096",
  });
  if (!configured.ok) throw new Error(configured.reason);
  const config = configured.config;
  const store = new ResearchStore(config.dir);
  const scheduler = createSessionScheduler(store);
  let scheduleTimer: ReturnType<typeof setInterval> | null = null;
  let model: LocalModel | null = null;
  let collaboratorModel: LocalModel | undefined;
  let verifying = false;
  let charter: Charter | null = null;
  let abort: AbortController | null = null;
  let job: ReturnType<typeof runDiscovery> | null = null;
  let preparing = false;
  let childId: string | null = null;
  const control = { pauseRequested: false };
  const makeCollaborator = (
    participant: Partnership["collaborator_model"],
  ): LocalModel | undefined => {
    if (!participant) return undefined;
    if (
      normalizeBaseUrl(participant.endpoint, "Collaborator endpoint") !==
      participant.endpoint
    )
      throw new Error(
        "Use a normalized collaborator endpoint without credentials, query or fragment",
      );
    if (participant.provider === "openai") {
      if (
        participant.endpoint !== "https://api.openai.com" ||
        env.RAIN_COLLABORATOR_PROVIDER !== "openai" ||
        participant.model !== env.RAIN_COLLABORATOR_MODEL
      )
        throw new Error("Remote collaborator must match explicit server configuration");
      return createOpenAIResearchModel({
        model: participant.model,
        apiKey: env.RAIN_OPENAI_API_KEY ?? "",
        remoteAllowed: env.RAIN_COLLABORATOR_REMOTE_ALLOWED === "true",
        timeoutMs: config.timeoutMs,
        maxTokens: config.maxTokens,
      });
    }
    return createLocalModel({
      provider: participant.provider,
      model: participant.model,
      baseUrl: participant.endpoint,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      contextTokens: config.contextTokens,
    });
  };
  let view: DiscoveryView = {
    schema: "rain-discovery-view/v1",
    available: true,
    active: false,
    stage: "IDLE",
    detail: "Connect your local model and review the experiment family to begin.",
    question: DISCOVERY_QUESTION,
    proposed: null,
    validation: [],
    authorization: "Not reviewed",
    progress: null,
    critique: null,
    history: discoveryHistory(store.discoveryEntries()),
    events: [],
    model: null,
    charter: null,
    charter_sha256: null,
    report: null,
    lock: store.lock(),
    research: store
      .discoveryEntries()
      .filter((e) => e.kind === "research-state")
      .at(-1)?.payload as ResearchView | undefined,
  };
  const status = () =>
    structuredClone({
      ...view,
      schedule: scheduler.state(),
      observatory: {
        labs: descendantLabs(store).map((l) => ({
          id: l.spec.id,
          parent: l.spec.parent,
          generation: l.spec.generation,
          status: l.status,
          digest: l.digest,
          expires_at: l.expires_at,
        })),
        proposals: store
          .discoveryEntries()
          .filter((e) => e.kind === "world-proposed")
          .map((e) => e.payload),
        reports: store
          .discoveryEntries()
          .filter((e) => e.kind === "world-report")
          .map((e) => e.payload),
        evaluation: evaluateInstitution(
          discoveryHistory(store.discoveryEntries()),
          store.discoveryEntries(),
          [],
          store
            .discoveryEntries()
            .filter((e) => e.kind === "institution-assessment")
            .map((e) => e.payload as InstitutionAssessment),
        ),
        inheritance: inheritanceCatalog(store).map((r) => ({
          id: r.id,
          sha256: r.sha256,
          status: r.status,
          origin_lab: r.origin_lab,
        })),
      },
      lock: store.lock(),
      events: store
        .discoveryEntries()
        .filter((e) => !["inference-request", "inference-answer"].includes(e.kind))
        .map((e) => ({
          sequence: e.sequence,
          at: e.at,
          kind: e.kind,
          detail: JSON.stringify(e.payload).slice(0, 2400),
        })),
    });
  const prepare = async (research?: ResearchScope) => {
    if (view.active || preparing)
      throw new Error("A session or connection check is already active");
    preparing = true;
    scheduler.control("paused");
    childId = null;
    try {
      if ((await classifyUrl(config.baseUrl)) === "remote")
        throw new Error("Only local inference endpoints are allowed");
      const settings = {
        provider: config.provider,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        contextTokens: config.contextTokens,
      };
      const listed = await createLocalModel({
        ...settings,
        model: "discovery",
        timeoutMs: 5000,
      }).listModels();
      const qwen = listed.filter((id) => /qwen/i.test(id));
      const selected = config.model ?? (qwen.length === 1 ? qwen[0] : null);
      if (!selected || !listed.includes(selected))
        throw new Error(
          `Select RAIN_MODEL from LM Studio's actual identifiers: ${listed.join(", ") || "none loaded"}. A unique loaded Qwen is selected automatically.`,
        );
      model = createLocalModel({ ...settings, model: selected });
      collaboratorModel = undefined;
      const participant = research?.partnership?.collaborator_model;
      if (participant) {
        if (
          normalizeBaseUrl(participant.endpoint, "Collaborator endpoint") !==
          participant.endpoint
        )
          throw new Error(
            "Use a normalized collaborator endpoint without credentials, query or fragment",
          );
        if (participant.provider === "openai") {
          if (
            participant.endpoint !== "https://api.openai.com" ||
            env.RAIN_COLLABORATOR_PROVIDER !== "openai" ||
            participant.model !== env.RAIN_COLLABORATOR_MODEL
          )
            throw new Error(
              "Remote collaborator must match explicit server configuration",
            );
          collaboratorModel = createOpenAIResearchModel({
            model: participant.model,
            apiKey: env.RAIN_OPENAI_API_KEY ?? "",
            remoteAllowed: env.RAIN_COLLABORATOR_REMOTE_ALLOWED === "true",
            timeoutMs: config.timeoutMs,
            maxTokens: config.maxTokens,
          });
        } else {
          if ((await classifyUrl(participant.endpoint)) === "remote")
            throw new Error("Collaborator endpoint must be local");
          collaboratorModel = createLocalModel({
            ...settings,
            provider: participant.provider,
            baseUrl: participant.endpoint,
            model: participant.model,
          });
          if (!(await collaboratorModel.listModels()).includes(participant.model))
            throw new Error("Collaborator model unavailable");
        }
      }
      const envelope: Envelope = env.RAIN_DISCOVERY_ENVELOPE
        ? JSON.parse(env.RAIN_DISCOVERY_ENVELOPE)
        : DEFAULT_ENVELOPE;
      const errors = envelopeErrors(envelope);
      if (errors.length) throw new Error(errors.join("; "));
      charter = buildDiscoveryCharter({
        ceilings: config.ceilings,
        model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
        validHours: config.charterHours,
        envelope,
        ...(research ? { research } : {}),
      });
      store.saveCharter(charter);
      const auth = store
        .authorizations(charter)
        .find((a) => Date.parse(a.expires_at) > Date.now());
      view = {
        ...view,
        charter,
        charter_sha256: charterSha256(charter),
        question: research?.goal ?? view.question,
        model: selected,
        authorization: auth
          ? `Approved until ${auth.expires_at}`
          : "Review the envelope and confirm its digest",
        detail: "Connected. No experiment has started.",
      };
      return status();
    } finally {
      preparing = false;
    }
  };
  const authorize = (prefix: string, reviewed: boolean) => {
    if (!charter || view.active)
      throw new Error("Prepare and review an idle charter first");
    const auth = authorizeCharter({
      charter,
      typedPrefix: prefix,
      reviewed,
      operator: config.operator,
      now: new Date(),
    });
    if (!auth.ok) throw new Error(auth.errors.join("; "));
    store.saveAuthorization(auth.value);
    view.authorization = `Approved until ${auth.value.expires_at}`;
    return status();
  };
  const start = async (question = DISCOVERY_QUESTION, scheduled = false) => {
    if (view.active || job || preparing || verifying)
      throw new Error("A session or verification is already active");
    if (!config.enabled)
      throw new Error("Set RAIN_AUTONOMY_ENABLED=true to enable local sessions");
    if (!charter || !model)
      throw new Error("Connect and review the current local model first");
    if (!question.trim() || question.length > 400 || UNSAFE_TEXT.test(question))
      throw new Error("Question must be 1–400 visible characters");
    if (charter.research && charter.research.goal !== question)
      throw new Error("Review a new research scope before changing its goal");
    const auth = store
      .authorizations(charter)
      .find((a) => Date.parse(a.expires_at) > Date.now());
    if (!auth) throw new Error("No current authorization covers this family");
    if (store.lock())
      throw new Error("Another or interrupted research session holds the lock");
    view.active = true;
    abort = new AbortController();
    control.pauseRequested = false;
    view.question = question;
    view.stage = "CONNECTING";
    view.detail = "Preparing persistent native registry";
    try {
      const sessionStore = scheduled
        ? new ResearchStore(
            store.root,
            Math.min(store.maxBytes, scheduler.state()!.policy.storage_bytes),
          )
        : store;
      const runtime = await configureRuntime({
        env: { ...env, RAIN_REGISTRY_DIR: sessionStore.registryDir() },
        cwd,
        registryWriteGuard: (bytes) => sessionStore.checkWriteBudget(bytes + 65536),
      });
      if (runtime.mode !== "local")
        throw new Error("Native R.A.I.N. runtime is unavailable");
      const common = {
        charter,
        authorization: auth,
        budgets: charter.ceilings,
        model,
        collaboratorModel,
        store: sessionStore,
        runtime: runtime.runtime,
        operator: config.operator,
        question,
        signal: abort.signal,
        control,
        onUpdate: (patch: Partial<DiscoveryView>) => {
          if (childId && patch.research)
            patch = {
              ...patch,
              research: {
                ...patch.research,
                artifacts: patch.research.artifacts.map((a) => ({
                  ...a,
                  path: `descendants/${childId}/${a.path}`,
                })),
              },
            };
          view = { ...view, ...patch };
        },
      };
      job = childId
        ? runDescendant({
            store,
            id: childId,
            model,
            collaboratorModel,
            authorization: auth,
            cwd,
            signal: abort.signal,
            control,
            onUpdate: common.onUpdate,
          })
        : runDiscovery(common);
      void job
        .catch((error) => {
          view.detail = String(error);
          view.stage = "FAILED";
        })
        .finally(() => {
          job = null;
          view.active = false;
          abort = null;
        });
      return status();
    } catch (error) {
      view.active = false;
      abort = null;
      throw error;
    }
  };
  const armScheduler = () => {
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = setInterval(() => {
      if (!charter || !model || view.active || preparing || verifying) return;
      const auth = store
        .authorizations(charter)
        .find((a) => Date.parse(a.expires_at) > Date.now());
      if (!auth) {
        scheduler.control("stopped");
        return;
      }
      void scheduler
        .tick(charter, auth, async () => {
          const policy = scheduler.state()!.policy;
          const expiry = setTimeout(
            () => abort?.abort(new Error("Schedule policy expired")),
            Math.max(1, Date.parse(policy.expires_at) - Date.now()),
          );
          try {
            await start(charter!.research?.goal ?? view.question, true);
            const result = await job;
            if (
              !result ||
              (!result.ok &&
                result.ending !== "Completed bounded session" &&
                !result.ending.startsWith("Paused"))
            )
              throw new Error(result?.ending ?? "Scheduled session failed");
          } finally {
            clearTimeout(expiry);
          }
        })
        .catch((error) => {
          view.detail = String(error);
        });
    }, 1000);
    scheduleTimer.unref();
  };
  return {
    status,
    registerSource: (title: string, text: string) => {
      if (
        view.active ||
        preparing ||
        !title.trim() ||
        title.length > 200 ||
        !text.trim() ||
        text.length > 4000 ||
        UNSAFE_TEXT.test(title + text)
      )
        throw new Error("Approve a bounded, visible source excerpt while idle");
      const digest = sha256Json({ title, text });
      const source: ResearchSource = {
        id: "OS-" + digest.slice(0, 24),
        kind: "operator",
        title,
        locator: "operator-approved supplied excerpt",
        sha256: digest,
        excerpt: text,
        reading_scope:
          "Operator supplied excerpt; no independent authorship or content validation",
        retrieved_at: new Date().toISOString(),
        authors: [],
        year: null,
        doi: null,
      };
      if (
        !store
          .discoveryEntries()
          .some(
            (e) =>
              e.kind === "operator-source" &&
              (e.payload as ResearchSource).id === source.id,
          )
      )
        store.appendDiscovery("operator", "operator-source", source);
      return { ...status(), approved_source: source };
    },
    archive: (id: string) => archiveInstitution(store, id),
    assessInstitution: (assessment: InstitutionAssessment) => {
      if (
        view.active ||
        preparing ||
        !inheritanceCatalog(store).some(
          (r) => r.status === "simulated" && r.id === assessment.run_id,
        )
      )
        throw new Error("Review a completed, admitted simulator finding first");
      store.appendDiscovery("operator", "institution-assessment", {
        ...assessment,
        operator: config.operator,
        evidence_scope: "simulator-only",
      });
      return status();
    },
    prepare,
    prepareResearch: (goal: string, online: boolean) =>
      prepare(researchScope(goal, online)),
    preparePartnership: (goal: string, online: boolean, partnership: Partnership) =>
      prepare({ ...researchScope(goal, online), partnership }),
    approveDescendant: (digest: string, prefix: string, reviewed: boolean) => {
      if (view.active || preparing)
        throw new Error("Stop the session before authorizing a descendant");
      const proposal = store
        .discoveryEntries()
        .filter((e) => e.kind === "world-proposed")
        .map((e) => e.payload as { spec: ResearchWorld; digest: string })
        .find((p) => p.digest === digest);
      if (!proposal) throw new Error("Unknown world proposal");
      const available: ResearchWorld["inheritance"] = store
        .discoveryEntries()
        .filter((e) => e.kind === "research-source")
        .map((e) => {
          const s = e.payload as ResearchSource;
          return { id: s.id, sha256: s.sha256, status: "source-context" };
        });
      // A child's source receipts are kept in its own journal, not copied as unrestricted memory.
      for (const lab of descendantLabs(store))
        available.push(
          ...store
            .descendant(lab.spec.id, lab.spec.budget.storage_bytes)
            .discoveryEntries()
            .filter((e) => e.kind === "research-source")
            .map((e) => {
              const s = e.payload as ResearchSource;
              return { id: s.id, sha256: s.sha256, status: "source-context" as const };
            }),
        );
      available.push(
        ...inheritanceCatalog(store).map((r) => ({
          id: r.id,
          sha256: r.sha256,
          status: r.status,
        })),
      );
      approveWorld(store, proposal.spec, available, {
        operator: config.operator,
        typedPrefix: prefix,
        reviewed,
        now: new Date(),
      });
      return status();
    },
    prepareDescendant: (id: string) => {
      if (view.active || preparing || !model)
        throw new Error("Connect an idle local model first");
      scheduler.control("paused");
      const prepared = descendantCharter(store, id, model);
      collaboratorModel = makeCollaborator(
        prepared.charter.research?.partnership?.collaborator_model,
      );
      charter = prepared.charter;
      childId = id;
      store.saveCharter(charter);
      view = {
        ...view,
        charter,
        charter_sha256: prepared.digest,
        question: charter.research!.goal,
        authorization: "Review the descendant's separate execution charter",
        detail: "Descendant prepared; no execution started",
      };
      return status();
    },
    artifact: (path: string) => {
      const match = /^descendants\/([a-z][a-z0-9-]{0,63})\/(programs\/.*)$/.exec(path);
      if (!match) return store.readResearchArtifact(path);
      const lab = descendantLabs(store).find((l) => l.spec.id === match[1]);
      if (!lab) throw new Error("Unknown descendant artifact namespace");
      return store
        .descendant(lab.spec.id, lab.spec.budget.storage_bytes)
        .readResearchArtifact(match[2]!);
    },
    descendant: (id: string) => {
      const lab = descendantLabs(store).find((l) => l.spec.id === id);
      if (!lab) throw new Error("Unknown descendant");
      const child = store.descendant(id, lab.spec.budget.storage_bytes);
      return {
        schema: "rain-descendant-inspection/v1",
        spec: lab.spec,
        digest: lab.digest,
        status: lab.status,
        history: discoveryHistory(child.discoveryEntries()),
        records: child
          .records()
          .filter((r) => r.digestOK && r.record)
          .map((r) => r.record),
        research:
          child
            .discoveryEntries()
            .filter((e) => e.kind === "research-state")
            .at(-1)?.payload ?? null,
        journal: child
          .discoveryEntries()
          .filter((e) => !["inference-request", "inference-answer"].includes(e.kind)),
      };
    },
    verifyDescendant: async (id: string, run: string, signal: AbortSignal) => {
      if (verifying || view.active || store.lock())
        throw new Error("Inspect replay while the institution is idle");
      const lab = descendantLabs(store).find((l) => l.spec.id === id);
      if (!lab) throw new Error("Unknown descendant");
      const saved = store
        .descendant(id, lab.spec.budget.storage_bytes)
        .records()
        .find((r) => r.record?.run_id === run);
      if (!saved?.digestOK || !saved.record)
        throw new Error("Unknown or quarantined record");
      const steps = verifyRecord(saved.record),
        deadline = Date.now() + 15000;
      let count = 0;
      verifying = true;
      try {
        for (;;) {
          if (signal.aborted || Date.now() > deadline || ++count > 200000)
            throw new Error("Bounded host replay interrupted or exhausted");
          const next = steps.next();
          if (next.done)
            return {
              schema: "rain-host-replay/v1",
              lab: id,
              run_id: run,
              record_sha256: saved.record.record_sha256,
              scope: "simulator-only",
              verification: next.value,
            };
          if (count % 128 === 0)
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } finally {
        verifying = false;
      }
    },
    authorize,
    start,
    intervene: (text: string) => {
      if (
        !charter?.research ||
        !text.trim() ||
        text.length > 1200 ||
        UNSAFE_TEXT.test(text)
      )
        throw new Error("A bounded research comment and current charter are required");
      store.appendDiscovery("operator", "operator-intervention", {
        text,
        operator: config.operator,
        charter_sha256: charterSha256(charter),
        scope: "research-comment-only",
      });
      return status();
    },
    forgetMemory: (id: string) => {
      if (view.active || preparing || !view.research?.memory?.some((m) => m.id === id))
        throw new Error(
          "Inspect an idle, existing memory before removing it from recall",
        );
      const memory = view.research.memory.find((m) => m.id === id)!;
      store.appendDiscovery("operator", "memory-forgotten", {
        id,
        ids: [
          id,
          ...(memory.consolidated_origins ?? []).map(
            (origin) => `${origin}:${memory.layer}`,
          ),
        ],
        operator: config.operator,
      });
      view.research.memory = view.research.memory.filter((m) => m.id !== id);
      return status();
    },
    approveSchedule: (policy: SessionPolicy, prefix: string, reviewed: boolean) => {
      if (!charter || childId || view.active || preparing || !config.enabled)
        throw new Error("Prepare an enabled, idle parent charter first");
      const auth = store
        .authorizations(charter)
        .find((a) => Date.parse(a.expires_at) > Date.now());
      if (!auth) throw new Error("Authorize the charter before scheduling");
      scheduler.approve(policy, charter, auth, prefix, reviewed);
      armScheduler();
      return status();
    },
    scheduleControl: (command: "paused" | "armed" | "cancelled") => {
      if (
        command === "armed" &&
        (!charter ||
          childId ||
          scheduler.state()?.policy.charter_sha256 !== charterSha256(charter))
      )
        throw new Error(
          "Reconnect and review the policy's exact parent charter before resuming",
        );
      scheduler.control(command);
      if (command === "cancelled")
        abort?.abort(new Error("Scheduled research cancelled by operator"));
      if (command === "armed") armScheduler();
      return status();
    },
    pause: () => {
      scheduler.control("paused");
      control.pauseRequested = true;
      view.detail = "Pause requested; finishing the current experiment and its record";
      return status();
    },
    stop: () => {
      abort?.abort(new Error("Emergency stop requested by operator"));
      scheduler.control("stopped");
      view.detail = "Emergency stop requested";
      return status();
    },
    recover: (digest: string) => {
      if (view.active) throw new Error("Stop the active session first");
      store.recoverLock(digest);
      return status();
    },
    completion: () => job,
    dispose: () => {
      if (scheduleTimer) clearInterval(scheduleTimer);
      abort?.abort(new Error("Service disposed"));
    },
  };
}
