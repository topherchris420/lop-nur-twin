#!/usr/bin/env node
/**
 * What were the bots doing when the seat killed them?
 *
 *   node tools/kill-anatomy.mjs --brain script --policy marksman --seconds 90 [--seed 42] [origin]
 *
 * A diagnostic, not a benchmark. When a seat farms the bots, the kill/death
 * ratio says that it happened and nothing about why; this says what each
 * victim was doing in the instant it was hit: its behaviour state, its range,
 * whether it was moving, whether it could see the shooter, and whether any
 * cover stood within 10 m of it. The answer decides what to change — the
 * bots' movement, their spawns, or their aim.
 *
 * It reads bot internals through the dev handle `__combatSim`, which is what a
 * diagnostic is for; nothing it reads is available to any brain.
 */

import { flag, launch, openPlay, option, runFor, waitForPilot } from "./jev-harness.mjs";

const brain = option("brain", "script");
const policy = option("policy", "marksman");
const control = option("control", "precision");
const seconds = Number(option("seconds", "90"));
const seed = Number(option("seed", "42"));
const extra = option("query", "");
const origin =
  process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";

const browser = await launch();
try {
  const { page, errors } = await openPlay(
    browser,
    origin,
    `autoplay=1&quality=0&brain=${brain}&policy=${policy}&jevControl=${control}&seed=${seed}${extra ? `&${extra}` : ""}`,
  );
  await waitForPilot(page);
  await page.evaluate(() => {
    const { game } = globalThis.__combat;
    const sim = globalThis.__combatSim;
    const kills = [];
    globalThis.__anatomy = kills;
    globalThis.__combatModules.damageObservers.push((report) => {
      if (!report.attacker?.isPlayer || !report.killed) return;
      const victim = report.victim;
      const bot = sim.bots.bots.find((b) => b.actor.id === victim.id);
      const p = game.player.position;
      const V = p.constructor;
      const eye = new V(victim.position.x, victim.position.y + 1.5, victim.position.z);
      const playerEye = new V(p.x, p.y + 1.5, p.z);
      let cover = false;
      const from = new V(victim.position.x, victim.position.y + 0.9, victim.position.z);
      for (let i = 0; i < 8 && !cover; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const dir = new V(Math.cos(a), 0, Math.sin(a));
        if (game.world.raycast(from, dir, 10, 3 | 8, victim.id)) cover = true;
      }
      kills.push({
        state: bot?.state ?? "unknown",
        range: Math.round(victim.position.distanceTo(p)),
        speed: Math.round(victim.speed * 10) / 10,
        sprinting: bot?.isTacSprinting ?? null,
        seesShooter: game.world.hasLineOfSight(eye, playerEye, 3, victim.id),
        targetIsPlayer: bot ? bot.targetId === game.player.id : null,
        coverWithin10m: cover,
        sinceSpawnS: null,
      });
    });
  });
  await runFor(page, seconds);
  const kills = await page.evaluate(() => globalThis.__anatomy);
  const count = (key) =>
    Object.entries(
      kills.reduce((acc, k) => {
        const v = String(k[key]);
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v} ${n}`)
      .join(", ");
  const ranges = kills.map((k) => k.range).sort((a, b) => a - b);
  console.log(
    `${kills.length} kills in ${seconds} s (${brain}${brain === "script" ? `/${policy}` : ""}, seed ${seed})`,
  );
  console.log(`  victim state:        ${count("state")}`);
  console.log(`  victim sprinting:    ${count("sprinting")}`);
  console.log(`  victim saw shooter:  ${count("seesShooter")}`);
  console.log(`  victim targeting it: ${count("targetIsPlayer")}`);
  console.log(`  cover within 10 m:   ${count("coverWithin10m")}`);
  console.log(
    `  range: min ${ranges[0] ?? "n/a"} · median ${ranges[Math.floor(ranges.length / 2)] ?? "n/a"} · max ${ranges[ranges.length - 1] ?? "n/a"} m`,
  );
  if (flag("verbose")) for (const k of kills) console.log("   ", JSON.stringify(k));
  if (errors.length) console.log(`  page errors: ${errors[0]}`);
} finally {
  await browser.close();
}
