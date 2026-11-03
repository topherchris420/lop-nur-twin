const W = new URL("../../../src/bethesda", import.meta.url).href;
const { CitySimulation, PROFILES } = await import(`${W}/simulation.ts`);
const { BethesdaFlyWorld } = await import(`${W}/fly/bethesdaWorld.ts`);
const { DigitalFly, FLY_VERSION } = await import(`${W}/fly/fly.ts`);
const { forward } = await import(`${W}/fly/units.ts`);
const world = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1] }));
const a = { x: 473.8015, z: 628.3347 }, pr = (world as any).spec.prisms.find((p: any) => p.id === "building 1011267786");
const ring = pr.ring;
const rows: any[] = [];
for (let e = 0; e < ring.length - 1; e++) {
  const A = ring[e], B = ring[e + 1]; const ex = B.x - A.x, ez = B.z - A.z, L = Math.hypot(ex, ez);
  if (L < 0.5) continue;
  for (const s of [1, -1]) {
    const d = [(-ez / L) * s, 0, (ex / L) * s];
    const mid = [A.x + ex / 2, A.z + ez / 2];
    const gm = world.ground(mid[0], mid[1]);
    if (world.solid([mid[0] - d[0] * 0.05, gm + 0.01, mid[1] - d[2] * 0.05]) || !world.solid([mid[0] + d[0] * 0.05, gm + 0.01, mid[1] + d[2] * 0.05])) continue;
    let tried = 0, blind = 0, entered = 0;
    for (let k = 1; k < 12; k++) {
      const u = k / 12;
      const x = A.x + ex * u - d[0] * 0.02, z = A.z + ez * u - d[2] * 0.02;
      let yaw = 0, most = -2; for (let q = 0; q < 7200; q++) { const y = (q * Math.PI) / 3600; const f = forward(y); const c = f[0] * d[0] + f[2] * d[2]; if (c > most) { most = c; yaw = y; } }
      let jumped = false, walked = false;
      const fly = new DigitalFly({ world, seed: 5, start: { p: [x, world.ground(x, z), z], yaw }, adapter: () => ({ descriptor: { id: "t", label: "t", fidelity: "t", simulatesNeurons: false, regions: [] }, decide: (input: any) => { if (input.body.t < 15) return { mode: "walk", walkSpeed: 2, yawRate: 0, reason: "w" }; if (!jumped) { jumped = true; return { mode: "takeoff", heading: yaw, prepare: 0.01, reason: "j" }; } return { mode: "flight", velocity: [d[0] * 0.4, 0.1, d[2] * 0.4], reason: "in" }; } }) });
      while (fly.state.t < 14.9) fly.advance(0.05);
      const p = fly.state.p; tried++;
      const f = forward(fly.state.yaw);
      const miss = !world.raycast(p, [f[0], 0, f[2]], 0.02, false);
      if (miss) blind++;
      let inside = false; for (let i = 0; i < 300; i++) { fly.advance(0.005); inside ||= world.solid(fly.state.p); }
      if (inside) entered++;
    }
    rows.push({ edge: e, from: [+A.x.toFixed(2), +A.z.toFixed(2)], L: +L.toFixed(2), tried, blind, entered });
  }
}
console.log(FLY_VERSION); console.table(rows);
