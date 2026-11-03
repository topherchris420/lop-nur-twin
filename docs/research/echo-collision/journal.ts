/** Read-only. The fly's minute-by-minute status from the service journal, against the real geometry. */
import { createGunzip } from "node:zlib";
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { CitySimulation, PROFILES } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { buildingAt } = await import(`${W}/model.ts`);
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("journal.ts")) + 1);
const world = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1] }));
const rows: any[] = [];
const rl = createInterface({ input: createReadStream(args[0]!).pipe(createGunzip()) });
for await (const line of rl) {
  const at = line.indexOf('{"schema":"bethesda-headless-life/v2"');
  if (at < 0) continue;
  let j: any; try { j = JSON.parse(line.slice(at)); } catch { continue; }
  const p = j.fly.position;
  rows.push({ utc: line.slice(0, 19), tick: j.tick, p, solid: world.solid(p), b: buildingAt({ x: p[0], z: p[2] })?.id ?? null, mode: j.fly.mode, e: j.fly.energyFraction, meals: j.fly.meals, mj: j.organism?.physiology?.maintenanceJ ?? null, bouts: j.organism?.physiology?.recoveryBouts ?? null, atp: j.organism?.physiology?.atp ?? null, protective: j.organism?.physiology?.protective ?? null });
}
console.log("rows", rows.length, rows[0]?.utc, "->", rows.at(-1)?.utc);
// Spells inside solids.
const spells: any[] = []; let cur: any = null;
rows.forEach((r, i) => { if (r.solid) { if (!cur) cur = { from: r.utc, fromTick: r.tick, b: r.b, n: 0, meals0: r.meals, lastFree: rows[i-1]?.utc ?? null, lastFreeP: rows[i-1]?.p ?? null, firstP: r.p }; cur.n++; cur.to = r.utc; cur.toTick = r.tick; cur.meals1 = r.meals; } else if (cur) { spells.push(cur); cur = null; } });
if (cur) spells.push({ ...cur, open: true });
console.log("spells inside a solid (minutes of samples):"); for (const s of spells) console.log(JSON.stringify(s));
const last = spells.at(-1);
if (last) {
  const inside = rows.filter((r) => r.tick >= last.fromTick);
  const xs = inside.map((r) => r.p[0]), zs = inside.map((r) => r.p[2]), ys = inside.map((r) => r.p[1]);
  const modes: any = {}; for (const r of inside) modes[r.mode] = (modes[r.mode] ?? 0) + 1;
  const es = inside.map((r) => r.e);
  const hours = (inside.at(-1).tick - inside[0].tick) / 36000;
  console.log({ hoursSimulatedInside: +hours.toFixed(2), samples: inside.length, allSolid: inside.every((r) => r.solid), buildings: [...new Set(inside.map((r) => r.b))], xRange: [Math.min(...xs), Math.max(...xs)], zRange: [Math.min(...zs), Math.max(...zs)], yRange: [Math.min(...ys), Math.max(...ys)], modes, meals: [inside[0].meals, inside.at(-1).meals], maintenanceJ: [inside[0].mj, inside.at(-1).mj], bouts: [inside[0].bouts, inside.at(-1).bouts], energyMinMaxLast: [Math.min(...es), Math.max(...es), es.at(-1)] });
  const before = rows.filter((r) => r.tick < last.fromTick);
  const hb = (before.at(-1).tick - before[0].tick) / 36000;
  console.log("before:", { hours: +hb.toFixed(1), meals: [before[0].meals, before.at(-1).meals], mealsPerH: +((before.at(-1).meals - before[0].meals) / hb).toFixed(3), bouts: [before[0].bouts, before.at(-1).bouts], mj: [before.find((r) => r.mj !== null)?.mj, before.at(-1).mj] });
  const j0 = (inside.at(-1).mj - inside[0].mj) / hours, j1 = (before.at(-1).mj - before.find((r) => r.mj !== null).mj) / ((before.at(-1).tick - before.find((r) => r.mj !== null).tick) / 36000);
  console.log("maintenance J per simulated hour: before", +j1.toFixed(4), "inside", +j0.toFixed(4));
  console.log("around entry:"); for (const r of rows.filter((r) => r.tick >= last.fromTick - 3000 && r.tick <= last.fromTick + 2000)) console.log(r.utc, r.tick, r.p.map((v: number) => +v.toFixed(3)).join(","), r.solid, r.mode, +r.e.toFixed(3), r.meals);
  // The last meal.
  let lm = rows.findLastIndex((r) => r.meals < rows.at(-1).meals);
  console.log("first sample at the final meal count:", rows[lm + 1]?.utc, rows[lm + 1]?.meals);
}
writeFileSync(args[1]!, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
