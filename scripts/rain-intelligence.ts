/** Operator entrypoint for explicitly reviewed, local-only CPU scientific campaigns. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { autonomyConfig } from "../src/rain/autonomy/config.js";
import { createLocalModel } from "../src/rain/autonomy/models.js";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { classifyUrl } from "../src/rain/meeting/privacy.js";
import { gitState } from "../src/rain/experiments/provenance.js";
import { canonicalJson, sha256Json } from "../src/rain/sha256.js";
import {
  cpuCampaignReport,
  exportCpuCampaign,
  prepareCpuCampaign,
  runCpuCampaign,
} from "../src/rain/research/intelligenceCampaign.js";
import { createCpuExecutor } from "../server/rain/cpuWorker.js";
import { deliberateCpuPlan } from "../src/rain/research/intelligenceDeliberation.js";

const args = process.argv.slice(2);
const HELP = `Local CPU research intelligence

node scripts/run-ts.mjs scripts/rain-intelligence.ts MODE [options]

Modes:
  --deliberate PLAN.json [--context STUDY]  Four advisory local-model calls; no CPU execution
  --prepare PLAN.json                     Freeze CPU definitions and print the approval digest
  --run STUDY --approved-sha DIGEST --reviewed [--continue-reviewed]
  --status STUDY                          Verify and print the retained campaign
  --export STUDY [--publish-dir NEW_DIR]   Export evidence and the offline observatory
  --recover-lock DIGEST --reviewed        Recover a reviewed interrupted-owner lock

Options:
  --dir JOURNAL                           Default: .rain-research/cpu-intelligence
  --python INTERPRETER --qnp CLONE --drr CLONE
                                          CPU prepare/run only; map required upstreams explicitly

Deliberation uses RAIN_AUTONOMY_ENABLED=true, RAIN_MODEL_PROVIDER=ollama|lmstudio,
and RAIN_MODEL=<exact local model ID>. RAIN_MODEL_TIMEOUT_MS, RAIN_MODEL_CONTEXT
and RAIN_MODEL_MAX_TOKENS bound individual calls. Remote endpoints and Ollama :cloud
models are refused. It records
each SOUL perspective's prompt/answer and returns advisory ranks without changing
the plan, registering an experiment, authorizing execution, or needing Python.
Status and export also need neither Python nor model configuration.`;
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const value = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const result = args[i + 1];
  if (!result || result.startsWith("--"))
    throw new Error(`${flag} requires a value; see --help`);
  return result;
};
const mode = [
  "--prepare",
  "--run",
  "--status",
  "--export",
  "--recover-lock",
  "--deliberate",
].filter((m) => args.includes(m));
if (mode.length !== 1) throw new Error("Choose exactly one mode; see --help.");
if (args.includes("--context") && mode[0] !== "--deliberate")
  throw new Error("--context is only available with --deliberate");
const store = new ResearchStore(
  resolve(value("--dir") ?? ".rain-research/cpu-intelligence"),
);
let result: unknown;
if (mode[0] === "--deliberate") {
  const configured = autonomyConfig(process.env);
  if (!configured.ok) throw new Error(configured.reason);
  const config = configured.config;
  if (!config.enabled || !config.model)
    throw new Error(
      "Deliberation requires RAIN_AUTONOMY_ENABLED=true and an explicit RAIN_MODEL",
    );
  if (config.ceilings.model_calls < 4)
    throw new Error("The CPU panel requires four calls within RAIN_MAX_MODEL_CALLS");
  if ((await classifyUrl(config.baseUrl)) === "remote")
    throw new Error(
      "CPU deliberation requires a loopback or private-network model endpoint",
    );
  const model = createLocalModel({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    contextTokens: config.contextTokens,
  });
  const contextId = value("--context");
  const verifiedReports = contextId ? [cpuCampaignReport(store, contextId)] : [];
  const signal = new AbortController();
  const stop = () => signal.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    result = await deliberateCpuPlan({
      session: `DS-${randomUUID()}`,
      store,
      template: JSON.parse(readFileSync(value("--deliberate")!, "utf8")),
      verifiedReports,
      model,
      signal: signal.signal,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
} else if (mode[0] === "--recover-lock") {
  if (!args.includes("--reviewed"))
    throw new Error("Interrupted owner lock must be reviewed before recovery");
  store.recoverLock(value("--recover-lock")!);
  result = { recovered: true };
} else if (mode[0] === "--status") {
  result = cpuCampaignReport(store, value("--status")!);
} else if (mode[0] === "--export") {
  const exported = exportCpuCampaign(store, value("--export")!);
  const publish = value("--publish-dir");
  if (publish) {
    const target = resolve(publish),
      rel = relative(process.cwd(), target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Publish export inside this repository, in a new directory");
    mkdirSync(target); // never overwrite an earlier scientific export
    writeFileSync(
      join(target, "evidence.json"),
      store.readResearchArtifact(exported.evidence.path),
      { flag: "wx" },
    );
    writeFileSync(
      join(target, "index.html"),
      store.readResearchArtifact(exported.observatory.path),
      { flag: "wx" },
    );
    writeFileSync(
      join(target, "observatory.js"),
      store.readResearchArtifact(exported.script.path),
      { flag: "wx" },
    );
    cpSync(store.root, join(target, "archive"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
  result = {
    evidence: exported.evidence,
    observatory: exported.observatory,
    script: exported.script,
    status: exported.report.status,
  };
} else {
  const python = value("--python");
  if (!python)
    throw new Error(
      "An explicit --python interpreter is required; no model selects executables",
    );
  const repositories: Record<string, string> = {};
  if (value("--qnp")) repositories["quantum-noise-profiler"] = value("--qnp")!;
  if (value("--drr")) repositories["dynamic-resonance-rooting"] = value("--drr")!;
  const executor = createCpuExecutor({
    repositoryRoot: process.cwd(),
    python,
    repositories,
  });
  if (mode[0] === "--prepare") {
    const git = gitState(process.cwd(), [store.root]);
    if (!git.commit || git.dirty === null)
      throw new Error("Producing repository identity unavailable");
    result = prepareCpuCampaign(
      store,
      JSON.parse(readFileSync(value("--prepare")!, "utf8")),
      executor,
      {
        commit: git.commit,
        dirty: git.dirty,
        source_sha256: sha256Json(executor.binding),
      },
    );
  } else {
    const signal = new AbortController();
    const stop = () => signal.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      result = await runCpuCampaign(
        store,
        value("--run")!,
        value("--approved-sha") ?? "",
        executor,
        {
          reviewed: args.includes("--reviewed"),
          continueReviewed: args.includes("--continue-reviewed"),
          signal: signal.signal,
        },
      );
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
}
console.log(canonicalJson(result));
