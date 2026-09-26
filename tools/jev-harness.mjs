/**
 * Shared plumbing for the Jev browser tools (`jev.mjs`, `jev-benchmark.mjs`,
 * `jev-replay.mjs`).
 *
 * ## Why the renderer is stubbed
 *
 * A headless browser renders WebGL through SwiftShader, on the CPU. On a CI
 * runner that is a handful of frames a second and on a small container it is
 * under one; with `dt` clamped to 50 ms per frame, a minute of match time then
 * takes twenty minutes of wall time — while decisions keep arriving in wall
 * time. A brain would get dozens of decisions per simulated second, and every
 * number a benchmark reported would describe the test machine, not the brain.
 *
 * So these tools replace `renderer.render` with a call that only updates the
 * scene's world matrices. Everything the simulation reads — muzzle and camera
 * transforms, character bones, hitboxes — is a matrix, not a pixel, and still
 * updates every frame; the frame loop, the player rig, the bots, the damage
 * resolver and the match director all run exactly as they do in a browser,
 * at the browser's own 60 Hz. Nothing is drawn, which is the point: what these
 * tools measure is play, and `tools/probe.mjs` is where pixels are measured.
 * Pass `--render` to keep real rendering anyway.
 */

import puppeteer from "puppeteer";

export function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

export async function launch() {
  return puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });
}

/**
 * Open `/play` with the given query, wait for the combat and pilot dev handles,
 * and stub rendering unless `--render` was passed. `beforeNavigate` runs on the
 * fresh page first — where request interception must be installed.
 */
export async function openPlay(
  browser,
  origin,
  query,
  { viewport, beforeNavigate } = {},
) {
  const page = await browser.newPage();
  await page.setViewport(viewport ?? { width: 960, height: 540 });
  // Request interception has to be in place before the first decision is
  // requested, and with `autoplay` that is the first second of the page.
  if (beforeNavigate) await beforeNavigate(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 240)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("GL Driver") || text.includes("DevTools")) return;
    // Intercepted or aborted decision requests surface as resource errors;
    // the pilot handles those, and the checks assert on its telemetry instead.
    if (text.includes("Failed to load resource")) return;
    errors.push(text.slice(0, 240));
  });
  await page.goto(`${origin}/play?${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForFunction(
    () => globalThis.__combat != null && globalThis.__jev != null,
    {
      timeout: 90000,
    },
  );
  if (!flag("render")) await stubRendering(page);
  return { page, errors };
}

export async function stubRendering(page) {
  await page.evaluate(() => {
    const gl = globalThis.__combat.r3f.gl;
    gl.render = (scene) => {
      scene.updateMatrixWorld();
    };
  });
}

export function simTime(page) {
  return page.evaluate(() => globalThis.__combat.game.time);
}

/** Wait until `seconds` of simulation time have passed, or `wallLimitS` of real time. */
export async function runFor(page, seconds, wallLimitS = seconds * 4 + 30) {
  const start = await simTime(page);
  const deadline = Date.now() + wallLimitS * 1000;
  for (;;) {
    const now = await simTime(page);
    if (now - start >= seconds) return now - start;
    if (Date.now() > deadline) return now - start;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Wait for the match to go live and the pilot to report its first decision. */
export async function waitForPilot(page, timeoutMs = 60000) {
  await page.waitForFunction(
    () => {
      const director = globalThis.__combat.game.matchDirector;
      return director && director.phase === "live";
    },
    { timeout: timeoutMs },
  );
}

export function telemetry(page) {
  return page.evaluate(() => {
    const t = globalThis.__jev.telemetry;
    return JSON.parse(
      JSON.stringify({
        brain: t.brain,
        label: t.label,
        status: t.status,
        sequence: t.sequence,
        frame: t.frame,
        frameSource: t.frameSource,
        model: t.model,
        latencyMs: t.latencyMs,
        lastError: t.lastError,
        inFlight: t.inFlight,
      }),
    );
  });
}

export function pilotInput(page) {
  return page.evaluate(() => {
    const input = globalThis.__jev.pilot.input;
    return {
      moveX: input.moveX,
      moveY: input.moveY,
      fire: input.fire,
      ads: input.ads,
      sprint: input.sprint,
      leanLeft: input.leanLeft,
      leanRight: input.leanRight,
      lookYaw: input.lookYaw,
      lookPitch: input.lookPitch,
    };
  });
}

export function episode(page) {
  return page.evaluate(() => globalThis.__jev.episode());
}

export function playerState(page) {
  return page.evaluate(() => {
    const { game } = globalThis.__combat;
    const p = game.player;
    return {
      x: p.position.x,
      z: p.position.z,
      yaw: p.yaw,
      pitch: p.pitch,
      alive: p.alive,
      health: p.health,
      kills: p.kills,
      deaths: p.deaths,
      ammo: game.hud.ammo,
      reserve: game.hud.reserve,
      time: game.time,
      screen: globalThis.__combat.store.getState().screen,
    };
  });
}

export function makeReporter() {
  const checks = [];
  const check = (name, pass, detail = "") => {
    checks.push({ name, pass, detail });
    console.log(`  ${pass ? "ok  " : "FAIL"} ${name.padEnd(58)} ${detail}`);
  };
  return { checks, check };
}
