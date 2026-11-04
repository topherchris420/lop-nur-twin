/**
 * Read-only. Samples of the deployed fly's witness, one JSON array a line, against the real geometry:
 * how many are inside a solid, its range, and each time it goes in or comes out.
 *
 *   node scripts/run-ts.mjs docs/research/echo-collision/witness-samples.ts SAMPLES.jsonl [...]
 */
import { readFileSync } from "node:fs";
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { CitySimulation, PROFILES } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { buildingAt } = await import(`${W}/model.ts`);
const world = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1] }));
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("witness-samples.ts")) + 1);
const rows: any[] = [];
for (const file of args) {
  for (const line of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.startsWith("[")) continue;
    const [utc, status, tick, p, mode, e, meals, seq, reason] = JSON.parse(line);
    if (!p) { rows.push({ utc, status, tick }); continue; }
    rows.push({ utc, status, tick, p, mode, e, meals, seq, reason, solid: world.solid(p), b: buildingAt({ x: p[0], z: p[2] })?.id ?? null });
  }
}
console.log("samples", rows.length, rows[0]?.utc, "->", rows.at(-1)?.utc);
console.log("inside", rows.filter((r) => r.solid).length, "outside", rows.filter((r) => r.p && !r.solid).length, "checkpoints", [...new Set(rows.map((r) => r.seq))].join(" "));
const ax = (i: number) => { const v = rows.filter((r) => r.p).map((r) => r.p[i]); return [+Math.min(...v).toFixed(2), +Math.max(...v).toFixed(2)]; };
console.log("x", ax(0), "y", ax(1), "z", ax(2));
console.log("modes", JSON.stringify(rows.reduce((m: any, r) => ((m[r.mode] = (m[r.mode] ?? 0) + 1), m), {})));
let was: boolean | null = null;
for (const r of rows) {
  if (!r.p) continue;
  if (r.solid !== was) console.log(r.solid ? "IN " : "OUT", r.utc, r.tick, r.p.map((v: number) => +v.toFixed(2)).join(","), r.mode, "building", r.b);
  was = r.solid;
}
const reasons: any = {};
for (const r of rows) { const k = String(r.reason ?? "").replace(/[0-9.]+/g, "#").slice(0, 70); reasons[k] = (reasons[k] ?? 0) + 1; }
console.log(JSON.stringify(reasons, null, 1));
