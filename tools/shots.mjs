#!/usr/bin/env node
/**
 * The screenshots the README embeds.
 *
 * Documentation images go stale the moment anything visible changes, and a
 * README shot recaptured by hand is recaptured from a slightly different
 * place every time — which is exactly the problem `tools/frames.mjs` exists
 * to solve for look development. This does the same for the published images:
 * fixed cameras, fixed framing, one command.
 *
 *   node tools/shots.mjs                       -> docs/*.png
 *   node tools/shots.mjs --only blacksite
 *   node tools/shots.mjs --origin http://localhost:5199
 *
 * The combat shots step the simulation forward before capturing. A match that
 * has only just started is eleven people walking; the picture worth publishing
 * is the one thirty seconds later, and thirty seconds cannot be waited for in
 * a headless browser that renders at a few frames a second.
 */

import puppeteer from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "http://localhost:5173");
const only = arg("only", null);
const quality = arg("quality", "3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Compound frame -> world metres, mirroring src/lib/layout.ts         */
/* ------------------------------------------------------------------ */

const ROT = 0.7679;
const ORIGIN = [1018, 1410];
function compound(u, v) {
  return [
    ORIGIN[0] + u * Math.cos(ROT) + v * Math.sin(ROT),
    ORIGIN[1] - u * Math.sin(ROT) + v * Math.cos(ROT),
  ];
}

/* ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});

async function shoot(page, path) {
  await mkdir(dirname(path), { recursive: true });
  const buffer = await page.screenshot({ type: "png" });
  await writeFile(path, buffer);
  console.log(`  ${path}  (${Math.round(buffer.length / 1024)} KB)`);
}

/* ------------------------------------------------------------------ */
/* The twin                                                            */
/* ------------------------------------------------------------------ */

async function captureTwin() {
  console.log("twin:");
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`${origin}/?quality=${quality}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => globalThis.__twinStore != null, { timeout: 60000 });
  await sleep(14000);

  // Aerial oblique from the south-east. Close in: the site's own sandy haze
  // is thick enough that from the default orbit distance the compound is a
  // smudge in the middle of the lakebed rather than the subject.
  const [tx, tz] = compound(20, 40);
  const [cx, cz] = compound(420, 520);
  await page.evaluate(
    ({ eye, target }) => globalThis.__twinStore.getState().requestFlyTo(eye, target),
    { eye: [cx, 250, cz], target: [tx, 0, tz] },
  );
  await sleep(9000);
  await shoot(page, "docs/screenshot-overview.png");

  // The dossier: click a structure in the site index and let the fly-to land.
  await page.evaluate(() => {
    const key = new KeyboardEvent("keydown", { key: "i", bubbles: true });
    window.dispatchEvent(key);
  });
  await sleep(1200);
  const picked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      /assembly hangar/i.test(b.textContent ?? ""),
    );
    if (!button) return null;
    button.click();
    return button.textContent?.trim() ?? "";
  });
  console.log(`  dossier: ${picked ?? "no site-index match"}`);
  await sleep(8000);
  await shoot(page, "docs/screenshot-dossier.png");
  await page.close();
}

/* ------------------------------------------------------------------ */
/* Blacksite                                                           */
/* ------------------------------------------------------------------ */

async function captureBlacksite() {
  console.log("blacksite:");
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`${origin}/play?autoplay=1&quality=${quality}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => globalThis.__combatSim != null, { timeout: 90000 });
  await sleep(6000);

  // Run the match forward, then park the player where the fighting is — the
  // frame worth publishing is a firefight, not a spawn.
  const placed = await page.evaluate(() => {
    const { game } = globalThis.__combat;
    const { bots, characters, director } = globalThis.__combatSim;
    const combat = globalThis.__combatModules;
    const player = game.player;
    const kills = [];
    const STEP = 1 / 60;

    for (let i = 0; i < 30 / STEP; i += 1) {
      game.time += STEP;
      bots.setFocus(player.position);
      bots.update(STEP, game.time);
      director.update(STEP);
      combat.resolveDamage(game.time, kills);
      for (const k of kills) director.onKill(k);
      combat.tickActorState(STEP, game.time);
      characters.update(STEP, { position: player.position });
    }

    // Put the camera on a live enemy at a range where a soldier reads as a
    // soldier. Candidate viewpoints are validated against the same geometry
    // the player walks through — a viewpoint chosen on distance alone lands
    // inside a hangar about as often as not, and an interior wall at the near
    // plane is indistinguishable from a broken renderer.
    const world = game.world;
    const MASK_SIGHT = 1 | 2;
    let subject = null;
    let closest = Infinity;
    for (const a of game.actors) {
      if (a.isPlayer || !a.alive || a.team === player.team) continue;
      const d = a.position.distanceTo(player.position);
      if (d < closest) {
        closest = d;
        subject = a;
      }
    }
    if (!subject) return null;

    const chest = subject.position.clone();
    chest.y += 1.2;
    let eye = null;
    let bestScore = -Infinity;
    for (const range of [15, 18, 22, 27, 34]) {
      for (let i = 0; i < 24; i += 1) {
        const angle = (i / 24) * Math.PI * 2;
        const candidate = subject.position.clone();
        candidate.x += Math.cos(angle) * range;
        candidate.z += Math.sin(angle) * range;
        candidate.y = world.groundAt(candidate.x, candidate.z);
        if (!world.isPositionFree(candidate, 0.34, 1.8)) continue;
        const from = candidate.clone();
        from.y += 1.62;
        if (!world.hasLineOfSight(from, chest, MASK_SIGHT, subject.id)) continue;

        // Close is better — a soldier at 40 m on an open apron is four pixels
        // of camouflage against a horizon.
        let score = -range;
        // Sun behind the camera. Shooting into it blows out the sky, drops
        // everything in frame to silhouette, and hides the thing the picture
        // is of. `SUN.azimuthDeg` is 112, in `render/environment.ts`.
        const sunAz = (112 * Math.PI) / 180;
        const toSubject = Math.atan2(chest.x - candidate.x, -(chest.z - candidate.z));
        // Positive when looking away from the sun.
        score += -Math.cos(toSubject - sunAz) * 16;
        // And something behind them is much better than empty lakebed: keep
        // shooting past the subject and see if the compound is back there.
        const away = chest.clone().sub(from).normalize();
        const behind = world.raycast(chest, away, 120, MASK_SIGHT, subject.id);
        if (behind && behind.distance < 90) score += 26;
        // Other bodies in frame make it a firefight rather than a portrait.
        for (const a of game.actors) {
          if (a.isPlayer || !a.alive || a === subject) continue;
          const toward = a.position.clone().sub(from).setY(0);
          const dist = toward.length();
          if (dist > 90 || dist < 1) continue;
          if (toward.normalize().dot(away) > 0.72) score += 5;
        }
        if (score > bestScore) {
          bestScore = score;
          eye = candidate;
        }
      }
    }
    if (!eye) return null;

    player.position.copy(eye);
    player.velocity.set(0, 0, 0);
    player.alive = true;
    player.stance = "stand";
    player.health = player.maxHealth;

    // Half a second so the squad reacts to somebody standing in the open.
    for (let i = 0; i < 30; i += 1) {
      game.time += STEP;
      bots.setFocus(player.position);
      bots.update(STEP, game.time);
      combat.resolveDamage(game.time, kills);
      combat.tickActorState(STEP, game.time);
      characters.update(STEP, { position: player.position });
    }
    return { placed: true };
  });

  // The page's own frame loop keeps advancing the match while the browser
  // catches up on rendering, so aiming happens in a *second* pass, right
  // before the shutter. Aiming inside the step above points the camera at
  // where everybody used to be several seconds ago.
  if (!placed) console.log("  no clear viewpoint found; capturing the spawn");
  await sleep(3500);
  const framed = await page.evaluate(() => {
    const { game } = globalThis.__combat;
    const player = game.player;
    player.alive = true;
    player.health = player.maxHealth;
    player.lastDamageTime = -999;
    player.aimStance = "tac";
    player.velocity.set(0, 0, 0);

    let aimAt = null;
    let aimDistance = Infinity;
    let inFrame = 0;
    for (const a of game.actors) {
      if (a.isPlayer || !a.alive) continue;
      const d = a.position.distanceTo(player.position);
      if (d < 80) inFrame += 1;
      if (a.team !== player.team && d < aimDistance) {
        aimDistance = d;
        aimAt = a;
      }
    }
    if (!aimAt) return null;

    const head = aimAt.position.clone();
    head.y += 1.5;
    const look = head.clone().sub(player.position);
    player.yaw = Math.atan2(-look.x, -look.z);
    // Level the horizon rather than staring at the apron: the eye is already
    // at 1.62 m, so the head of a soldier at any useful range is near zero.
    player.pitch = Math.atan2(
      head.y - (player.position.y + 1.62),
      Math.hypot(look.x, look.z),
    );
    player.alive = true;
    player.health = player.maxHealth;
    player.lastDamageTime = -999;
    player.aimStance = "tac";
    player.aiming = true;
    player.state = "idle";
    player.velocity.set(0, 0, 0);

    return { standoff: +aimDistance.toFixed(1), contacts: inFrame };
  });
  if (framed) {
    console.log(
      `  framed a ${framed.standoff} m engagement, ${framed.contacts} within 80 m`,
    );
  }
  // Brief 50ms tick to let viewmodel matrices update
  await sleep(50);
  await page.evaluate(() => {
    const { game } = globalThis.__combat;
    game.player.alive = true;
    game.player.health = game.player.maxHealth;
    game.player.lastDamageTime = -999;
  });
  await shoot(page, "docs/screenshot-blacksite.png");
  await page.close();
}

if (!only || only === "twin") await captureTwin();
if (!only || only === "blacksite") await captureBlacksite();

await browser.close();
