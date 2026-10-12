/** A typed host extension seam. Adding a backend does not authorize it in a charter. */
import type { Checked } from "../../bethesda/rain/validation.js";
import type { BackendCapability, ScientificProvenance } from "./contracts.js";
import { BACKEND_CAPABILITIES } from "./contracts.js";
import {
  compileBethesdaExperiment,
  compileNumericalExperiment,
  type BethesdaScientificPlan,
  type NumericalPlan,
} from "./compiler.js";
import { executeNumerical, verifyNumericalRecord } from "./numerical.js";
import { executeBethesda } from "./bethesda.js";
import type { compileDesign } from "../../bethesda/rain/discoveryCompiler.js";
import { verifyRecordSync } from "../../bethesda/rain/replay.js";
import {
  compileCivilizationExperiment,
  executeCivilization,
  verifyCivilizationRecord,
  type CivilizationContext,
} from "./civilization.js";
import type { NoeterraEngine } from "./noeterraEngine.js";
import type {
  CivilizationAuthorization,
  CivilizationPlan,
  CivilizationRecord,
} from "./contracts.js";

export interface ScientificBackend<Plan, Context, Authority, Output> {
  capability: BackendCapability;
  compile(raw: unknown, context: Context): Checked<Plan>;
  execute(plan: Plan, authority: Authority): Output;
  verifyRecord(raw: unknown): { ok: boolean };
}
export const numericalPhysicsBackend: ScientificBackend<
  NumericalPlan,
  Parameters<typeof compileNumericalExperiment>[1],
  Parameters<typeof executeNumerical>[1],
  ReturnType<typeof executeNumerical>
> = {
  capability: BACKEND_CAPABILITIES[1]!,
  compile: compileNumericalExperiment,
  execute: executeNumerical,
  verifyRecord: verifyNumericalRecord,
};
export const bethesdaBackend: ScientificBackend<
  BethesdaScientificPlan,
  { native: Parameters<typeof compileDesign>[1]; provenance: ScientificProvenance },
  Parameters<typeof executeBethesda>[1],
  ReturnType<typeof executeBethesda>
> = {
  capability: BACKEND_CAPABILITIES[0]!,
  compile: (raw, context) =>
    compileBethesdaExperiment(raw, context.native, context.provenance),
  execute: executeBethesda,
  verifyRecord: verifyRecordSync,
};
/** Bound to one engine instance: compile, execute and replay all run on that engine. */
export function civilizationBackend(
  engine: NoeterraEngine,
): ScientificBackend<
  CivilizationPlan,
  Omit<CivilizationContext, "engine">,
  CivilizationAuthorization,
  CivilizationRecord
> {
  return {
    capability: BACKEND_CAPABILITIES[2]!,
    compile: (raw, context) => compileCivilizationExperiment(raw, { ...context, engine }),
    execute: (plan, authority) => executeCivilization(plan, authority, engine),
    verifyRecord: (raw) => verifyCivilizationRecord(raw, engine),
  };
}
