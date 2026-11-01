/**
 * The digital fly's calibration against published recordings of real flies
 * (src/bethesda/fly/calibration/).
 *
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts                run every paradigm, write the report
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --check        exit 1 unless a fresh run reproduces it
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --fit          refit the circuit models' fitted values
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --fit --check  exit 1 unless a refit reproduces fit.json
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --seal         seal the 2026-11 held-out set (once; never rewritten)
 *
 * Everything is seeded, so a run reproduces byte for byte. The report is
 * docs/benchmarks/fly-calibration/report.json and its README.md; the fit is
 * fit.json beside them, and the fitted values in
 * src/bethesda/fly/circuits/params.ts must be its (a test holds them to it).
 * Rerun both after any change to the fly, its controllers or the paradigms,
 * from a clean commit, and commit what they write; never edit them by hand.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { CIRCUIT_DESCRIPTOR } from "../src/bethesda/fly/circuits/controller.js";
import {
  fitGiantFiber,
  fitGroomDrive,
  GF_FIT_TRIALS,
} from "../src/bethesda/fly/calibration/fit.js";
import {
  calibrationReport,
  renderReadme,
} from "../src/bethesda/fly/calibration/report.js";
import { fitV2 } from "../src/bethesda/fly/calibration/fitV2.js";
import { V2_DESCRIPTOR } from "../src/bethesda/fly/circuits/v2/controller.js";
import {
  canonical,
  HOLDOUT_ACCEPTANCE,
  sealEntries,
  sha256,
  sourceDigest,
  V2_SOURCES,
} from "../src/bethesda/fly/calibration/holdoutSeal.js";

const root = process.cwd();
const dir = join(root, "docs/benchmarks/fly-calibration");
const check = process.argv.includes("--check");
const log = (line: string) => console.log(`[fly-calibration] ${line}`);

async function emit(name: string, text: string): Promise<boolean> {
  const path = join(dir, name);
  const formatted = await format(text, {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  let before: string | null = null;
  try {
    before = readFileSync(path, "utf8");
  } catch {
    before = null;
  }
  if (check) {
    if (before !== formatted) {
      console.error(`[fly-calibration] ${name} does not reproduce`);
      return false;
    }
    log(`${name} reproduces`);
    return true;
  }
  mkdirSync(dir, { recursive: true });
  if (before !== formatted) writeFileSync(path, formatted);
  log(`${before === formatted ? "unchanged" : "wrote"} ${name}`);
  return true;
}

const SEAL = "holdout-2026-11.json";
/** The design note circuit-informed/v2 was built from, written before the set was read. */
const DESIGN_NOTE = "docs/research/fly-circuit-v2-design-note.md";
const v2Digests = () =>
  Object.fromEntries(
    V2_SOURCES.map((f) => [f, sourceDigest(readFileSync(join(root, f), "utf8"))]),
  );

