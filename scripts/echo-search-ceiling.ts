/**
 * Could searching differently pay at all? See src/bethesda/life/acquired/ceiling.ts.
 *
 *   yard: each setting in each kind of yard, by seed.
 *     node scripts/run-ts.mjs scripts/echo-search-ceiling.ts yard --seeds 101,102 --out y.jsonl
 *   city: each setting on the real map, by seed.
 *     node scripts/run-ts.mjs scripts/echo-search-ceiling.ts city --seeds 101 --arms long --out c.jsonl
 *   analyse-yard, analyse-city [--from 24]: the report, from any number of those files.
 *
 * Research flies with no store: nothing here reaches an individual or an archive.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  analyseCityCeiling,
  analyseYardCeiling,
  FOOD_WORLD_NAMES,
  runCityCeiling,
  runYardCeiling,
  SEARCH_ARM_NAMES,
  type CityCeilingResult,
  type FoodWorld,
  type SearchArm,
  type YardCeilingResult,
} from "../src/bethesda/life/acquired/ceiling.js";

const at = process.argv.findIndex((a) => a.endsWith("echo-search-ceiling.ts"));
const [mode, ...rest] = process.argv.slice(at + 1);

function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const files = () => {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
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
const arms = (option("arms")?.split(",") ?? SEARCH_ARM_NAMES) as SearchArm[];

if (mode === "yard") {
  if (!out || !seeds?.length) throw new Error("yard needs --seeds and --out");
  const worlds = (option("worlds")?.split(",") ?? FOOD_WORLD_NAMES) as FoodWorld[];
  const hours = Number(option("hours") ?? 8);
  for (const seed of seeds)
    for (const world of worlds)
      for (const arm of arms) {
        const r = runYardCeiling(seed, arm, world, hours);
        appendFileSync(out, `${JSON.stringify(r)}\n`);
        console.log(`seed ${seed} ${world} ${arm}: ${Math.round(r.wallS)} s`);
      }
} else if (mode === "city") {
  if (!out || !seeds?.length) throw new Error("city needs --seeds and --out");
  const hours = Number(option("hours") ?? 48);
  const every = Number(option("every") ?? 3);
  for (const seed of seeds)
    for (const arm of arms) {
      const r = runCityCeiling(seed, arm, hours, every);
      appendFileSync(out, `${JSON.stringify(r)}\n`);
      console.log(`seed ${seed} ${arm}: ${Math.round(r.wallS)} s`);
    }
} else if (mode === "analyse-yard") {
  console.log(JSON.stringify(analyseYardCeiling(read<YardCeilingResult>()), null, 2));
} else if (mode === "analyse-city") {
  const from = Number(option("from") ?? 0);
  console.log(
    JSON.stringify(analyseCityCeiling(read<CityCeilingResult>(), from), null, 2),
  );
} else {
  throw new Error("say yard, city, analyse-yard or analyse-city");
}
