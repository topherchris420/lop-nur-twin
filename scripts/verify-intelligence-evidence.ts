/**
 * Read-only archive verification and separately reviewed deterministic replay.
 * Replay is a consistency check of exposed seeds, never a new confirmation.
 *
 * --archive DIR                         Verify without Python or upstream clones.
 * --archive DIR --draft-replay          Print exact replay digest/cost; run no probes.
 * --archive DIR --replay-reviewed SHA --python EXE --qnp CLONE --drr CLONE
 *                                      Replay only already-completed panels.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ResearchStore, type DiscoveryEntry } from "../src/rain/autonomy/store.js";
import { Registry } from "../src/rain/experiments/registry.js";
import { verify } from "../src/rain/experiments/verify.js";
import { canonicalJson, sha256Bytes, sha256Json } from "../src/rain/sha256.js";
import {
  campaignSeeds,
  validateIntelligencePlan,
  validateProbe,
  type CpuDesign,
  type IntelligencePlan,
  type ProbeResult,
} from "../src/rain/research/intelligence.js";
import { cpuCampaignReport } from "../src/rain/research/intelligenceCampaign.js";
import { createCpuExecutor } from "../server/rain/cpuWorker.js";

interface Registration {
  schema: string;
  plan: IntelligencePlan;
  binding: Record<string, unknown>;
  definitions: Record<string, { id: string; sha256: string }>;
}
interface CompletedPanel {
  entry: DiscoveryEntry;
  registration: Registration;
  design: CpuDesign;
  key: string;
  phase: "screen" | "confirmation";
  seeds: number[];
  units: number;
  probe: ProbeResult;
}
interface StudyCount {
  case: string;
  units: number;
  falsified_claims: number;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function same(a: unknown, b: unknown): boolean {
  return sha256Json(a) === sha256Json(b);
}
function requireSame(a: unknown, b: unknown, label: string): void {
  if (!same(a, b)) throw new Error(`${label} differs from independently derived data`);
}
function sourceSnapshot(root: string) {
  let bytes = 0;
  const files: Array<{ path: string; sha256: string }> = [];
  function visit(path: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Archive symlinks are refused");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw new Error("Archive contains a non-file or oversized record");
    bytes += stat.size;
    if (bytes > 256 * 1024 * 1024 || files.length >= 10000)
      throw new Error("Archive verification bound exceeded");
    files.push({
      path: relative(root, path).replaceAll("\\", "/"),
      sha256: sha256Bytes(new Uint8Array(readFileSync(path))),
    });
  }
  visit(root);
  return { sha256: sha256Json(files), files: files.length, bytes };
}

function registrations(entries: DiscoveryEntry[]) {
  const selected = entries.filter((entry) => entry.kind === "cpu-registered");
  if (!selected.length) throw new Error("Archive has no registered CPU campaigns");
  const result = new Map<string, Registration>();
  for (const entry of selected) {
    if (result.has(entry.session)) throw new Error("Duplicate CPU registration");
    const value = object(entry.payload, "CPU registration");
    if (value.schema !== "rain-cpu-registration/v1")
      throw new Error("Unsupported CPU registration schema");
    result.set(entry.session, {
      schema: value.schema,
      plan: validateIntelligencePlan(value.plan),
      binding: object(value.binding, "source binding"),
      definitions: object(
        value.definitions,
        "definition references",
      ) as Registration["definitions"],
    });
  }
  return result;
}

function completedPanels(
  entries: DiscoveryEntry[],
  registered: Map<string, Registration>,
  registry: Registry,
): CompletedPanel[] {
  return entries
    .filter((entry) => entry.kind === "cpu-result")
    .map((entry) => {
      const registration = registered.get(entry.session);
      if (!registration) throw new Error("Result has no frozen registration");
      const result = object(entry.payload, "completed result");
      const design = registration.plan.designs.find(
        (item) => item.id === result.design_id,
      );
      if (!design || (result.phase !== "screen" && result.phase !== "confirmation"))
        throw new Error("Result names an unknown design or phase");
      const key = `${design.id}:${result.phase}`;
      if (result.key !== key) throw new Error("Result panel key mismatch");
      const reference = registration.definitions[key];
      if (!reference) throw new Error("Result lacks a frozen registry definition");
      const definition = registry.loadDefinition(reference.id);
      requireSame(sha256Json(definition), reference.sha256, "Definition digest");
      const parameters = object(definition.parameters, "definition parameters");
      const seeds = parameters.seeds;
      if (!Array.isArray(seeds) || !seeds.every((seed) => Number.isSafeInteger(seed)))
        throw new Error("Frozen definition seeds are invalid");
      const actualSeeds = seeds as number[];
      requireSame(
        actualSeeds,
        campaignSeeds(registration.plan, design, result.phase),
        "Frozen seeds",
      );
      requireSame(parameters.adapter, design.adapter, "Frozen adapter");
      requireSame(parameters.parameters, design.parameters, "Frozen parameters");
      requireSame(parameters.design_id, design.id, "Frozen design");
      requireSame(parameters.phase, result.phase, "Frozen phase");
      const reservations = entries.filter(
        (item) =>
          item.session === entry.session &&
          item.kind === "cpu-reserved" &&
          object(item.payload, "work reservation").key === key,
      );
      if (reservations.length !== 1)
        throw new Error("Completed panel needs exactly one reservation");
      const reserved = object(reservations[0]!.payload, "work reservation");
      const units = design.cost_units * actualSeeds.length;
      requireSame(reserved.units, units, "Completed work cost");
      requireSame(reserved.seeds_sha256, sha256Json(actualSeeds), "Reservation seeds");
      return {
        entry,
        registration,
        design,
        key,
        phase: result.phase,
        seeds: [...actualSeeds],
        units,
        probe: validateProbe(result.probe, actualSeeds.length),
      };
    });
}

function verifyStudy(
  entries: DiscoveryEntry[],
  registered: Map<string, Registration>,
  reports: Map<string, ReturnType<typeof cpuCampaignReport>>,
  bindingSha256: string,
) {
  const starts = entries.filter((entry) => entry.kind === "cpu-study-registered");
  const ends = entries.filter((entry) => entry.kind === "cpu-study-result");
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1)
    throw new Error(
      "Controlled study requires exactly one registration and final result",
    );
  const start = object(starts[0]!.payload, "study registration");
  const study = object(start.study, "study");
  const end = object(ends[0]!.payload, "study result");
  if (
    study.schema !== "rain-intelligence-study/v1" ||
    end.schema !== "rain-intelligence-study-result/v1"
  )
    throw new Error("Unsupported controlled study schema");
  requireSame(start.binding_sha256, bindingSha256, "Study source binding");
  const binding = registered.values().next().value?.binding;
  requireSame(start.digest, sha256Json({ study, binding }), "Study approval digest");
  requireSame(end.registration_sha256, start.digest, "Study result registration");
  if (!Array.isArray(study.cases) || !Array.isArray(end.results))
    throw new Error("Invalid controlled study cases");
  const retainedResults: unknown[] = end.results;
  if (retainedResults.length !== study.cases.length)
    throw new Error("Retained study case count differs from registration");
  const used = new Set<string>();
  const counts: StudyCount[] = study.cases.map((raw) => {
    const item = object(raw, "study case");
    if (typeof item.name !== "string") throw new Error("Invalid study case name");
    const matching = [...registered].filter(([, value]) => same(value.plan, item.plan));
    if (matching.length !== 1)
      throw new Error("Study plan must identify one registered campaign");
    const [id] = matching[0]!;
    if (used.has(id)) throw new Error("Study duplicates a registered campaign");
    used.add(id);
    const report = reports.get(id)!;
    const embedded = retainedResults.find(
      (rawResult: unknown) => object(rawResult, "study result case").case === item.name,
    );
    if (!embedded) throw new Error("Missing retained study result case");
    const storedReport = object(
      object(embedded, "study result case").report,
      "retained campaign report",
    );
    if (!Array.isArray(storedReport.events))
      throw new Error("Retained campaign event list is missing");
    requireSame(
      storedReport.events,
      report.events.slice(0, storedReport.events.length),
      "Retained report event prefix",
    );
    if (
      report.events
        .slice(storedReport.events.length)
        .some((event) => event.kind !== "cpu-exported")
    )
      throw new Error("Retained report has later non-export campaign events");
    const scienceFields = (value: object) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "events"));
    requireSame(
      scienceFields(storedReport),
      scienceFields(report),
      "Retained study scientific report",
    );
    return {
      case: item.name,
      units: report.budget.completed_units,
      falsified_claims: report.designs.filter(
        (design) =>
          design.screen?.verdict === "falsified" &&
          design.confirmation?.verdict === "falsified",
      ).length,
    };
  });
  requireSame(end.counts, counts, "Study primary counts");
  const fifo = counts.find((item) => item.case === "fifo");
  const information = counts.find((item) => item.case === "information");
  if (!fifo || !information || fifo.units !== information.units)
    throw new Error(
      "Primary comparison needs FIFO and information at equal actual work cost",
    );
  const primaryPassed = information.falsified_claims > fifo.falsified_claims;
  requireSame(end.primary_passed, primaryPassed, "Study primary outcome");
  return { registration_sha256: start.digest, counts, primary_passed: primaryPassed };
}

function deterministicProbe(probe: ProbeResult) {
  return { samples: probe.samples, checks: probe.checks, details: probe.details };
}
function stableProvenance(probe: ProbeResult) {
  return Object.fromEntries(
    Object.entries(probe.provenance).filter(
      ([key]) => !["commit", "dirty"].includes(key),
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  // run-ts.mjs imports its target without rewriting argv; direct Node/Bun
  // execution already has the target in argv[1]. Accept exactly our own entry.
  if (args[0] && !args[0].startsWith("--")) {
    if (resolve(args[0]) !== fileURLToPath(import.meta.url))
      throw new Error("Unexpected verifier positional argument");
    args.shift();
  }
  const flags = new Set([
    "--archive",
    "--draft-replay",
    "--replay-reviewed",
    "--python",
    "--qnp",
    "--drr",
  ]);
  const options = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flags.has(flag) || options.has(flag))
      throw new Error("Unknown or repeated verifier option");
    if (flag === "--draft-replay") options.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      options.set(flag, value);
    }
  }
  const archive = options.get("--archive");
  if (typeof archive !== "string") throw new Error("Provide --archive PATH");
  if (options.has("--draft-replay") && options.has("--replay-reviewed"))
    throw new Error("Draft and reviewed replay are separate modes");
  if (
    !options.has("--replay-reviewed") &&
    ["--python", "--qnp", "--drr"].some((flag) => options.has(flag))
  )
    throw new Error("Execution paths are accepted only for reviewed replay");
  if (lstatSync(archive).isSymbolicLink())
    throw new Error("Archive root symlinks are refused");
  const root = realpathSync(archive);
  const before = sourceSnapshot(root);
  const store = new ResearchStore(root);
  const entries = store.discoveryEntries();
  const registry = new Registry(store.registryDir());
  const registryReport = verify(registry);
  if (!registryReport.valid)
    throw new Error(
      "Existing registry verification failed: " + registryReport.problems.join("; "),
    );
  const registered = registrations(entries);
  const reports = new Map(
    [...registered.keys()].map((id) => [id, cpuCampaignReport(store, id)]),
  );
  const bindings = [...registered.values()].map((registration) =>
    sha256Json(registration.binding),
  );
  const bindingSha256 = bindings[0]!;
  if (!bindings.every((binding) => binding === bindingSha256))
    throw new Error("Archive campaigns do not share one replay source binding");
  const panels = completedPanels(entries, registered, registry);
  const workUnits = panels.reduce((sum, panel) => sum + panel.units, 0);
  const envelope = {
    schema: "rain-cpu-replay/v1",
    source_binding_sha256: bindingSha256,
    result_entries: panels.map((panel) => panel.entry.sha256),
    work_units: workUnits,
  };
  const digest = sha256Json(envelope);
  const study = verifyStudy(entries, registered, reports, bindingSha256);
  const receipt = {
    schema: "rain-cpu-verification-receipt/v1",
    mode: options.has("--draft-replay")
      ? "replay-draft"
      : options.has("--replay-reviewed")
        ? "replay"
        : "archive-only",
    verifier_sha256: sha256Bytes(new Uint8Array(readFileSync(new URL(import.meta.url)))),
    archive: {
      ...before,
      journal_entries: entries.length,
      journal_tail_sha256: entries.at(-1)?.sha256 ?? null,
    },
    registry: registryReport,
    study,
    campaigns: [...reports].map(([id, report]) => ({
      id,
      policy: report.policy,
      status: report.status,
      completed_units: report.budget.completed_units,
      designs: report.designs.map((design) => ({
        id: design.id,
        minimum_rate: design.minimum_rate,
        screen: design.screen,
        confirmation: design.confirmation,
      })),
    })),
    replay: {
      ...envelope,
      approval_sha256: digest,
      completed_panels: panels.length,
      attempted_panels: 0,
      replayed_panels: 0,
      replay_work_units: 0,
      valid: true,
      failure: null as string | null,
      matches: [] as Array<Record<string, unknown>>,
    },
    archive_unchanged: false,
    creates_scientific_evidence: false,
    new_confirmation_samples: 0,
    limitations: [
      "Archive verification re-derives conclusions from retained records; hashes detect inconsistency, not forgery by a writer replacing the whole archive.",
      "Replay reuses exposed frozen seeds and the same implementation. It checks deterministic consistency and supplies no new independent confirmation.",
      "Replay work is additional local CPU cost, separate from the original experiment budget. No original result, journal, or registry record is rewritten.",
    ],
  };
  if (options.has("--replay-reviewed")) {
    if (!panels.length) throw new Error("Archive has no completed panels to replay");
    if (options.get("--replay-reviewed") !== digest)
      throw new Error("Exact replay source/result/work digest is required");
    const paths = ["--python", "--qnp", "--drr"].map((flag) => options.get(flag));
    if (!paths.every((path) => typeof path === "string"))
      throw new Error(
        "Reviewed replay requires explicit --python, --qnp and --drr paths",
      );
    const executor = createCpuExecutor({
      repositoryRoot: process.cwd(),
      python: paths[0] as string,
      repositories: {
        "quantum-noise-profiler": paths[1] as string,
        "dynamic-resonance-rooting": paths[2] as string,
      },
    });
    for (const panel of panels) {
      requireSame(
        executor.binding,
        panel.registration.binding,
        "Replay execution binding",
      );
      // Charge the completed panel's declared cost before attempting replay;
      // an interrupted or failed consistency check is never free work.
      receipt.replay.attempted_panels++;
      receipt.replay.replay_work_units += panel.units;
      let probe: ProbeResult;
      try {
        probe = await executor.run(
          structuredClone(panel.design),
          [...panel.seeds],
          panel.registration.plan.timeout_seconds * 1000,
        );
        requireSame(
          deterministicProbe(probe),
          deterministicProbe(panel.probe),
          "Replay samples/checks/details",
        );
        requireSame(
          stableProvenance(probe),
          stableProvenance(panel.probe),
          "Replay source/dependency provenance",
        );
      } catch {
        receipt.replay.valid = false;
        receipt.replay.failure = `Recorded result ${panel.entry.sha256} failed deterministic replay; reserved cost remains charged.`;
        process.exitCode = 1;
        break;
      }
      receipt.replay.replayed_panels++;
      receipt.replay.matches.push({
        result_entry_sha256: panel.entry.sha256,
        key: panel.key,
        seed_count: panel.seeds.length,
        work_units: panel.units,
        deterministic_probe_sha256: sha256Json(deterministicProbe(probe)),
        exact_provenance_equal: same(probe.provenance, panel.probe.provenance),
        stable_provenance_equal: true,
      });
    }
  }
  requireSame(sourceSnapshot(root), before, "Read-only archive snapshot");
  receipt.archive_unchanged = true;
  console.log(canonicalJson(receipt));
}

try {
  await main();
} catch (error) {
  console.error(
    canonicalJson({
      schema: "rain-cpu-verification-error/v1",
      error: (error as Error).message,
    }),
  );
  process.exitCode = 1;
}
