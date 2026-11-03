/**
 * Does a fly learn how widely to search? See src/bethesda/life/acquired/ranging.ts
 * and rangingStudy.ts.
 *
 *   run: the crossover, by seed.
 *     node scripts/run-ts.mjs scripts/echo-ranging-evaluate.ts run --seeds 121 --out y.jsonl
 *       [--trained near,far,mixed] [--split dev|heldout] [--design '{"trainH":48}']
 *   city: research flies on the real map.
 *     node scripts/run-ts.mjs scripts/echo-ranging-evaluate.ts city --seeds 141 --out c.jsonl
 *       [--arms organism,learner,roam] [--hours 96] [--every 3] [--guarded]
 *   analyse, analyse-city [--from 24]: the report, from any number of those files.
 *
 * Research flies with no store: nothing here reaches an individual or an archive.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  analyseRanging,
  analyseRangingCity,
  RANGING_DESIGN,
  runRanging,
  runRangingCity,
  type RangingCityArm,
  type RangingCityResult,
  type RangingDesign,
  type RangingResult,
  type TrainWorld,
} from "../src/bethesda/life/acquired/rangingStudy.js";

const at = process.argv.findIndex((a) => a.endsWith("echo-ranging-evaluate.ts"));
const [mode, ...rest] = process.argv.slice(at + 1);

function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const files = () => {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--guarded") continue;
    if (rest[i]!.startsWith("--")) i++;
    else out.push(rest[i]!);
  }
  return out;
};
const read = <T>(): T[] =>
  files().flatMap((file) =>
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as T),
  );

const out = option("out");
const seeds = option("seeds")?.split(",").map(Number);

if (mode === "run") {
  if (!out || !seeds?.length) throw new Error("run needs --seeds and --out");
  const trained = (option("trained")?.split(",") ?? ["near", "far"]) as TrainWorld[];
  const design: RangingDesign = {
    ...RANGING_DESIGN,
    ...(option("design")
      ? (JSON.parse(option("design")!) as Partial<RangingDesign>)
      : {}),
    split: option("split") === "heldout" ? "heldout" : "dev",
  };
  for (const seed of seeds)
    for (const world of trained) {
      const r = runRanging(seed, world, design);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(
        `seed ${seed} trained ${world}: ${r.training.meals} meals, settled on ${r.training.settledOn}, ${Math.round(r.wallS)} s`,
      );
    }
} else if (mode === "city") {
  if (!out || !seeds?.length) throw new Error("city needs --seeds and --out");
  const arms = (option("arms")?.split(",") ?? [
    "organism",
    "learner",
    "roam",
  ]) as RangingCityArm[];
  const hours = Number(option("hours") ?? 96);
  const every = Number(option("every") ?? 3);
  const guarded = rest.includes("--guarded");
  for (const seed of seeds)
    for (const arm of arms) {
      const r = runRangingCity(seed, arm, hours, every, guarded);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(`seed ${seed} ${arm}: ${Math.round(r.wallS)} s`);
    }
} else if (mode === "analyse") {
  console.log(JSON.stringify(analyseRanging(read<RangingResult>()), null, 2));
} else if (mode === "analyse-city") {
  const from = Number(option("from") ?? 0);
  console.log(
    JSON.stringify(analyseRangingCity(read<RangingCityResult>(), from), null, 2),
  );
} else {
  throw new Error("say run, city, analyse or analyse-city");
}
