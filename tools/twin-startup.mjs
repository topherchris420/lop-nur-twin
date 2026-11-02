#!/usr/bin/env node
/**
 * How the twin's first seconds actually behave, as numbers.
 *
 * Loads a URL that is already being served (it builds nothing) in a fresh Chrome
 * profile, so the HTTP cache and the GPU shader cache start empty, and prints
 * JSON: long tasks, blocking time, when the scene first rendered, when input
 * started responding, and the frame rate over a fixed window. Compare two builds
 * by serving each in turn and running this against both, on the same machine in
 * the same state.
 *
 *   npm run build && npm run preview
 *   npm run twin:startup -- --url http://localhost:4173/ --runs 3
 *
 * The result is only comparable with another result from the same renderer, and
 * it names the one it got. Puppeteer's own Chrome is an x64 build, which runs
 * emulated on a Windows on Arm machine, so an installed Chrome is preferred. A
 * SwiftShader result is flagged `software: true`: it says nothing about a GPU.
 *
 * Options:
 *   --url <url>            default http://localhost:4173/
 *   --runs <n>             default 3
 *   --startup-ms <ms>      how long to watch the load, default 25000
 *   --fps-ms <ms>          the frame rate window that follows it, default 10000
 *   --width, --height, --dpr   default 1536 x 735 at 1.25
 *   --chrome <path>        default CHROME_PATH, then an installed Chrome
 *   --headed               a real window, closest to what a visitor sees
 *   --uncapped             no vsync or frame rate limit, to see headroom above 60;
 *                          only compare it with another uncapped run
 *   --profile-dir <dir>    reuse a profile, to measure a warm shader cache
 *   --out <file>           also write the JSON there
 *   --shot <file.png>      screenshot after the last run
 *   --attribute            add time spent per WebGL call; this slows the page
 *                          slightly, so never compare it with a plain run
 *   --cpu-profile <file>   write a .cpuprofile of the last run (also slows it)
 */

import { existsSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
const flag = (name) => argv.includes(`--${name}`);

const url = arg("url", "http://localhost:4173/");
const runs = Number(arg("runs", "3"));
const startupMs = Number(arg("startup-ms", "25000"));
const fpsMs = Number(arg("fps-ms", "10000"));
const width = Number(arg("width", "1536"));
const height = Number(arg("height", "735"));
const dpr = Number(arg("dpr", "1.25"));
const headed = flag("headed");
const uncapped = flag("uncapped");
const attribute = flag("attribute");
const cpuProfilePath = arg("cpu-profile", null);
const shotPath = arg("shot", null);
const outPath = arg("out", null);
const profileDir = arg("profile-dir", null);

/** A probe slower than this counts as the page not responding. INP's "good" limit. */
const INPUT_OK_MS = 200;
const PROBE_INTERVAL_MS = 250;

const INSTALLED_CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];
const executablePath =
  arg("chrome", null) ?? INSTALLED_CHROME.find((path) => path && existsSync(path));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Inside the page, before any of its scripts                          */
/* ------------------------------------------------------------------ */

