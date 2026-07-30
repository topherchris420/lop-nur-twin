#!/usr/bin/env node
/**
 * Visual verification probe.
 *
 * Launches a headless browser, opens the local dev server, waits for the
 * scene to settle and writes a screenshot to `render_output.png`, then prints
 * exposure statistics for the captured frame so shader values can be tuned
 * against numbers instead of vibes.
 *
 *   node tools/probe.mjs
 *   node tools/probe.mjs --url http://localhost:5173/?quality=3 --wait 4000
 *   node tools/probe.mjs --url "/?quality=3" --url "/?quality=3&night=1"
 *
 * Options
 *   --url <url>       Page to capture. Relative values resolve against
 *                     --origin. Repeatable; extra captures get numbered
 *                     output files. Default: /?quality=3
 *   --origin <url>    Dev server origin. Default: http://localhost:5173
 *   --out <path>      Output PNG. Default: render_output.png
 *   --wait <ms>       Settle time after load before capturing. Default: 2000
 *   --width <px>      Viewport width. Default: 1600
 *   --height <px>     Viewport height. Default: 900
 *   --scale <n>       Device pixel ratio. Default: 1
 *   --selector <css>  Capture just this element instead of the viewport.
 *   --keys <seq>      Comma-separated keys to press once the page has
 *                     settled, before a second settle and the capture.
 *                     The app's hotkeys are 1/2/3 cameras, n day/night,
 *                     i index, r research, h help, m measure.
 *   --focus <name>    Fly the orbit camera to the first structure whose name
 *                     matches, via the site index. This is how you get a
 *                     close-up worth judging panel lines and seams against.
 *   --no-hud          Hide the HUD overlays so only the render is captured.
 *   --plan <m>        Capture a scale-accurate plan view covering this many
 *                     metres across, centred on --center. Prints the exact
 *                     metres-per-pixel so the frame can be laid over a
 *                     satellite crop at matched scale.
 *   --center <u,v>    Compound-frame centre for --plan. Default 0,0 (the
 *                     compound origin). Accepts `x,z,world` for world metres.
 *   --keep-open       Leave the browser running (debugging).
 *
 * Environment
 *   PUPPETEER_EXECUTABLE_PATH   Explicit browser binary.
 *   PROBE_ORIGIN                Same as --origin.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import puppeteer from "puppeteer";

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    urls: [],
    origin: process.env.PROBE_ORIGIN ?? "http://localhost:5173",
    out: "render_output.png",
    wait: 2000,
    width: 1600,
    height: 900,
    scale: 1,
    selector: null,
    keys: [],
    focus: null,
    hud: true,
    plan: null,
    center: null,
    keepOpen: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case "--url":
      case "-u":
        options.urls.push(next());
        break;
      case "--origin":
        options.origin = next();
        break;
      case "--out":
      case "-o":
        options.out = next();
        break;
      case "--wait":
      case "-w":
        options.wait = Number(next());
        break;
      case "--width":
        options.width = Number(next());
        break;
      case "--height":
        options.height = Number(next());
        break;
      case "--scale":
        options.scale = Number(next());
        break;
      case "--selector":
        options.selector = next();
        break;
      case "--keys":
        options.keys = next()
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean);
        break;
      case "--focus":
        options.focus = next();
        break;
      case "--no-hud":
        options.hud = false;
        break;
      case "--plan":
        options.plan = Number(next());
        break;
      case "--center":
        options.center = next();
        break;
      case "--keep-open":
        options.keepOpen = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "usage: node tools/probe.mjs [--url <url>]... [--origin <url>] [--out <path>] [--wait <ms>] [--width <px>] [--height <px>] [--scale <n>] [--selector <css>] [--keys <seq>] [--focus <name>] [--no-hud] [--keep-open]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // quality tier 3 is the only tier that mounts the post-processing stack, so
  // that is what a visual probe needs to look at
  if (options.urls.length === 0) options.urls.push("/?quality=3");
  return options;
}

function resolveUrl(url, origin) {
  return /^https?:\/\//i.test(url) ? url : new URL(url, origin).toString();
}

function outputPathFor(out, index, total) {
  if (total === 1) return resolve(out);
  const dot = out.lastIndexOf(".");
  const stem = dot === -1 ? out : out.slice(0, dot);
  const extension = dot === -1 ? ".png" : out.slice(dot);
  return resolve(`${stem}-${index + 1}${extension}`);
}

/* ------------------------------------------------------------------ */
/* Browser discovery                                                   */
/* ------------------------------------------------------------------ */

