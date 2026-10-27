/** New research individuals only. No live endpoint, original checkpoint or deploy path. */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { sha256Json } from "../src/rain/sha256.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";
import { birth, checkpointLife, restoreLife } from "../src/bethesda/life/continuity.js";
import { LifeStore } from "../src/bethesda/life/store.js";
import { checkpointWithEvents } from "../src/bethesda/life/immortal/checkpoint.js";
import {
  FORAGING_RESEARCH_LIFE as KIND,
  foragingGenesis,
} from "../src/bethesda/life/foraging/life.js";
import {
  FORAGING_STUDY,
  assay,
  temporalAssay,
} from "../src/bethesda/life/foraging/study.js";

const check = process.argv.includes("--check"),
  dir = "docs/research/echo-foraging";
if (!check && execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("commit the implementation before generating scientific results");
const sourceCommit = check
  ? (
      JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as {
        sourceCommit: string;
      }
    ).sourceCommit
  : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const files = [
  "scripts/echo-foraging-evaluate.ts",
  "src/bethesda/life/headless.ts",
  "src/bethesda/fly/cityFly.ts",
  ...["immortal", "foraging"].flatMap((d) =>
    readdirSync(`src/bethesda/life/${d}`)
      .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
      .map((p) => `src/bethesda/life/${d}/${p}`),
  ),
].sort();
const sourceDigest = sha256Json({
  baseFly: FLY_SOURCE,
  files: files.map((p) => [p, readFileSync(p, "utf8")]),
});
const temporal = temporalAssay();
const rows: ReturnType<typeof assay>[] = [];
for (const seed of FORAGING_STUDY.evaluationSeeds)
  for (const stimulus of ["pulse", "spatial"] as const) {
    for (const enabled of [false, true]) rows.push(assay(seed, enabled, stimulus));
    process.stderr.write(`[echo-foraging] paired ${stimulus} seed ${seed}\n`);
  }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pulse = FORAGING_STUDY.evaluationSeeds.map((seed) => {
  const a = rows.find((r) => r.seed === seed && r.stimulus === "pulse" && r.enabled)!;
  const b = rows.find((r) => r.seed === seed && r.stimulus === "pulse" && !r.enabled)!;
  return a.onAlignment === null || b.onAlignment === null
    ? null
    : a.onAlignment - b.onAlignment;
});
const spatial = FORAGING_STUDY.evaluationSeeds.map((seed) => {
  const a = rows.find((r) => r.seed === seed && r.stimulus === "spatial" && r.enabled)!;
  const b = rows.find((r) => r.seed === seed && r.stimulus === "spatial" && !r.enabled)!;
  return { enabledM: a.closestSourceM, disabledM: b.closestSourceM };
});
const valid = pulse.filter((x): x is number => x !== null),
  alignmentGain = valid.length ? mean(valid) : null;
const reduction =
  1 - mean(spatial.map((r) => r.enabledM)) / mean(spatial.map((r) => r.disabledM));
const interpretation = {
  orientation: {
    meanAlignmentGain: alignmentGain,
    validPairs: valid.length,
    positivePairs: valid.filter((x) => x > 0).length,
    status:
      valid.length !== 8
        ? "inconclusive"
        : alignmentGain! >= 0.2 && valid.filter((x) => x > 0).length >= 6
          ? "criterion met"
          : "criterion not met",
  },
  sourceApproach: {
    meanClosestDistanceReduction: reduction,
    improvedPairs: spatial.filter((r) => r.enabledM < r.disabledM).length,
    status:
      reduction >= 0.2 && spatial.filter((r) => r.enabledM < r.disabledM).length >= 6
        ? "criterion met"
        : "criterion not met",
  },
  biologicalValidation:
    "not established; behavioral filter implementation and synthetic engineering assay only",
  newLearning:
    "not claimed: filters adapt to recent input; existing associative and predictive learning are retained",
};

const g = {
  ...foragingGenesis(2201),
  olfactoryNavigation: true,
  flags: { immortality: true, associativeLearning: true, predictiveSelfModel: true },
};
const life = KIND.build(g),
  path = mkdtempSync(join(tmpdir(), "echo-foraging-research-"));
let head = checkpointLife(KIND, life, {
  genesis: g,
  birth: birth(KIND.id, g, randomBytes(16).toString("hex")),
  previous: null,
});
const individual = head.birth.individual;
const store = LifeStore.create(path, KIND, head, { keepGraphs: 2 });
const continuity = [];
try {
  KIND.apply!(life, {
    tick: 0,
    kind: "food",
    data: { food: { site: "east", at: [0, 0] } },
  });
  for (const seconds of [60, 600, 3600]) {
    while (life.tick < seconds * 10) {
      life.advanceTicks(1);
      if (life.tick % 3000 === 0 || life.outbox.length >= 400)
        head = checkpointWithEvents(KIND, life, store, head);
    }
    head = checkpointWithEvents(KIND, life, store, head);
    const back = restoreLife(KIND, head);
    const before = KIND.hash(back);
    back.inspect();
    const observationPure = before === KIND.hash(back);
    back.advanceTicks(10);
    life.advanceTicks(10);
    continuity.push({
      checkpointSeconds: seconds,
      comparisonUntilSeconds: life.tick / 10,
      exactFutureRestore: KIND.hash(back) === KIND.hash(life),
      identityPreserved: head.birth.individual === individual,
      observationPure,
      archivedEvents: store.events().length,
      rejected: life.fly.state.counts.rejected,
      workingHistory: life.recent.length,
      pendingArchive: life.outbox.length,
      olfactoryState: { ...life.adapter.olfaction.state },
    });
    process.stderr.write(`[echo-foraging] continuity ${seconds}s verified\n`);
  }
} finally {
  store.release();
  rmSync(path, { recursive: true, force: true });
}

const report = {
  schema: "echo-foraging-report/v1",
  sourceCommit,
  sourceDigest,
  plan: FORAGING_STUDY,
  temporal,
  rows,
  interpretation,
  continuity,
  scope: "research only; original individual untouched; no live migration or deployment",
};
const summary =
  `# ECHO olfactory research results\n\nGenerated from \`${sourceCommit}\`; fingerprint \`${sourceDigest}\`.\n\n` +
  `| Check | Result |\n| --- | --- |\n` +
  `| Published-equation numerical comparison | ${temporal.passed ? "Passed" : "Failed"}; maximum error ${temporal.maxError.toExponential(3)} |\n` +
  `| Odor-window upwind alignment | ${interpretation.orientation.status}; mean gain ${alignmentGain?.toFixed(3)}, ${interpretation.orientation.positivePairs}/8 improved pairs |\n` +
  `| Synthetic source approach | ${interpretation.sourceApproach.status}; mean closest-distance reduction ${(reduction * 100).toFixed(1)}%, ${interpretation.sourceApproach.improvedPairs}/8 improved pairs |\n` +
  `| Motor command refusals | ${rows.reduce((n, r) => n + r.rejected, 0)} |\n` +
  `| ECHO prediction/command mismatches | ${rows.reduce((n, r) => n + r.predictionMismatches, 0)} in ${rows.reduce((n, r) => n + r.predictionChecks, 0)} walking checks |\n` +
  `| Identity and future behavior after restore | ${continuity.every((r) => r.identityPreserved && r.exactFutureRestore) ? "Passed" : "Failed"} at 60, 600 and 3,600 simulated seconds |\n\n` +
  `Eight paired evaluation seeds, two 60-second walking assays, enabled and disabled sensory extension. Every trajectory and failure is included in report.json. ` +
  `Criteria were fixed in the source before these evaluation seeds were run. This is not independent validation or a registered R.A.I.N. experiment.\n\n` +
  `The temporal model adapts to recent odor history; it does not add associative learning or demonstrate open-ended learning. The existing mushroom-body and ECHO models remain in the loop. ` +
  `There is no new spiking-neuron or connectome claim. These are reduced-order body results; MuJoCo locomotion remains unvalidated.\n\n` +
  `Reproduce: \`npm run echo:foraging:evaluate -- --check\`. Model and scope: [ECHO_OLFACTORY_NAVIGATION.md](../../ECHO_OLFACTORY_NAVIGATION.md).\n`;
mkdirSync(dir, { recursive: true });
for (const [name, data] of [
  ["report.json", JSON.stringify(report, null, 2) + "\n"],
  ["results.md", summary],
]) {
  const file = join(dir, name!);
  const text = await format(data!, {
    ...((await resolveConfig(file)) ?? {}),
    filepath: file,
  });
  if (check) {
    if (readFileSync(file, "utf8") !== text)
      throw new Error(`${name} does not reproduce`);
  } else writeFileSync(file, text);
}
if (
  !temporal.passed ||
  rows.some((r) => r.rejected || !r.finite || r.predictionMismatches) ||
  continuity.some(
    (r) => !r.identityPreserved || !r.exactFutureRestore || !r.observationPure,
  )
)
  process.exitCode = 1;
process.stderr.write(
  `[echo-foraging] ${check ? "reproduced" : "wrote"} results; orientation ${interpretation.orientation.status}; approach ${interpretation.sourceApproach.status}\n`,
);