if (process.argv.includes("--seal")) {
  // The seal is written once: a second run may only confirm it.
  let existing: string | null = null;
  try {
    existing = readFileSync(join(dir, SEAL), "utf8");
  } catch {
    existing = null;
  }
  const entries = sealEntries();
  if (existing !== null) {
    const sealed = JSON.parse(existing) as ReturnType<typeof sealEntries>;
    const same =
      canonical(sealed.observations) === canonical(entries.observations) &&
      canonical(sealed.paradigms) === canonical(entries.paradigms) &&
      canonical(sealed.excluded) === canonical(entries.excluded);
    if (!same) {
      console.error(
        `[fly-calibration] ${SEAL} exists and holdout.ts no longer matches it`,
      );
      process.exit(1);
    }
    log(`${SEAL} exists and holdout.ts matches it; it is never rewritten`);
    process.exit(0);
  }
  const seal = {
    schema: "fly-calibration-holdout/v1",
    set: "holdout-2026-11",
    registered: "2026-11-01",
    statement:
      "Observations from papers the calibration had not used, registered and sealed before circuit-informed/v2 was committed or run on any of their paradigms. Every observation is held out for every controller: nothing in any controller was set from it.",
    disclosure: [
      `circuit-informed/v2's five mechanisms, its parameter table, its fit procedure (calibration/fitV2.ts) and its design note (${DESIGN_NOTE}) were written before the candidate observations were read. The candidates were gathered by a separate agent from open full texts; their values were first seen when this set was chosen from them.`,
      "After the candidates were read, v2's sources changed only by the fitted values that fit procedure reached on development observations (fit.json) and by Prettier's formatting (line breaks, trailing commas, one pair of parentheses).",
      "preReading records digests taken at its time, before the candidates were read, of files not yet committed: this account's own record, not independent evidence. Since then: controller.ts changed by its descriptor (one reworded phrase, and a VFB link removed because the pinned reference does not hold it), after those digests and before reading, and by the formatting above; params.ts by its fitted values and that formatting (with the formatting and those edits undone, each reproduced its digest); roles.ts by a corrected comment. observations.ts, paradigms.ts and report.ts were extended to carry the set: observations.ts spreads it in and corrects wording, paradigms.ts exports two helpers and adds the body's yaw to each frame, report.ts measures and reports it. The other files listed are unchanged, among them compare.ts, which gives the verdicts. v2.sources holds the digests as sealed.",
      "A preview of the fit started before those digests and finished after them; the official fit, run on the final code, reached the same seven values.",
      "The implementation departs from the design note in three places, all before the set was read: the mean freeze is a model value derived from Zacarias et al.'s words (100 s) rather than fitted; 'a surface over it within enclosedM' became the paradigm's statement Setting.enclosed, as the note's own last bullet on it describes; and the note planned to commit the set before any v2 code, whereas both are committed together, in the order of work stated here.",
      "The set was chosen by what the simulator can rebuild, with the reasons for each candidate left out recorded below; it was not chosen by any controller's result.",
      "The held-out paradigms were written after the set was chosen and debugged on the reduced-order and circuit-informed/v1 controllers only (which have no fitted value from these papers). That debugging raised the chamber flights of Maya et al. from 300 to 3000, since few cross its central cube. circuit-informed/v2 is run on these paradigms for the first time for the report.",
    ],
    acceptance: HOLDOUT_ACCEPTANCE,
    designNote: {
      path: DESIGN_NOTE,
      sha256: sourceDigest(readFileSync(join(root, DESIGN_NOTE), "utf8")),
    },
    preReading: {
      takenAt: "2026-11-01T08:11:45Z",
      sha256: {
        "src/bethesda/fly/circuits/v2/controller.ts":
          "c533d785219c6a49d9a5ff85a2c4abe0908a81e6e50ccc20694710e555919981",
        "src/bethesda/fly/circuits/v2/params.ts":
          "08014f26dae1c302b487365afcdd32b9d82f987adee7caae90afbcedac1e6dd5",
        "src/bethesda/fly/circuits/v2/v2.test.ts":
          "8679dac7b8feb606f97136f723305d777ec7b3ecc72d2be7e4c9ceb99fc0bcd5",
        "src/bethesda/fly/calibration/fitV2.ts":
          "4ed4e7226d89f47bd86c7cc9a3e71feb0e995c456c721724d12921bf5f1d25c2",
        "src/bethesda/fly/calibration/roles.ts":
          "d388c34dbd393e88716c741b55ea0592f4eeed8da6a5431c5a94c0ee46ac0b65",
        "src/bethesda/fly/calibration/calibration.test.ts":
          "df2cad85d1ca588152df4a8b5e7eec8ddc8b6349fdee1956e0d04d496492bbeb",
        "src/bethesda/fly/calibration/compare.ts":
          "bdc87714b9fc6e8d1e2c67b99c49e5078a6067e3b0754390371af0769bd1d416",
        "src/bethesda/fly/calibration/ethogram.ts":
          "63fa4d543cc9a5673cbf978fdac23540b1f42bdc65656ef2445ba2bcb1b86cb2",
        "src/bethesda/fly/calibration/fit.ts":
          "9a62de0e9fed9add21cf320944ffdc9a0c0a36dd9450c35b2cf2fefc645acdf2",
        "src/bethesda/fly/calibration/groomingReference.ts":
          "78d08988bc3d94d65fd2163a92eaa10b5c22374cb4c099659d3879db67e9b0ec",
        "src/bethesda/fly/calibration/observations.ts":
          "2d36358a343cd7f6f41c93b4757eeff792254eb8a3bd242bddf36cb8efcee7bc",
        "src/bethesda/fly/calibration/paradigms.ts":
          "19189789152d6a5602c4e26d5dec972286bd27b72620daf44c2cb4200bf62ebf",
        "src/bethesda/fly/calibration/report.ts":
          "b2d313a50789e85db0fdc87a3cd878351e6b1c52a346840b75d5c1717d577bdf",
        "src/bethesda/fly/calibration/stimuli.ts":
          "3f61a714ffcdfb389c1551f2f6e6239da1aafffd41ca77c2249cde4fefbb2e23",
        "src/bethesda/fly/calibration/subjects.ts":
          "57042ca5d231de8720c5675f3f45a8d7254d3e04864d777f3a9b1d735b79496c",
        "src/bethesda/fly/calibration/worlds.ts":
          "ad2db9eb5ff6138aa8e1c4a6156bcf92df4fbd037cdbc8aeee181bc6236643b6",
        [DESIGN_NOTE]: "93372076cc23cd4b056368c8455be13773d889ade98bd3cd389086a620437eed",
      },
    },
    v2: { controller: V2_DESCRIPTOR.id, sources: v2Digests() },
    ...entries,
    digest: sha256(canonical(entries)),
  };
  mkdirSync(dir, { recursive: true });
  const path = join(dir, SEAL);
  writeFileSync(
    path,
    await format(JSON.stringify(seal), {
      ...((await resolveConfig(path)) ?? {}),
      filepath: path,
    }),
  );
  log(`sealed ${entries.observations.length} observations in ${SEAL}`);
  process.exit(0);
}

