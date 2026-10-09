/**
 * Re-derive every recorded conclusion from the stored data.
 *
 * A port of R.A.I.N.'s `experiments/verify.py` (james_library, MIT). `verify`
 * never trusts a stored status: it re-validates each record against its
 * schema, recomputes statistics from the stored series, re-applies the
 * embedded pre-registered criteria to the stored measurements, recomputes
 * reproduction claims and scans for credential patterns. SHA-256 detects
 * inconsistency; it is not a signature, so a writer able to rewrite both data
 * and records can still forge them. Git history is the tamper-evidence layer.
 *
 * Server only.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { evaluate, type Criterion } from "./evaluate.js";
import { credentialFormatsIn } from "./provenance.js";
import { parseJsonText, readBoundedFile, type Registry, readJson, type Json } from "./registry.js";
import { reproductionReport } from "./runner.js";
import { type ExperimentError, definitionErrors, runRecordErrors, sha256Bytes, sha256Json } from "./schema.js";
import { summarize } from "./stats.js";

export interface VerifyReport {
  valid: boolean;
  problems: string[];
  warnings: string[];
  experiments: number;
  runs: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // Defined, not assigned, so a "__proto__" key is compared as data.
    for (const key of Object.keys(value).sort())
      Object.defineProperty(out, key, { value: sortKeys((value as Json)[key]), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return value;
}
const without = (value: Json, key: string): Json => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

export function verifyRun(registry: Registry, experimentId: string, definition: Json, runDir: string): [string[], string[]] {
  const problems: string[] = [];
  const warnings: string[] = [];
  const dirName = basename(runDir);
  const label = `${experimentId}/${dirName}`;
  const path = join(runDir, "result.json");
  // Read once, through one descriptor: the bytes scanned are the bytes parsed.
  let raw: string;
  try {
    raw = readBoundedFile(path, 16 * 1024 * 1024);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return [[`${label}: missing result.json`], warnings];
    return [[`${label}: ${(error as Error).message}`], warnings];
  }
  if (credentialFormatsIn(raw)) problems.push(`${label}: credential-like pattern present in record`);
  let record: Json;
  try {
    record = parseJsonText(raw, "result.json") as Json;
  } catch (error) {
    return [[...problems, `${label}: ${(error as Error).message}`], warnings];
  }
  const errors = runRecordErrors(record);
  if (errors.length) return [[...problems, ...errors.map((e) => `${label}: ${e}`)], warnings];
  if (record.run_id !== `${experimentId}-${dirName}`)
    problems.push(`${label}: run_id ${record.run_id} does not match its directory`);
  if (record.status === "running") {
    warnings.push(`${label}: still marked running (interrupted or in progress); not evaluated`);
    return [problems, warnings];
  }
  const snapshot = record.definition as Json;
  if (snapshot.experiment_version === definition.experiment_version && record.definition_sha256 !== sha256Json(definition))
    problems.push(`${label}: experiment.json was edited after this run without bumping experiment_version`);
  else if ((snapshot.experiment_version as number) > (definition.experiment_version as number))
    problems.push(`${label}: run references a newer definition version than experiment.json`);

  const series = record.series as Record<string, number[]>;
  for (const [name, values] of Object.entries(series))
    if (!same((record.statistics as Json)[name], summarize(values)))
      problems.push(`${label}: statistics for '${name}' do not match the stored series`);

  if (record.status === "error") {
    if (record.hypothesis_verdict !== "not_evaluated" || record.evaluation !== null)
      problems.push(`${label}: an error run must not carry a hypothesis evaluation`);
  } else {
    const result = evaluate(
      snapshot.criteria as { guards: Criterion[]; success: Criterion[]; failure: Criterion[] },
      record.measurements as Record<string, number | null>,
    );
    if (result.status !== record.status || result.verdict !== record.hypothesis_verdict)
      problems.push(
        `${label}: recorded ${record.status}/${record.hypothesis_verdict} but the stored measurements evaluate to ${result.status}/${result.verdict}`,
      );
    else if (
      // Compare the structured evaluation; the summary sentence is presentation and may be reworded.
      !same(without(result.evaluation as unknown as Json, "summary"), without(record.evaluation as Json, "summary"))
    )
      problems.push(`${label}: stored evaluation detail differs from recomputation`);
  }
  problems.push(...verifyReproduction(registry, experimentId, label, record));

  const artifactDir = join(runDir, "artifacts");
  const storedNames = new Set<string>();
  for (const artifact of record.artifacts as Json[]) {
    if (!artifact.stored) continue;
    storedNames.add(artifact.name as string);
    const target = join(artifactDir, artifact.name as string);
    // One descriptor: a symlink is refused at open, and the bytes hashed are the file measured.
    let stored: string | null = null;
    try {
      stored = readBoundedFile(registry.safePath(target), 64 * 1024 * 1024);
    } catch {
      stored = null;
    }
    if (stored === null) problems.push(`${label}: stored artifact ${artifact.name} is missing`);
    else if (sha256Bytes(stored) !== artifact.sha256 || Buffer.byteLength(stored, "utf8") !== artifact.bytes)
      problems.push(`${label}: artifact ${artifact.name} does not match its recorded SHA-256`);
  }
  if (existsSync(artifactDir))
    for (const extra of readdirSync(artifactDir).filter((name) => !storedNames.has(name)).sort())
      problems.push(`${label}: untracked file in artifacts/: ${extra}`);
  return [problems, warnings];
}

/** Recompute the reproduction claim from the source run; never trust the stored comparison. */
function verifyReproduction(registry: Registry, experimentId: string, label: string, record: Json): string[] {
  const kind = record.kind,
    sourceId = record.reproduces as string | null,
    stored = record.reproduction as Json | null;
  if (kind !== "reproduce") {
    if (sourceId !== null || stored !== null) return [`${label}: only a reproduce run may carry reproduction data`];
    return [];
  }
  if (sourceId === null) return [`${label}: reproduce run does not name its source run`];
  if (record.status === "error")
    return stored === null ? [] : [`${label}: an error run must not carry a reproduction claim`];
  if (stored === null || stored.source_run !== sourceId)
    return [`${label}: reproduction claim is missing or names a different source run`];
  let source: Json;
  try {
    source = registry.resolveRun(sourceId).record;
  } catch (error) {
    return [`${label}: reproduction source unavailable: ${(error as Error).message}`];
  }
  const ordinal = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));
  if (source.experiment_id !== experimentId || ordinal(sourceId) >= ordinal(record.run_id as string))
    return [`${label}: reproduction source must be an earlier run of the same experiment`];
  if (!["passed", "failed", "inconclusive"].includes(source.status as string))
    return [`${label}: reproduction source ${sourceId} has no completed result`];
  if (!same(reproductionReport(record.definition as Json, source, record), stored))
    return [`${label}: stored reproduction claim differs from recomputation against ${sourceId}`];
  return [];
}

