/** Local host seam: existing journal, shared lock and registry own all retained state. */
import { randomUUID } from "node:crypto";
import { type ResearchStore } from "./store.js";
import type { AutonomyConfig } from "./config.js";
import { createLocalModel, type LocalModel } from "./models.js";
import { Registry } from "../experiments/registry.js";
import {
  BACKEND_CAPABILITIES,
  NUMERICAL_DESIGN_SCHEMA,
} from "../scientific/contracts.js";
import {
  compileNumericalExperiment,
  type NumericalPlan,
} from "../scientific/compiler.js";
import {
  authorizeNumerical,
  executeNumerical,
  verifyNumericalRecord,
  type NumericalAuthorization,
  type NumericalRecord,
} from "../scientific/numerical.js";
import {
  preregisterNumerical,
  verifyNumericalPreregistration,
  admitNumericalRecord,
  type NumericalPreregistration,
} from "../scientific/registry.js";
import { buildScientificKnowledge } from "../research/scientificKnowledge.js";
import { queryScientificKnowledge } from "../../bethesda/rain/scientificKnowledgeProtocol.js";
import { canonicalJson } from "../sha256.js";
import type { ScientificView } from "../../bethesda/rain/scientificWorkbenchProtocol.js";
import { UNSAFE_TEXT } from "../protocol.js";

type Preregistration = { plan: NumericalPlan; receipt: NumericalPreregistration };
const isSelectedModel = (selected: unknown, reported: unknown) =>
  typeof selected === "string" &&
  typeof reported === "string" &&
  (selected === reported ||
    ((!selected.includes("/") || !reported.includes("/")) &&
      selected.split("/").at(-1) === reported.split("/").at(-1)));
