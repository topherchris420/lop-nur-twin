#!/usr/bin/env node
/**
 * Scene inspector for the first-person mode.
 *
 * `tools/probe.mjs` tells you what a frame *looks* like; this tells you why.
 * It opens a page, waits for the scene to settle and dumps the live state the
 * renderer is actually working from — camera placement, light intensities,
 * collider counts, whether an environment map is bound, and any oversized
 * transparent geometry sitting in front of the camera.
 *
 * Every rendering bug found while building this mode was diagnosed here rather
 * than by staring at pixels: a camera that never left its spawn, an
 * environment map poisoned with NaN, a bloom pass fed infinities by the sun.
 *
 *   node tools/inspect.mjs
 *   node tools/inspect.mjs "http://localhost:5173/play?autoplay=1&quality=3"
 *
 * Requires the dev server (`bun run dev`) — the handle it reads,
 * `globalThis.__combat`, is stripped from production builds.
 */

import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:5173/play?autoplay=1&quality=3";
const settleMs = Number(process.argv[3] ?? 9000);

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  const text = m.text();
  if (m.type() === "error" || m.type() === "warning") {
    if (!text.includes("GL Driver") && !text.includes("DevTools")) {
      console.log(`[${m.type()}]`, text.slice(0, 300));
    }
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, settleMs));

const report = await page.evaluate(() => {
  const handle = globalThis.__combat;
  if (!handle) return { error: "no __combat handle — is this a dev build of /play?" };
  const { r3f: state, game } = handle;
  const round = (v) => +v.toFixed(2);

  const lights = [];
  const bigTransparent = [];
  let meshes = 0;
  state.scene.traverse((o) => {
    if (o.isLight) {
      lights.push({
        type: o.type,
        intensity: +o.intensity.toFixed(3),
        castShadow: !!o.castShadow,
        shadowMap: o.shadow ? o.shadow.mapSize.x : null,
      });
    }
    if (o.isMesh) {
      meshes += 1;
      if (o.material?.transparent) {
        o.geometry.computeBoundingSphere?.();
        const radius = o.geometry.boundingSphere?.radius ?? 0;
        if (radius > 200) {
          bigTransparent.push({
            name: o.name || o.type,
            radius: Math.round(radius),
            y: round(o.position.y),
            opacity: o.material.opacity,
            visible: o.visible,
          });
        }
      }
    }
  });

  return {
    camera: {
      position: state.camera.position.toArray().map(round),
      fov: round(state.camera.fov),
      near: state.camera.near,
      far: state.camera.far,
    },
    player: {
      position: game.player.position.toArray().map(round),
      yawDeg: Math.round((game.player.yaw * 180) / Math.PI),
      health: Math.round(game.player.health),
      grounded: game.player.grounded,
      weapon: game.player.weaponId,
    },
    hud: {
      ammo: game.hud.ammo,
      reserve: game.hud.reserve,
      spreadDeg: round(game.hud.spreadDeg),
    },
    stats: game.stats,
    scene: {
      children: state.scene.children.map((c) => `${c.type}:${c.name || "-"}`),
      meshes,
      environmentBound: !!state.scene.environment,
      environmentIntensity: state.scene.environmentIntensity,
      fogDensity: state.scene.fog?.density ?? null,
      bigTransparent,
    },
    lights,
    renderer: {
      toneMapping: state.gl.toneMapping,
      exposure: state.gl.toneMappingExposure,
      shadowsEnabled: state.gl.shadowMap.enabled,
    },
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
