/** Recompute our public, original workflow evidence without models or execution authority. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256Json } from "../src/rain/sha256.js";
import type { DiscoveryEntry } from "../src/rain/autonomy/store.js";
import { buildScientificKnowledge } from "../src/rain/research/scientificKnowledge.js";
import { learningView } from "../src/rain/research/learning.js";
import { validateLearningEvaluation } from "../src/rain/research/learningEvaluation.js";
import type { LearningEvaluation } from "../src/bethesda/rain/learningProtocol.js";
import { verifyNumericalRecord } from "../src/rain/scientific/numerical.js";

const root = resolve(process.argv[3] ?? "docs/rea-research/evaluations");
let records = 0,
  evaluations = 0,
  bundles = 0;
for (const name of readdirSync(root)) {
  const dir = join(root, name);
  if (!existsSync(join(dir, "journal.json"))) continue;
  const load = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  const entries = load("journal.json") as DiscoveryEntry[];
  const graph = buildScientificKnowledge(entries); // verifies the complete journal chain
  if (sha256Json(graph) !== sha256Json(load("graph.json")))
    throw new Error(name + ": graph reconstruction differs");
  const report = load("demonstration.json");
  if (
    report.journal_head_sha256 !== (entries.at(-1)?.sha256 ?? null) ||
    sha256Json(report.learning) !== sha256Json(learningView(entries))
  )
    throw new Error(name + ": report does not match authoritative journal");
  for (const entry of entries) {
    if (entry.kind === "scientific-record") {
      const result = verifyNumericalRecord(entry.payload);
      if (!result.ok)
        throw new Error(name + ": numerical replay failed: " + result.errors.join("; "));
      records++;
    }
    if (entry.kind === "learning-evaluation") {
      if (
        !validateLearningEvaluation(
          entries.slice(0, entry.sequence),
          entry.payload as LearningEvaluation,
        )
      )
        throw new Error(name + ": independent learning rescore failed");
      evaluations++;
    }
  }
  bundles++;
}
if (!bundles || !records || !evaluations)
  throw new Error("No complete numerical and learning evidence found");
console.log(
  JSON.stringify({
    bundles,
    numerical_replays: records,
    independent_learning_rescores: evaluations,
    status: "verified",
  }),
);