export function verify(registry: Registry, experimentIds: string[] | null = null): VerifyReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  let checkedRuns = 0;
  let ledgerIds = new Set<string>();
  try {
    ledgerIds = new Set(registry.ledger().allocated.map((entry) => entry.id));
  } catch (error) {
    problems.push((error as Error).message);
  }
  const directories = registry.experimentIds();
  if (experimentIds === null)
    for (const missing of [...ledgerIds].filter((id) => !directories.includes(id)).sort())
      warnings.push(`${missing}: allocated in registry.json but has no directory (ID stays retired)`);
  for (const experimentId of experimentIds ?? directories) {
    if (!ledgerIds.has(experimentId)) problems.push(`${experimentId}: directory exists but the ID is not in registry.json`);
    const definitionPath = join(registry.experimentDir(experimentId), "experiment.json");
    if (!existsSync(definitionPath)) {
      problems.push(`${experimentId}: missing experiment.json`);
      continue;
    }
    let definition: Json;
    try {
      definition = readJson(definitionPath) as Json;
    } catch (error) {
      problems.push(`${experimentId}: ${(error as ExperimentError).message}`);
      continue;
    }
    const errors = definitionErrors(definition);
    if (errors.length) {
      problems.push(...errors.map((e) => `${experimentId}/experiment.json: ${e}`));
      continue;
    }
    if (definition.experiment_id !== experimentId) {
      problems.push(`${experimentId}: experiment.json declares ${definition.experiment_id}`);
      continue;
    }
    for (const runDir of registry.runDirs(experimentId)) {
      const [runProblems, runWarnings] = verifyRun(registry, experimentId, definition, runDir);
      problems.push(...runProblems);
      warnings.push(...runWarnings);
      checkedRuns += 1;
    }
  }
  return {
    valid: problems.length === 0,
    problems,
    warnings,
    experiments: (experimentIds ?? directories).length,
    runs: checkedRuns,
  };
}
