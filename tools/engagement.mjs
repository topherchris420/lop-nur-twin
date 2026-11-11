#!/usr/bin/env node
/**
 * Does the opposing force actually fight the player?
 *
 * `tools/smoke.mjs` asserts the plumbing: colliders baked, hitboxes hittable,
 * a lethal damage event kills. All of that passed while the game was
 * unplayable, because the two failures that mattered were not in the plumbing:
 * the player had no hitboxes at all, so every bot round resolved against the
 * concrete behind them, and the force was spread over 600 m of compound, so
 * nobody was ever within engagement range of anybody.
 *
 * Neither shows up in a still frame or a single tick. This drives the real
 * bot manager, character manager and match director with a fixed delta for a
 * minute of match time — a headless browser renders a few frames a second and
 * `dt` is clamped, so a minute cannot be waited for — and measures what the
 * match actually did.
 *
 *   node tools/engagement.mjs
 *   node tools/engagement.mjs http://localhost:5173
 *
 * Exits non-zero if any check fails.
 */

import puppeteer from "puppeteer";

const origin = process.argv[2] ?? "http://localhost:5173";
const url = `${origin}/play?autoplay=1&quality=1`;

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => globalThis.__combatSim != null, { timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, 2500));

const report = await page.evaluate(() => {
  const { game } = globalThis.__combat;
  const { bots, characters, director } = globalThis.__combatSim;
  const player = game.player;

  const STEP = 1 / 60;
  const SECONDS = 60;
  const stats = {
    shotsAtPlayer: 0,
    damageOnPlayer: 0,
    damageEvents: 0,
    botsKilled: 0,
    playerDeaths: 0,
    closestApproach: Infinity,
    /** Seconds of match time with a live enemy inside 60 m. */
    contactSeconds: 0,
    /**
     * Ten-second stretches in which a bot stayed alive and wanted throughout
     * to be more than 8 m from where it stood, and how many of them ended
     * within 3 m of where they began.
     */
    travelWindows: 0,
    stalledWindows: 0,
    maxSuppression: 0,
    playerHealthMin: player.health,
    weaponIds: [
      ...new Set(game.actors.filter((a) => !a.isPlayer).map((a) => a.weaponId)),
    ],
    unknownWeapons: [],
    deathPoseSamples: [],
  };

  // Watch the damage queue rather than inferring from health, so a hit that
  // regenerates away still counts.
  const realPush = Array.prototype.push;
  game.damageQueue.push = function (...events) {
    for (const e of events) {
      stats.damageEvents += 1;
      if (e.targetId === player.id) {
        stats.damageOnPlayer += 1;
        stats.shotsAtPlayer += 1;
      }
    }
    return realPush.apply(this, events);
  };

  // Step the whole simulation the way a real frame does, in order.
  const kills = [];
  const combat = globalThis.__combatModules;
  let deathsSeen = 0;
  const wasAlive = new Map();
  for (const a of game.actors) wasAlive.set(a.id, a.alive);
  // `bots.bots` is the manager's own list: each bot's goal sits beside its actor.
  const travel = new Map(
    bots.bots.map((b) => [
      b.actor.id,
      { x: b.actor.position.x, z: b.actor.position.z, travelling: true },
    ]),
  );

  for (let i = 0; i < SECONDS / STEP; i += 1) {
    game.time += STEP;
    bots.setFocus(player.position);
    bots.update(STEP, game.time);
    director.update(STEP);
    // The scene's `Simulation` component owns damage resolution; reach it the
    // same way it does, through the module the game exposes.
    combat.resolveDamage(game.time, kills);
    for (const k of kills) director.onKill(k);
    combat.tickActorState(STEP, game.time);
    characters.update(STEP, { position: player.position });

    let nearest = Infinity;
    for (const a of game.actors) {
      if (a.isPlayer || !a.alive || a.team === player.team) continue;
      nearest = Math.min(nearest, a.position.distanceTo(player.position));
    }
    if (nearest < stats.closestApproach) stats.closestApproach = nearest;
    if (nearest < 60) stats.contactSeconds += STEP;

    for (const b of bots.bots) {
      const at = b.actor.position;
      const away = Math.hypot(b.goal.x - at.x, b.goal.z - at.z);
      if (!b.actor.alive || away <= 8) travel.get(b.actor.id).travelling = false;
    }
    if ((i + 1) % (10 / STEP) === 0) {
      for (const b of bots.bots) {
        const at = b.actor.position;
        const from = travel.get(b.actor.id);
        if (from.travelling) {
          stats.travelWindows += 1;
          if (Math.hypot(at.x - from.x, at.z - from.z) < 3) stats.stalledWindows += 1;
        }
        from.x = at.x;
        from.z = at.z;
        from.travelling = b.actor.alive;
      }
    }
    stats.maxSuppression = Math.max(stats.maxSuppression, player.suppression);
    stats.playerHealthMin = Math.min(stats.playerHealthMin, player.health);

    for (const a of game.actors) {
      if (a.isPlayer) continue;
      const before = wasAlive.get(a.id);
      if (before && !a.alive) {
        deathsSeen += 1;
        // Sample the collapse a third of a second in: a body that fell has a
        // model root tipped away from upright, one that did not is still
        // standing there at identity.
        if (stats.deathPoseSamples.length < 3) {
          stats.deathPoseSamples.push({ id: a.id, at: +game.time.toFixed(2) });
        }
      }
      wasAlive.set(a.id, a.alive);
    }
  }

  stats.botsKilled = deathsSeen;
  stats.nav = { ...bots.navStats };
  stats.playerDeaths = player.deaths;
  stats.closestApproach = +stats.closestApproach.toFixed(1);
  stats.contactSeconds = +stats.contactSeconds.toFixed(1);
  stats.maxSuppression = +stats.maxSuppression.toFixed(2);

  // Player hitboxes: the check the whole thing turned on.
  const found = [];
  game.world.queryAABB(
    player.position.clone().addScalar(-2),
    player.position.clone().addScalar(3),
    found,
  );
  stats.playerHitboxes = found.filter((c) => c.entityId === player.id).length;

  // Every bot must be carrying something the arsenal actually defines; an id
  // that falls back silently issues the whole force the same rifle.
  stats.unknownWeapons = stats.weaponIds.filter((id) => !globalThis.__combatWeapons[id]);

  /* ------------------------------------------------------------------ */
  /* Hit-region coverage                                                 */
  /* ------------------------------------------------------------------ */
  // Measured, not assumed: walk a vertical line through a standing actor and
  // record every height that resolves to something other than that actor.
  // Boxes that merely touch leave a seam at each joint, and a round through a
  // seam registers as world geometry — which is exactly what "I hit him and
  // nothing happened" feels like from the other end.
  const victim = game.actors.find((a) => !a.isPlayer && a.alive);
  const gaps = [];
  if (victim) {
    victim.stance = "stand";
    characters.update(1 / 60, { position: victim.position });

    // Find an angle with nothing between the probe and the target, so this
    // measures the hitbox rig rather than whatever the bot is standing next to.
    let from = null;
    for (let i = 0; i < 24 && !from; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const candidate = victim.position.clone();
      candidate.x += Math.cos(angle) * 3;
      candidate.z += Math.sin(angle) * 3;
      candidate.y += 0.9;
      const chest = victim.position.clone();
      chest.y += 0.9;
      if (game.world.hasLineOfSight(candidate, chest, 1 | 2, victim.id)) from = candidate;
    }

    if (from) {
      let covered = 0;
      const samples = 90;
      for (let i = 0; i < samples; i += 1) {
        const h = 0.05 + (i / samples) * 1.72;
        const o = from.clone();
        o.y = victim.position.y + h;
        const dir = victim.position.clone();
        dir.y = o.y;
        dir.sub(o).normalize();
        const hit = game.world.raycast(o, dir, 8, 1 | 2 | 4 | 16, null);
        if (hit && hit.entityId === victim.id) covered += 1;
        else gaps.push(+h.toFixed(2));
      }
      stats.verticalCoverage = +(covered / samples).toFixed(3);
      stats.coverageGaps = gaps.slice(0, 8);
    }
  }

  /* ------------------------------------------------------------------ */
  /* The collapse                                                        */
  /* ------------------------------------------------------------------ */
  // "They don't fall when shot" is a claim about the pose, and a still frame
  // of a body mid-collapse looks a lot like a body standing still. So kill one
  // with a known round direction and measure where its highest point ends up:
  // a body that fell has its head near the ground, downrange of its feet.
  const subject = game.actors.find((a) => !a.isPlayer && a.alive);
  if (subject) {
    const bones = characters.bonesOf(subject.id);
    // The height of the highest bone says whether the body went down. Which
    // way it went is the head's travel, not that bone's: once a body is on the
    // ground its highest point is whichever limb is sticking up, and in three
    // bodies of ten that limb lay uprange of where the head had stood while
    // the head itself lay more than a metre downrange.
    const head = bones.find((b) => /head/i.test(b.name));
    const highest = () => {
      let top = -Infinity;
      for (const b of bones) top = Math.max(top, b.matrixWorld.elements[13]);
      return { top, headZ: head ? head.matrixWorld.elements[14] : null };
    };

    characters.poseOnly(subject.id, 1 / 60);
    const standing = highest();

    // Shot from due north, so the round travels toward +z and the body should
    // go over that way.
    subject.alive = false;
    subject.state = "dead";
    subject.deathDir.set(0, 0, 1);
    subject.deathHeadshot = false;
    for (let i = 0; i < 120; i += 1) characters.poseOnly(subject.id, 1 / 60);
    const fallen = highest();

    stats.standingTopM = +(standing.top - subject.position.y).toFixed(2);
    stats.fallenTopM = +(fallen.top - subject.position.y).toFixed(2);
    // Positive means the head went over in the direction the round was going.
    stats.fallDownrangeM =
      standing.headZ === null ? null : +(fallen.headZ - standing.headZ).toFixed(2);
  }

  return stats;
});

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

