#!/usr/bin/env node
/**
 * The README's moving pictures.
 *
 * The README shows the app working rather than describing it: an orbit of the
 * Lop Nur compound while night falls, the evidence timeline rewinding, the
 * hidden city resolving, the shared Bethesda fly as `/live` serves it, and fifty
 * simulated years in each of Noeterra's two worlds. Like the stills
 * `tools/shots.mjs` writes, they go stale the moment anything visible changes,
 * so they are captured by script: fixed cameras, fixed framing, fixed timing,
 * one command.
 *
 *   node tools/readme-media.mjs                  -> all of them, in order
 *   node tools/readme-media.mjs --only orbit     (orbit | evidence | bethesda | live | noeterra | noeterra-tarim | gallery)
 *   node tools/readme-media.mjs --origin http://localhost:5199 --site https://lop-nur-twin.vercel.app
 *
 * It writes docs/media/readme/*.gif and the gallery thumbnails in
 * docs/media/readme/gallery/. Frames go to shots/readme/, which is gitignored.
 * Encoding needs `ffmpeg` and `gifsicle` on the PATH. A moving camera over
 * grainy sand is the worst case for GIF compression: the orbit comes out of
 * ffmpeg at 22 MB and out of gifsicle's lossy pass at 4.
 *
 * The three 3D captures need the dev server (`bun run dev`): they place the
 * camera through the dev-only `window.__twinStore` and `window.__bethesda`
 * handles and the dev server's copy of React Three Fiber. Edit nothing in the
 * repository while they run: Tailwind's plugin reloads the page when any file
 * it scans for class names changes, the README included, and a reload ends
 * the capture. A headless browser on software WebGL takes seconds to render a
 * frame, so these captures do not record the screen: they own the page's
 * clock. `requestAnimationFrame` and `performance.now()` are replaced before
 * any app code runs, and each frame advances the scene by exactly 1/fps of a
 * second before it is photographed. The GIF plays at the app's own speed
 * however long each frame took.
 *
 * `live` and the two Noeterra worlds are recorded in real time from the
 * deployed site (`--site`). `/live` follows the one server-side fly, which no
 * local server can show, and the dev server only has Noeterra's WebAssembly
 * engine after `bun run noeterra:wasm`. The fly does whatever it is doing when
 * this runs — rerun `--only live` if it slept through the recording — and the
 * README's caption names the date of the recording, so update it with the GIF.
 */

import puppeteer from "puppeteer";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "http://localhost:5173");
const site = arg("site", "https://lop-nur-twin.vercel.app");
const only = arg("only", null);
const OUT = "docs/media/readme";
const FRAMES = "shots/readme";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [tool, flag] of [
  ["ffmpeg", "-version"],
  ["gifsicle", "--version"],
]) {
  if (spawnSync(tool, [flag], { stdio: "ignore" }).status !== 0) {
    console.error(`${tool} is not on the PATH; it is needed to encode the GIFs.`);
    process.exit(1);
  }
}

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
/* The page's clock                                                    */
/* ------------------------------------------------------------------ */

/**
 * Replace `requestAnimationFrame` and `performance.now()` before the app loads.
 * Until `__clock.freeze()` both behave natively, so the app boots, compiles its
 * shaders and settles in real time. After it, animation callbacks queue until
 * `__clock.step(ms)` advances the clock and runs them: one call, one frame.
 *
 * `hold(true)` also parks every timeout of a second or more. A virtual-time
 * animation stepped slowly would otherwise be cut short by a real-time timer
 * scheduled to end it — the hidden city's 1.4 s hand-off fires long before its
 * resolution card, stepped one photograph at a time, has finished playing.
 */
