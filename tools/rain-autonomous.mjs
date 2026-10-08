#!/usr/bin/env node
/**
 * R.A.I.N.'s autonomous research loop, from the command line.
 *
 * A local open model — served by Ollama or LM Studio — sits in R.A.I.N.'s
 * researcher and analyst seats; the Lab keeps every authority. The loop
 * observes the research state, proposes one of the charter's experiment
 * designs, has the autonomy policy admit or refuse it, pre-registers it,
 * runs it on fresh simulators, replays it, has the analyst read it, reports
 * it to the registry and seals the record — and repeats, within budgets, until
 * one is spent or there is nothing left worth running. See
 * docs/RAIN_LAB_BETHESDA.md#autonomous-research.
 *
 *   npm run rain:autonomous -- --dry-run          what it would run; executes and writes nothing
 *   npm run rain:autonomous -- --charter          print the charter a person authorizes
 *   npm run rain:autonomous -- --authorize <first 8 characters of the charter digest> --reviewed
 *   npm run rain:autonomous                       a live session under that authorization
 *   npm run rain:autonomous -- --iterations 5     fewer iterations than the charter's ceiling
 *   npm run rain:autonomous -- --status           the research state, derived from the records
 *   npm run rain:autonomous -- --verify           replay every record in the research state
 *
 * Flags: --dir <path> (overrides RAIN_AUTONOMY_DIR), --json (one JSON line per
 * trace entry, then the summary). Settings are RAIN_* environment variables
 * (`.env.example`); none is a credential, and the model server is sent none.
 * Exit status: 0 when a session ends on a budget or the researcher's own stop;
 * 1 when it fails closed; 2 for usage, settings or a missing authorization; 3
 * when the model server cannot be reached before anything starts.
 */
import { execFileSync } from "node:child_process";
import "../scripts/ts-hooks.mjs";

const USAGE =
  "usage: node tools/rain-autonomous.mjs [--dry-run] [--iterations N] [--charter] [--authorize PREFIX --reviewed] [--status] [--verify] [--dir PATH] [--json]";
const FLAGS = new Set([
  "--dry-run",
  "--charter",
  "--reviewed",
  "--status",
  "--verify",
  "--json",
  "--help",
]);
const VALUED = new Set(["--iterations", "--authorize", "--dir"]);
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (FLAGS.has(a)) opt[a.slice(2)] = true;
  else if (VALUED.has(a) && i + 1 < args.length) opt[a.slice(2)] = args[++i];
  else {
    console.error(`unknown or incomplete argument: ${a}\n${USAGE}`);
    process.exit(2);
  }
}
if (opt.help) {
  console.log(USAGE);
  process.exit(0);
}

// Nothing a server or a model wrote reaches the terminal unescaped.
const clean = (s) =>
  String(s).replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
    "\ufffd",
  );
const json = !!opt.json;
const say = (...lines) => {
  if (!json) for (const l of lines) console.log(clean(l));
};
const fail = (code, message) => {
  if (json) console.log(JSON.stringify({ error: message }));
  else console.error(clean(message));
  process.exit(code);
};

