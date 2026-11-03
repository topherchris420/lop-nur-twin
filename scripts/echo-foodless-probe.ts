/**
 * Does a research fly on the real map get inside solid buildings, and is that why
 * it stops eating? Read-only: it lives the same life as `city` in
 * echo-ranging-evaluate.ts and checks each simulated second whether the fly's
 * position is inside a solid. It writes one row per 3 simulated hours, and one
 * for each stay inside a solid of a minute or more, with the half minute before.
 *
 *   node scripts/run-ts.mjs scripts/echo-foodless-probe.ts --seeds 181 --hours 96 --out p.jsonl
 *
 * Research flies with no store: nothing here reaches an individual or an archive.
 */
import { appendFileSync } from "node:fs";
import { CITY_CONFIG } from "../src/bethesda/life/acquired/cityStudy.js";
import { guardWalls } from "../src/bethesda/life/acquired/wallGuard.js";
import { OrganismLife } from "../src/bethesda/life/organism.js";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = option("out");
const seeds = option("seeds")?.split(",").map(Number);
const hours = Number(option("hours") ?? 96);
if (!out || !seeds?.length) throw new Error("needs --seeds and --out");

/** One simulated second, and how long a fly has to stay inside to count. */
const SECOND_TICKS = 10;
const STAY_S = 60;
const RING_S = 30;
const write = (row: object) => appendFileSync(out, `${JSON.stringify(row)}\n`);
const dp = (v: number) => Math.round(v * 100) / 100;

for (const seed of seeds) {
  const life = new OrganismLife({ seed, ...CITY_CONFIG });
  const fly = life.cityFly.fly;
  const world = fly.world;
  const guard = process.argv.includes("--guarded") ? guardWalls(fly) : null;
  const ring: object[] = [];
  let before: object[] = [];
  let run = 0,
    staying = false,
    insideS = 0,
    entries = 0;
  const last = { meals: 0, flownM: 0 };
  const seconds = Math.round(hours * 3600);
  for (let t = 1; t <= seconds; t++) {
    life.advanceTicks(SECOND_TICKS);
    const s = fly.state;
    const inside = world.solid(s.p);
    if (inside && run === 0) before = [...ring];
    ring.push({
      t,
      p: s.p.map(dp),
      v: s.v.map(dp),
      mode: s.mode,
      why: (fly.lastCommand?.reason ?? "").slice(0, 60),
      inside,
    });
    if (ring.length > RING_S) ring.shift();
    if (inside) {
      insideS++;
      run++;
      if (run === STAY_S && !staying) {
        staying = true;
        entries++;
        const up = world.raycast(s.p, [0, 1, 0], 500);
        write({
          seed,
          kind: "entry",
          t: t - STAY_S + 1,
          h: (t - STAY_S + 1) / 3600,
          at: s.p.map(dp),
          in: up?.id ?? null,
          before,
        });
      }
    } else {
      if (staying) write({ seed, kind: "exit", t, h: t / 3600, at: s.p.map(dp) });
      staying = false;
      run = 0;
    }
    if (t % (3 * 3600) === 0) {
      const c = s.counts;
      write({
        seed,
        kind: "period",
        h: t / 3600,
        meals: c.meals - last.meals,
        flownM: c.flownM - last.flownM,
        insideS,
        entries,
        at: s.p.map(dp),
      });
      last.meals = c.meals;
      last.flownM = c.flownM;
      insideS = 0;
    }
  }
  if (guard) write({ seed, kind: "guard", ...guard });
  console.log(`seed ${seed}: ${entries} stays inside a solid`);
}
