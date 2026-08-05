#!/usr/bin/env node
/**
 * The canonical frame set.
 *
 * Visual work on this project kept going in circles because every review
 * looked at a different frame. A shot into the sun and a shot away from it
 * disagree about almost everything, so "is it better than last time" was
 * never actually answerable.
 *
 * So this captures the same views, from the same positions, on every run,
 * and prints the same numbers for each. It reloads once and then moves the
 * camera through the set via the dev handle, which is both faster than a
 * reload per view and the only way to place a camera precisely.
 *
 *   node tools/frames.mjs                       -> shots/frames/*.png
 *   node tools/frames.mjs --out shots/before
 *   node tools/frames.mjs --origin http://localhost:5199 --quality 3
 *   node tools/frames.mjs --compare shots/before
 *
 * With --compare it diffs this run's statistics against a previous run's
 * manifest and prints what moved, which is the part a reviewer should read
 * before looking at any picture.
 */

import puppeteer from "puppeteer";
import { mkdir, writeFile, readFile } from "node:fs/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "http://localhost:5173");
const outDir = arg("out", "shots/frames");
const quality = arg("quality", "3");
const compare = arg("compare", null);

/**
 * Views chosen to disagree with each other: sun behind, sun ahead, close
 * ground, far horizon, interior corridor, and a character at conversational
 * distance. A change that improves all six is a real change.
 */
