/** Read-only inheritance receipts. Simulator findings never become external observations. */
import type { ResearchStore } from "../autonomy/store.js";
import type {
  ResearchSource,
  ResearchTurn,
} from "../../bethesda/rain/researchProtocol.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import { runArtifactSha256 } from "../../bethesda/rain/record.js";
import { descendantLabs, ROOT_LAB } from "./worlds.js";
import { Registry } from "../experiments/registry.js";
import { runRecordErrors } from "../experiments/schema.js";
export type InheritedFinding =
  | {
      id: string;
      sha256: string;
      status: "simulated";
      origin_lab: string;
      scope: "simulator-only";
      result: DiscoveryResult;
    }
  | {
      id: string;
      sha256: string;
      status: "hypothesis";
      origin_lab: string;
      scope: "unverified-model-interpretation";
      turn: ResearchTurn;
    };
export function inheritanceCatalog(store: ResearchStore) {
  const stores = [
    { id: ROOT_LAB, store },
    ...descendantLabs(store).map((l) => ({
      id: l.spec.id,
      store: store.descendant(l.spec.id, l.spec.budget.storage_bytes),
    })),
  ];
  return stores.flatMap(({ id: origin_lab, store: current }) => {
    const entries = current.discoveryEntries();
    const sources = entries
      .filter((e) => e.kind === "research-source")
      .map((e) => {
        const source = e.payload as ResearchSource;
        return {
          id: source.id,
          sha256: source.sha256,
          status: "source-context" as const,
          origin_lab,
          source,
        };
      });
    const hypotheses = entries
      .filter((e) => e.kind === "research-turn")
      .map((e) => ({
        id: (e.payload as ResearchTurn).decision_id,
        sha256: e.sha256,
        status: "hypothesis" as const,
        origin_lab,
        scope: "unverified-model-interpretation" as const,
        turn: e.payload as ResearchTurn,
      }));
    const records = current.records().filter((r) => r.digestOK && r.record?.run);
    const findings = entries
      .filter((e) => e.kind === "result")
      .flatMap((e) => {
        const result = e.payload as DiscoveryResult;
        const record = records.find((r) => r.record?.run_id === result.run_id)?.record;
        if (!record || !result.replay || !result.registry_run_id) return [];
        try {
          const admitted = new Registry(current.registryDir()).resolveRun(
            result.registry_run_id,
          ).record;
          if (
            runRecordErrors(admitted).length ||
            admitted.status === "running" ||
            admitted.status === "error"
          )
            return [];
          const artifacts = admitted.artifacts as { sha256: string }[];
          if (!artifacts.some((a) => a.sha256 === runArtifactSha256(record))) return [];
        } catch {
          return [];
        }
        return [
          {
            id: result.run_id,
            sha256: runArtifactSha256(record),
            status: "simulated" as const,
            origin_lab,
            scope: "simulator-only" as const,
            result,
          },
        ];
      });
    return [...sources, ...hypotheses, ...findings];
  });
}
