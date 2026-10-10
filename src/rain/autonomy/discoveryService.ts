/** Local operator service. Construction and status never start or resume research. */
import { autonomyConfig } from "./config.js";
import { createLocalModel, type LocalModel } from "./models.js";
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
  let model: LocalModel | null = null;
  let charter: Charter | null = null;
  let abort: AbortController | null = null;
  let job: ReturnType<typeof runDiscovery> | null = null;
  let preparing = false;
  const control = { pauseRequested: false };
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
  const start = async (question = DISCOVERY_QUESTION) => {
    if (view.active || job || preparing) throw new Error("A session is already active");
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
      const runtime = await configureRuntime({
        env: { ...env, RAIN_REGISTRY_DIR: store.registryDir() },
        cwd,
      });
      if (runtime.mode !== "local")
        throw new Error("Native R.A.I.N. runtime is unavailable");
      job = runDiscovery({
        charter,
        authorization: auth,
        budgets: charter.ceilings,
        model,
        store,
        runtime: runtime.runtime,
        operator: config.operator,
        question,
        signal: abort.signal,
        control,
        onUpdate: (patch) => {
          view = { ...view, ...patch };
        },
      });
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
  return {
    status,
    prepare,
    prepareResearch: (goal: string, online: boolean) =>
      prepare(researchScope(goal, online)),
    artifact: (path: string) => store.readResearchArtifact(path),
    authorize,
    start,
    pause: () => {
      control.pauseRequested = true;
      view.detail = "Pause requested; finishing the current experiment and its record";
      return status();
    },
    stop: () => {
      abort?.abort(new Error("Emergency stop requested by operator"));
      view.detail = "Emergency stop requested";
      return status();
    },
    recover: (digest: string) => {
      if (view.active) throw new Error("Stop the active session first");
      store.recoverLock(digest);
      return status();
    },
    completion: () => job,
  };
}