const VIEWS = [
  { id: "spawn", at: null, look: null, pitch: -0.02, note: "default spawn, flight line" },
  {
    id: "apron-close",
    at: [1290, 1350],
    look: 45,
    pitch: -0.12,
    note: "clutter and fuel tank, sun behind",
  },
  {
    id: "apron-sun",
    at: [1290, 1350],
    look: 225,
    pitch: -0.05,
    note: "same spot, into the sun",
  },
  {
    id: "desert",
    at: [1440, 1830],
    look: 20,
    pitch: -0.06,
    note: "open lakebed to the horizon",
  },
  {
    id: "hangar",
    at: [960, 1300],
    look: 80,
    pitch: 0.02,
    note: "hangar wall at close range",
  },
  {
    id: "ground",
    at: [1290, 1350],
    look: 45,
    pitch: -0.55,
    note: "ground underfoot, the bottom half of every frame",
  },
];

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const url = `${origin}/play?autoplay=1&quality=${quality}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bring the page back if it went away.
 *
 * A capture run takes minutes and the dev server hot-reloads on any source
 * edit, which destroys the execution context mid-view. Rather than forbid
 * editing during a run, each view checks the handle is live and reloads if it
 * is not — the camera is placed from scratch per view anyway, so a reload
 * costs time and nothing else.
 */
async function ensureReady() {
  const live = await page.evaluate(() => !!globalThis.__combat).catch(() => false);
  if (live) return;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForScene();
}

/**
 * Wait for the scene to be genuinely rendering.
 *
 * A fixed sleep is the wrong mechanism and produced a blank first frame:
 * collision has to bake, the environment map has to be filtered and the
 * quality tier has to settle, and how long that takes depends on the machine.
 * Poll for the state that says it happened instead.
 */
async function waitForScene(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page
      .evaluate(() => {
        const handle = globalThis.__combat;
        if (!handle) return false;
        const { game, r3f } = handle;
        return !!(game.world && r3f.scene.environment && game.stats.drawCalls > 5);
      })
      .catch(() => false);
    if (ready) {
      // A few more frames so exposure and any temporal pass have converged.
      await sleep(1500);
      return true;
    }
    await sleep(500);
  }
  throw new Error(`scene never became ready at ${url}`);
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitForScene();

await mkdir(outDir, { recursive: true });
const manifest = [];

for (const view of VIEWS) {
  await ensureReady();
  const placed = await page.evaluate((v) => {
    const { game } = globalThis.__combat;
    const p = game.player;
    if (v.at) {
      p.position.set(v.at[0], game.world.groundAt(v.at[0], v.at[1]), v.at[1]);
      p.velocity.set(0, 0, 0);
    }
    if (v.look !== null) p.yaw = (v.look * Math.PI) / 180;
    p.pitch = v.pitch;
    return {
      x: +p.position.x.toFixed(1),
      y: +p.position.y.toFixed(2),
      z: +p.position.z.toFixed(1),
      free: game.world.isPositionFree(p.position, 0.34, 1.8),
    };
  }, view);

  // Let the camera settle and any temporal effect converge.
  await sleep(900);
  const path = `${outDir}/${view.id}.png`;
  const buffer = await page.screenshot({ path });

  // Statistics from the encoded frame, so they describe what a viewer sees
  // rather than what the renderer intended.
  const stats = await page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let clipped = 0;
      let crushed = 0;
      let satSum = 0;
      let lowerSum = 0;
      let lowerCount = 0;
      const n = data.length / 4;
      // Local contrast: mean absolute luma difference between neighbouring
      // pixels. This is the number that moves when a surface stops being a
      // flat wash, and it is why it is measured separately for the lower half
      // of the frame, which is always ground.
      let detail = 0;
      let detailCount = 0;
      let counted = 0;
      // Every fourth row, but every pixel within it: the row stride is a
      // four-times speed-up that changes none of the averages, while keeping
      // horizontal neighbours adjacent so local contrast stays exact.
      const ROW_STRIDE = 4;
      // The viewmodel occupies the lower right of every frame, and the HUD the
      // lower corners. Both are opaque foreground, so counting them as "ground"
      // made this metric move whenever the weapon changed — it dropped 4% the
      // day hands were added, which is the metric measuring an improvement as a
      // regression. The ground sample is the lower *left* only.
      const groundRight = Math.floor(width * 0.55);
      const groundBottom = Math.floor(height * 0.88);
      for (let y = 0; y < height; y += ROW_STRIDE) {
        const lower = y > height * 0.55 && y < groundBottom;
        let previous = -1;
        for (let x = 0; x < width; x += 1) {
          const i = y * width + x;
          const r = data[i * 4] / 255;
          const g = data[i * 4 + 1] / 255;
          const b = data[i * 4 + 2] / 255;
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += luma;
          counted += 1;
          if (luma > 0.995) clipped += 1;
          if (luma < 0.005) crushed += 1;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          satSum += max > 0 ? (max - min) / max : 0;
          if (lower && x < groundRight) {
            lowerSum += luma;
            lowerCount += 1;
            if (previous >= 0) {
              detail += Math.abs(luma - previous);
              detailCount += 1;
            }
            previous = luma;
          } else {
            previous = -1;
          }
        }
      }
      void n;
      return {
        luma: +(sum / counted).toFixed(4),
        clippedPct: +((clipped / counted) * 100).toFixed(2),
        crushedPct: +((crushed / counted) * 100).toFixed(2),
        saturation: +(satSum / counted).toFixed(4),
        groundLuma: +(lowerSum / Math.max(1, lowerCount)).toFixed(4),
        groundDetail: +((detail / Math.max(1, detailCount)) * 1000).toFixed(2),
      };
    },
    `data:image/png;base64,${buffer.toString("base64")}`,
  );

  const perf = await page.evaluate(() => {
    const { game } = globalThis.__combat;
    return { draws: game.stats.drawCalls, tris: game.stats.triangles };
  });

  manifest.push({ id: view.id, note: view.note, at: placed, ...stats, ...perf });
  console.log(
    `${view.id.padEnd(12)} luma ${String(stats.luma).padEnd(6)} ` +
      `clip ${String(stats.clippedPct).padEnd(5)}% crush ${String(stats.crushedPct).padEnd(5)}% ` +
      `sat ${String(stats.saturation).padEnd(6)} ` +
      `ground ${String(stats.groundLuma).padEnd(6)} detail ${String(stats.groundDetail).padEnd(6)} ` +
      `${perf.draws} draws${placed.free ? "" : "  [CAMERA INSIDE GEOMETRY]"}`,
  );
}

await writeFile(`${outDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${VIEWS.length} frames -> ${outDir}`);

if (compare) {
  const previous = JSON.parse(await readFile(`${compare}/manifest.json`, "utf8"));
  console.log(`\nagainst ${compare}:`);
  const keys = [
    "luma",
    "clippedPct",
    "crushedPct",
    "saturation",
    "groundLuma",
    "groundDetail",
    "draws",
  ];
  for (const now of manifest) {
    const then = previous.find((p) => p.id === now.id);
    if (!then) continue;
    const moved = keys
      .filter(
        (k) => Math.abs(now[k] - then[k]) > Math.max(0.0005, Math.abs(then[k]) * 0.02),
      )
      .map((k) => `${k} ${then[k]} -> ${now[k]}`);
    console.log(
      `  ${now.id.padEnd(12)} ${moved.length ? moved.join(", ") : "unchanged"}`,
    );
  }
}

await browser.close();
