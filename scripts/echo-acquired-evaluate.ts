/**
 * The acquired-search study (src/bethesda/life/acquired/study.ts): research
 * flies only. It reads no store and touches no life.
 *
 *   run: one JSON line per fly, appended, so a stopped run keeps what it has.
 *     node scripts/run-ts.mjs scripts/echo-acquired-evaluate.ts run \
 *       --seeds 21,22 --out flies.jsonl [--rules shade,sun] [--split dev]
 *   analyse: the report, from any number of those files.
 *     node scripts/run-ts.mjs scripts/echo-acquired-evaluate.ts analyse a.jsonl b.jsonl
 *   persist: does a preference last, and can later life change it?
 *     node scripts/run-ts.mjs scripts/echo-acquired-evaluate.ts persist \\
 *       --seeds 81,82 --later any --out persist.jsonl   (or --later reversed)
 *   analyse-persist: the report, from any number of those files.
 *   city: the same seeds as the organism and with the layer, on the real map.
 *     node scripts/run-ts.mjs scripts/echo-acquired-evaluate.ts city \
 *       --seeds 61,62 --out city.jsonl [--arms organism,layer] [--hours 48] [--every 3]
 *   analyse-city: layer against organism by seed, after --from hours.
 *     node scripts/run-ts.mjs scripts/echo-acquired-evaluate.ts analyse-city a.jsonl --from 24
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  analyseCity,
  runCity,
  type CityArm,
  type CityResult,
} from "../src/bethesda/life/acquired/cityStudy.js";
import {
  DEV_DESIGN,
  analyse,
  analysePersistence,
  runPersistence,
  runSubject,
  type LaterLife,
  type PersistenceResult,
  type StudyDesign,
  type SubjectResult,
} from "../src/bethesda/life/acquired/study.js";
import type { FoodRule, TrainingRule } from "../src/bethesda/life/acquired/yard.js";

const at = process.argv.findIndex((a) => a.endsWith("echo-acquired-evaluate.ts"));
const [mode, ...rest] = process.argv.slice(at + 1);

function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

if (mode === "run") {
  const out = option("out");
  const seeds = option("seeds")?.split(",").map(Number);
  if (!out || !seeds?.length || seeds.some((s) => !Number.isInteger(s)))
    throw new Error("run needs --seeds and --out");
  const rules = (option("rules") ?? "shade,sun").split(",") as TrainingRule[];
  const design: StudyDesign = {
    ...DEV_DESIGN,
    ...(option("design") ? (JSON.parse(option("design")!) as Partial<StudyDesign>) : {}),
    split: option("split") === "heldout" ? "heldout" : "dev",
  };
  for (const seed of seeds)
    for (const rule of rules) {
      const r = runSubject(seed, rule, design);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(
        `seed ${seed} ${rule}: ${r.training.counted} meals, sunlit lift ${r.training.sunlitLift.toFixed(2)}, ${Math.round(r.wallS)} s`,
      );
    }
} else if (mode === "persist") {
  const out = option("out");
  const seeds = option("seeds")?.split(",").map(Number);
  const later = option("later") as LaterLife | undefined;
  if (!out || !seeds?.length || (later !== "any" && later !== "reversed"))
    throw new Error("persist needs --seeds, --later any|reversed and --out");
  const design: StudyDesign = {
    ...DEV_DESIGN,
    ...(option("design") ? (JSON.parse(option("design")!) as Partial<StudyDesign>) : {}),
    split: option("split") === "heldout" ? "heldout" : "dev",
  };
  for (const seed of seeds)
    for (const rule of ["shade", "sun"] as FoodRule[]) {
      const r = runPersistence(seed, rule, later, design);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(`seed ${seed} ${rule} ${later}: ${Math.round(r.wallS)} s`);
    }
} else if (mode === "analyse-persist") {
  const rows = rest.flatMap((file) =>
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PersistenceResult),
  );
  console.log(JSON.stringify(analysePersistence(rows), null, 2));
} else if (mode === "city") {
  const out = option("out");
  const seeds = option("seeds")?.split(",").map(Number);
  if (!out || !seeds?.length || seeds.some((s) => !Number.isInteger(s)))
    throw new Error("city needs --seeds and --out");
  const arms = (option("arms") ?? "organism,layer").split(",") as CityArm[];
  const hours = Number(option("hours") ?? 48);
  const every = Number(option("every") ?? 3);
  for (const seed of seeds)
    for (const arm of arms) {
      const r = runCity(seed, arm, hours, every);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(`seed ${seed} ${arm}: ${Math.round(r.wallS)} s`);
    }
} else if (mode === "analyse-city") {
  const files = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--from");
  const rows = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as CityResult),
  );
  console.log(JSON.stringify(analyseCity(rows, Number(option("from") ?? 24)), null, 2));
} else if (mode === "analyse") {
  const rows = rest.flatMap((file) =>
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SubjectResult),
  );
  console.log(JSON.stringify(analyse(rows, DEV_DESIGN.testS), null, 2));
} else {
  throw new Error("say run, analyse, persist, analyse-persist, city or analyse-city");
}
