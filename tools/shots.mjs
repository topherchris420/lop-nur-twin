#!/usr/bin/env node
/**
 * The documentation screenshots.
 *
 * Documentation images go stale the moment anything visible changes, and a
 * README shot recaptured by hand is recaptured from a slightly different
 * place every time — which is exactly the problem `tools/frames.mjs` exists
 * to solve for look development. This does the same for the published images:
 * fixed cameras, fixed framing, one command.
 *
 *   node tools/shots.mjs                       -> all of them, in order
 *   node tools/shots.mjs --only blacksite      (twin | lens | blacksite | debrief | lab | white-paper)
 *   node tools/shots.mjs --origin http://localhost:5199
 *
 * It writes docs/screenshot-overview.png, docs/screenshot-dossier.png,
 * docs/screenshot-lens.png, docs/screenshot-blacksite.png,
 * docs/screenshots/debrief.png, the four R.A.I.N. Lab rooms in
 * docs/screenshots/rain-lab-*.png and docs/white-paper.png. The two Bethesda images in docs/screenshots/ are
 * `node tools/bethesda-look.mjs`'s street-detail.png and survey-detail.png,
 * captured against a preview of dist/.
 *
 * The combat shots step the simulation forward before capturing. A match that
 * has only just started is eleven people walking; the picture worth publishing
 * is the one thirty seconds later, and thirty seconds cannot be waited for in
 * a headless browser that renders at a few frames a second.
 */

import puppeteer from "puppeteer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

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