if (process.argv.includes("--fit")) {
  const giantFiber = fitGiantFiber(GF_FIT_TRIALS, log);
  const grooming = fitGroomDrive(log);
  const v2 = fitV2(log);
  const fit = {
    schema: "fly-calibration-fit/v2",
    flyVersion: FLY_VERSION,
    controller: CIRCUIT_DESCRIPTOR.id,
    giantFiber,
    grooming,
    v2: { controller: V2_DESCRIPTOR.id, ...v2 },
  };
  if (!(await emit("fit.json", JSON.stringify(fit)))) process.exit(1);
} else {
  const fit = JSON.parse(readFileSync(join(dir, "fit.json"), "utf8")) as unknown;
  const report = calibrationReport(log);
  const json = JSON.stringify(report);
  // The commit the report says it ran from: the one --check compares against keeps its own.
  const commit = check
    ? (/from ([0-9a-f]{7,40}|a working tree)/.exec(
        readFileSync(join(dir, "README.md"), "utf8"),
      )?.[1] ?? "")
    : execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim()
      ? "a working tree"
      : execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  // Is the v2 this report scores the one the held-out set was sealed against?
  const seal = JSON.parse(readFileSync(join(dir, SEAL), "utf8")) as {
    v2: { sources: Record<string, string> };
  };
  const now = v2Digests();
  const changed = V2_SOURCES.filter((f) => seal.v2.sources[f] !== now[f]);
  const sealLine = changed.length
    ? `circuit-informed/v2's sources have changed since the held-out set was sealed (${changed.map((f) => `\`${f}\``).join(", ")}): its held-out rows are not a test of the sealed controller.`
    : "circuit-informed/v2's sources are byte for byte (line endings aside) those the held-out set was sealed against.";
  const ok =
    (await emit("report.json", json)) &&
    (await emit("README.md", renderReadme(report, fit, commit, sealLine)));
  if (!ok) process.exit(1);
}
