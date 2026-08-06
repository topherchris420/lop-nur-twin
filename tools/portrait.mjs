#!/usr/bin/env node
/**
 * Character portraits.
 *
 * Judging a character from a gameplay frame does not work. At the game's
 * field of view a soldier standing two metres away is about three hundred
 * pixels tall, which is enough to tell that something is a person and not
 * enough to tell whether its kit, proportions or face are any good — so
 * every review of the character so far has been guesswork, in both
 * directions.
 *
 * This borrows the world camera and narrows it to a portrait lens. A 28
 * degree lens at 3.6 m frames a 1.8 m subject head to toe; the head study
 * drops to 9 degrees.
 *
 * Two things it has to do that are not obvious. The lens is set through the
 * *store*, because the player rig eases the camera toward that setting every
 * frame and would undo a direct write before the shutter. And the camera
 * stands still while the subject turns, because orbiting the camera moves the
 * sun from behind the lens to behind the subject and half the set comes back
 * as unjudgeable silhouette.
 *
 *   node tools/portrait.mjs                 -> shots/portrait/*.png
 *   node tools/portrait.mjs --out shots/x --stance crouch
 *
 * Exits non-zero if no subject could be staged.
 */

import puppeteer from "puppeteer";
import { mkdir } from "node:fs/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "http://localhost:5173");
const outDir = arg("out", "shots/portrait");
const stance = arg("stance", "stand");
const quality = arg("quality", "3");

/** Angle around the subject, lens, and what the shot is for. */
const SHOTS = [
  {
    id: "front",
    angle: 0,
    fov: 28,
    distance: 3.6,
    aim: 0.95,
    note: "silhouette, kit layout, proportions",
  },
  {
    id: "three-quarter",
    angle: 40,
    fov: 28,
    distance: 3.6,
    aim: 0.95,
    note: "the angle a player actually sees",
  },
  {
    id: "side",
    angle: 90,
    fov: 28,
    distance: 3.6,
    aim: 0.95,
    note: "pack depth, boot length, spine",
  },
  {
    id: "back",
    angle: 180,
    fov: 28,
    distance: 3.6,
    aim: 0.95,
    note: "pack, helmet rear, belt line",
  },
  {
    id: "head",
    angle: 25,
    fov: 9,
    distance: 2.4,
    aim: 1.62,
    note: "helmet, face, NVG mount",
  },
  {
    id: "boots",
    angle: 30,
    fov: 12,
    distance: 2.2,
    aim: 0.22,
    note: "boot proportion and tread",
  },
];

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1200 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await page.goto(`${origin}/play?autoplay=1&quality=${quality}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

// Poll for a scene that is genuinely rendering rather than sleeping a fixed
// amount; a blank first frame has caught every other tool in this directory.
for (let i = 0; i < 120; i += 1) {
  const ready = await page
    .evaluate(() => {
      const h = globalThis.__combat;
      return !!(
        h &&
        h.game.world &&
        h.r3f.scene.environment &&
        h.game.stats.drawCalls > 5
      );
    })
    .catch(() => false);
  if (ready) break;
  await sleep(500);
}
await sleep(1500);

await mkdir(outDir, { recursive: true });

const staged = await page.evaluate((wantStance) => {
  const { game } = globalThis.__combat;
  const bot = game.actors.find((a) => !a.isPlayer && a.alive);
  if (!bot) return { error: "no live bot" };

  // Stand the subject on open ground near the player's validated spawn, so it
  // is not half inside whatever it was taking cover behind.
  const p = game.player;
  let spot = null;
  for (let i = 0; i < 24 && !spot; i += 1) {
    const yaw = p.yaw + i * 0.42;
    const x = p.position.x - Math.sin(yaw) * 6;
    const z = p.position.z - Math.cos(yaw) * 6;
    const y = game.world.groundAt(x, z);
    if (game.world.isPositionFree({ x, y, z, isVector3: true }, 0.5, 1.9))
      spot = { x, y, z };
  }
  if (!spot) return { error: "nowhere clear to stand the subject" };

  bot.position.set(spot.x, spot.y, spot.z);
  bot.stance = wantStance;
  bot.state = "idle";
  bot.speed = 0;
  bot.pitch = 0;
  bot.velocity.set(0, 0, 0);
  bot.suppression = 0;
  globalThis.__portraitSubject = bot.id;
  globalThis.__portraitAt = { x: spot.x, y: spot.y, z: spot.z };
  return { name: bot.name, at: [+spot.x.toFixed(1), +spot.z.toFixed(1)] };
}, stance);

if (staged.error) {
  console.error(`portrait: ${staged.error}`);
  await browser.close();
  process.exit(1);
}

for (const shot of SHOTS) {
  await page.evaluate((s) => {
    const { game, r3f } = globalThis.__combat;
    const bot = game.actorById.get(globalThis.__portraitSubject);
    if (!bot) return;

    bot.speed = 0;
    bot.velocity.set(0, 0, 0);
    bot.state = "idle";

    const theta = (s.angle * Math.PI) / 180;
    const p = game.player;
    // The camera stands where the light is and the subject turns in front of
    // it. `1.25 pi` is the yaw that faces the subject at the camera, since the
    // camera sits off its +x/+z quarter — which is the side the sun is on at
    // this azimuth, so every shot has the light over the lens's shoulder.
    bot.yaw = Math.PI * 1.25 + theta;
    const x = bot.position.x + 0.707 * s.distance;
    const z = bot.position.z + 0.707 * s.distance;
    p.position.set(x, game.world.groundAt(x, z), z);
    p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(bot.position.x - x), -(bot.position.z - z));

    // Aim at a height on the subject rather than at its feet.
    const eye = p.position.y + 1.62;
    p.pitch = Math.atan2(bot.position.y + s.aim - eye, s.distance);

    // Set the *setting*, not the camera. The rig eases the camera toward the
    // store's field of view every frame, so writing `camera.fov` directly is
    // undone before the next capture — which is why this lens never took.
    globalThis.__combat.store.setState({ fov: s.fov });
    r3f.camera.fov = s.fov;
    r3f.camera.updateProjectionMatrix();
  }, shot);

  // Settle the pose, then re-pin the subject right before the shutter: the
  // bot manager keeps running between calls and walks it into a stride.
  await sleep(650);
  await page.evaluate((s) => {
    const { game } = globalThis.__combat;
    const bot = game.actorById.get(globalThis.__portraitSubject);
    if (!bot) return;
    const theta = (s.angle * Math.PI) / 180;
    const p = game.player;
    bot.speed = 0;
    bot.velocity.set(0, 0, 0);
    bot.state = "idle";
    bot.yaw = Math.PI * 1.25 + theta;
    bot.position.set(
      globalThis.__portraitAt.x,
      globalThis.__portraitAt.y,
      globalThis.__portraitAt.z,
    );
    const x = bot.position.x + 0.707 * s.distance;
    const z = bot.position.z + 0.707 * s.distance;
    p.position.set(x, game.world.groundAt(x, z), z);
    p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(bot.position.x - x), -(bot.position.z - z));
    p.pitch = Math.atan2(bot.position.y + s.aim - (p.position.y + 1.62), s.distance);
  }, shot);
  await sleep(70);
  await page.screenshot({ path: `${outDir}/${shot.id}.png` });
  console.log(`${shot.id.padEnd(14)} ${shot.fov}deg at ${shot.distance}m  ${shot.note}`);
}

console.log(`\n${SHOTS.length} portraits of ${staged.name} -> ${outDir}`);
await browser.close();
