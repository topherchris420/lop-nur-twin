#!/usr/bin/env node
/**
 * Functional smoke test for the first-person mode.
 *
 * This is the counterpart to `tools/probe.mjs`. The probe tells you what a
 * frame looks like; this asserts that the simulation underneath it actually
 * works — that colliders were baked, that the player is standing on ground and
 * not inside a hangar, that bots exist and are separated from each other, that
 * their hitboxes are where their bodies are, and that a shot fired at one
 * registers a hit on a named body region and kills it.
 *
 * Every check here corresponds to something that has actually been broken at
 * some point: a camera that never left its spawn, an environment map full of
 * NaN, a bloom pass fed infinities. Screenshots showed all three as "the
 * screen is dark" and nothing more.
 *
 *   node tools/smoke.mjs
 *   node tools/smoke.mjs http://localhost:5173
 *
 * Exits non-zero if any check fails.
 */

import puppeteer from "puppeteer";

const origin = process.argv[2] ?? "http://localhost:5173";
const url = `${origin}/play?autoplay=1&quality=2`;

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") {
    const text = m.text();
    if (!text.includes("GL Driver") && !text.includes("DevTools")) consoleErrors.push(text);
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, 10000));

const results = await page.evaluate(() => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });

  const handle = globalThis.__combat;
  if (!handle) {
    check("dev handle present", false, "globalThis.__combat missing");
    return { checks };
  }
  const { game, r3f } = handle;
  const world = game.world;

  /* ------------------------------------------------------------ world */
  check("collision baked", (world?.staticCount ?? 0) > 200, `${world?.staticCount ?? 0} colliders`);
  check(
    "environment map bound",
    !!r3f.scene.environment,
    String(!!r3f.scene.environment),
  );

  /* ----------------------------------------------------------- player */
  const player = game.player;
  const groundY = world.groundAt(player.position.x, player.position.z);
  check(
    "player on the ground",
    Math.abs(player.position.y - groundY) < 0.5,
    `y=${player.position.y.toFixed(2)} ground=${groundY.toFixed(2)}`,
  );
  check(
    "player not inside geometry",
    world.isPositionFree(player.position, 0.34, 1.8),
    "capsule clear",
  );
  check(
    "camera at the player's eye",
    r3f.camera.position.distanceTo(player.position) < 2.2,
    `${r3f.camera.position.distanceTo(player.position).toFixed(2)} m`,
  );

  /* ------------------------------------------------------------- bots */
  const bots = game.actors.filter((a) => !a.isPlayer);
  check("bots spawned", bots.length >= 4, `${bots.length} bots`);
  check("bots alive", bots.filter((b) => b.alive).length >= 4, `${bots.filter((b) => b.alive).length} alive`);
  let worstGround = 0;
  let worstBot = "";
  for (const b of bots) {
    const delta = Math.abs(b.position.y - world.groundAt(b.position.x, b.position.z));
    if (delta > worstGround) {
      worstGround = delta;
      worstBot = `${b.name} at ${b.position.x.toFixed(0)},${b.position.z.toFixed(0)}`;
    }
  }
  check(
    "bots on the ground",
    worstGround < 1.2,
    `worst ${worstGround.toFixed(2)} m (${worstBot})`,
  );
  check(
    "bots not inside geometry",
    bots.every((b) => world.isPositionFree(b.position, 0.34, 1.7)),
    `${bots.filter((b) => !world.isPositionFree(b.position, 0.34, 1.7)).length} embedded`,
  );
  let minSeparation = Infinity;
  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      minSeparation = Math.min(minSeparation, bots[i].position.distanceTo(bots[j].position));
    }
  }
  check("bots not stacked", minSeparation > 0.5, `min separation ${minSeparation.toFixed(2)} m`);
  check(
    "both teams present",
    new Set(bots.map((b) => b.team)).size === 2,
    [...new Set(bots.map((b) => b.team))].join("/"),
  );

  /* --------------------------------------------------------- hitboxes */
  // Fire a ray from a metre in front of a bot's chest, straight at it. If the
  // hitbox rig is registered and tracking, this must return that entity and a
  // named region.
  const victim = bots.find((b) => b.alive);
  let hit = null;
  let colliderCount = 0;
  let firedFrom = "";
  if (victim) {
    const chest = victim.position.clone();
    chest.y += 1.15;

    // Count the character colliders actually registered around this bot.
    const min = victim.position.clone().addScalar(-1.5);
    const max = victim.position.clone().addScalar(2.5);
    const found = [];
    world.queryAABB(min, max, found);
    colliderCount = found.filter((c) => c.entityId === victim.id).length;

    // Shoot from a direction that is verifiably clear, so the check tests the
    // hitbox rig rather than whatever building the bot happens to stand by.
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const from = chest.clone();
      from.x += Math.cos(angle) * 3;
      from.z += Math.sin(angle) * 3;
      if (!world.hasLineOfSight(from, chest, 1 | 2, victim.id)) continue;
      const dir = chest.clone().sub(from).normalize();
      // MASK_BULLET = world | prop | character | penetrable = 1|2|4|16
      hit = world.raycast(from, dir, 6, 1 | 2 | 4 | 16, null);
      firedFrom = `${(angle * 180 / Math.PI).toFixed(0)}deg`;
      if (hit && hit.entityId === victim.id) break;
    }
  }
  check(
    "bot hitboxes registered",
    colliderCount >= 5,
    `${colliderCount} colliders on the target`,
  );
  check(
    "bot hitbox is hittable",
    hit !== null && hit.entityId === victim?.id,
    hit ? `entity ${hit.entityId} region ${hit.region} from ${firedFrom}` : `no hit (${firedFrom || "no clear angle"})`,
  );
  check(
    "hit resolves to a body region",
    hit?.region != null,
    String(hit?.region ?? "none"),
  );

  /* ----------------------------------------------------------- damage */
  // Push a lethal damage event through the real queue and let the simulation
  // resolve it on the next frame.
  const before = victim ? { health: victim.health, alive: victim.alive } : null;
  if (victim) {
    game.damageQueue.push({
      targetId: victim.id,
      attackerId: player.id,
      amount: 250,
      kind: "bullet",
      region: "head",
      direction: { x: 1, y: 0, z: 0, clone() { return this; }, normalize() { return this; } },
      point: victim.position.clone(),
      distanceM: 3,
      penetrated: false,
      weaponId: player.weaponId,
      time: game.time,
    });
  }

  return {
    checks,
    pending: victim ? { id: victim.id, before } : null,
    playerKillsBefore: player.kills,
  };
});

