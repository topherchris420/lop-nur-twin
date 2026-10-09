#!/usr/bin/env node
/** Operator-only lineage review and inspection of the existing R.A.I.N. registry. */
import { resolve } from "node:path";
import "../scripts/ts-hooks.mjs";
// Install TypeScript resolution hooks before linking runtime modules.
const { Registry, readJson } = await import("../src/rain/experiments/registry.ts");
const { assessResearch, validateResearchPlan } =
  await import("../src/rain/experiments/research.ts");
const { sha256Bytes, sha256Json } = await import("../src/rain/experiments/schema.ts");

const args = process.argv.slice(2);
const flag = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
};
const command = args[0];
const directory = flag("--registry");
if (
  !directory ||
  !["inspect", "review", "apply", "recover", "replay"].includes(command)
) {
  console.error(`usage: node tools/rain-research.mjs COMMAND --registry DIR
  inspect [--branch main]             reassess sources, replay stored Bethesda evidence
  review --file plan.json             validate a plan and show its digest and assessment
  apply --file plan.json --expected N --approve SHA256 --operator ROLE
  recover --run RUN_ID --approve RECORD_SHA256 --operator ROLE
  replay --run RUN_ID                 re-simulate stored Bethesda artifacts, no model`);
  process.exit(2);
}
const registry = new Registry(resolve(directory));
try {
  let answer;
  if (command === "inspect") {
    const history = registry.researchHistory();
    const branch = flag("--branch") ?? "main";
    const head = history.filter((h) => h.plan.branch === branch).at(-1);
    if (!head) throw new Error(`No research branch named ${branch}`);
    answer = {
      revision: head.revision,
      branch,
      historical_assessment: head.assessment,
      current_assessment: assessResearch(registry, head.plan),
    };
  } else if (command === "review" || command === "apply") {
    if (!flag("--file")) throw new Error("Supply --file with an operator-authored plan");
    const plan = validateResearchPlan(readJson(resolve(flag("--file")), 1024 * 1024));
    const digest = sha256Json(plan);
    answer =
      command === "review"
        ? {
            expected_revision: registry.researchHistory().length,
            plan_sha256: digest,
            plan,
            assessment: assessResearch(registry, plan),
          }
        : registry.saveResearch(plan, Number(flag("--expected")), {
            origin: "human",
            operator: flag("--operator"),
            reviewed: flag("--approve") === digest,
            plan_sha256: flag("--approve"),
          });
  } else if (command === "recover") {
    answer = registry.recoverInterruptedRun(flag("--run"), {
      operator: flag("--operator"),
      reviewed: !!flag("--approve"),
      record_sha256: flag("--approve"),
    });
  } else {
    const { record } = registry.resolveRun(flag("--run"));
    const artifact = record.artifacts.find((a) => a.kind === "replay" && a.stored);
    if (!artifact)
      throw new Error(
        "No stored replay artifact; a hash-only reference cannot be replayed",
      );
    const text = registry.readArtifact(record.run_id, artifact.name);
    if (
      sha256Bytes(text) !== artifact.sha256 ||
      Buffer.byteLength(text) !== artifact.bytes
    )
      throw new Error("Replay artifact bytes differ");
    const { seal } = await import("../src/bethesda/rain/record.ts");
    const { verifyRecord } = await import("../src/bethesda/rain/replay.ts");
    const raw = JSON.parse(text);
    const steps = verifyRecord(seal({ ...raw, rain_admission: null }));
    const deadline = performance.now() + 120_000;
    for (;;) {
      if (performance.now() > deadline)
        throw new Error("Replay exceeded its 120 second budget");
      const next = steps.next();
      if (next.done) {
        answer = next.value;
        break;
      }
    }
    if (!answer.ok) process.exitCode = 1;
  }
  console.log(JSON.stringify(answer, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Research operation failed");
  process.exitCode = 1;
}
