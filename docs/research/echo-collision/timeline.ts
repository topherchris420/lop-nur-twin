/** Read-only. The fly in the newest checkpoint of each backup, against the real geometry. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { Graph } = await import(`${W}/life/echoUpgrade.ts`);
const { CitySimulation } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { buildingAt } = await import(`${W}/model.ts`);
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("timeline.ts")) + 1);
let world: any = null;
const out: any[] = [];
for (const archive of args.sort((a, b) => basename(a).localeCompare(basename(b)))) {
  const dest = mkdtempSync(join(tmpdir(), "tl-"));
  try {
    const list = execFileSync("C:/Windows/System32/tar.exe", ["-tzf", archive], { encoding: "utf8", maxBuffer: 1 << 28 }).split(/\r?\n/).filter((n) => /checkpoints\/\d{12}\.json$/.test(n)).sort();
    const newest = list.at(-1)!;
    execFileSync("C:/Windows/System32/tar.exe", ["-xzf", archive, "-C", dest, newest]);
    const rec = JSON.parse(readFileSync(join(dest, newest), "utf8"));
    const c = rec.checkpoint;
    const g = new Graph(c.graph, false);
    const leaf = (path: any[]) => { const v = g.get(path); return v; };
    const arr = (path: any[]) => { const n = g.node(g.get(path)); return n.e; };
    const S = ["cityFly", "fly", "state"];
    const p = arr([...S, "p"]) as number[];
    const cnt = (k: string) => leaf([...S, "counts", k]);
    world ??= new BethesdaFlyWorld(new CitySimulation({ ...c.genesis.config }));
    const reserve = leaf([...S, "reserve"]) as number;
    const rj = leaf(["cityFly", "fly", "params", "reserveJ"]);
    const b = buildingAt({ x: p[0], z: p[2] });
    out.push({ utc: rec.committedUtc.slice(0, 16), seq: c.sequence, tick: c.tick, fly: c.versions.fly, x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2), solid: world.solid(p), bld: b?.id ?? "-", mode: leaf([...S, "mode"]), edge: leaf([...S, "edge"]), energy: typeof rj === "number" ? +(reserve / rj).toFixed(3) : +reserve.toFixed(3), meals: cnt("meals"), takeoffs: cnt("takeoffs"), walkedM: Math.round(cnt("walkedM")), flownM: Math.round(cnt("flownM")), feedS: Math.round(cnt("feedS")) });
    console.log(JSON.stringify(out.at(-1)));
  } finally { rmSync(dest, { recursive: true, force: true }); }
}
