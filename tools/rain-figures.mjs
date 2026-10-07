#!/usr/bin/env node
/**
 * The R.A.I.N. Lab's four perspectives, close up, for look development.
 *
 * A screenshot of the Research Panel shows the figures at a few dozen pixels
 * each, which is no way to judge a face, a hand or a walk. This walks into the
 * lab the way `tools/shots.mjs` does, puts the HUD away, and frames each
 * perspective at its station — full figure and head — then stages the DEMO
 * meeting and photographs the walk to the table and the table itself; last it
 * sends Luca out to Woodmont, returns to Bethesda and follows his jog from the
 * survey camera, zoomed in. The lab's cameras come from `labLayout.ts`, so a
 * moved station moves the shot.
 *
 *   bun run dev &
 *   node tools/rain-figures.mjs                    -> shots/rain-figures/*.png
 *   node tools/rain-figures.mjs --out shots/before --hud
 *   node tools/rain-figures.mjs --only portraits   (portraits | meeting | city)
 *
 * It waits in rendered frames, not milliseconds: under software WebGL a frame
 * can take a second, and the figures' clock is the frame loop's.
 */
import puppeteer from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

await import("../scripts/ts-hooks.mjs");
const { STATIONS, SEATS, TABLE } = await import("../src/bethesda/rain/labLayout.ts");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const origin = arg("origin", "http://localhost:5173");
const out = arg("out", "shots/rain-figures");
const only = arg("only", null);
const hud = process.argv.includes("--hud");
const width = Number(arg("width", "1280")),
  height = Number(arg("height", "800"));

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
page.setDefaultTimeout(180000);
await page.setViewport({ width, height });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.error("navigated:", f.url());
});
page.on("error", (e) => console.error("page crashed:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("console:", m.text().slice(0, 300));
});

const waitText = (text, timeout = 180000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let i = 0;
        const f = () => (++i >= n ? done() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
async function shoot(name) {
  await mkdir(out, { recursive: true });
  const path = join(out, `${name}.png`);
  const buffer = await page.screenshot({ type: "png" });
  await writeFile(path, buffer);
  console.log(`  ${path}  (${Math.round(buffer.length / 1024)} KB)`);
}
/** Stand the visitor's camera at `from`, looking at a point at height `y`. */
async function look(from, at, y) {
  await page.evaluate(
    ({ from, at, y }) => {
      const { nav } = globalThis.__rainLab;
      const dx = at.x - from.x,
        dz = at.z - from.z;
      nav.teleport = { x: from.x, z: from.z };
      nav.yaw = Math.atan2(-dx, -dz);
      nav.pitch = Math.atan2(y - 1.65, Math.hypot(dx, dz));
    },
    { from, at, y },
  );
  await frames(8);
}

// Into Bethesda by its coordinates, then into the lab by its phrase.
await page.goto(`${origin}/?quality=1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await waitText("EVIDENCE TIMELINE", 90000);
await page.keyboard.press("Backquote");
await page.waitForSelector("#anomaly-coordinate");
await page.focus("#anomaly-coordinate");
await page.keyboard.sendCharacter("38.9847,-77.0947");
await page.keyboard.press("Enter");
await page.waitForSelector('[data-bethesda="active"]');
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.trim().startsWith("~ telemetry"),
  );
  b?.click();
});
await page.waitForSelector("#city-event");
await page.focus("#city-event");
await page.keyboard.sendCharacter("resolve r.a.i.n.");
await page.keyboard.press("Enter");
await page.waitForSelector('[data-rain-lab="active"]');
await page.waitForFunction(() => globalThis.__rainLab != null);
if (!hud)
  await page.addStyleTag({
    content:
      '[data-rain-lab] header, [data-rain-lab] aside, [data-rain-lab] nav, [data-rain-lab] section[aria-label="Rooms"], [data-rain-lab] [role="status"] { display: none !important; }',
  });
await frames(30);

const forward = (f) => ({ x: -Math.sin(f), z: -Math.cos(f) });

if (!only || only === "portraits") {
  console.log("portraits:");
  for (const [who, s] of Object.entries(STATIONS)) {
    const f = forward(s.facing);
    const octopus = who === "James";
    // Full figure from 2.1 m, then the head from under a metre.
    await look(
      { x: s.at.x + f.x * 2.1, z: s.at.z + f.z * 2.1 },
      s.at,
      octopus ? 0.8 : 1.0,
    );
    await frames(40);
    await shoot(`portrait-${who.toLowerCase()}`);
    const d = octopus ? 0.95 : 0.75;
    await look({ x: s.at.x + f.x * d, z: s.at.z + f.z * d }, s.at, octopus ? 1.0 : 1.6);
    await frames(30);
    await shoot(`face-${who.toLowerCase()}`);
  }
}

if (!only || only === "meeting") {
  console.log("meeting:");
  // The DEMO recording: no runtime, no network, the recording's own words.
  await page.evaluate(() => globalThis.__rainLab.store.playDemo());
  // Jasmine's walk from the bay across the Observation Room, three frames
  // apart; Luca crosses the same room from his station.
  await look({ x: -4.6, z: -15.2 }, { x: 3, z: -9 }, 0.95);
  for (const n of [1, 2, 3]) {
    await frames(28);
    await shoot(`walk-${n}`);
  }
  // The table from the threshold side, over R.A.I.N.'s plates, once all are seated.
  await frames(220);
  await look({ x: 0.6, z: 6.4 }, { x: TABLE.center.x, z: TABLE.center.z }, 1.05);
  await frames(30);
  await shoot("meeting-threshold");
  // And from the Systems Room side, through the glass.
  await look({ x: 5.2, z: 1.2 }, { x: SEATS.Jasmine.x + 1.2, z: 0.6 }, 1.15);
  await frames(30);
  await shoot("meeting-side");
}

if (!only || only === "city") {
  console.log("city:");
  // Luca's outing: the shortest route from the lab's door, 145 m at a jog.
  const sent = await page.evaluate(() => {
    const { store } = globalThis.__rainLab;
    store.sendOuting("Luca", "woodmont_bethesda");
    return store.outings.length;
  });
  if (!sent) throw new Error("rain-figures: the outing was refused");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Return to Bethesda",
    );
    b?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[data-rain-lab="active"]'));
  // Aim the survey camera where he will be a few seconds from now, close in.
  await page.evaluate(() => {
    const { store } = globalThis.__rainLab;
    const { sim, view } = globalThis.__bethesda;
    const o = store.outings[0];
    const s = Math.min(o.length, (sim.tick - o.startTick) * 0.3 + 30);
    let i = 1;
    while (i < o.cumulative.length - 1 && o.cumulative[i] < s) i++;
    const a = o.path[i - 1],
      b = o.path[i];
    const t = (s - o.cumulative[i - 1]) / (o.cumulative[i] - o.cumulative[i - 1] || 1);
    view.target = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const survey = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Survey",
    );
    survey?.click();
  });
  await frames(10);
  // Zoom on the canvas itself: the HUD's transparent overlay would take a
  // wheel event aimed at the middle of the screen.
  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => {
      // The city's view is the largest canvas; the minimap is another.
      const canvas = [
        ...document.querySelectorAll('[data-bethesda="active"] canvas'),
      ].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      canvas?.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true, cancelable: true }),
      );
    });
    await frames(2);
  }
  for (const n of [1, 2, 3]) {
    await frames(12);
    await shoot(`city-${n}`);
  }
}

await browser.close();