async function installClock(page) {
  await page.evaluateOnNewDocument(() => {
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const nativeCaf = window.cancelAnimationFrame.bind(window);
    const nativeNow = performance.now.bind(performance);
    const nativeTimeout = window.setTimeout.bind(window);
    const queue = new Map();
    const parked = [];
    let frozen = false;
    let holding = false;
    let clock = 0;
    let nextId = 1e9;
    performance.now = () => (frozen ? clock : nativeNow());
    window.requestAnimationFrame = (callback) => {
      if (!frozen) return nativeRaf(callback);
      nextId += 1;
      queue.set(nextId, callback);
      return nextId;
    };
    window.cancelAnimationFrame = (id) => {
      if (!queue.delete(id)) nativeCaf(id);
    };
    window.setTimeout = (callback, delay, ...rest) => {
      if (holding && typeof callback === "function" && delay >= 1000) {
        parked.push(() => callback(...rest));
        return 0;
      }
      return nativeTimeout(callback, delay, ...rest);
    };
    window.__clock = {
      freeze() {
        if (frozen) return;
        clock = nativeNow();
        frozen = true;
      },
      step(ms) {
        clock += ms;
        const due = [...queue.values()];
        queue.clear();
        for (const callback of due) {
          try {
            callback(clock);
          } catch (error) {
            console.error(error);
          }
        }
      },
      hold(on) {
        holding = on;
        if (!on) for (const callback of parked.splice(0)) nativeTimeout(callback, 0);
      },
    };
  });
}

/** Take over the clock; give callbacks already queued natively a moment to move. */
async function freeze(page) {
  await page.evaluate(() => window.__clock.freeze());
  await sleep(1500);
}

async function step(page, fps, frames = 1) {
  for (let i = 0; i < frames; i++)
    await page.evaluate((ms) => window.__clock.step(ms), 1000 / fps);
}

/**
 * A numbered frame sequence in shots/readme/<name>/. `shoot(n)` writes the
 * current page n times, which is how a still moment is held in the GIF.
 */
