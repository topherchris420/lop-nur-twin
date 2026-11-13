/** Frozen CPU validation + equal-budget policy ablation. No paid or model resources. */
import { mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { gitState } from "../src/rain/experiments/provenance.js";
import { sha256Json, canonicalJson } from "../src/rain/sha256.js";
import {
  validateIntelligencePlan,
  type CpuDesign,
  type IntelligencePlan,
} from "../src/rain/research/intelligence.js";
import {
  exportCpuCampaign,
  prepareCpuCampaign,
  runCpuCampaign,
} from "../src/rain/research/intelligenceCampaign.js";
import { createCpuExecutor } from "../server/rain/cpuWorker.js";

const args = process.argv.slice(2),
  value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
const designs: CpuDesign[] = [
  {
    id: "qnp-sequential-null",
    adapter: "qnp-stable",
    parameters: { method: "sequential" },
    cost_units: 1,
    predictions: { calibrated: 0.95, multiplicity: 0.95 },
    minimum_rate: 0.75,
    hypothesis: "At least 75% of stable binomial sessions produce no false alert.",
    falsification:
      "The simultaneous fixed-n upper bound on correctly quiet sessions is below 75%.",
  },
  {
    id: "qnp-fixed-null",
    adapter: "qnp-stable",
    parameters: { method: "fixed" },
    cost_units: 1,
    predictions: { calibrated: 0.95, multiplicity: 0.15 },
    minimum_rate: 0.75,
    hypothesis:
      "An unadjusted repeated per-batch fixed test leaves at least 75% of stable sessions quiet.",
    falsification:
      "The fixed-n upper bound is below 75%; a favorable individual batch cannot rescue the claim.",
  },
  {
    id: "drr-permutation-null",
    adapter: "drr-null",
    parameters: { surrogate_method: "permutation" },
    cost_units: 4,
    predictions: { calibrated: 0.95, multiplicity: 0.2 },
    minimum_rate: 0.75,
    hypothesis:
      "At least 75% of independent autocorrelated null signal pairs produce no discovered edge.",
    falsification:
      "The fixed-n upper bound on correctly rejected null pairs is below 75%.",
  },
  {
    id: "drr-circular-null",
    adapter: "drr-null",
    parameters: { surrogate_method: "circular_shift" },
    cost_units: 4,
    predictions: { calibrated: 0.95, multiplicity: 0.85 },
    minimum_rate: 0.75,
    hypothesis:
      "At least 75% of independent autocorrelated null pairs produce no edge with circular surrogates.",
    falsification:
      "The fixed-n upper bound is below 75%; this test does not establish nominal 5% calibration.",
  },
];
function plan(
  policy: IntelligencePlan["policy"],
  base: number,
  budget: number,
): IntelligencePlan {
  return validateIntelligencePlan({
    schema: "rain-intelligence-plan/v1",
    question:
      "Which inexpensive experiment exposes incorrect inference on known-null simulated systems?",
    rivals: { calibrated: 0.5, multiplicity: 0.5 },
    designs,
    screen_seeds: Array.from({ length: 64 }, (_, i) => base + i),
    confirm_seeds: Array.from({ length: 128 }, (_, i) => base + 1000 + i),
    family_alpha: 0.05,
    budget_units: budget,
    timeout_seconds: 120,
    policy,
    parent_campaigns: [],
  });
}
const study = {
  schema: "rain-intelligence-study/v1",
  development_seeds:
    "84000..84079 were development only; campaign seed derivation uses distinct frozen bases",
  cases: [
    { name: "fifo", plan: plan("fifo", 110000, 192) },
    { name: "information", plan: plan("information", 210000, 192) },
    { name: "full-validation", plan: plan("information", 310000, 1920) },
  ],
  primary:
    "Number of predeclared incorrect scientific claims falsified in BOTH panels per 192 work units; information must exceed FIFO.",
  independent_reference:
    "The repeated unadjusted binomial test has an analytically computable stable-session false-alert probability; simulation and independent numeric e-value checks must agree with their assumptions.",
  decision_rule:
    "Both screening and independent-seed confirmation must falsify an operational claim; errors and inconclusive panels count as zero falsifications.",
  limitations: [
    "The FIFO arm is a matched policy ablation on a NEW CPU backend, not an end-to-end baseline of prior Bethesda R.A.I.N.",
    "Declared rival predictions intentionally encode the repeated-testing concern. This tests use of supplied models, not autonomous discovery of those probabilities.",
    "One frozen benchmark instance and one independent-seed replicate panel; no population-level proof of general scheduler superiority.",
    "Full validation also measures DRR short-signal null failures. Neither a 75% correctness criterion nor a non-falsified interval proves nominal 5% error control.",
  ],
};
const python = value("--python"),
  qnp = value("--qnp"),
  drr = value("--drr");
if (!python || !qnp || !drr)
  throw new Error(
    "Provide explicit --python, --qnp and --drr paths; use --draft before --execute-reviewed DIGEST",
  );
const executor = createCpuExecutor({
  repositoryRoot: process.cwd(),
  python,
  repositories: { "quantum-noise-profiler": qnp, "dynamic-resonance-rooting": drr },
});
const digest = sha256Json({ study, binding: executor.binding });
if (args.includes("--draft")) {
  console.log(
    canonicalJson(
      args.includes("--digest-only")
        ? { approval_sha256: digest }
        : {
            study,
            binding_sha256: sha256Json(executor.binding),
            approval_sha256: digest,
          },
    ),
  );
} else {
  if (value("--execute-reviewed") !== digest)
    throw new Error("Exact full study and execution-binding digest required");
  const dir = resolve(value("--dir") ?? ".rain-research/intelligence-study"),
    store = new ResearchStore(dir);
  if (store.discoveryEntries().length)
    throw new Error(
      "The controlled study requires a fresh journal; do not rerun exposed holdouts",
    );
  const git = gitState(process.cwd(), [dir]);
  if (!git.commit || git.dirty === null)
    throw new Error("Unknown producing code revision");
  const producer = {
    commit: git.commit,
    dirty: git.dirty,
    source_sha256: sha256Json(executor.binding),
  };
  const release = store.acquireLock("cpu-study-registration");
  try {
    store.appendDiscovery("cpu-study", "cpu-study-registered", {
      study,
      digest,
      binding_sha256: sha256Json(executor.binding),
      producer,
    });
  } finally {
    release();
  }
  const results = [];
  for (const item of study.cases) {
    const prepared = prepareCpuCampaign(store, item.plan, executor, producer);
    const report = await runCpuCampaign(
      store,
      prepared.id,
      prepared.approval_sha256,
      executor,
      { reviewed: true },
    );
    const exported = exportCpuCampaign(store, prepared.id);
    results.push({
      case: item.name,
      prepared,
      report,
      exported: {
        evidence: exported.evidence,
        observatory: exported.observatory,
        script: exported.script,
      },
    });
    console.log(
      JSON.stringify({
        checkpoint: item.name,
        status: report.status,
        completed_units: report.budget.completed_units,
      }),
    );
  }
  const counts = results.map((r) => ({
    case: r.case,
    units: r.report.budget.completed_units,
    falsified_claims: r.report.designs.filter(
      (d) => d.screen?.verdict === "falsified" && d.confirmation?.verdict === "falsified",
    ).length,
  }));
  const summary = {
    schema: "rain-intelligence-study-result/v1",
    registration_sha256: digest,
    producer,
    counts,
    primary_passed: counts[1]!.falsified_claims > counts[0]!.falsified_claims,
    results,
    limitations: study.limitations,
  };
  const releaseFinal = store.acquireLock("cpu-study-report");
  try {
    store.appendDiscovery("cpu-study", "cpu-study-result", summary);
  } finally {
    releaseFinal();
  }
  const publish = value("--publish-dir");
  if (publish) {
    const target = resolve(publish);
    if (
      !target.startsWith(resolve(process.cwd()) + "/") &&
      !target.startsWith(resolve(process.cwd()) + "\\")
    )
      throw new Error("Publish inside the producing repository");
    mkdirSync(target);
    writeFileSync(join(target, "summary.json"), canonicalJson(summary), { flag: "wx" });
    for (const result of results) {
      const folder = join(target, result.case);
      mkdirSync(folder);
      writeFileSync(
        join(folder, "index.html"),
        store.readResearchArtifact(result.exported.observatory.path),
        { flag: "wx" },
      );
      writeFileSync(
        join(folder, "evidence.json"),
        store.readResearchArtifact(result.exported.evidence.path),
        { flag: "wx" },
      );
      writeFileSync(
        join(folder, "observatory.js"),
        store.readResearchArtifact(result.exported.script.path),
        { flag: "wx" },
      );
    }
    cpSync(store.root, join(target, "archive"), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    const primary = results[1]!;
    writeFileSync(
      join(target, "index.html"),
      store.readResearchArtifact(primary.exported.observatory.path),
      { flag: "wx" },
    );
    writeFileSync(
      join(target, "evidence.json"),
      store.readResearchArtifact(primary.exported.evidence.path),
      { flag: "wx" },
    );
    writeFileSync(
      join(target, "observatory.js"),
      store.readResearchArtifact(primary.exported.script.path),
      { flag: "wx" },
    );
  }
  console.log(
    "RESULT " + JSON.stringify({ primary_passed: summary.primary_passed, counts }),
  );
}
