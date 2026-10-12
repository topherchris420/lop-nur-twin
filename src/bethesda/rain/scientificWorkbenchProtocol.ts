import type {
  BackendCapability,
  NumericalDesign,
  ScientificExperimentIR,
} from "./scientificProtocol.js";
/** Read-only local workbench projection, distinct from authoritative records. */
export interface ScientificView {
  schema: "rain-scientific-workbench/v1";
  capabilities: readonly BackendCapability[];
  latest: null | {
    digest: string;
    experiment_id: string;
    registry_experiment_id: string;
    design: NumericalDesign;
    ir: ScientificExperimentIR;
    authorized: boolean;
  };
  records: {
    run_id: string;
    sha256: string;
    status: string;
    verdict: string;
    replay: boolean;
    registry_run_id: string | null;
    measurements: Record<string, number | null>;
    limitations: string[];
  }[];
  failures: { stage: string; errors: string[] }[];
}
