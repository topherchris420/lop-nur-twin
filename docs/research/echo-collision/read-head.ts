/** Read-only: where is the fly in a store's checkpoint, against the real geometry? No restore, no lease. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { Graph } = await import(`${W}/life/echoUpgrade.ts`);
const { CitySimulation } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { buildings, buildingAt, bounds } = await import(`${W}/model.ts`);
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("read-head.ts")) + 1);
const dir = args[0]!;
const names = readdirSync(join(dir, "checkpoints")).filter((n) => /^\d{12}\.json$/.test(n)).sort();
const which = args[1] ? names.find((n) => n.startsWith(args[1]!.padStart(12, "0"))) : names.at(-1);
const rec = JSON.parse(readFileSync(join(dir, "checkpoints", which!), "utf8"));
const c = rec.checkpoint;
console.log({ sequence: c.sequence, tick: c.tick, committedUtc: rec.committedUtc, versions: c.versions, individual: c.birth.individual, parent: c.parent?.slice(0, 16), digest: c.digest.slice(0, 16), graphDigest: c.graphDigest.slice(0, 16), events: c.events.length, birth: c.birth, genesisDigest: c.genesisDigest });
const g = new Graph(c.graph, false);
const plain = (v: any, depth = 6): any => {
  if (typeof v !== "object" || v === null) return v;
  if ("n" in v) return v.n;
  if ("u" in v) return undefined;
  const n = g.node(v);
  if (depth <= 0) return `<${n.t}>`;
  if (n.t === "o") return Object.fromEntries(n.e.map(([k, x]: any) => [k, plain(x, depth - 1)]));
  if (n.t === "a") return n.e.map((x: any) => plain(x, depth - 1));
  return `<${n.t}>`;
};
const s = plain(g.get(["cityFly", "fly", "state"]), 3);
console.log(JSON.stringify({ t: s.t, p: s.p, v: s.v, yaw: s.yaw, mode: s.mode, sub: s.sub, modeT: s.modeT, reserve: s.reserve, perch: s.perch, contact: s.contact, edge: s.edge, target: s.target, walkSpeed: s.walkSpeed, counts: s.counts }, null, 1));
const config = plain(c.genesis ? null : null);
const sim = new CitySimulation({ ...c.genesis.config });
const world = new BethesdaFlyWorld(sim);
const p = s.p as [number, number, number];
const standing = 0;
console.log("solid at thorax:", world.solid(p), "ground here:", world.ground(p[0], p[2]), "perch below:", world.perchAt(p[0], p[2], p[1]));
const at = buildingAt({ x: p[0], z: p[2] });
console.log("building at:", at ? { id: at.id, name: at.name, height: at.height, baseY: at.baseY, verts: at.footprint?.length ?? at.ring?.length, keys: Object.keys(at) } : null);
console.log("bounds:", bounds, "home:", world.home.bounds, world.home.ceiling);
const prisms = (world as any).spec.prisms as any[];
for (const pr of prisms) if (p[0] >= pr.min.x && p[0] <= pr.max.x && p[2] >= pr.min.z && p[2] <= pr.max.z) {
  const inF = (await import(`${W}/fly/world.ts`)).insideFootprint(p[0], p[2], pr);
  console.log("prism near:", { id: pr.id, y0: pr.y0, y1: pr.y1, min: pr.min, max: pr.max, verts: pr.ring.length, holes: pr.holes?.length ?? 0, inFootprint: inF });
  if (inF) console.log(" ring:", JSON.stringify(pr.ring.map((q: any) => [+q.x.toFixed(3), +q.z.toFixed(3)])));
}
const rays = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]];
for (const d of rays) { const h = world.raycast(p, d as any, 200, false); console.log("ray", d.join(","), h ? { t: +h.t.toFixed(4), id: h.id, kind: h.kind } : null); }
console.log("odour here:", world.odour(p), "food here:", world.foodAt([p[0], p[1] - 0.002, p[2]]));
const food = (world as any).spec.food as any[];
const near = food.map((f) => ({ id: f.id, kind: f.kind, d: Math.hypot(f.center[0] - p[0], f.center[2] - p[2]), at: f.center })).sort((a, b) => a.d - b.d).slice(0, 5);
console.log("nearest food:", near);
const adapter = plain(g.get(["cityFly", "fly", "adapter", "physiology"]), 3);
console.log("physiology:", JSON.stringify(adapter));
const S = plain(g.get(["cityFly", "fly", "adapter", "model", "state", "counts"]), 2);
console.log("self-model counts:", JSON.stringify(S));
const circ = plain(g.get(["cityFly", "fly", "adapter", "circuit", "state"]), 1);
console.log("mushroom body:", { trials: circ.trials, fruitless: circ.fruitless, last: circ.last });
const places = plain(g.get(["cityFly", "fly", "adapter", "inner", "state", "nav", "places"]), 2);
console.log("remembered places:", places.length);
