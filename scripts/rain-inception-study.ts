/** Real-inference study entry point. No fixtures, automatic authorization, or restart. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createLocalModel } from "../src/rain/autonomy/models.js";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { runDiscovery } from "../src/rain/autonomy/discovery.js";
import { configureRuntime } from "../src/rain/runtime.js";
import { partnership } from "../src/bethesda/rain/inceptionProtocol.js";
import { researchScope } from "../src/bethesda/rain/researchProtocol.js";
import {
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
} from "../src/bethesda/rain/standing.js";
import { verifyRecordSync } from "../src/bethesda/rain/replay.js";
import { sha256Json } from "../src/rain/sha256.js";
import { liveStudyAudit } from "../src/rain/research/liveValidation.js";

const index = process.argv.findIndex((v) =>
  v.replaceAll("\\", "/").endsWith("/rain-inception-study.ts"),
);
const args = process.argv.slice(index < 0 ? 2 : index + 1).filter((v) => v !== "--");
const command = args.shift();
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i]!,
    value = args[i + 1];
  if (
    !["--root", "--model", "--authorize", "--operator", "--strategies"].includes(flag) ||
    !value ||
    value.startsWith("--") ||
    options.has(flag)
  )
    throw new Error("Expected unique --root, --model, --authorize or --operator value");
  options.set(flag, value);
}
if (!["prepare", "run", "inspect"].includes(command ?? "") || !options.has("--root"))
  throw new Error(
    "Usage: rain:inception:study prepare|run|inspect --root PATH [--model ID] [--authorize FULL_DIGEST --operator ROLE]. Review prepare output before run; inspect never resumes.",
  );
const store = new ResearchStore(resolve(options.get("--root")!), 64 * 1024 * 1024);
const settings = {
  provider: "lmstudio" as const,
  model: options.get("--model") ?? "qwen/qwen3.5-9b",
  baseUrl: "http://127.0.0.1:1234",
  contextTokens: 16384,
  maxTokens: 1536,
  timeoutMs: 600000,
  temperature: 0.2,
};
const question =
  "Does a simulated fire at Bethesda Row increase the mean count of outdoor pedestrians watching or recording within 300 m, compared with a matched no-event control? Distinguish an event response from no measurable change; conclusions concern only installed simulator rules.";
const profile = partnership();
if (options.has("--strategies")) {
  if (options.get("--strategies") !== "v1")
    throw new Error("Supported strategy configuration: v1");
  profile.profile.strategy_version = 1;
  profile.profile.version = 2;
}
const charter = buildDiscoveryCharter({
  model: {
    provider: settings.provider,
    model: settings.model,
    endpoint: settings.baseUrl,
  },
  validHours: 2,
  ceilings: {
    iterations: 4,
    experiments: 2,
    runtime_ms: 5400000,
    failed_proposals: 4,
    model_calls: 60,
    model_tokens: 250000,
  },
  envelope: {
    scenarios: ["fire"],
    locations: ["bethesda_row"],
    metrics: ["watching"],
    pedestrians: [40, 80],
    vehicles: [0, 0],
    buses: [0, 0],
    intensity: [1, 2],
    duration_ticks: [300, 900],
    warmup_ticks: [100, 300],
    observation_window_ticks: [300, 600],
    max_actor_ticks: 500000,
    seeds_per_design: 3,
  },
  research: {
    ...researchScope(question, false),
    partnership: profile,
    require_confirmation: true,
  },
});
const digest = charterSha256(charter);
if (command === "prepare") {
  store.saveCharter(charter);
  console.log(
    JSON.stringify(
      {
        root: store.root,
        charter,
        digest,
        settings,
        storage_bytes: store.maxBytes,
        execution:
          "No authority granted. Review the complete charter; run requires its full digest and operator role. No network literature, descendants, or automatic restart.",
      },
      null,
      2,
    ),
  );
} else if (command === "inspect") {
  const entries = store.discoveryEntries();
  const records = store.records();
  const replay = records.map((r) => ({
    run_id: r.record?.run_id,
    digest_ok: r.digestOK,
    replay_ok: !!r.record && r.digestOK && verifyRecordSync(r.record).ok,
  }));
  console.log(
    JSON.stringify(
      {
        root: store.root,
        executing: false,
        lock: store.lock(),
        entries: entries.length,
        journal_head: entries.at(-1)?.sha256,
        replay,
        audit: liveStudyAudit(
          entries,
          new Set(replay.filter((r) => r.replay_ok).map((r) => r.run_id!)),
        ),
        endings: entries.filter((e) =>
          ["session-end", "session-failure", "research-untestable"].includes(e.kind),
        ),
        note: "Read-only inspection; no execution or inference is resumed.",
      },
      null,
      2,
    ),
  );
  if (replay.some((r) => !r.replay_ok)) process.exitCode = 1;
} else {
  if (options.get("--authorize") !== digest || !options.get("--operator"))
    throw new Error(
      "Run requires the exact reviewed charter digest and explicit operator role",
    );
  if (store.discoveryEntries().some((e) => e.kind === "live-study-start"))
    throw new Error(
      "This live study was already started. Inspect retained records; a new reviewed study requires a separate root. No automatic retry or resume.",
    );
  const model = createLocalModel(settings);
  if (!(await model.listModels()).includes(settings.model))
    throw new Error("Requested local model unavailable");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const dirty = !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  Object.assign(globalThis, { __LAB_REVISION__: { commit, dirty, source: "git" } });
  const authorization = authorizeCharter({
    charter,
    typedPrefix: digest.slice(0, 8),
    reviewed: true,
    operator: options.get("--operator")!,
    now: new Date(),
  });
  if (!authorization.ok) throw new Error(authorization.errors.join("; "));
  store.saveCharter(charter);
  store.saveAuthorization(authorization.value);
  store.appendDiscovery("operator", "live-study-start", {
    settings,
    charter_sha256: digest,
    commit,
    dirty,
    diff_sha256: sha256Json(diff),
    generation: "model",
    authorization:
      "Explicit CLI request bound to reviewed charter; no scripted reasoning or fallback",
    limits: { descendants: 0, storage_bytes: store.maxBytes },
  });
  const runtime = await configureRuntime({
    env: { RAIN_REGISTRY_DIR: store.registryDir() },
    cwd: process.cwd(),
    registryWriteGuard: (bytes) => store.checkWriteBudget(bytes + 65536),
  });
  if (runtime.mode !== "local") throw new Error("Native runtime unavailable");
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("Operator emergency stop"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let last = "";
  try {
    const result = await runDiscovery({
      store,
      model,
      charter,
      authorization: authorization.value,
      budgets: charter.ceilings,
      runtime: runtime.runtime,
      operator: authorization.value.operator,
      question,
      signal: abort.signal,
      onUpdate: (v) => {
        const line = `${v.stage}: ${v.detail}`;
        if (line !== last && v.detail) {
          console.log(new Date().toISOString() + " " + line);
          last = line;
        }
      },
    });
    console.log(
      JSON.stringify(
        {
          root: store.root,
          session: result.session,
          executed: result.executed,
          ending: result.ending,
          report: result.report,
          delivery: result.research?.delivery,
          gaps: result.research?.gaps,
          ok: result.ok,
        },
        null,
        2,
      ),
    );
    if (!result.ok) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
