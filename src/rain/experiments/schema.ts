/**
 * Versioned experiment contracts, canonical JSON and validation.
 *
 * A port of R.A.I.N.'s `experiments/schema.py` (james_library, MIT). The JSON
 * Schemas under `./schemas/` are the language-neutral interface, vendored
 * verbatim from `james_library/contracts/experiments/`; this module adds the
 * semantic checks a schema cannot express (criteria must reference declared
 * metrics, finite numbers, no credential-like values) and the canonical
 * serialisation every registry file and digest is taken over.
 *
 * Server only (through `provenance.ts`).
 */
import { canonicalJson as compactJson, sha256, sha256Json as sha256Compact } from "../sha256.js";
import { schemaErrors } from "./jsonSchema.js";
import { credentialFormatsIn, redact } from "./provenance.js";
import experimentSchema from "./schemas/experiment.schema.json" with { type: "json" };
import runSchema from "./schemas/run.schema.json" with { type: "json" };
import submissionSchema from "./schemas/submission.schema.json" with { type: "json" };

export const DEFINITION_SCHEMA = "rain-experiment/v1" as const;
export const RUN_SCHEMA = "rain-experiment-run/v1" as const;
export const SUBMISSION_SCHEMA = "rain-experiment-submission/v1" as const;
export const RUN_STATUSES = ["running", "passed", "failed", "inconclusive", "error"] as const;
export const VERDICTS = ["supported", "not_supported", "insufficient_evidence", "not_evaluated"] as const;
export const EVIDENCE_CLASSES = ["measured", "simulated", "model_inferred"] as const;

/** A definition, record or request that the host refuses to accept. */
export class ExperimentError extends Error {}

export type Json = Record<string, unknown>;

/** Stable, human-diffable JSON used for every file the registry writes. */
export function canonicalJson(data: unknown): string {
  return JSON.stringify(JSON.parse(compactJson(data)), null, 2) + "\n";
}
/** SHA-256 over compact, key-sorted JSON (R.A.I.N.'s `sha256_json`). */
export const sha256Json = (data: unknown) => sha256Compact(data);
export const sha256Bytes = (text: string) => sha256(text);

function finiteJsonErrors(value: unknown): string[] {
  const walk = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(walk);
    if (v && typeof v === "object") return Object.values(v as Json).every(walk);
    return v === null || typeof v === "string" || typeof v === "boolean";
  };
  return walk(value) ? [] : ["(root): not finite JSON (a number is NaN or infinite, or a value is not JSON)"];
}

/** Every problem with an experiment definition (empty when valid). */
export function definitionErrors(definition: unknown): string[] {
  const errors = (() => {
    const finite = finiteJsonErrors(definition);
    return finite.length ? finite : schemaErrors(definition, experimentSchema);
  })();
  if (errors.length) return errors;
  const d = definition as {
    metrics: { name: string }[];
    criteria: Record<"guards" | "success" | "failure", { id: string; metric: string; value: number }[]>;
    runner: { kind: string };
    subsystem: { paths: string[] };
  };
  const metrics = d.metrics.map((m) => m.name);
  if (new Set(metrics).size !== metrics.length) errors.push("metrics: duplicate metric names");
  const ids: string[] = [];
  for (const [group, prefix] of [
    ["guards", "G"],
    ["success", "S"],
    ["failure", "F"],
  ] as const)
    for (const criterion of d.criteria[group]) {
      ids.push(criterion.id);
      if (!criterion.id.startsWith(prefix))
        errors.push(`criteria/${group}: id '${criterion.id}' must start with '${prefix}'`);
      if (!metrics.includes(criterion.metric))
        errors.push(`criteria/${group}/${criterion.id}: metric '${criterion.metric}' is not declared`);
      if (!Number.isFinite(criterion.value))
        errors.push(`criteria/${group}/${criterion.id}: threshold must be finite`);
    }
  if (new Set(ids).size !== ids.length) errors.push("criteria: duplicate criterion ids");
  if (compactJson(redact(definition)) !== compactJson(definition) || credentialFormatsIn(JSON.stringify(definition)))
    errors.push(
      "(root): contains a credential-like value; definitions are committed and must not hold secrets (pass credentials through the environment at run time)",
    );
  if (d.runner.kind === "external" && d.subsystem.paths.length)
    errors.push("subsystem/paths: external experiments cannot hash files in this repository");
  return errors;
}

export function validateDefinition<T>(definition: T): T {
  const errors = definitionErrors(definition);
  if (errors.length) throw new ExperimentError("Invalid experiment definition:\n  " + errors.join("\n  "));
  return definition;
}

export function runRecordErrors(record: unknown): string[] {
  const errors = (() => {
    const finite = finiteJsonErrors(record);
    return finite.length ? finite : schemaErrors(record, runSchema);
  })();
  if (errors.length) return errors;
  const r = record as {
    run_id: string;
    experiment_id: string;
    definition: unknown;
    definition_sha256: string;
    status: string;
    error: unknown;
  };
  const owner = r.run_id.slice(0, r.run_id.lastIndexOf("-RUN-"));
  if (owner !== r.experiment_id) errors.push("run_id does not belong to experiment_id");
  if (sha256Json(r.definition) !== r.definition_sha256)
    errors.push("definition snapshot does not match definition_sha256");
  errors.push(...definitionErrors(r.definition).map((e) => `definition: ${e}`));
  if (r.status === "error" && r.error === null) errors.push("status 'error' requires an error object");
  if (r.status !== "error" && r.status !== "running" && r.error !== null)
    errors.push("an error object is only valid with status 'error'");
  return errors;
}

export function submissionErrors(submission: unknown): string[] {
  const finite = finiteJsonErrors(submission);
  return finite.length ? finite : schemaErrors(submission, submissionSchema);
}
