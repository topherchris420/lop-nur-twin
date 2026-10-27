/** Research only. Creates NEW host-nonced individuals in temporary stores.
 * Never accepts a production store path, deploys, or migrates an existing individual.
 * Run from a clean commit; --check reproduces the committed deterministic results. */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { sha256Json } from "../src/rain/sha256.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";
import { birth, checkpointLife, restoreLife } from "../src/bethesda/life/continuity.js";
import { LifeStore } from "../src/bethesda/life/store.js";
import {
  IMMORTAL_RESEARCH_LIFE as KIND,
  type ImmortalGenesis,
} from "../src/bethesda/life/immortal/life.js";
import { checkpointResearch } from "../src/bethesda/life/immortal/checkpoint.js";
import { Physiology } from "../src/bethesda/life/immortal/physiology.js";
import {
  STUDY_PLAN,
  STUDY_ARMS,
  studyGenesis,
  studyRun,
  evaluateStudy,
  type StudyRow,
} from "../src/bethesda/life/immortal/study.js";

const check = process.argv.includes("--check");
const root = process.cwd();
const dir = join(root, "docs/research/echo-immortal");
const files = [
  "scripts/echo-immortal-evaluate.ts",
  "src/bethesda/life/headless.ts",
  "src/bethesda/fly/cityFly.ts",
  ...readdirSync(join(root, "src/bethesda/life/immortal"))
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .map((p) => `src/bethesda/life/immortal/${p}`),
].sort();
const sourceDigest = sha256Json({
  baseFly: FLY_SOURCE,
  files: files.map((p) => [p, readFileSync(join(root, p), "utf8")]),
});
if (!check && execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("commit the implementation before generating scientific results");
const sourceCommit = check
  ? (
      JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as {
        sourceCommit: string;
      }
    ).sourceCommit
  : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function researchStore(g: ImmortalGenesis) {
  const path = mkdtempSync(join(tmpdir(), "echo-immortal-evaluation-"));
  const life = KIND.build(g);
  const first = checkpointLife(KIND, life, {
    genesis: g,
    birth: birth(KIND.id, g, randomBytes(16).toString("hex")),
    previous: null,
  });
  const store = LifeStore.create(path, KIND, first, { keepGraphs: 2 });
  let head = first;
  const commit = () => {
    head = checkpointResearch(life, store, head);
  };
  return {
    life,
    store,
    commit,
    head: () => head,
    cleanup: () => {
      try {
        store.release();
      } finally {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

const rows: StudyRow[] = [];
const continuity: {
  seed: number;
  arm: string;
  identityPreserved: boolean;
  exactRestore: boolean;
  archivedEvents: number;
}[] = [];
for (const seed of STUDY_PLAN.heldOutSeeds)
  for (const arm of STUDY_ARMS) {
    const run = researchStore(studyGenesis(seed, arm));
    try {
      const individual = run.head().birth.individual;
      const phases = studyRun(run.life, seed, arm, (life) => {
        if (life.tick % 3000 === 0 || life.outbox.length >= 400) run.commit();
      });
      run.commit();
      const back = restoreLife(KIND, run.head());
      const exactRestore = KIND.hash(back) === KIND.hash(run.life);
      rows.push({ seed, arm, phases });
      continuity.push({
        seed,
        arm,
        identityPreserved: run.head().birth.individual === individual,
        exactRestore,
        archivedEvents: run.store.events().length,
      });
      process.stderr.write(
        `[echo-immortal] seed ${seed}, ${arm}, restore ${exactRestore ? "verified" : "FAILED"}\n`,
      );
    } finally {
      run.cleanup();
    }
  }

// One full embodied hour, checkpoints and exact restart comparison at increasing intervals.
const longRun = researchStore(studyGenesis(2201, "persistent"));
const embodied: {
  simulatedSeconds: number;
  exactRestore: boolean;
  rejected: number;
  workingHistory: number;
  pending: number;
}[] = [];
try {
  for (const seconds of [60, 600, 3600]) {
    while (longRun.life.tick < seconds * 10) {
      longRun.life.advanceTicks(1);
      if (longRun.life.tick % 3000 === 0 || longRun.life.outbox.length >= 400)
        longRun.commit();
    }
    longRun.commit();
    const back = restoreLife(KIND, longRun.head());
    // Compare FUTURE behavior, not only the saved hash.
    back.advanceTicks(10);
    longRun.life.advanceTicks(10);
    embodied.push({
      simulatedSeconds: seconds,
      exactRestore: KIND.hash(back) === KIND.hash(longRun.life),
      rejected: longRun.life.fly.state.counts.rejected,
      workingHistory: longRun.life.recent.length,
      pending: longRun.life.outbox.length,
    });
  }
} finally {
  longRun.cleanup();
}

// Fast tissue-only endurance. Every second is computed: no fabricated offline experience.
const tissue = new Physiology(true);
let reserve = 0;
const tissueSamples: {
  simulatedSeconds: number;
  reserveJ: number;
  recoveryBouts: number;
  maintenanceJ: number;
  finite: boolean;
}[] = [];
let computed = 0;
for (const target of [3600, 86400, 604800, 31536000]) {
  for (; computed < target; computed++) {
    const mode = computed % 900 < 600 ? "flight" : "rest";
    reserve = Math.max(0, reserve - (mode === "flight" ? 0.000196 : 0.000025));
    reserve += tissue.advance(1, { mode, reserve, capacity: 1.41 });
  }
  tissueSamples.push({
    simulatedSeconds: computed,
    reserveJ: reserve,
    recoveryBouts: tissue.state.recoveryBouts,
    maintenanceJ: tissue.state.maintenanceJ,
    finite: Object.values(tissue.state).every(
      (v) => typeof v !== "number" || Number.isFinite(v),
    ),
  });
}

const report = {
  schema: "echo-immortal-report/v1",
  sourceCommit,
  sourceDigest,
  plan: STUDY_PLAN,
  rows,
  continuity,
  interpretation: evaluateStudy(rows),
  stability: { embodied, tissueOnly: tissueSamples },
  scope:
    "research individuals only; original live fly and checkpoints untouched; no live migration tested",
};
const summary =
  `# ECHO immortal research results\n\nGenerated from \`${sourceCommit}\`. Source fingerprint: \`${sourceDigest}\`.\n\n` +
  `Four arms, ${STUDY_PLAN.heldOutSeeds.length} held-out environment seeds, five sequential phases per individual, ${STUDY_PLAN.phaseSeconds} seconds per phase.\n\n` +
  `Adaptation criterion: **${report.interpretation.adaptation.status}**, ${report.interpretation.adaptation.validPairs} valid paired transfer latencies.\n\n` +
  `All research identities preserved: **${continuity.every((r) => r.identityPreserved)}**. All final restores exact: **${continuity.every((r) => r.exactRestore)}**.\n\n` +
  `Embodied endurance: ${embodied.map((r) => `${r.simulatedSeconds} s`).join(", ")}. Tissue-only endurance: ${tissueSamples.map((r) => `${r.simulatedSeconds} s`).join(", ")}. ` +
  `The one-year result covers the tissue model only, not a whole fly or a whole city.\n\n` +
  `Open-ended learning is **not demonstrated**. Independent biological validation is **not established**. See report.json for every arm, failed meal search, command rejection, retention measure, and divergence result.\n\n` +
  `Reproduce: \`npm run echo:immortal:evaluate -- --check\`. No production store path is accepted.\n`;
mkdirSync(dir, { recursive: true });
for (const [name, text] of [
  ["report.json", JSON.stringify(report, null, 2) + "\n"],
  ["results.md", summary],
]) {
  const path = join(dir, name!);
  const formatted = await format(text!, {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  if (check) {
    if (readFileSync(path, "utf8") !== formatted)
      throw new Error(`${name} does not reproduce`);
  } else writeFileSync(path, formatted);
}
if (
  continuity.some((r) => !r.exactRestore || !r.identityPreserved) ||
  embodied.some((r) => !r.exactRestore) ||
  tissueSamples.some((r) => !r.finite)
)
  process.exitCode = 1;
process.stderr.write(
  `[echo-immortal] ${check ? "reproduced" : "wrote"} report; ${report.interpretation.adaptation.status}\n`,
);
