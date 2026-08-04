#!/usr/bin/env node
/**
 * Close-range character capture.
 *
 * Puts the camera a few metres from a live soldier and holds it there while
 * the frame is taken. Everything about a character that reads at 3 m —
 * silhouette, gait, where the hands are, whether the camouflage survives
 * being seen — is invisible in a wide establishing shot, which is what every
 * other capture in this repo produces.
 *
 *   node tools/closeup.mjs                       walking soldier, 3 m
 *   node tools/closeup.mjs --distance 2 --speed 6
 *   node tools/closeup.mjs --out shots/x.png
 *
 * The gait numbers come from `tools/gait.mjs`; this is for everything a
 * number cannot describe.
 */

import puppeteer from "puppeteer";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "http://localhost:5173");
const distance = Number(arg("distance", 3));
const speed = Number(arg("speed", 2.6));
const out = arg("out", "shots/closeup.png");
const quality = arg("quality", "3");

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto(`${origin}/play?autoplay=1&quality=${quality}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((resolve) => setTimeout(resolve, 12000));

/**
 * Stand the player off a bot's shoulder and hold the bot in a chosen gait.
 * Re-applied right before the capture because the simulation keeps running
 * and would otherwise walk the subject out of frame.
 */
const stage = (dist, walkSpeed) =>
  page.evaluate(
    ({ dist, walkSpeed }) => {
      const { game } = globalThis.__combat;
      const bot = game.actors.find((a) => !a.isPlayer && a.alive);
      if (!bot) return { error: "no live bot" };
      const p = game.player;

      // Bring the subject to the player rather than the other way round: the
      // player's spawn is the one position the game has already checked is
      // clear, and teleporting the camera to a bot tends to land it inside
      // whatever the bot was taking cover behind.
      let placed = null;
      for (let i = 0; i < 16 && !placed; i += 1) {
        const yaw = p.yaw + (i % 2 === 0 ? 1 : -1) * Math.floor(i / 2) * 0.4;
        const x = p.position.x - Math.sin(yaw) * dist;
        const z = p.position.z - Math.cos(yaw) * dist;
        const y = game.world.groundAt(x, z);
        const at = { x, y, z, isVector3: true };
        if (game.world.isPositionFree(at, 0.4, 1.8)) placed = { x, y, z, yaw };
      }
      if (!placed) return { error: "no clear ground in front of the player" };

      bot.position.set(placed.x, placed.y, placed.z);
      // Side-on to the camera, walking across frame: a gait reads far better
      // in profile than head-on.
      bot.yaw = placed.yaw + Math.PI / 2;
      bot.pitch = 0;
      bot.stance = "stand";
      bot.state = walkSpeed > 5 ? "sprint" : walkSpeed > 0.4 ? "run" : "idle";
      bot.speed = walkSpeed;
      bot.velocity.set(-Math.sin(bot.yaw) * walkSpeed, 0, -Math.cos(bot.yaw) * walkSpeed);

      p.velocity.set(0, 0, 0);
      p.yaw = placed.yaw;
      p.pitch = -0.05;
      return {
        bot: bot.name,
        at: [+placed.x.toFixed(1), +placed.z.toFixed(1)],
      };
    },
    { dist, walkSpeed },
  );

const first = await stage(distance, speed);
if (first.error) {
  console.error(`closeup: ${first.error}`);
  await browser.close();
  process.exit(1);
}

// Let the gait run for a moment so the capture is mid-stride, not mid-rest.
await new Promise((resolve) => setTimeout(resolve, 1200));
await stage(distance, speed);
await new Promise((resolve) => setTimeout(resolve, 260));
await stage(distance, speed);
await new Promise((resolve) => setTimeout(resolve, 90));

await mkdir(dirname(out), { recursive: true });
await page.screenshot({ path: out });
console.log(`closeup: ${first.bot} at ${first.at.join(", ")} -> ${out}`);

await browser.close();
