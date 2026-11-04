/**
 * Read-only. A forecast on a copy of a backup: restore the head in memory, step it, and write one
 * line each simulated minute. It takes no lease and commits nothing, and a copy is never the individual.
 *
 *   node --max-old-space-size=4096 scripts/run-ts.mjs docs/research/echo-collision/forecast.ts STORE OUT HOURS
 */
import { appendFileSync } from "node:fs";
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { restoreLife } = await import(`${W}/life/continuity.ts`);
const { ORGANISM_LIFE, BODY_LEFT_SOLID, BODY_ENTERED_SOLID } = await import(`${W}/life/organism.ts`);
const { LifeStore } = await import(`${W}/life/store.ts`);
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("forecast.ts")) + 1);
const [dir, out, hours] = [args[0]!, args[1]!, Number(args[2])];
const store = LifeStore.open(dir, ORGANISM_LIFE);
const head = store.head();
const life: any = restoreLife(ORGANISM_LIFE, head);
const tick0 = life.city.tick;
const target = tick0 + Math.round(hours * 36000);
const started = Date.now();
const write = (o: object) => appendFileSync(out, JSON.stringify(o) + "\n");
write({ section: "start", sequence: head.sequence, tick: tick0, hash: ORGANISM_LIFE.hash(life), node: process.version, platform: process.platform, arch: process.arch });
const sample = () => {
  const fly = life.cityFly.fly;
  const s = fly.state;
  const status = life.organismStatus();
  return {
    tick: life.city.tick,
    h: +((life.city.tick - tick0) / 36000).toFixed(4),
    p: s.p.map((v: number) => +v.toFixed(3)),
    mode: s.mode,
    why: (fly.lastCommand?.reason ?? "").slice(0, 70),
    inside: life.cityFly.world.solid(s.p),
    reserve: +(s.reserve / fly.params.reserveJ).toFixed(4),
    meals: s.counts.meals,
    landings: s.counts.landings,
    takeoffs: s.counts.takeoffs,
    protective: status.physiology.protective,
    bouts: status.physiology.recoveryBouts,
    atp: +status.physiology.atp.toFixed(3),
    maintJ: +status.physiology.maintenanceJ.toFixed(3),
    goal: life.organism.inner.state.nav.goal?.kind ?? null,
    wall: Math.round((Date.now() - started) / 1000),
  };
};
write(sample());
while (life.city.tick < target) {
  ORGANISM_LIFE.step(life, 600);
  for (const e of life.takeArchive()) {
    if (e.kind === BODY_LEFT_SOLID || e.kind === BODY_ENTERED_SOLID || e.kind === "recovery-enter" || e.kind === "recovery-exit")
      write({ section: "event", kind: e.kind, tick: e.tick, h: +((e.tick - tick0) / 36000).toFixed(4), ...e.data });
  }
  write(sample());
}
write({ section: "end", tick: life.city.tick, wall: Math.round((Date.now() - started) / 1000) });
