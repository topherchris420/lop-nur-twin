/**
 * Increasingly long lives for the organism, on the small test city (not the
 * deployed individual): a fresh ECHO v3 fly, continued as the organism, then
 * lived in runs of 1,000, 10,000, 100,000 and 1,200,000 ticks (1.52 simulated
 * days in all, every tick computed). Each run ends in a checkpoint that must
 * verify, chain and restore exactly; the next run continues from the restored
 * copy, as a restarted runner does.
 *   node scripts/run-ts.mjs <this file>
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = pathToFileURL(`${process.env.REHEARSAL_REPO}/`).href;
const OUT = `${process.env.REHEARSAL_SCRATCH}/rehearsal/out`;
const here = (f: string) => import(REPO + f);
const { birth, checkpointErrors, checkpointLife, restoreLife } = await here(
  "src/bethesda/life/continuity.ts",
);
const { ECHO_UPGRADED_LIFE } = await here("src/bethesda/life/echoUpgrade.ts");
const { BETHESDA_LIFE, headlessGenesis } = await here("src/bethesda/life/headless.ts");
const { ORGANISM_LIFE } = await here("src/bethesda/life/organism.ts");
const { continueAsOrganism, valuationOf } = await here("src/bethesda/life/organismContinuation.ts");

const t0 = performance.now();
const genesis = headlessGenesis({
  seed: 393977,
  pedestrians: 4,
  vehicles: 1,
  buses: 0,
  statisticalPopulation: 10,
});
const born = birth(BETHESDA_LIFE.id, genesis, "0123456789abcdef0123456789abcdef");
const v3 = ECHO_UPGRADED_LIFE.build(genesis);
v3.advanceTicks(300);
const source = checkpointLife(ECHO_UPGRADED_LIFE, v3, { genesis, birth: born, previous: null });
const start = continueAsOrganism(source, "2026-10-27T01:00:00.000Z");
let life: any = start.life;
let previous: any = start.checkpoint;
const transition = ORGANISM_LIFE.history.transition;
const kinds: Record<string, number> = {};
const runs: unknown[] = [];
const t00 = life.cityFly.fly.state.t;
let lived = 0;
const extremes = { minReserve: 1, minWater: 1, minAtp: 1, maxFatigue: 0, maxSleepPressure: 0, maxStress: 0 };
for (const run of [1_000, 10_000, 100_000, 1_200_000]) {
  const t = performance.now();
  const archived: any[] = [];
  for (let left = run; left > 0; left -= 48) {
    life.advanceTicks(Math.min(48, left));
    const fly = life.cityFly.fly,
      p = life.organism.physiology.state;
    extremes.minReserve = Math.min(extremes.minReserve, fly.state.reserve / fly.params.reserveJ);
    extremes.minWater = Math.min(extremes.minWater, p.water);
    extremes.minAtp = Math.min(extremes.minAtp, p.atp);
    extremes.maxFatigue = Math.max(extremes.maxFatigue, p.fatigue);
    extremes.maxSleepPressure = Math.max(extremes.maxSleepPressure, p.sleepPressure);
    extremes.maxStress = Math.max(extremes.maxStress, p.stress);
    if (life.archive.length >= 1024) archived.push(...life.takeArchive());
  }
  archived.push(...life.takeArchive());
  lived += run;
  for (const e of archived) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const next = checkpointLife(ORGANISM_LIFE, life, { genesis, birth: born, previous, events: archived });
  const errors = [...checkpointErrors(ORGANISM_LIFE, next), ...transition(previous, next)];
  const back: any = restoreLife(ORGANISM_LIFE, next);
  const restoresExactly = ORGANISM_LIFE.hash(back) === ORGANISM_LIFE.hash(life);
  life = back;
  previous = next;
  const fly = life.cityFly.fly,
    a = life.organism;
  runs.push({
    ticks: run,
    livedTicks: lived,
    simulatedHours: +((fly.state.t - t00) / 3600).toFixed(3),
    msPerTick: +((performance.now() - t) / run).toFixed(3),
    sequence: next.sequence,
    archived: archived.length,
    errors,
    restoresExactly,
    valuationKept: valuationOf(a) === a.valuation,
    reserveFraction: +(fly.state.reserve / fly.params.reserveJ).toFixed(4),
    status: life.organismStatus(),
    episodesKept: a.model.state.episodes.length,
    places: a.inner.state.nav.places.length,
    meals: fly.state.counts.meals,
    fedJ: +fly.state.counts.fedJ.toFixed(4),
    spentJ: +fly.state.counts.spentJ.toFixed(4),
    rejected: fly.state.counts.rejected,
    failed: life.cityFly.failed,
    checkpointBytes: JSON.stringify(next).length,
    maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    wallS: +((performance.now() - t0) / 1000).toFixed(1),
  });
  process.stderr.write(`${JSON.stringify(runs.at(-1))}\n`);
}
const fly = life.cityFly.fly;
const report = {
  tickExact: life.city.tick === start.checkpoint.tick + lived,
  flyClockS: +(fly.state.t - t00).toFixed(6),
  expectedS: lived / 10,
  extremes,
  archiveKinds: kinds,
  runs,
};
writeFileSync(`${OUT}/report-long.json`, JSON.stringify(report, null, 1));
process.stdout.write(`${JSON.stringify({ ...report, runs: runs.length })}\n`);