function instrumentPage(attributeGl) {
  const record = (globalThis.__twinStartup = {
    longTasks: [],
    /** [time the next frame began, draws to the screen, draws off screen, triangles] */
    frames: [],
    /** [time, the quality the HUD printed], whenever it changes. */
    quality: [],
    gl: {},
    /** [start, WebGL call, ms] for each one slower than 15 ms, under --attribute. */
    slowCalls: [],
    contexts: [],
  });

  setInterval(() => {
    const label = document.querySelector(
      ".telemetry-footer span:last-child",
    )?.textContent;
    if (label && label !== record.quality.at(-1)?.[1]) {
      record.quality.push([Math.round(performance.now()), label]);
    }
  }, 100);

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      record.longTasks.push([Math.round(entry.startTime), Math.round(entry.duration)]);
    }
  }).observe({ type: "longtask", buffered: true });

  let screenDraws = 0;
  let offscreenDraws = 0;
  let triangles = 0;
  let boundToScreen = true;

  // Credited to the frame after the one that issued them, because a frame has not
  // finished for anyone until the main thread has come back round to the next one.
  const tick = () => {
    record.frames.push([performance.now(), screenDraws, offscreenDraws, triangles]);
    screenDraws = 0;
    offscreenDraws = 0;
    triangles = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = originalGetContext.call(this, type, ...rest);
    if (context && type.startsWith("webgl")) record.contexts.push(context);
    return context;
  };

  for (const proto of [
    WebGL2RenderingContext.prototype,
    WebGLRenderingContext.prototype,
  ]) {
    const bind = proto.bindFramebuffer;
    proto.bindFramebuffer = function (target, framebuffer) {
      if (target !== this.READ_FRAMEBUFFER) boundToScreen = framebuffer === null;
      return bind.call(this, target, framebuffer);
    };
    for (const name of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const original = proto[name];
      if (!original) continue;
      const countIndex = name.startsWith("drawElements") ? 1 : 2;
      proto[name] = function (...args) {
        if (boundToScreen) screenDraws++;
        else offscreenDraws++;
        if (args[0] === this.TRIANGLES) triangles += args[countIndex] / 3;
        return original.apply(this, args);
      };
    }
    if (!attributeGl) continue;
    for (const name of [
      "bindTexture",
      "bufferData",
      "bufferSubData",
      "clear",
      "compileShader",
      "drawArrays",
      "drawArraysInstanced",
      "drawElements",
      "drawElementsInstanced",
      "finish",
      "flush",
      "framebufferTexture2D",
      "generateMipmap",
      "getActiveUniform",
      "getAttribLocation",
      "getError",
      "getExtension",
      "getParameter",
      "getProgramInfoLog",
      "getProgramParameter",
      "getShaderInfoLog",
      "getShaderParameter",
      "getUniformLocation",
      "linkProgram",
      "readPixels",
      "renderbufferStorage",
      "renderbufferStorageMultisample",
      "shaderSource",
      "texImage2D",
      "texStorage2D",
      "texSubImage2D",
      "useProgram",
    ]) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...args) {
        const before = performance.now();
        const result = original.apply(this, args);
        const spent = performance.now() - before;
        const slot = (record.gl[name] ??= { calls: 0, ms: 0, maxMs: 0 });
        slot.calls++;
        slot.ms += spent;
        if (spent > slot.maxMs) slot.maxMs = spent;
        if (spent > 15)
          record.slowCalls.push([Math.round(before), name, Math.round(spent)]);
        return result;
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reading a run                                                       */
/* ------------------------------------------------------------------ */

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function median(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length === 0) return null;
  const sorted = [...present].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarise({ page, probes, fpsWindow }) {
  const { frames, longTasks } = page;
  const inWindow = frames.filter(([t]) => t >= fpsWindow[0] && t <= fpsWindow[1]);
  const gaps = [];
  for (let i = 1; i < inWindow.length; i++)
    gaps.push(inWindow[i][0] - inWindow[i - 1][0]);
  gaps.sort((a, b) => a - b);
  const spanned = inWindow.length > 1 ? inWindow.at(-1)[0] - inWindow[0][0] : 0;
  const settledScreenDraws = median(inWindow.map((frame) => frame[1])) ?? 0;

  // The first frame that drew anything, and the first that drew what the page
  // goes on drawing once it has settled. A scene that streams in would otherwise
  // pass off a frame of bare sky as its first rendered frame.
  const firstDraw = frames.find((frame) => frame[1] + frame[2] > 0);
  const firstFull = frames.find(
    (frame) => settledScreenDraws > 0 && frame[1] >= settledScreenDraws * 0.9,
  );

  const slowProbes = probes.filter((probe) => probe.ms > INPUT_OK_MS);
  const lastSlow = slowProbes.at(-1);

  const startupTasks = longTasks.filter(([start]) => start < fpsWindow[0]);
  const round = (value) => (value === null ? null : Math.round(value));

  const framesEachSecond = [];
  for (const [t] of frames) {
    const second = Math.floor(t / 1000);
    framesEachSecond[second] = (framesEachSecond[second] ?? 0) + 1;
  }
  return {
    firstContentfulPaintMs: round(page.fcp),
    firstDrawMs: firstDraw ? round(firstDraw[0]) : null,
    firstFullSceneMs: firstFull ? round(firstFull[0]) : null,
    longTaskCount: startupTasks.length,
    longestTaskMs: startupTasks.reduce((most, task) => Math.max(most, task[1]), 0),
    longTaskTotalMs: startupTasks.reduce((sum, task) => sum + task[1], 0),
    /** The usual definition: what each long task spent past the 50 ms budget. */
    totalBlockingMs: startupTasks.reduce(
      (sum, task) => sum + Math.max(0, task[1] - 50),
      0,
    ),
    /** When the last input slower than INPUT_OK_MS came back. */
    inputRespondsMs: lastSlow ? Math.round(lastSlow.at + lastSlow.ms) : 0,
    worstInputMs: Math.round(probes.reduce((most, probe) => Math.max(most, probe.ms), 0)),
    inputProbes: probes.length,
    fps: spanned > 0 ? Number((((inWindow.length - 1) * 1000) / spanned).toFixed(1)) : 0,
    frameMsP50: round(quantile(gaps, 0.5)),
    frameMsP95: round(quantile(gaps, 0.95)),
    frameMsWorst: round(gaps.at(-1) ?? null),
    longTasksInFpsWindow: longTasks.filter(
      ([start]) => start >= fpsWindow[0] && start <= fpsWindow[1],
    ).length,
    settledScreenDraws,
    settledTriangles: round(median(inWindow.map((frame) => frame[3]))),
    drawingBuffer: page.drawingBuffer,
    qualitySteps: page.quality,
    framesEachSecond: Array.from(framesEachSecond, (count) => count ?? 0),
    longTasks,
    gl: page.gl,
    ...(attribute
      ? { frames: page.frames, probes, slowCalls: page.slowCalls, marks: page.marks }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* One run                                                             */
/* ------------------------------------------------------------------ */

async function run(index) {
  const last = index === runs - 1;
  const browser = await puppeteer.launch({
    headless: headed ? false : true,
    executablePath,
    userDataDir: profileDir ?? undefined,
    defaultViewport: { width, height, deviceScaleFactor: dpr },
    args: [
      "--no-first-run",
      "--ignore-gpu-blocklist",
      "--enable-gpu",
      process.platform === "win32" ? "--use-angle=d3d11" : "--use-gl=angle",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
      `--window-size=${width},${height + 140}`,
    ],
  });
  try {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await page.evaluateOnNewDocument(instrumentPage, attribute);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    const profiling = last && cpuProfilePath !== null;
    if (profiling) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
      await cdp.send("Profiler.start");
    }

    const startedAt = Date.now();
    const navigation = page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // A real input event, round-tripped through the renderer's main thread. It
    // cannot complete while that thread is blocked, which is the point.
    const probes = [];
    const stopProbingAt = startedAt + startupMs;
    const probing = (async () => {
      let toggle = 0;
      while (Date.now() < stopProbingAt) {
        const at = Date.now();
        toggle = 1 - toggle;
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: width / 2 + toggle,
          y: 96,
        });
        probes.push({ at: at - startedAt, ms: Date.now() - at });
        await sleep(Math.max(0, PROBE_INTERVAL_MS - (Date.now() - at)));
      }
    })();

    await navigation;
    await probing;

    const fpsStart = await page.evaluate(() => performance.now());
    await sleep(fpsMs);
    const fpsEnd = await page.evaluate(() => performance.now());

    if (profiling) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(cpuProfilePath, JSON.stringify(profile));
    }

    const data = await page.evaluate(() => {
      const record = globalThis.__twinStartup;
      const contexts = record.contexts.filter((context) => !context.isContextLost());
      const gl = contexts.at(-1);
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        longTasks: record.longTasks,
        frames: record.frames,
        quality: record.quality,
        gl: record.gl,
        slowCalls: record.slowCalls,
        marks: performance
          .getEntriesByType("mark")
          .map((m) => [Math.round(m.startTime), m.name]),
        fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        parallelShaderCompile: Boolean(gl?.getExtension("KHR_parallel_shader_compile")),
        drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
        timeOrigin: performance.timeOrigin,
      };
    });

    // Probes were timed against the clock in Node; put them on the page's clock.
    const offset = startedAt - data.timeOrigin;
    const summary = summarise({
      page: data,
      probes: probes.map((probe) => ({ ...probe, at: probe.at + offset })),
      fpsWindow: [fpsStart, fpsEnd],
    });

    if (last && shotPath) await page.screenshot({ path: shotPath });
    return {
      summary,
      errors,
      renderer: data.renderer,
      parallelShaderCompile: data.parallelShaderCompile,
      browser: await browser.version(),
    };
  } finally {
    await browser.close();
  }
}

/* ------------------------------------------------------------------ */

const results = [];
for (let i = 0; i < runs; i++) {
  results.push(await run(i));
  // Let the machine come back to rest, so one run's teardown is not the next's load.
  if (i < runs - 1) await sleep(3000);
}

const numericKeys = Object.keys(results[0].summary).filter(
  (key) => typeof results[0].summary[key] === "number",
);
const medians = Object.fromEntries(
  numericKeys.map((key) => [key, median(results.map((r) => r.summary[key]))]),
);
const renderer = results[0].renderer;
const output = {
  url,
  browser: results[0].browser,
  chrome: executablePath ?? "puppeteer's bundled Chrome",
  mode: headed ? "headed" : "headless",
  uncapped,
  renderer,
  software: /swiftshader|llvmpipe|software|basic render/i.test(renderer ?? "unknown"),
  parallelShaderCompile: results[0].parallelShaderCompile,
  viewport: { width, height, dpr },
  coldShaderCache: profileDir === null,
  startupMs,
  fpsMs,
  runs: results.map((result) => ({ ...result.summary, errors: result.errors })),
  median: medians,
};

const json = JSON.stringify(output, null, 2);
if (outPath) writeFileSync(outPath, json);
console.log(json);