// A submission names the producing commit; read the checkout's real one, or leave it unknown.
try {
  const git = (a) =>
    execFileSync("git", a, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  if (/^[0-9a-f]{40}$/.test(commit))
    globalThis.__LAB_REVISION__ = {
      commit,
      dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
      source: "git",
    };
} catch {
  // Unknown stays unknown: a live session then refuses to start, and says why.
}

const { autonomyConfig, PROVIDERS } = await import("../src/rain/autonomy/config.ts");
const { createLocalModel, listsModel } = await import("../src/rain/autonomy/models.ts");
const { ResearchStore } = await import("../src/rain/autonomy/store.ts");
const { deriveState, STATUS_WORDS, optionLines } =
  await import("../src/rain/autonomy/state.ts");
const { resultLine } = await import("../src/rain/autonomy/prompts.ts");
const { runSession } = await import("../src/rain/autonomy/controller.ts");
const { SEATS } = await import("../src/rain/autonomy/roles.ts");
const { STOP_REASONS } = await import("../src/rain/autonomy/trace.ts");
const standing = await import("../src/bethesda/rain/standing.ts");
const { verifyRecordSync } = await import("../src/bethesda/rain/replay.ts");
const { classifyUrl } = await import("../src/rain/meeting/privacy.ts");

const configured = autonomyConfig(
  opt.dir ? { ...process.env, RAIN_AUTONOMY_DIR: opt.dir } : process.env,
);
if (!configured.ok) fail(2, `R.A.I.N. autonomy is not configured: ${configured.reason}`);
const config = configured.config;
const store = new ResearchStore(config.dir);
const loadState = () => deriveState(store.records(), store.traces().entries);

if (opt.status) {
  const state = loadState();
  if (json) {
    console.log(JSON.stringify(state));
    process.exit(0);
  }
  say(`R.A.I.N. RESEARCH STATE · ${store.root}`, "", state.note, "");
  say(`Experiments (${state.experiments.length}) — simulation results:`);
  for (const x of state.experiments) say(`  ${resultLine(x)} · ${x.path}`);
  say("", "Hypotheses — status from the registry's pre-registered criteria:");
  for (const h of state.hypotheses)
    say(`  H ${h.id}: ${STATUS_WORDS[h.status]} — ${h.statement}`);
  say("", "Open questions — the model's words, not findings:");
  for (const q of state.questions.slice(-12))
    say(`  ${q.text} (${q.model}, ${q.session_id})`);
  say("", `Sessions (${state.sessions.length}):`);
  for (const s of state.sessions)
    say(
      `  ${s.session_id} · ${s.mode} · ${s.model} via ${s.provider} · ${s.experiments} experiment(s) · ${s.stop_reason ?? "did not end cleanly"}`,
    );
  for (const w of state.warnings) say(`WARNING: ${w}`);
  process.exit(0);
}

if (opt.verify) {
  let bad = 0;
  const stored = store.records();
  for (const s of stored) {
    if (!s.record || !s.digestOK) {
      bad += 1;
      say(`FAIL ${s.path}: ${s.problem ?? "does not match its digest"}`);
      continue;
    }
    const v = verifyRecordSync(s.record);
    if (!v.ok) bad += 1;
    say(
      `${v.ok ? "PASS" : "FAIL"} ${s.path}: ${s.record.outcome.state}${
        v.ok
          ? ""
          : " — " +
            v.checks
              .filter((c) => !c.ok)
              .map((c) => `${c.id}: ${c.detail}`)
              .join("; ")
      }`,
    );
  }
  say(
    `${stored.length - bad} of ${stored.length} record(s) verified by replay; no model was contacted.`,
  );
  process.exit(bad ? 1 : 0);
}

const label = PROVIDERS[config.provider].label;
const settingsFor = (model) => ({
  provider: config.provider,
  model,
  baseUrl: config.baseUrl,
  timeoutMs: config.timeoutMs,
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  contextTokens: config.contextTokens,
});
const locality = await classifyUrl(config.baseUrl);
if (locality === "remote")
  fail(
    2,
    `${PROVIDERS[config.provider].setting} points at a host that is neither this machine nor a private network. The autonomous researcher runs local models only; nothing was sent.`,
  );
if (!config.model) {
  let listed = [];
  try {
    listed = await createLocalModel({
      ...settingsFor("unset"),
      timeoutMs: 5000,
    }).listModels();
  } catch {
    // Listing is a courtesy here; the session itself checks again.
  }
  fail(
    2,
    `RAIN_MODEL is not set. Name the model exactly as ${label} lists it${listed.length ? ` — it lists: ${listed.slice(0, 20).join(", ")}` : ` (nothing answered at ${config.baseUrl})`}.`,
  );
}
const model = createLocalModel(settingsFor(config.model));
const charter = standing.buildCharter({
  ceilings: config.ceilings,
  model: { provider: config.provider, model: config.model, endpoint: config.baseUrl },
  validHours: config.charterHours,
});
const charterSha = standing.charterSha256(charter);
const charterId = standing.charterIdOf(charterSha);

function printCharter() {
  const c = charter.ceilings;
  say(
    `CHARTER ${charterId}`,
    `Digest:   ${charterSha}`,
    `Covers:   ${charter.covers}`,
    `Model:    ${config.model} via ${label} at ${config.baseUrl} (${locality})`,
    `Ceilings: per session at most ${c.iterations} iterations, ${c.experiments} experiments, ${Math.round(c.runtime_ms / 1000)} s, ${c.failed_proposals} failed proposals, ${c.model_calls} model calls, ${c.model_tokens ?? "no"} token ceiling`,
    `Stands:   ${charter.valid_hours} hours from authorization`,
    `Policy:   ${charter.policy_version}: charter-authorized, design-listed, validated, design-digest, host-written, fresh-seeds, experiment-budget, runtime-budget`,
    "",
    `Designs (${charter.designs.length}) — a host option, one direction, one seed panel (primary ${standing.SEED_PANELS.primary.join(", ")} · replication ${standing.SEED_PANELS.replication.join(", ")}); 9,000 simulated ticks each:`,
  );
  const lines = optionLines();
  for (const line of lines) {
    const option = line.split(" ")[0];
    say(`  ${line}`);
    for (const d of charter.designs.filter((x) => x.option === option))
      say(`      ${d.design_id.padEnd(26)} ${d.design_sha256}`);
  }
  say(
    "",
    "To authorize this charter, review it, then type the first eight characters of its digest:",
    "  npm run rain:autonomous -- --authorize <first 8 characters> --reviewed",
    `The authorization is a local operator attestation under the role label ${config.operator} (RAIN_AUTONOMY_OPERATOR): not authenticated identity. Any change to the model, endpoint, ceilings, validity or this build's simulator is a different charter.`,
  );
}

if (opt.charter) {
  printCharter();
  store.saveCharter(charter);
  process.exit(0);
}

let budgets;
{
  const iterations = opt.iterations === undefined ? undefined : Number(opt.iterations);
  const b = standing.budgetsWithin(
    charter.ceilings,
    iterations === undefined ? {} : { iterations },
  );
  if (!b.ok)
    fail(
      2,
      `${b.errors.join("; ")}. Raise RAIN_MAX_ITERATIONS and authorize the new charter to run more.`,
    );
  budgets = b.value;
}

const live = !opt["dry-run"];
if (live && !config.enabled)
  fail(
    2,
    "RAIN_AUTONOMY_ENABLED is not true: live autonomy is switched off, and nothing ran. Set it to true to run a live session; --dry-run works without it.",
  );
if (opt.authorize !== undefined) {
  if (!live)
    fail(2, "--authorize is for a live session; a dry run needs no authorization");
  const a = standing.authorizeCharter({
    charter,
    operator: config.operator,
    typedPrefix: opt.authorize,
    reviewed: !!opt.reviewed,
    now: new Date(),
  });
  if (!a.ok)
    fail(
      2,
      `The charter was not authorized: ${a.errors.join("; ")}. (--reviewed confirms you reviewed it; see --charter.)`,
    );
  store.saveCharter(charter);
  store.saveAuthorization(a.value);
  say(
    `Charter ${charterId} authorized by local operator ${a.value.operator} at ${a.value.authorized_at}, until ${a.value.expires_at} (not authenticated identity).`,
    "",
  );
}
const now = Date.now();
const authorization =
  store.authorizations(charter).find((a) => Date.parse(a.expires_at) >= now) ?? null;
if (live && !authorization) {
  printCharter();
  say("");
  fail(
    2,
    `No standing authorization covers charter ${charterId}; nothing ran. Authorize it as above, or run --dry-run to see what it would do.`,
  );
}

let runtime = null;
if (live) {
  const { configureRuntime } = await import("../src/rain/runtime.ts");
  const env = { RAIN_REGISTRY_DIR: process.env.RAIN_REGISTRY_DIR || store.registryDir() };
  for (const k of ["VERCEL_GIT_COMMIT_SHA", "GITHUB_SHA"])
    if (process.env[k]) env[k] = process.env[k];
  const c = await configureRuntime({ env, cwd: process.cwd() });
  if (c.mode !== "local")
    fail(
      1,
      `The research runtime did not start: ${c.mode === "misconfigured" ? c.reason : "switched off"}`,
    );
  runtime = c.runtime;
}

// Before anything starts: is the model there at all?
try {
  const listed = await model.listModels();
  if (!listsModel(listed, model))
    fail(
      3,
      `${label} at ${config.baseUrl} does not list ${config.model}${listed.length ? `; it lists: ${listed.slice(0, 20).join(", ")}` : ""}. Nothing ran.`,
    );
} catch (error) {
  fail(
    3,
    `${label} did not answer at ${config.baseUrl}: ${error instanceof Error ? error.message : error}. Start it (ollama serve, or LM Studio's server), or check ${PROVIDERS[config.provider].setting}. Nothing ran.`,
  );
}

const words = (s) => s.replaceAll("_", " ");
let iterationShown = null;
const header = () => {
  const c = authorization;
  say(
    "RAIN AUTONOMOUS SESSION",
    "",
    `Mode:      ${live ? "LIVE — runs only what the autonomy policy admits under the charter" : "DRY RUN — proposes and validates; executes nothing, writes nothing"}`,
    `Model:     ${config.model}`,
    `Provider:  ${label} at ${config.baseUrl} (${locality})`,
    `Charter:   ${charterId} · ${c ? `authorized by local operator ${c.operator} at ${c.authorized_at}, until ${c.expires_at}` : "not authorized — shows what would need authorization"}`,
    `Budgets:   ${budgets.iterations} iterations · ${budgets.experiments} experiments · ${Math.round(budgets.runtime_ms / 1000)} s · ${budgets.failed_proposals} failed proposals · ${budgets.model_calls} model calls · ${budgets.model_tokens ?? "no"} token ceiling`,
    `Seats:     ${Object.entries(SEATS)
      .map(
        ([role, s]) =>
          `${role} ${s.by === "model" ? "(model)" : s.by === "host" ? "(host)" : "(unassigned)"}`,
      )
      .join(" · ")}`,
    `Research:  ${store.root}`,
  );
};
const render = (e) => {
  if (json) return console.log(JSON.stringify(e));
  if (
    e.iteration !== null &&
    e.iteration !== iterationShown &&
    e.kind !== "session-ended"
  ) {
    iterationShown = e.iteration;
    say("", `── Iteration ${e.iteration} / ${budgets.iterations} ${"─".repeat(40)}`);
  }
  switch (e.kind) {
    case "session-started":
      return say(
        `Session:   ${e.session_id}`,
        `Before:    ${e.records_before} record(s) in the research state`,
      );
    case "model-check":
      return say(`Model check: ${e.ok ? "OK — " : "FAILED — "}${e.detail}`);
    case "observation":
      return say(
        `Observed:  ${e.experiments_recorded} experiment(s) recorded · ${e.hypotheses_tested} hypothesis(es) tested · ${e.designs_open} design(s) with fresh seeds · ${e.open_questions} open question(s)`,
      );
    case "decision":
      if (e.decision.failure)
        return say(`${e.decision.seat} (model): NO ANSWER — ${e.decision.refused}`);
      if (e.decision.refused)
        return say(`${e.decision.seat} (model): ANSWER REFUSED — ${e.decision.refused}`);
      return;
    case "tool":
      return say(
        `Researcher asked: ${e.tool} ${e.input}`,
        ...e.output
          .split("\n")
          .slice(0, 3)
          .map((l) => `  Lab (read-only): ${l}`),
      );
    case "proposal":
      return say(
        `Current question (model):     ${e.question}`,
        `Current hypothesis (model):   ${e.hypothesis}`,
        `Competing hypothesis (model): ${e.competing_hypothesis}`,
        `Rationale (model):            ${e.rationale}`,
        `Proposed experiment:          ${e.design_id}${e.ranking.length ? ` (then ${e.ranking.join(", ")})` : ""}`,
      );
    case "validation":
      return say(
        `Validation:     ${
          e.ok
            ? `PASSED — ${e.experiment_id}, ${e.checks.length} deterministic checks`
            : `FAILED — ${e.checks
                .filter((c) => !c.ok)
                .map((c) => c.detail)
                .join("; ")}`
        }`,
      );
    case "policy": {
      const blocking = e.rules.filter((r) => !r.ok);
      if (e.admitted)
        return say(
          `Authorization:  APPROVED — ${e.design_id} admitted by ${standing.POLICY_VERSION} under ${charterId} (${e.rules.length} of ${e.rules.length} rules)`,
        );
      if (e.admissible_once_authorized)
        return say(
          `Authorization:  WOULD BE APPROVED once ${charterId} is authorized (every other rule holds)`,
        );
      return say(
        `Authorization:  REFUSED — ${blocking.map((r) => `${r.id}: ${r.detail}`).join("; ")}`,
      );
    }
    case "would-execute":
      return say(`WOULD EXECUTE:  ${e.experiment_id} — ${e.protocol}`);
    case "preregistration":
      return say(
        `Pre-registered: ${e.rain_experiment_id} (${e.registry} registry), before the run`,
      );
    case "execution":
      return say(
        `Executing:      ${e.experiment_id} · 6 arms on fresh simulators · ${e.seconds} s`,
        `Result:         ${e.state} · ${words(e.verdict)} (simulation) — ${e.summary}`,
      );
    case "replay":
      return say(
        `Replay:         ${e.ok ? "verified — every arm re-simulated identically, no model contacted" : `FAILED — ${e.failed.join("; ")}`}`,
      );
    case "analysis":
      return say(
        `Interpretation (model, not evidence): reads "${e.reading}" — ${e.agrees ? "agrees with the criteria" : `DISAGREES with the criteria (${e.criteria_reading}); the criteria stand`}`,
        `  ${e.interpretation}`,
        ...(e.open_questions[0] ? [`Next question (model): ${e.open_questions[0]}`] : []),
      );
    case "contradiction":
      return say(
        `CONTRADICTORY RESULTS PRESERVED: ${e.detail} (${e.runs.map((r) => `${r.design_id} ${words(r.verdict)}`).join("; ")})`,
      );
    case "submission":
      return say(
        `Registry:       ${e.rain_run_id ? `${e.rain_run_id} · ${e.status} (${words(e.verdict)}) — judged by its own pre-registered criteria` : `NOT ADMITTED — ${e.refused}`}`,
      );
    case "record":
      return say(
        `Record:         ${e.path} · ${e.state} · sealed ${e.record_sha256.slice(0, 16)}…`,
      );
    case "refusal":
      return say(`Refused (${e.stage}): ${e.reason}`);
    case "session-ended":
      return say("", `── Session ended: ${STOP_REASONS[e.stop_reason]} — ${e.detail}`);
  }
};

header();
const summary = await runSession({
  mode: live ? "live" : "dry-run",
  charter,
  authorization,
  budgets,
  model,
  store,
  runtime,
  operator: config.operator,
  onEntry: render,
});
if (json) console.log(JSON.stringify(summary));
else {
  const t = summary.tokens;
  say(
    `Experiments:    ${summary.experiments.length} run${live ? "" : ` · ${summary.would_execute.length} would execute: ${summary.would_execute.join(", ") || "none"}`}`,
    ...summary.experiments.map(
      (x) =>
        `  ${x.experiment_id} ${x.design_id} · ${x.state} · ${words(x.verdict)}${x.registry_run_id ? ` · ${x.registry_run_id}` : ""} · ${x.path}`,
    ),
    `Proposals:      ${summary.failed_proposals} failed · ${summary.refusals} refusal(s)`,
    `Model calls:    ${summary.model_calls} · tokens ${t ? `${t.prompt} prompt + ${t.completion} completion, as the server reported` : "not reported by the server (unknown, not zero)"}`,
    ...(summary.trace
      ? [
          `Trace:          ${store.root}/${summary.trace}`,
          `State:          ${store.root}/state.json (derived; never read back)`,
        ]
      : []),
    "",
    summary.note,
  );
}
const CLEAN = new Set([
  "iterations",
  "experiments",
  "runtime",
  "model_calls",
  "model_tokens",
  "researcher",
  "no_design",
]);
process.exit(!summary.started ? 2 : CLEAN.has(summary.stop_reason) ? 0 : 1);