// Let the simulation drain the queue.
await new Promise((resolve) => setTimeout(resolve, 1500));

const after = await page.evaluate((pendingId) => {
  const { game } = globalThis.__combat;
  const victim = pendingId != null ? game.actorById.get(pendingId) : null;
  return {
    victimAlive: victim ? victim.alive : null,
    victimHealth: victim ? victim.health : null,
    playerKills: game.player.kills,
    killfeedLength: game.killQueue.length,
  };
}, results.pending?.id ?? null);

const checks = results.checks ?? [];
if (results.pending) {
  checks.push({
    name: "lethal damage kills the target",
    pass: after.victimAlive === false,
    detail: `alive=${after.victimAlive} health=${after.victimHealth}`,
  });
  checks.push({
    name: "kill is credited to the attacker",
    pass: after.playerKills > results.playerKillsBefore,
    detail: `${results.playerKillsBefore} -> ${after.playerKills}`,
  });
}
checks.push({
  name: "no console errors",
  // Pointer lock always rejects without a user gesture in a headless capture.
  pass: consoleErrors.filter((e) => !e.includes("Pointer Lock")).length === 0,
  detail: consoleErrors.filter((e) => !e.includes("Pointer Lock")).join(" | ") || "clean",
});

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`${c.pass ? "  ok  " : " FAIL "} ${c.name.padEnd(34)} ${c.detail ?? ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