/**
 * Prefers Puppeteer's own download, then an explicit override, then the
 * Chromium that ships with this container image (Playwright's), then whatever
 * is on PATH. Headless WebGL needs SwiftShader explicitly enabled.
 */
function findExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && existsSync(bundled)) return undefined; // let puppeteer decide
  } catch {
    // no bundled browser; fall through to the candidates below
  }
  const candidates = [
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  // software WebGL2 in headless: ANGLE over SwiftShader
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--hide-scrollbars",
  "--mute-audio",
];

/* ------------------------------------------------------------------ */
/* Minimal PNG reader, so the probe can report exposure numbers         */
/* ------------------------------------------------------------------ */

/** Decodes an 8-bit, non-interlaced RGB/RGBA PNG into raw pixel bytes. */
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(start);
      height = buffer.readUInt32BE(start + 4);
      bitDepth = buffer[start + 8];
      colorType = buffer[start + 9];
      interlace = buffer[start + 12];
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType})`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x++) {
      const rawByte = line[x];
      const left = x >= channels ? out[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const dLeft = Math.abs(p - left);
          const dUp = Math.abs(p - up);
          const dUpLeft = Math.abs(p - upLeft);
          const predictor =
            dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`);
      }
      out[x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

/**
 * Exposure report for the captured frame. The numbers map directly onto the
 * tuning checklist in `.claude/skills/blender-hardsurface/SKILL.md`:
 * clipped highlights mean the tone curve is losing the sky, crushed blacks
 * mean it is losing the shadow detail.
 */
function analyse(png) {
  const { width, height, channels, pixels } = png;
  const histogram = new Array(32).fill(0);
  let sum = 0;
  let clipped = 0;
  let crushed = 0;
  let saturationSum = 0;
  let total = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  // sample on a grid; a full sweep of a 1600x900 frame is pointless here
  const step = Math.max(1, Math.floor(Math.min(width, height) / 360));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      sum += luma;
      rSum += r;
      gSum += g;
      bSum += b;
      saturationSum += max <= 0 ? 0 : (max - min) / max;
      if (max > 0.995) clipped++;
      if (max < 0.02) crushed++;
      histogram[Math.min(31, Math.floor(luma * 32))]++;
      total++;
    }
  }

  return {
    width,
    height,
    samples: total,
    meanLuma: sum / total,
    meanSaturation: saturationSum / total,
    clippedPercent: (clipped / total) * 100,
    crushedPercent: (crushed / total) * 100,
    tint: { r: rSum / total, g: gSum / total, b: bSum / total },
    histogram,
  };
}

function renderHistogram(histogram) {
  const blocks = " ▁▂▃▄▅▆▇█";
  const peak = Math.max(...histogram, 1);
  return histogram
    .map((count) => blocks[Math.min(8, Math.round((count / peak) * 8))])
    .join("");
}

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

