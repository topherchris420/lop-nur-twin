/** Host-only descendant execution through the unchanged charter, runner and replay gates. */
import type { LocalModel } from "./models.js";
import { runDiscovery } from "./discovery.js";
import type { ResearchStore } from "./store.js";
import { configureRuntime } from "../runtime.js";
import { descendantLabs } from "../research/worlds.js";
import {
  buildDiscoveryCharter,
  charterSha256,
  verifyCharterAuthorization,
  type CharterAuthorization,
} from "../../bethesda/rain/standing.js";
import { researchScope } from "../../bethesda/rain/researchProtocol.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";
import type { DiscoveryView } from "../../bethesda/rain/discoveryView.js";
import { sha256Json } from "../sha256.js";
import { evaluateInstitution } from "../research/institutionEvaluation.js";
import { discoveryHistory } from "./discovery.js";
import { runArtifactSha256 } from "../../bethesda/rain/record.js";

export function descendantCharter(store: ResearchStore, id: string, model: LocalModel) {
  const lab = descendantLabs(store).find((l) => l.spec.id === id);
  if (!lab || lab.status !== "approved" || Date.parse(lab.expires_at) <= Date.now())
    throw new Error("Descendant is not approved, already started, stopped, or expired");
  const w = lab.spec;
  const charter = buildDiscoveryCharter({
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    validHours: 1,
    envelope: w.envelope,
    ceilings: {
      iterations: w.budget.experiments,
      experiments: w.budget.experiments,
      runtime_ms: w.budget.runtime_ms,
      failed_proposals: 2,
      model_calls: w.budget.model_calls,
      model_tokens: null,
    },
    research: { ...researchScope(w.objective, false), partnership: w.agents },
  });
  return { lab, charter, digest: charterSha256(charter) };
}
export async function runDescendant(input: {
  store: ResearchStore;
  id: string;
  model: LocalModel;
  authorization: CharterAuthorization;
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (view: Partial<DiscoveryView>) => void;
  control?: { pauseRequested: boolean };
}) {
  const release = input.store.acquireLock("descendant-" + input.id);
  try {
    const { lab, charter } = descendantCharter(input.store, input.id, input.model);
    const errors = verifyCharterAuthorization(input.authorization, charter);
    if (errors.length) throw new Error(errors.join("; "));
    const remaining = Date.parse(lab.expires_at) - Date.now();
    if (remaining <= 0) throw new Error("Descendant expired");
    const child = input.store.descendant(input.id, lab.spec.budget.storage_bytes);
    const sourceEntries = [...input.store.discoveryEntries()];
    for (const ancestor of descendantLabs(input.store)) {
      if (ancestor.spec.id !== input.id)
        sourceEntries.push(
          ...input.store
            .descendant(ancestor.spec.id, ancestor.spec.budget.storage_bytes)
            .discoveryEntries(),
        );
    }
    const inheritedSources = lab.spec.inheritance.map((ref) => {
      const source = sourceEntries
        .filter((e) => e.kind === "research-source")
        .map((e) => e.payload as ResearchSource)
        .find((s) => s.id === ref.id && s.sha256 === ref.sha256);
      if (!source || ref.status !== "source-context")
        throw new Error(
          "Inherited source unavailable or unsupported evidence classification",
        );
      return structuredClone(source);
    });
    const runtime = await configureRuntime({
      env: { RAIN_REGISTRY_DIR: child.registryDir() },
      cwd: input.cwd,
    });
    if (runtime.mode !== "local") throw new Error("Native runtime unavailable");
    input.store.appendDiscovery(input.id, "world-state", {
      id: input.id,
      status: "running",
    });
    const timer = AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
    const signal = input.signal ? AbortSignal.any([input.signal, timer]) : timer;
    try {
      const result = await runDiscovery({
        inheritedSources,
        store: child,
        model: input.model,
        charter,
        authorization: input.authorization,
        budgets: charter.ceilings,
        runtime: runtime.runtime,
        question: lab.spec.objective,
        operator: input.authorization.operator,
        signal,
        onUpdate: input.onUpdate,
        control: input.control,
      });
      // Rebase child proposals onto this lab; they still require separate operator authorization.
      for (const entry of child
        .discoveryEntries()
        .filter((e) => e.kind === "world-proposed")) {
        const proposal = structuredClone(entry.payload) as {
          spec: typeof lab.spec;
          digest: string;
        };
        proposal.spec.parent = lab.spec.id;
        proposal.spec.generation = lab.spec.generation + 1;
        // Leave a review window: using all remaining lifetime would expire the
        // proposal's parent-lifetime check before an operator could approve it.
        proposal.spec.lifetime_ms = Math.max(
          0,
          Math.floor(
            Math.min(
              proposal.spec.lifetime_ms,
              (Date.parse(lab.expires_at) - Date.now()) / 2,
            ),
          ),
        );
        for (const key of [
          "experiments",
          "model_calls",
          "runtime_ms",
          "storage_bytes",
        ] as const)
          proposal.spec.budget[key] = Math.min(
            proposal.spec.budget[key],
            lab.spec.budget[key],
          );
        proposal.digest = sha256Json(proposal.spec);
        input.store.appendDiscovery(input.id, "world-proposed", proposal);
      }
      input.store.appendDiscovery(input.id, "world-report", {
        id: input.id,
        parent: lab.spec.parent,
        generation: lab.spec.generation,
        world_sha256: lab.digest,
        scope: "simulator-only",
        session: result.session,
        ending: result.ending,
        records: child
          .records()
          .filter((r) => r.digestOK && r.record)
          .map((r) => ({
            path: r.path,
            run_id: r.record!.run_id,
            artifact_sha256: runArtifactSha256(r.record!),
          })),
        history: result.history,
        report: result.report,
        evaluation: evaluateInstitution(
          result.history,
          child.discoveryEntries(),
          discoveryHistory(input.store.discoveryEntries()),
        ),
      });
      input.store.appendDiscovery(input.id, "world-state", {
        id: input.id,
        status: signal.aborted || !result.ok ? "stopped" : "completed",
      });
      return result;
    } catch (error) {
      input.store.appendDiscovery(input.id, "world-state", {
        id: input.id,
        status: "stopped",
      });
      throw error;
    }
  } finally {
    release();
  }
}