check(
  "player has hitboxes",
  report.playerHitboxes >= 5,
  `${report.playerHitboxes} colliders on entity 0`,
);
check(
  "bots carry real weapons",
  report.unknownWeapons.length === 0,
  report.weaponIds.join(", "),
);
check(
  "bot loadouts vary",
  report.weaponIds.length >= 2,
  `${report.weaponIds.length} distinct`,
);
check(
  "enemies close to fighting range",
  report.closestApproach < 60,
  `closest ${report.closestApproach} m`,
);
check(
  "contact is sustained",
  report.contactSeconds > 8,
  `${report.contactSeconds}s inside 60 m`,
);
// Steering straight at a goal left three travelling bots in four running into
// the wall between them and it, and the force a hundred metres from a player
// who never moved. These two say the routes exist and are being walked.
check(
  "bots find a route to where they are going",
  report.nav.searches > 0 && report.nav.found >= report.nav.searches * 0.9,
  `${report.nav.found} of ${report.nav.searches} searches found one; grid built in ${report.nav.buildMs} ms`,
);
check(
  "a bot that sets off gets somewhere",
  report.stalledWindows <= Math.max(1, report.travelWindows * 0.25),
  `${report.stalledWindows} of ${report.travelWindows} ten-second journeys ended within 3 m of their start`,
);
check(
  "bots shoot the player",
  report.shotsAtPlayer > 0,
  `${report.shotsAtPlayer} rounds on target`,
);
check(
  "the player can be hurt",
  report.playerHealthMin < 100,
  `min health ${Math.round(report.playerHealthMin)}, ${report.playerDeaths} deaths in 60 s`,
);
check(
  "incoming fire suppresses",
  report.maxSuppression > 0,
  `peak ${report.maxSuppression}`,
);
check("bodies drop", report.botsKilled > 0, `${report.botsKilled} deaths in 60 s`);
check(
  "a killed body collapses",
  report.fallenTopM < report.standingTopM * 0.6,
  `highest point ${report.standingTopM} m standing -> ${report.fallenTopM} m two seconds after the kill`,
);
check(
  "it falls the way the round was going",
  report.fallDownrangeM !== null && report.fallDownrangeM > 0.35,
  report.fallDownrangeM === null
    ? "the rig has no head bone to follow"
    : `head ${report.fallDownrangeM} m downrange`,
);
check(
  "hitboxes cover the body",
  report.verticalCoverage > 0.95,
  `${Math.round(report.verticalCoverage * 100)}% of a vertical sweep${report.coverageGaps.length ? ` — gaps at ${report.coverageGaps.join(", ")} m` : ""}`,
);
check("no page errors", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`${c.pass ? "  ok  " : " FAIL "} ${c.name.padEnd(30)} ${c.detail ?? ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