async function capture(page, options, url, outPath) {
  const messages = [];
  const onConsole = (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push(`[${message.type()}] ${message.text()}`);
    }
  };
  const onPageError = (error) => messages.push(`[pageerror] ${error.message}`);
  const onFailed = (request) =>
    messages.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ""}`);

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onFailed);

  console.log(`→ ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });

  // give the scene its settle time: terrain build, texture generation, the
  // lazy post-processing chunk and the intro overlay fade
  await new Promise((done) => setTimeout(done, options.wait));

  // hotkeys drive the camera rigs and overlays, which is how the probe gets a
  // close-up worth judging shader values against
  if (options.keys.length > 0) {
    await page.bringToFront();
    for (const key of options.keys) {
      await page.keyboard.press(key);
      await new Promise((done) => setTimeout(done, 120));
    }
    await new Promise((done) => setTimeout(done, options.wait));
  }

  // the site index is the app's own "go look at this" affordance: opening it,
  // searching and clicking an entry runs the real select + flyTo path
  if (options.focus) {
    await page.keyboard.press("i");
    await page.waitForSelector("#site-index-search", { timeout: 10_000 });
    await page.type("#site-index-search", options.focus, { delay: 10 });
    await new Promise((done) => setTimeout(done, 250));
    const clicked = await page.evaluate(() => {
      const button = document.querySelector("#site-index button:not([aria-label])");
      if (!(button instanceof HTMLElement)) return null;
      button.click();
      return button.textContent;
    });
    if (clicked === null) {
      messages.push(`[probe] no site-index match for "${options.focus}"`);
    } else {
      console.log(`  focus: ${clicked.trim()}`);
    }
    // the fly-to is an eased glide, so give it room to arrive and settle
    await new Promise((done) => setTimeout(done, Math.max(4000, options.wait)));
  }

  // A plan view is the only way to compare the model against a satellite
  // crop: put the camera straight overhead at the altitude that makes the
  // frame cover a known ground width, then both images share a scale.
  let planInfo = null;
  if (options.plan) {
    planInfo = await page.evaluate(
      ({ span, center, fovDeg, viewWidth, viewHeight }) => {
        const store = globalThis.__twinStore;
        if (!store) return { error: "window.__twinStore missing (dev build only)" };

        // compound frame -> world metres, mirroring src/lib/layout.ts
        const ROT = 0.7679;
        const ORIGIN = [1018, 1410];
        const parts = center.split(",").map((p) => p.trim());
        const isWorld = parts[2] === "world";
        const a = Number(parts[0] ?? 0);
        const b = Number(parts[1] ?? 0);
        const cx = isWorld ? a : ORIGIN[0] + a * Math.cos(ROT) + b * Math.sin(ROT);
        const cz = isWorld ? b : ORIGIN[1] - a * Math.sin(ROT) + b * Math.cos(ROT);

        // vertical fov governs the shorter axis of the frame
        const aspect = viewWidth / viewHeight;
        const halfFov = (fovDeg * Math.PI) / 360;
        const groundHeight = aspect >= 1 ? span / aspect : span;
        const altitude = groundHeight / (2 * Math.tan(halfFov));

        // a hair off vertical: an exactly-zero polar angle makes the orbit
        // controls' up vector degenerate
        const nudge = altitude * 0.004;
        store.getState().requestFlyTo([cx, altitude, cz + nudge], [cx, 0, cz]);

        return {
          centerWorld: [cx, cz],
          altitude,
          groundWidth: aspect >= 1 ? span : span * aspect,
          groundHeight,
          metresPerPixel: (aspect >= 1 ? span : span * aspect) / viewWidth,
        };
      },
      {
        span: options.plan,
        center: options.center ?? "0,0",
        fovDeg: 55,
        viewWidth: options.width,
        viewHeight: options.height,
      },
    );
    if (planInfo.error) {
      messages.push(`[probe] ${planInfo.error}`);
    }
    // the fly-to is eased; let it arrive and the frame settle
    await new Promise((done) => setTimeout(done, Math.max(5000, options.wait)));
  }

  if (!options.hud) {
    // hide everything in the page that is not the render surface's own
    // container, so the capture is the frame and nothing else
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      // walk up from the canvas to <body>, hiding every sibling on the way:
      // whatever is left is exactly the chain that renders the frame
      for (let node = canvas; node.parentElement; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling !== node) {
            sibling.setAttribute("style", "display:none !important");
          }
        }
      }
    });
    await new Promise((done) => setTimeout(done, 250));
  }

  const gl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { canvas: false };
    const context =
      canvas.getContext("webgl2", { preserveDrawingBuffer: false }) ?? null;
    const debugInfo = context?.getExtension("WEBGL_debug_renderer_info") ?? null;
    return {
      canvas: true,
      width: canvas.width,
      height: canvas.height,
      renderer: debugInfo
        ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : (context?.getParameter(context.RENDERER) ?? null),
    };
  });

  const target = options.selector ? await page.$(options.selector) : page;
  if (options.selector && !target) {
    throw new Error(`selector not found: ${options.selector}`);
  }

  const buffer = await target.screenshot({ type: "png" });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onFailed);

  let stats = null;
  try {
    stats = analyse(decodePng(buffer));
  } catch (error) {
    messages.push(`[probe] could not analyse PNG: ${error.message}`);
  }

  return { outPath, bytes: buffer.length, gl, stats, plan: planInfo, messages };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const executablePath = findExecutablePath();

  const browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    ...(executablePath ? { executablePath } : {}),
  });

  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.scale,
    });

    for (let i = 0; i < options.urls.length; i++) {
      const url = resolveUrl(options.urls[i], options.origin);
      const outPath = outputPathFor(options.out, i, options.urls.length);
      results.push(await capture(page, options, url, outPath));
    }
  } finally {
    if (!options.keepOpen) await browser.close();
  }

  let failed = false;
  for (const result of results) {
    console.log(`\n${result.outPath}  (${(result.bytes / 1024).toFixed(0)} KB)`);
    if (!result.gl.canvas) {
      console.log("  canvas:    NOT FOUND — the scene never mounted");
      failed = true;
    } else {
      console.log(
        `  drawing:   ${result.gl.width}x${result.gl.height}  renderer: ${result.gl.renderer ?? "unknown"}`,
      );
    }
    if (result.plan && !result.plan.error) {
      const p = result.plan;
      console.log(
        `  plan:      centre world [${p.centerWorld[0].toFixed(0)}, ${p.centerWorld[1].toFixed(0)}] m, altitude ${p.altitude.toFixed(0)} m`,
      );
      console.log(
        `  scale:     ${p.groundWidth.toFixed(0)} x ${p.groundHeight.toFixed(0)} m across the frame — ${p.metresPerPixel.toFixed(3)} m/px`,
      );
    }
    if (result.stats) {
      const s = result.stats;
      console.log(`  frame:     ${s.width}x${s.height}, ${s.samples} samples`);
      console.log(
        `  exposure:  mean luma ${s.meanLuma.toFixed(3)}  clipped ${s.clippedPercent.toFixed(2)}%  crushed ${s.crushedPercent.toFixed(2)}%`,
      );
      console.log(
        `  colour:    saturation ${s.meanSaturation.toFixed(3)}  rgb ${s.tint.r.toFixed(3)}/${s.tint.g.toFixed(3)}/${s.tint.b.toFixed(3)}`,
      );
      console.log(`  histogram: |${renderHistogram(s.histogram)}| (black → white)`);
      if (s.meanLuma < 0.02) {
        console.log("  WARNING:   frame is essentially black");
        failed = true;
      }
    }
    if (result.messages.length > 0) {
      console.log("  messages:");
      for (const message of result.messages.slice(0, 20)) {
        console.log(`    ${message}`);
      }
      if (result.messages.length > 20) {
        console.log(`    ... and ${result.messages.length - 20} more`);
      }
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  if (/ERR_CONNECTION_REFUSED|net::ERR/.test(error.message)) {
    console.error("is the dev server running?  npm run dev   (or bun run dev)");
  }
  process.exitCode = 1;
});
