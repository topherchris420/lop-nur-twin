#!/usr/bin/env node
/** Real simulator integration demonstration with an explicitly scripted designer, never Qwen. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import "../scripts/ts-hooks.mjs";
const { configureRuntime } = await import("../src/rain/runtime.ts");
const { ResearchStore } = await import("../src/rain/autonomy/store.ts");
const { DiscoveryFixtureModel } =
  await import("../src/rain/autonomy/discoveryFixtures.ts");
const { ResearchFixtureModel } = await import("../src/rain/research/fixtures.ts");
const { researchScope } = await import("../src/bethesda/rain/researchProtocol.ts");
const { compileManuscript } = await import("../src/rain/research/manuscript.ts");
const { sha256Json } = await import("../src/rain/sha256.ts");
const { runDiscovery } = await import("../src/rain/autonomy/discovery.ts");
const { DEFAULT_ENVELOPE, DISCOVERY_QUESTION } =
  await import("../src/bethesda/rain/discoveryProtocol.ts");
const { buildDiscoveryCharter, authorizeCharter, charterSha256 } =
  await import("../src/bethesda/rain/standing.ts");
const { verifyRecordSync } = await import("../src/bethesda/rain/replay.ts");
const research = process.argv.includes("--research");
const args = process.argv.slice(2).filter((arg) => arg !== "--research");
const destination = resolve(args[1] ?? ".rain-research/discovery-validation");
if (args[0] === "--verify") {
  const store = new ResearchStore(destination);
  const entries = store.discoveryEntries();
  const records = store.records();
  if (!records.length) throw new Error("No records to verify");
  for (const row of records) {
    const checked = verifyRecordSync(row.record);
    console.log(`${row.path}: ${checked.ok ? "PASS" : "FAIL"}`);
    if (!checked.ok) {
      console.error(checked.checks.filter((c) => !c.ok));
      process.exitCode = 1;
    }
  }
  for (const { payload: artifact } of entries.filter(
    (e) => e.kind === "research-artifact",
  )) {
    const text = store.readResearchArtifact(artifact.path);
    if (artifact.name.endsWith("evidence.json")) {
      const evidence = JSON.parse(text);
      for (const result of evidence.results) {
        const record = records.find((r) => r.record.run_id === result.run_id)?.record;
        if (
          !record ||
          !result.replay ||
          sha256Json(result.measurements) !== sha256Json(record.run.measurements) ||
          sha256Json(result.per_seed) !== sha256Json(record.run.per_seed) ||
          result.verdict !== record.outcome.verdict ||
          result.registry_run_id !== record.rain_admission.run_id
        )
          throw new Error("Paper evidence differs from its native sealed record");
      }
    }
    if (artifact.name.endsWith("manuscript.md")) {
      const base = artifact.path.replace(/manuscript\.md$/, "");
      const draft = JSON.parse(store.readResearchArtifact(base + "manuscript.json"));
      const evidence = JSON.parse(store.readResearchArtifact(base + "evidence.json"));
      const figure = base.split("/").at(-1) + "figure.svg";
      if (compileManuscript(draft, evidence, figure) !== text)
        throw new Error("Manuscript does not reproduce from its evidence bundle");
    }
  }
  console.log("Journal, artifact hashes and any manuscript evidence bindings: PASS");
} else {
  if (args[0] && args[0] !== "--out")
    throw new Error("Usage: [--research] --out DIRECTORY | --verify DIRECTORY");
  if (existsSync(destination))
    throw new Error("Choose a new output directory; existing evidence is never replaced");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length >
    0;
  globalThis.__LAB_REVISION__ = { commit, dirty, source: "git" };
  const store = new ResearchStore(destination),
    model = research ? new ResearchFixtureModel() : new DiscoveryFixtureModel();
  const charter = buildDiscoveryCharter({
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    ceilings: {
      iterations: 2,
      experiments: 2,
      runtime_ms: 240000,
      failed_proposals: 2,
      model_calls: research ? 24 : 8,
      model_tokens: null,
    },
    validHours: 1,
    envelope: DEFAULT_ENVELOPE,
    ...(research ? { research: researchScope(DISCOVERY_QUESTION, false) } : {}),
  });
  const approved = authorizeCharter({
    charter,
    operator: "Scripted.Validation",
    typedPrefix: charterSha256(charter).slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  if (!approved.ok) throw new Error(approved.errors.join("; "));
  // This host-authored integration fixture is explicitly authorized by invoking this tool.
  // No live-model charter is created or approved here.
  store.saveCharter(charter);
  store.saveAuthorization(approved.value);
  const runtime = await configureRuntime({
    env: { RAIN_REGISTRY_DIR: store.registryDir() },
    cwd: process.cwd(),
  });
  if (runtime.mode !== "local") throw new Error("Runtime unavailable");
  const result = await runDiscovery({
    charter,
    authorization: approved.value,
    budgets: charter.ceilings,
    model,
    store,
    runtime: runtime.runtime,
    question: DISCOVERY_QUESTION,
    operator: "Scripted.Validation",
  });
  if (result.executed !== 2 || result.history.length !== 2)
    throw new Error(result.ending);
  if (research && result.research?.delivery !== "ready_for_human_review")
    throw new Error("Research draft delivery failed: " + result.ending);
  writeFileSync(
    join(destination, "summary.json"),
    JSON.stringify(
      {
        ...result,
        provenance: { commit, dirty },
        disclaimer:
          "Scripted integration fixture; NOT a Qwen reasoning demonstration. Measurements are actual simulator outputs.",
      },
      null,
      2,
    ),
  );
  copyFileSync(join(destination, result.report), join(destination, "REPORT.md"));
  mkdirSync(join(destination, "reproduction"), { recursive: true });
  console.log(
    JSON.stringify(
      {
        output: destination,
        executed: result.executed,
        ending: result.ending,
        ...(result.research
          ? { delivery: result.research.delivery, artifacts: result.research.artifacts }
          : {}),
        results: result.history.map((r) => ({
          parent: r.parent,
          mean_delta: r.measurements.primary_delta_mean,
          verdict: r.verdict,
          seeds: r.per_seed.map((s) => s.seed),
        })),
      },
      null,
      2,
    ),
  );
}
