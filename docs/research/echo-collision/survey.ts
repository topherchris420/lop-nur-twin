/** Which of the city's solids have the blind spot? Read-only geometry; the old engine's rays. */
const W = new URL("../../../src/bethesda", import.meta.url).href;
const { CitySimulation, PROFILES } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { mulberry32 } = await import(`${W}/../lib/noise.ts`);
const world = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1] }));
const spec = (world as any).spec;
const rng = mulberry32(20261103);
function lineFrom(from: number[], d: number[], reach: number) {
  let out = 0, inn = reach;
  const at = (t: number) => [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
  if (world.solid(at(out)) || !world.solid(at(inn))) return null;
  for (let i = 0; i < 200; i++) { const m = (out + inn) / 2; if (m === out || m === inn) break; if (world.solid(at(m))) inn = m; else out = m; }
  return at(out);
}
function test(from: number[], d: number[], reach: number, r: any) {
  const p = lineFrom(from, d, reach);
  if (!p) return;
  r.tried++;
  const hit = world.raycast(p, d, 0.003, false);
  if (!hit) r.blind++;
  else if (hit.t < 1e-6) r.touch++;
}
const res: Record<string, any> = {};
const R = (k: string) => (res[k] ??= { tried: 0, blind: 0, touch: 0 });
for (const pr of spec.prisms) {
  const rings = [pr.ring, ...(pr.holes ?? [])];
  const y = Math.max(pr.y0, world.ground(pr.ring[0].x, pr.ring[0].z)) + 0.5;
  const area = (() => { let a = 0; const q = pr.ring; for (let i = 0; i < q.length; i++) { const u = q[i], v = q[(i + 1) % q.length]; a += u.x * v.z - v.x * u.z; } return a; })();
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez); if (!(L > 0)) continue;
    for (let k = 0; k < 3; k++) {
      const u = 0.1 + 0.8 * rng();
      const m = [a.x + ex * u, y, a.z + ez * u];
      // Try both normals; lineFrom needs outside -> inside.
      for (const s of [1, -1]) {
        const d = [(-ez / L) * s, 0, (ex / L) * s];
        const from = [m[0] - d[0] * 0.05, m[1], m[2] - d[2] * 0.05];
        if (!world.solid(from) && world.solid([m[0] + d[0] * 0.05, m[1], m[2] + d[2] * 0.05])) test(from, d, 0.1, R("prism wall"));
      }
    }
  }
}
for (const b of spec.boxes) for (let k = 0; k < 6; k++) { const a = rng() * 2 * Math.PI, d = [Math.cos(a), 0, Math.sin(a)]; const r = Math.hypot(b.half[0], b.half[2]) + 0.2; const from = [b.center[0] - d[0] * r, b.center[1], b.center[2] - d[2] * r]; test(from, d, r, R("box")); }
for (const c of spec.cylinders) for (let k = 0; k < 6; k++) { const a = rng() * 2 * Math.PI, d = [Math.cos(a), 0, Math.sin(a)]; const r = Math.max(c.r, c.r1 ?? c.r) + 0.2; const y = (c.y0 + c.y1) / 2; const from = [c.x - d[0] * r, y, c.z - d[2] * r]; test(from, d, r, R(c.r1 !== undefined && c.r1 !== c.r ? "tapered cylinder" : "cylinder")); }
for (const s of spec.spheres) for (let k = 0; k < 4; k++) { const a = rng() * 2 * Math.PI, d = [Math.cos(a), 0, Math.sin(a)]; const r = s.r + 0.2; const from = [s.center[0] - d[0] * r, s.center[1], s.center[2] - d[2] * r]; test(from, d, r, R(s.stretch !== undefined && s.stretch !== 1 ? "ellipsoid" : "sphere")); }
for (let k = 0; k < 20000; k++) { const x = spec.prisms[0].min.x + rng() * 800 - 400, z = rng() * 800 - 400; const g = world.ground(x, z); const y = g + 0.5; const p = [x, y, z]; if (world.solid(p)) continue; test(p, [0, -1, 0], 2, R("ground")); }
for (const pr of spec.prisms.slice(0, 400)) { const cx = (pr.min.x + pr.max.x) / 2, cz = (pr.min.z + pr.max.z) / 2; test([cx, pr.y1 + 0.5, cz], [0, -1, 0], 1, R("roof")); }
console.log(JSON.stringify(res, null, 1));