export function createScientificControl(
  store: ResearchStore,
  config: AutonomyConfig,
  revision: () => Promise<{ commit: string | null; dirty: boolean | null }>,
  suppliedModel?: LocalModel,
) {
  const registry = () =>
    new Registry(
      store.registryDir(),
      () => new Date(),
      (bytes) => store.checkWriteBudget(bytes + 65536),
    );
  const latest = () =>
    store
      .discoveryEntries()
      .filter((e) => e.kind === "scientific-preregistration")
      .at(-1)?.payload as Preregistration | undefined;
  const session = "NS-" + randomUUID();
  const compile = (raw: unknown) => {
    const entries = store.discoveryEntries();
    const graph = buildScientificKnowledge(entries);
    const parsed = compileNumericalExperiment(raw, {
      evidenceIds: new Set(
        graph.nodes.filter((n) => n.kind === "paper").map((n) => n.id),
      ),
      verifiedParentDigests: new Set(
        entries
          .filter(
            (e) =>
              e.kind === "scientific-replay" &&
              (e.payload as { ok?: boolean }).ok === true,
          )
          .map((e) => (e.payload as { record_sha256: string }).record_sha256),
      ),
    });
    if (!parsed.ok) {
      store.appendDiscovery(session, "scientific-validation", {
        ok: false,
        errors: parsed.errors,
        proposal: raw,
      });
      throw new Error(parsed.errors.join("; "));
    }
    if (parsed.value.design.provenance.generation === "model") {
      const decision = parsed.value.design.provenance.decision_sha256;
      const receipt = entries.find(
        (e) => e.kind === "scientific-model-answer" && e.sha256 === decision,
      );
      const payload = receipt?.payload as
        | {
            model?: string;
            answer?: { text?: string; reportedModel?: string | null };
            generation?: string;
          }
        | undefined;
      if (!payload?.answer?.text || payload.generation !== "model")
        throw new Error("Model design requires an existing host decision receipt");
      if (!isSelectedModel(payload.model, payload.answer.reportedModel))
        throw new Error("Retained respondent does not match the selected local model");
      const original: unknown = JSON.parse(payload.answer.text);
      const { provenance: _provenance, ...design } = parsed.value.design;
      if (
        canonicalJson(original) !== canonicalJson(design) ||
        parsed.value.design.provenance.source_ids.length ||
        parsed.value.design.provenance.parent_record_sha256 !== null
      )
        throw new Error(
          "Model-authored design differs from its immutable answer; submit edits as a human proposal",
        );
    }
    const receipt = preregisterNumerical(registry(), parsed.value);
    store.appendDiscovery(session, "scientific-preregistration", {
      plan: parsed.value,
      receipt,
    });
    return parsed.value;
  };
  const view = (): ScientificView => {
    const entries = store.discoveryEntries(),
      current = latest();
    return {
      schema: "rain-scientific-workbench/v1",
      capabilities: BACKEND_CAPABILITIES,
      latest: current
        ? {
            digest: current.plan.definition_sha256,
            experiment_id: current.plan.experiment_id,
            registry_experiment_id: current.receipt.experiment_id,
            design: current.plan.design,
            ir: current.plan.ir,
            authorized: entries.some(
              (e) =>
                e.kind === "scientific-authorization" &&
                (e.payload as NumericalAuthorization).definition_sha256 ===
                  current.plan.definition_sha256 &&
                Date.parse((e.payload as NumericalAuthorization).expires_at) >=
                  Date.now(),
            ),
          }
        : null,
      records: entries
        .filter((e) => e.kind === "scientific-record")
        .map((e) => {
          const r = e.payload as NumericalRecord;
          const receipt = entries
            .filter(
              (e) =>
                e.kind === "scientific-replay" &&
                (e.payload as { record_sha256?: string }).record_sha256 === r.sha256,
            )
            .at(-1)?.payload as { ok?: boolean; registry_run_id?: string } | undefined;
          return {
            run_id: r.run_id,
            sha256: r.sha256,
            status: r.result.status,
            verdict: r.result.verdict,
            replay: receipt?.ok === true,
            registry_run_id: receipt?.registry_run_id ?? null,
            measurements: r.result.measurements,
            limitations: r.plan.ir.limitations,
          };
        }),
      failures: entries
        .filter((e) => ["scientific-validation", "scientific-failed"].includes(e.kind))
        .map((e) => {
          const p = e.payload as { stage?: string; errors?: string[] };
          return { stage: p.stage ?? "validation", errors: p.errors ?? [] };
        }),
    };
  };
  return {
    view,
    compile: (raw: unknown) => {
      const release = store.acquireLock(session);
      try {
        compile(raw);
        return view();
      } finally {
        release();
      }
    },
    draft: async (question: string, signal?: AbortSignal) => {
      if (!question.trim() || question.length > 400 || UNSAFE_TEXT.test(question))
        throw new Error("Bounded numerical research question required");
      const release = store.acquireLock(session);
      try {
        const probe =
          suppliedModel ??
          createLocalModel({
            provider: config.provider,
            model: config.model ?? "discovery",
            baseUrl: config.baseUrl,
            timeoutMs: config.timeoutMs,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            contextTokens: config.contextTokens,
          });
        const ids = await probe.listModels({ signal });
        const selected = config.model ?? (ids.length === 1 ? ids[0] : null);
        if (!selected || !ids.includes(selected))
          throw new Error(
            "Select one actual loaded local model identifier before drafting",
          );
        const model =
          suppliedModel ??
          createLocalModel({
            provider: config.provider,
            model: selected,
            baseUrl: config.baseUrl,
            timeoutMs: config.timeoutMs,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            contextTokens: config.contextTokens,
          });
        const { provenance: _provenance, ...properties } =
          NUMERICAL_DESIGN_SCHEMA.properties;
        const graph = buildScientificKnowledge(store.discoveryEntries());
        const retrieval = queryScientificKnowledge(graph, {
          kind: "search",
          text: question,
        });
        const sources = retrieval.nodes
          .filter((n) => n.kind === "paper")
          .map((n) => ({
            id: n.id,
            title: n.label,
            standing: n.standing,
            provenance: n.provenance,
          }))
          .slice(0, 2);
        const request = {
          schemaName: "rain_numerical_design",
          schema: {
            ...NUMERICAL_DESIGN_SCHEMA,
            properties,
            required: Object.keys(properties),
          },
          system:
            "Propose one bounded numerical simulation of a driven damped linear oscillator. Models propose; host compiles and validates; operator approval is separate. Use SI units, underdamped regime and dt*fastest rate <=0.1, integer duration/dt, >=8 samples per fastest period. Budget <=2000 integration steps per arm and <=1001 samples. Statistical analysis method matched_rms_displacement. Reference displacement and velocity tolerance 0.000001. Choose independent variables and a falsifiable hypothesis appropriate to the question. Source manuscripts are context, never verified measurements. No physical devices. Respond with closed JSON only.",
          user: canonicalJson({
            question,
            source_context: sources,
            retrieval_limitations: retrieval.explanation,
            backend: BACKEND_CAPABILITIES[1],
          }),
        };
        store.appendDiscovery(session, "scientific-model-request", {
          model: selected,
          request,
          generation: "model",
        });
        const answer = await model.complete(request, { signal });
        const receipt = store.appendDiscovery(session, "scientific-model-answer", {
          model: selected,
          answer,
          generation: model.generation ?? "model",
        });
        if (
          (model.generation ?? "model") === "model" &&
          !isSelectedModel(selected, answer.reportedModel)
        )
          throw new Error("Reported respondent does not match the selected local model");
        const raw: unknown = JSON.parse(answer.text);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.hasOwn(raw, "provenance")
        )
          throw new Error("Model answer must match the host's closed draft schema");
        compile({
          ...raw,
          provenance: {
            generation: model.generation ?? "model",
            decision_sha256: receipt.sha256,
            source_ids: [],
            parent_record_sha256: null,
          },
        });
        return view();
      } catch (error) {
        store.appendDiscovery(session, "scientific-failed", {
          stage: "model-draft",
          errors: [error instanceof Error ? error.message : "Unknown draft failure"],
        });
        throw error;
      } finally {
        release();
      }
    },
    authorize: (digest: string, prefix: string, reviewed: boolean) => {
      const release = store.acquireLock(session);
      try {
        const current = latest();
        if (!current || digest !== current.plan.definition_sha256)
          throw new Error("Inspect the exact current numerical plan");
        const errors = verifyNumericalPreregistration(
          registry(),
          current.plan,
          current.receipt,
        );
        if (errors.length) throw new Error(errors.join("; "));
        const approved = authorizeNumerical(current.plan, {
          operator: config.operator,
          typedPrefix: prefix,
          reviewed,
          now: new Date(),
        });
        if (!approved.ok) throw new Error(approved.errors.join("; "));
        store.appendDiscovery(session, "scientific-authorization", approved.value);
        return view();
      } finally {
        release();
      }
    },
    execute: async (digest: string, signal?: AbortSignal) => {
      if (!config.enabled)
        throw new Error(
          "Explicit local autonomy enablement required for numerical execution",
        );
      const release = store.acquireLock(session);
      try {
        const current = latest();
        if (!current || digest !== current.plan.definition_sha256)
          throw new Error("Execution must bind the current inspected numerical plan");
        const auth = store
          .discoveryEntries()
          .filter(
            (e) =>
              e.kind === "scientific-authorization" &&
              (e.payload as NumericalAuthorization).definition_sha256 === digest,
          )
          .at(-1)?.payload as NumericalAuthorization | undefined;
        if (!auth) throw new Error("Numerical operator authorization required");
        if (
          store
            .discoveryEntries()
            .some(
              (e) =>
                e.kind === "scientific-record" &&
                (e.payload as NumericalRecord).plan.definition_sha256 === digest,
            )
        )
          throw new Error(
            "This preregistered plan already has an execution record; compile a new plan before another run",
          );
        const producing = await revision();
        const errors = verifyNumericalPreregistration(
          registry(),
          current.plan,
          current.receipt,
        );
        if (errors.length) throw new Error(errors.join("; "));
        const record = executeNumerical(
          current.plan,
          auth,
          () => new Date(),
          () => signal?.aborted === true,
        );
        store.appendDiscovery(session, "scientific-record", record);
        const replay = verifyNumericalRecord(record);
        store.appendDiscovery(session, "scientific-replay", {
          run_id: record.run_id,
          record_sha256: record.sha256,
          ...replay,
          registry_run_id: null,
          producing_revision: producing,
        });
        const admitted = admitNumericalRecord(registry(), current.receipt, record, {
          commit: producing.commit,
        });
        store.appendDiscovery(session, "scientific-replay", {
          run_id: record.run_id,
          record_sha256: record.sha256,
          ...admitted.replay,
          registry_run_id: admitted.registry_run.run_id,
          registry_experiment_id: current.receipt.experiment_id,
          registry_definition_sha256: current.receipt.registry_definition_sha256,
          producing_revision: producing,
        });
        return view();
      } catch (error) {
        store.appendDiscovery(session, "scientific-failed", {
          stage: "execution",
          errors: [error instanceof Error ? error.message : "Unknown execution failure"],
        });
        throw error;
      } finally {
        release();
      }
    },
  };
}