async function frames(page, name) {
  const dir = `${FRAMES}/${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  let n = 0;
  const shoot = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      await page.screenshot({ path: `${dir}/${String(n).padStart(4, "0")}.png` });
      n += 1;
    }
  };
  shoot.dir = dir;
  return shoot;
}

/* ------------------------------------------------------------------ */
/* The twin                                                            */
/* ------------------------------------------------------------------ */

/**
 * Open the twin and wait for the site to come online, not for a clock (see
 * `waitForSiteOnline` in tools/shots.mjs).
 */
async function openTwin(page) {
  await page.goto(`${origin}/?quality=3`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForFunction(() => globalThis.__twinStore != null, { timeout: 180000 });
  await page.waitForFunction(() => globalThis.__twinStore.getState().ready === true, {
    timeout: 300000,
  });
  await sleep(10000); // the intro overlay fades out after the site is ready
}

/**
 * Find the newest canvas's React Three Fiber store and keep it as
 * `globalThis[handle]`. The dev server serves the app's copy of the library at
 * one URL, and importing that same URL hands back the same module, whose
 * `_roots` holds each canvas's camera and orbit controls.
 */
async function sceneStore(page, handle) {
  await page.evaluate(async (handle) => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("@react-three_fiber.js"));
    if (!url)
      throw new Error("React Three Fiber is not served separately: use the dev server");
    const fiber = await import(url);
    const roots = [...fiber._roots.values()];
    globalThis[handle] = roots[roots.length - 1].store;
  }, handle);
}

/** Put the camera exactly here and keep the orbit controls in agreement. */
async function place(page, handle, eye, target) {
  await page.evaluate(
    ({ handle, eye, target }) => {
      const { camera, controls } = globalThis[handle].getState();
      camera.position.set(...eye);
      controls.target.set(...target);
      controls.update();
    },
    { handle, eye, target },
  );
}

const twin = (page, action, value) =>
  page.evaluate(({ action, value }) => globalThis.__twinStore.getState()[action](value), {
    action,
    value,
  });

/** Hide the HUD except the panels matching `keep`. */
async function hideHud(page, keep = []) {
  await page.evaluate((keep) => {
    const canvas = document.querySelector("canvas");
    const visible = new Set();
    for (const selector of keep)
      for (const element of document.querySelectorAll(selector))
        for (let node = element; node; node = node.parentElement) visible.add(node);
    for (let node = canvas; node.parentElement; node = node.parentElement)
      for (const sibling of node.parentElement.children)
        if (sibling !== node && !visible.has(sibling))
          sibling.style.setProperty("display", "none", "important");
  }, keep);
}

/**
 * One orbit of the compound while night falls and lifts again. The sun's
 * transition is the twin's own (`N`, eased in `Atmosphere.tsx`), the radar,
 * patrols and circuit aircraft move at their own speed, and the last frame
 * leads back into the first.
 */
async function captureOrbit(page) {
  console.log("orbit:");
  const FPS = 12;
  const total = FPS * 12;
  await page.setViewport({ width: 1280, height: 720 });
  await openTwin(page);
  await sceneStore(page, "__twinScene");
  await freeze(page);
  await hideHud(page);
  const shoot = await frames(page, "orbit");
  const [cx, cz] = compound(20, 40);
  const start = (35 * Math.PI) / 180;
  const pose = (i) => {
    const a = start - (2 * Math.PI * i) / total;
    return [
      [cx + 400 * Math.cos(a), 165, cz + 400 * Math.sin(a)],
      [cx, 0, cz],
    ];
  };
  await place(page, "__twinScene", ...pose(0));
  await step(page, FPS, 3);
  for (let i = 0; i < total; i++) {
    if (i === Math.round(total * 0.2) || i === Math.round(total * 0.62)) {
      await twin(page, "toggleNight");
      await sleep(250);
    }
    await place(page, "__twinScene", ...pose(i));
    await step(page, FPS);
    await shoot();
  }
  encode("lop-nur-orbit", shoot.dir, { fps: FPS, width: 800, lossy: 140 });
}

/**
 * The evidence lens over today's model, then the evidence timeline rewound to
 * its first dated stop and walked forward to today. At each date the scene
 * draws solid only what public evidence had established by then. The framing
 * is the overview of tools/shots.mjs: the compound sits left of the evidence
 * panel and above the timeline.
 */
async function captureEvidence(page) {
  console.log("evidence:");
  const FPS = 10;
  await page.setViewport({ width: 1600, height: 900 });
  await openTwin(page);
  await sceneStore(page, "__twinScene");
  await freeze(page);
  await hideHud(page, [
    ".site-title",
    ".hud-dock-map",
    ".hud-dock-center",
    ".hud-dock-side",
  ]);
  const dates = await page.evaluate(async () => {
    const temporal = await import("/src/lib/temporal.ts");
    return [...temporal.TEMPORAL_SNAPSHOT_DATES];
  });
  const shoot = await frames(page, "evidence");
  const [tx, tz] = compound(20, 40);
  const [ex, ez] = compound(420, 520);
  // The film grain is redrawn every frame, and a still recaptured as new frames
  // costs a whole frame each in the GIF (8 MB instead of under 1). The lens and
  // the timeline change the scene at once, so each state is photographed once
  // and held.
  const hold = async (seconds) => {
    await place(page, "__twinScene", [ex, 250, ez], [tx, 0, tz]);
    await step(page, FPS, 3);
    await shoot(Math.round(seconds * FPS));
  };
  await hold(1.2);
  await twin(page, "toggleLens");
  await sleep(400);
  await hold(1.6);
  for (const date of dates) {
    await twin(page, "setSnapshotDate", date);
    await sleep(400);
    await hold(date === dates[0] ? 1.2 : 0.8);
  }
  await twin(page, "setSnapshotDate", null);
  await sleep(400);
  await hold(1.8);
  encode("evidence-timeline", shoot.dir, { fps: FPS, width: 960, lossy: 80 });
}

/**
 * The hidden city, entered the way a visitor finds it: the coordinates typed
 * into the twin's telemetry resolver, the location resolving with the card's
 * warning that nothing in the city is evidence, then a slow survey arc over
 * Bethesda with the city's own clock paused.
 */
async function captureBethesda(page) {
  console.log("bethesda:");
  const FPS = 12;
  await page.setViewport({ width: 1280, height: 720 });
  await openTwin(page);
  await sceneStore(page, "__twinScene");
  await page.evaluate(() => {
    for (const selector of [".telemetry-panel", ".topbar-controls", ".hud-dock"])
      for (const element of document.querySelectorAll(selector))
        element.style.setProperty("display", "none", "important");
  });
  await freeze(page);
  const shoot = await frames(page, "bethesda");
  const [cx, cz] = compound(20, 40);
  const a = (35 * Math.PI) / 180;
  await place(
    page,
    "__twinScene",
    [cx + 400 * Math.cos(a), 165, cz + 400 * Math.sin(a)],
    [cx, 0, cz],
  );
  await step(page, FPS, 3);
  await shoot(8);

  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await sleep(300);
  await shoot(6);
  await page.focus("#anomaly-coordinate");
  for (const character of "38.9847,-77.0947") {
    await page.keyboard.sendCharacter(character);
    await sleep(60);
    await shoot();
  }
  await shoot(8);

  // Park the 1.4 s hand-off to the city while the card's animation is stepped,
  // and poll on an interval: polling by animation frame would wait forever on
  // the frozen clock.
  await page.evaluate(() => window.__clock.hold(true));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.body.innerText.includes("ANOMALOUS LOCATION RESOLUTION"),
    { polling: 100 },
  );
  for (let i = 0; i < Math.ceil(1.15 * FPS); i++) {
    await step(page, FPS);
    await sleep(40);
    await shoot();
  }
  await shoot(Math.round(1.6 * FPS));
  await page.evaluate(() => window.__clock.hold(false));

  await page.waitForSelector('[data-bethesda="active"]', { timeout: 300000 });
  await page.waitForFunction(() => globalThis.__bethesda?.view, {
    timeout: 300000,
    polling: 250,
  });
  await page.evaluate(() => {
    globalThis.__bethesda.view.quality = "detail";
  });
  // the city builds its streets while the clock is stepped
  for (let i = 0; i < 40; i++) {
    await step(page, FPS);
    await sleep(250);
  }
  for (const name of ["Pause", "Survey"])
    await page.evaluate((name) => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === name,
      );
      if (!button) throw new Error(`no ${name} button in the city`);
      button.click();
    }, name);
  await sleep(500);
  await step(page, FPS, 6);
  await sceneStore(page, "__cityScene");
  const { eye, target } = await page.evaluate(() => {
    const { camera, controls } = globalThis.__cityScene.getState();
    return { eye: camera.position.toArray(), target: controls.target.toArray() };
  });
  const radius = Math.hypot(eye[0] - target[0], eye[2] - target[2]);
  const bearing = Math.atan2(eye[2] - target[2], eye[0] - target[0]);
  const total = Math.round(3.6 * FPS);
  for (let i = 0; i < total; i++) {
    const k = i / (total - 1);
    const scale = 1.05 - 0.2 * k;
    const angle = bearing - 0.55 * k;
    await place(
      page,
      "__cityScene",
      [
        target[0] + radius * scale * Math.cos(angle),
        target[1] + (eye[1] - target[1]) * scale,
        target[2] + radius * scale * Math.sin(angle),
      ],
      target,
    );
    await step(page, FPS);
    await shoot();
  }
  await shoot(Math.round(0.8 * FPS));
  encode("bethesda-reveal", shoot.dir, { fps: FPS, width: 800, lossy: 80 });
}

/* ------------------------------------------------------------------ */
/* The deployed site, in real time                                     */
/* ------------------------------------------------------------------ */

/**
 * Twenty-four seconds of `/live`, two frames a second, played back at twice
 * the speed. Everything on the page comes from the observer of the one fly;
 * the log of what it decided, and why, is the part worth watching.
 */
async function captureLive(page) {
  console.log("live:");
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${site}/live`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => /What it decided/i.test(document.body.innerText), {
    timeout: 120000,
    polling: 500,
  });
  for (let i = 0; i < 3; i++) {
    await page.click('button[aria-label="Zoom in"]');
    await sleep(300);
  }
  await sleep(3000);
  const shoot = await frames(page, "live");
  const states = new Set();
  const started = new Date();
  for (let i = 0; i < 48; i++) {
    const t = Date.now();
    await shoot();
    states.add(
      await page.evaluate(() => document.body.innerText.match(/NOW\s+(\S[^\n]*)/i)?.[1]),
    );
    await sleep(Math.max(0, 500 - (Date.now() - t)));
  }
  console.log(`  recorded ${started.toISOString()}: ${[...states].join(" → ")}`);
  encode("live-fly", shoot.dir, {
    fps: 4,
    width: 960,
    colors: 128,
    dither: "none",
    lossy: 40,
  });
}