async function shoot(page, path, options = {}) {
  await mkdir(dirname(path), { recursive: true });
  const buffer = await page.screenshot({ type: "png", ...options });
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
/* The evidence lens                                                   */
/* ------------------------------------------------------------------ */

/**
 * The overview's own framing with the evidence lens on, so the two images
 * differ in exactly one thing: the picture carrying its evidence status. The
 * legend is opened so its tally is in the frame with the paint it counts.
 */
async function captureLens() {
  console.log("lens:");
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`${origin}/?quality=${quality}&lens=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => globalThis.__twinStore != null, { timeout: 60000 });
  await sleep(14000);
  const [tx, tz] = compound(20, 40);
  const [cx, cz] = compound(420, 520);
  await page.evaluate(
    ({ eye, target }) => globalThis.__twinStore.getState().requestFlyTo(eye, target),
    { eye: [cx, 250, cz], target: [tx, 0, tz] },
  );
  await sleep(9000);
  await shoot(page, "docs/screenshot-lens.png");
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
  const place = () =>
    page.evaluate(() => {
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
  const frame = () =>
    page.evaluate(() => {
      const { game } = globalThis.__combat;
      const player = game.player;
      player.alive = true;
      player.health = player.maxHealth;
      player.lastDamageTime = -999;
      player.aimStance = "tac";
      player.velocity.set(0, 0, 0);

      // The match kept running while the browser rendered, so the enemy the
      // viewpoint was chosen for may be behind a wall by now. Aim only at one
      // the eye can actually see, and prefer one with the sun behind the camera:
      // re-aiming at the nearest enemy regardless once pointed the lens at the
      // side of a hangar, into the sun.
      const MASK_SIGHT = 1 | 2;
      const eye = player.position.clone();
      eye.y += 1.62;
      const sunAz = (112 * Math.PI) / 180;
      let aimAt = null;
      let aimDistance = Infinity;
      let bestScore = -Infinity;
      let inFrame = 0;
      for (const a of game.actors) {
        if (a.isPlayer || !a.alive) continue;
        const d = a.position.distanceTo(player.position);
        if (d < 80) inFrame += 1;
        if (a.team === player.team || d < 6 || d > 60) continue;
        const head = a.position.clone();
        head.y += 1.5;
        if (!game.world.hasLineOfSight(eye, head, MASK_SIGHT, a.id)) continue;
        const bearing = Math.atan2(head.x - eye.x, -(head.z - eye.z));
        const score = -d - Math.cos(bearing - sunAz) * 16;
        if (score > bestScore) {
          bestScore = score;
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

  // A match keeps moving; if no enemy is in sight by the time the shutter is
  // ready, place and frame again rather than publish an unframed spawn.
  let framed = null;
  for (let attempt = 1; attempt <= 4 && framed === null; attempt += 1) {
    const placed = await place();
    if (!placed) console.log("  no clear viewpoint found this attempt");
    await sleep(3500);
    framed = await frame();
    if (framed === null) console.log(`  attempt ${attempt}: no enemy in sight to frame`);
  }
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

/* ------------------------------------------------------------------ */
/* The debrief                                                         */
/* ------------------------------------------------------------------ */

/**
 * The results screen after a real match played by a scripted policy: a
 * minute and a quarter of simulation with drawing switched off (the match is
 * the same, it just is not painted — see tools/jev-harness.mjs), then drawing
 * back on, the clock run out, and the debrief photographed as it stands.
 */
async function captureDebrief() {
  console.log("debrief:");
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(
    `${origin}/play?autoplay=1&quality=${Math.min(2, Number(quality))}&brain=script&policy=skirmisher&seed=42&jevNav=places`,
    { waitUntil: "domcontentloaded", timeout: 90000 },
  );
  await page.waitForFunction(() => globalThis.__combat?.r3f?.gl != null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const gl = globalThis.__combat.r3f.gl;
    globalThis.__drawFrame = gl.render.bind(gl);
    gl.render = (scene) => scene.updateMatrixWorld();
  });
  await page.waitForFunction(
    () => globalThis.__combat.game.matchDirector?.phase === "live",
    { timeout: 90000 },
  );
  const start = await page.evaluate(() => globalThis.__combat.game.time);
  for (;;) {
    await sleep(1000);
    const now = await page.evaluate(() => globalThis.__combat.game.time);
    if (now - start >= 75) break;
  }
  await page.evaluate(() => {
    const { game, r3f } = globalThis.__combat;
    r3f.gl.render = globalThis.__drawFrame;
    game.matchDirector.timeRemaining = 0.05;
  });
  await page.waitForFunction(
    () => globalThis.__combat.store.getState().screen === "results",
    { timeout: 60000 },
  );
  await sleep(6000);
  await shoot(page, "docs/screenshots/debrief.png");
  await page.close();
}

/* ------------------------------------------------------------------ */
/* The white paper                                                     */
/* ------------------------------------------------------------------ */

/**
 * The white paper as a page. It embeds the overview and the dossier, so it is
 * taken after them; nothing else regenerated it, and it once went months
 * behind its own HTML. The committed file is rendered from disk with nothing
 * fetched, at 900 CSS pixels and twice the density, in the light scheme the
 * page is designed as paper for.
 */
async function captureWhitePaper() {
  console.log("white paper:");
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (request) =>
    /^(file|data):/.test(request.url()) ? void request.continue() : void request.abort(),
  );
  await page.goto(pathToFileURL("docs/white-paper.html").href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() =>
    [...document.images].filter((image) => image.naturalWidth === 0).map((i) => i.src),
  );
  if (missing.length > 0)
    throw new Error(`white paper: no image at ${missing.join(", ")}`);
  await shoot(page, "docs/white-paper.png", { fullPage: true });
  await page.close();
}

/* ------------------------------------------------------------------ */
/* The R.A.I.N. Lab                                                    */
/* ------------------------------------------------------------------ */

/**
 * The lab, walked the way `tools/rain-lab.mjs` walks its LIVE preview: in
 * through Bethesda's telemetry, a question to the runtime the site's own
 * server holds, the DEMO's proposal stopped at the human boundary, then
 * authorized, pre-registered, run and verified by replay. Four rooms, four
 * frames, each taken when the room says what its caption says.
 *
 * It needs the research runtime on (the dev server and a plain preview both
 * run it in-process, offline engine, nothing configured) and touches no model
 * and no network: the meeting is the offline engine's scripted one, and the
 * run is Bethesda's own simulator in a worker. The question is the DEMO
 * recording's, so the meeting pictured is the recording's, word for word.
 */
async function captureLab() {
  console.log("R.A.I.N. Lab:");
  const demo = JSON.parse(
    await readFile(
      new URL("../src/bethesda/rain/fixtures/demo-meeting.json", import.meta.url),
      "utf8",
    ),
  );
  const status = await (await fetch(`${origin}/api/rain/status`)).json();
  if (status.configured !== true)
    throw new Error(
      "R.A.I.N. Lab: the runtime is off on this server; serve it with nothing configured",
    );
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.setViewport({ width: 1600, height: 900 });
  const waitText = (text, timeout = 180000) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
  const click = (prefix) =>
    page.evaluate((prefix) => {
      const b = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.trim().startsWith(prefix),
      );
      if (!b) throw new Error(`R.A.I.N. Lab: no button “${prefix}”`);
      b.click();
    }, prefix);
  const settle = (n = 24) =>
    page.evaluate(
      (n) =>
        new Promise((done) => {
          let i = 0;
          const f = () => (++i >= n ? done() : requestAnimationFrame(f));
          requestAnimationFrame(f);
        }),
      n,
    );

  // Into Bethesda by its coordinates, then into the lab by its phrase.
  await page.goto(`${origin}/?quality=${quality}`, {
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
  await click("~ telemetry");
  await page.waitForSelector("#city-event");
  await page.focus("#city-event");
  await page.keyboard.sendCharacter("resolve r.a.i.n.");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-rain-lab="active"]');
  await waitText("RUNTIME LIVE");
  await settle(40);
  await shoot(page, "docs/screenshots/rain-lab-threshold.png");

  // The Research Panel: the offline engine's meeting, every turn shown, and
  // R.A.I.N.'s plates saying where the room stands.
  await click("Research Panel");
  await page.waitForSelector("#rain-question");
  await page.focus("#rain-question");
  await page.keyboard.sendCharacter(demo.question);
  await click("Ask R.A.I.N.");
  await waitText("R.A.I.N.'s offline engine answered");
  await click("Show all ");
  await waitText("WHERE THE ROOM STANDS");
  await settle();
  await shoot(page, "docs/screenshots/rain-lab-meeting.png");

  // The Experiment Bay at the boundary: the protocol in full, nothing run.
  await click("Experiment Bay");
  await click("Load the DEMO's scripted proposal");
  await waitText("AWAITING HUMAN APPROVAL");
  await settle();
  await shoot(page, "docs/screenshots/rain-lab-protocol.png");

  // Authorize with the digest's own prefix, pre-register, run, and verify.
  const sha = await page.evaluate(
    () => document.querySelector("aside code.break-all")?.textContent ?? "",
  );
  const prefix = await page.evaluateHandle(() =>
    [...document.querySelectorAll("label")]
      .find((l) => l.textContent.trim().startsWith("First 8 characters"))
      ?.querySelector("input"),
  );
  await prefix.asElement().type(sha.slice(0, 8));
  await page.evaluate(() =>
    document.querySelector('aside input[type="checkbox"]').click(),
  );
  await click("Authorize this definition");
  await click("Pre-register with R.A.I.N., run, and report the measurements");
  await waitText("pre-registered with R.A.I.N. as");
  await page.waitForFunction(
    () => !document.body.innerText.includes("EXPERIMENT RUNNING"),
    { timeout: 300000 },
  );
  await click("Registry / Archive");
  await waitText("R.A.I.N.'S OWN RECORD");
  await click("Verify by replay (no model)");
  await page.waitForFunction(
    () => /Verified: every arm|Verification FAILED/.test(document.body.innerText),
    { timeout: 300000 },
  );
  if (
    !(await page.evaluate(() => document.body.innerText)).includes("Verified: every arm")
  )
    throw new Error("R.A.I.N. Lab: the record did not verify by replay");
  await settle();
  await shoot(page, "docs/screenshots/rain-lab-record.png");
  await page.close();
}

if (!only || only === "twin") await captureTwin();
if (!only || only === "lens") await captureLens();
if (!only || only === "blacksite") await captureBlacksite();
if (!only || only === "debrief") await captureDebrief();
if (!only || only === "lab") await captureLab();
if (!only || only === "white-paper") await captureWhitePaper();

await browser.close();
