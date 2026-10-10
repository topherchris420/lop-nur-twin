/** Read-only workbench wire view; contains no server dependencies. */
import type { Charter } from "./standing.js";
import type { Critique, Design } from "./discoveryProtocol.js";
export interface DiscoveryResult {
  design_id: string;
  question: string;
  design: Design;
  unit: "m" | "count";
  operational_hypothesis: string;
  hypothesis: string;
  purpose: "exploratory" | "confirmatory";
  parent: string | null;
  evidence_ids: string[];
  run_id: string;
  registry_run_id: string | null;
  verdict: string;
  replay: boolean;
  measurements: Record<string, number | null>;
  per_seed: {
    seed: number;
    control: number | null;
    treatment: number | null;
    delta: number | null;
  }[];
  critique: Critique | null;
  record_path: string;
}
export interface DiscoveryView {
  schema: "rain-discovery-view/v1";
  available: boolean;
  active: boolean;
  stage: string;
  detail: string;
  question: string;
  proposed: Design | null;
  validation: string[];
  authorization: string;
  progress: { arm: string; seed: number; tick: number; totalTicks: number } | null;
  critique: Critique | null;
  history: DiscoveryResult[];
  events: { sequence: number; at: string; kind: string; detail: string }[];
  model: string | null;
  charter: Charter | null;
  charter_sha256: string | null;
  report: string | null;
  lock: { owner: string; pid: number; created_at: string; sha256: string } | null;
}