/**
 * A Noeterra world in observer mode, seed 1: one frame for every five simulated
 * years, each showing the first three events of those years. The engine is
 * deterministic, so the same seed plays the same fifty years. The page is shown
 * with reduced motion, as the app renders it for visitors who ask for that:
 * the map's highlights pulse otherwise, and a frame photographed at a different
 * point in the pulse made every rerun a new GIF of the same years.
 */
async function captureNoeterra(page, scenario, name) {
  console.log(`${name}:`);
  await page.setViewport({ width: 1280, height: 760 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`${site}/noeterra?scenario=${scenario}&play=observe&seed=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const press = (label) =>
    page.evaluate((label) => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
      );
      button?.click();
      return Boolean(button);
    }, label);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((b) =>
        /Next season/.test(b.textContent),
      ),
    { timeout: 120000 },
  );
  await sleep(2500);
  const shoot = await frames(page, name);
  await shoot(2);
  for (let i = 0; i < 10; i++) {
    if (!(await press("5 years"))) throw new Error("no '5 years' button");
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((b) =>
          /Resolving/.test(b.textContent),
        ),
      { timeout: 120000 },
    );
    await sleep(600);
    for (let k = 0; k < 2; k++) {
      await press("Next event");
      await sleep(350);
    }
    await shoot();
  }
  await shoot(2);
  encode(name, shoot.dir, { fps: 1.25, width: 960, statsMode: "full", lossy: 60 });
}

/* ------------------------------------------------------------------ */
/* The gallery                                                         */
/* ------------------------------------------------------------------ */

/**
 * The six thumbnails under "Start exploring", 640 x 360 JPEG, cut from the
 * committed screenshots and from this script's own frames. A source that is
 * not on disk is skipped and named.
 */
function captureGallery() {
  console.log("gallery:");
  const tiles = [
    ["twin", "docs/screenshot-lens.png", "crop=1040:585:250:290"],
    ["live-fly", `${FRAMES}/live/0022.png`, null],
    ["garden", "docs/media/live-garden/macro.webp", "crop=1440:810:0:45"],
    ["rain-lab", "docs/screenshots/rain-lab-meeting.png", null],
    ["noeterra", `${FRAMES}/noeterra/0006.png`, "crop=1280:720:0:20"],
    ["blacksite", "docs/screenshot-blacksite.png", null],
  ];
  for (const [name, source, crop] of tiles) {
    if (!existsSync(source)) {
      console.log(`  ${name}: ${source} is missing, skipped`);
      continue;
    }
    const filter = [crop, "scale=640:360:flags=lanczos"].filter(Boolean).join(",");
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-vf",
      filter,
      "-q:v",
      "4",
      `${OUT}/gallery/${name}.jpg`,
    ]);
    console.log(`  ${OUT}/gallery/${name}.jpg`);
  }
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

/**
 * One palette for the whole sequence, ordered dither, then gifsicle's lossy
 * LZW. The palette counts the pixels that change between frames (`diff`), so a
 * moving subject is not starved of colours by a still background; Noeterra,
 * whose every frame is a new picture, counts them all (`full`).
 */
function encode(
  name,
  dir,
  { fps, width, colors = 256, dither = "bayer:bayer_scale=4", statsMode = "diff", lossy },
) {
  const raw = `${dir}.gif`;
  run("ffmpeg", [
    ...["-v", "error", "-y", "-framerate", String(fps), "-i", `${dir}/%04d.png`, "-vf"],
    `scale=${width}:-1:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=${colors}:stats_mode=${statsMode}[p];` +
      `[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`,
    ...["-loop", "0", raw],
  ]);
  run("gifsicle", ["-O3", `--lossy=${lossy}`, raw, "-o", `${OUT}/${name}.gif`]);
  console.log(`  ${OUT}/${name}.gif`);
}

/* ------------------------------------------------------------------ */

const CAPTURES = {
  orbit: captureOrbit,
  evidence: captureEvidence,
  bethesda: captureBethesda,
  live: captureLive,
  noeterra: (page) => captureNoeterra(page, "mediterranean-264bc", "noeterra"),
  "noeterra-tarim": (page) => captureNoeterra(page, "tarim-77bc", "noeterra-tarim"),
  gallery: captureGallery,
};
if (only && !(only in CAPTURES)) {
  console.error(`--only takes one of: ${Object.keys(CAPTURES).join(", ")}`);
  process.exit(1);
}

await mkdir(`${OUT}/gallery`, { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  protocolTimeout: 600000,
});
try {
  for (const [name, capture] of Object.entries(CAPTURES)) {
    if (only && only !== name) continue;
    // a fresh page per capture, so each starts on a native clock
    const page = await browser.newPage();
    await installClock(page);
    page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
    await capture(page);
    await page.close();
  }
} finally {
  await browser.close();
}
