#!/usr/bin/env node
/**
 * Serves a built garden release locally, under the live server's own CSP and
 * headers, and drives it in Chrome. `/api/state` is answered either from a
 * recording of real live states replayed on a virtual clock (`--source
 * replay`, the default; nothing leaves this machine) or by a read-only GET to
 * the live garden, cached for a second so every local observer shares one
 * upstream request (`--source live`). With `--source proxy` the page itself
 * comes from the live garden too: every file is passed through unchanged,
 * headers included, so the check runs on what the server actually serves
 * (Chrome refuses the server's bare address, so it cannot be opened directly).
 * Its outage is simulated here, at the proxy; the server is only ever read.
 *
 *   node tools/garden.mjs serve  [--release dir] [--source replay|live|proxy] [--origin url] [--port 4173]
 *                                [--start-tick n] [--hours-later h] [--weather rain=2.5,code=63]
 *   node tools/garden.mjs check  [--release dir] [--source …] [--out dir] [--recording file]
 *   node tools/garden.mjs record [--recording file] [--minutes 10]
 *
 * `check` loads the page at desktop and phone sizes, photographs every
 * camera, and checks: no console errors or CSP violations; only same-origin
 * GET requests, the API only at /api/state; two observers see the same
 * presented moment and pose; a reload shows the same individual; a garden
 * outage shows as reconnecting and recovers; memory stays flat across
 * camera and preset changes. It writes report.json and the screenshots to
 * --out.
 */
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args.shift() : "check";
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const ORIGIN = opt("origin", "http://150.136.49.49").replace(/\/$/, "");
const LIVE = `${ORIGIN}/api/state`;
const CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
};

function latestRelease() {
  const root = path.resolve("dist-garden");
  const dirs = existsSync(root)
    ? readdirSync(root)
        .filter((d) => d.startsWith("garden-"))
        .map((d) => path.join(root, d))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!dirs.length)
    throw new Error("no release in dist-garden/: run `bun run garden:build` first");
  return dirs[0];
}

const pinned = opt("release", "");
/** The release whose page is served at `/`: the one named, or the newest build. Older builds stay reachable at their own paths, as on the server. */
const currentRelease = () => path.resolve(pinned || latestRelease());
const source = opt("source", "replay");
/** The release on show: built here, or (proxy) the one the live index refers to. */
const release =
  source === "proxy"
    ? await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(15_000) })
        .then((r) => r.text())
        .then((html) => /\/(garden-\d{8}-[0-9a-f]{12})\//.exec(html)?.[1])
    : path.basename(currentRelease());
if (!release) {
  console.error(`${ORIGIN}/ does not serve a garden release`);
  process.exit(2);
}
const port = Number(opt("port", command === "serve" ? "4173" : "0"));

// ------------------------------------------------------------------ the API

/** Moves every unix time (seconds) in a state by `dt`, except the reported sunrise and sunset. */
function shifted(value, dt, key = "") {
  if (dt === 0 || key === "sun") return value;
  if (typeof value === "number")
    return value > 1.5e9 && value < 2.2e9 ? value + dt : value;
  if (Array.isArray(value)) return value.map((v) => shifted(v, dt));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shifted(v, dt, k)]),
    );
  return value;
}

/**
 * Replays recorded responses: at virtual time v, the newest state the server
 * had published by v. `restart` jumps to another recorded moment, optionally
 * some hours later in the day (to see evening and night) and with other
 * weather; it is for this harness's own pages, which are reloaded after it.
 */
function replaySource(file) {
  const states = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).state)
    .sort((a, b) => a.ticks - b.ticks);
  let t0 = 0,
    wall0 = 0,
    dt = 0,
    weather = null;
  const restart = (tick = 0, hours = 0, overrides = null) => {
    const i = tick ? states.findIndex((s) => s.ticks >= tick) : 0;
    t0 = states[i < 0 ? states.length - 1 : i].server_time;
    wall0 = Date.now() / 1000;
    dt = hours * 3600;
    weather = overrides;
  };
  return {
    restart,
    answer() {
      const v = t0 + (Date.now() / 1000 - wall0);
      let s = states[0];
      for (const x of states) if (x.server_time <= v) s = x;
      const state = shifted({ ...s, server_time: v }, dt);
      state.weather = { ...state.weather, ...weather };
      const sun = state.weather.sun && Object.values(state.weather.sun);
      if (dt && sun?.length)
        state.weather.is_day = sun.some(
          ([rise, set]) => rise <= state.server_time && state.server_time < set,
        );
      return state;
    },
  };
}

function liveSource() {
  let cached = null;
  return {
    async answer() {
      // A cached answer is still the server's latest state; its clock is
      // moved on by the cache's age, as the server's own would have been.
      // (Served stale, it would set each observer's clock up to a second
      // behind, by however long its answers sat here.)
      const age = cached ? Date.now() - cached.at : Infinity;
      if (age < 1000)
        return { ...cached.body, server_time: cached.body.server_time + age / 1000 };
      const r = await fetch(LIVE, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error(`live garden HTTP ${r.status}`);
      cached = { at: Date.now(), body: await r.json() };
      return cached.body;
    },
  };
}

const recording = opt("recording", process.env.GARDEN_RECORDING ?? "");
if (command === "record") {
  // Read-only: one GET every 2.5 s, each new step kept once, as the live page would see it.
  const file = path.resolve(recording || `garden-recording-${Date.now()}.jsonl`);
  const minutes = Number(opt("minutes", "10"));
  const seen = new Set();
  const end = Date.now() + minutes * 60_000;
  console.log(`recording ${minutes} min of live states to ${file}`);
  while (Date.now() < end) {
    const sent = Date.now();
    try {
      const r = await fetch(LIVE, { method: "GET", signal: AbortSignal.timeout(6000) });
      const state = await r.json();
      if (r.ok && !seen.has(state.ticks)) {
        seen.add(state.ticks);
        writeFileSync(
          file,
          `${JSON.stringify({ sent, received: Date.now(), state })}
`,
          { flag: "a" },
        );
      }
    } catch (e) {
      console.warn(String(e));
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  process.exit(0);
}
if (source === "replay" && !recording) {
  console.error(
    "replay needs a recording: --recording file.jsonl (or GARDEN_RECORDING), from `node tools/garden.mjs record`; or use --source live",
  );
  process.exit(2);
}
/** `--weather rain=2.5,code=63`: numbers, booleans or text replacing the reported weather. */
const weatherOverrides = (text) =>
  text
    ? Object.fromEntries(
        text.split(",").map((pair) => {
          const [k, v = ""] = pair.split("=");
          return [
            k,
            v === "true"
              ? true
              : v === "false"
                ? false
                : v !== "" && !Number.isNaN(Number(v))
                  ? Number(v)
                  : v,
          ];
        }),
      )
    : null;
const api = source === "replay" ? replaySource(path.resolve(recording)) : liveSource();

/** Passes a GET through to the live garden unchanged, headers included. */
async function forward(url, res) {
  const r = await fetch(ORIGIN + url.pathname + url.search, {
    headers: { "accept-encoding": "identity" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const headers = {};
  r.headers.forEach((v, k) => {
    if (
      !/^(content-encoding|content-length|transfer-encoding|connection|keep-alive)$/.test(
        k,
      )
    )
      headers[k] = v;
  });
  res.writeHead(r.status, headers).end(Buffer.from(await r.arrayBuffer()));
}
api.restart?.(
  Number(opt("start-tick", "0")) || 0,
  Number(opt("hours-later", "0")) || 0,
  weatherOverrides(opt("weather", "")),
);

/** Every request the pages made, for the check. */
const requests = [];
let outage = false;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  requests.push({ method: req.method, path: url.pathname });
  const headers = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  };
  if (req.method !== "GET") {
    res.writeHead(403, headers).end();
    return;
  }
  if (url.pathname === "/__replay" && api.restart) {
    const q = url.searchParams;
    api.restart(
      Number(q.get("tick")) || 0,
      Number(q.get("hours")) || 0,
      weatherOverrides(q.get("weather") ?? ""),
    );
    res.writeHead(204, headers).end();
    return;
  }
  if (url.pathname === "/api/state") {
    if (outage) {
      res.writeHead(502, headers).end();
      return;
    }
    try {
      const body = JSON.stringify(await api.answer());
      res
        .writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch (e) {
      res.writeHead(502, headers).end(String(e));
    }
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(404, headers).end();
    return;
  }
  if (source === "proxy") {
    await forward(url, res).catch((e) => res.writeHead(502, headers).end(String(e)));
    return;
  }
  const dir = currentRelease();
  const releases = path.dirname(dir);
  const file =
    url.pathname === "/" || url.pathname === "/index.html"
      ? path.join(dir, "index.html")
      : /^\/garden-[\w-]+\//.test(url.pathname)
        ? path.resolve(releases, `.${decodeURIComponent(url.pathname)}`)
        : null;
  if (
    !file ||
    !file.startsWith(releases + path.sep) ||
    !existsSync(file) ||
    statSync(file).isDirectory()
  ) {
    res.writeHead(404, headers).end();
    return;
  }
  res.writeHead(200, {
    ...headers,
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`garden ${release} at ${origin}/ (state: ${source})`);
if (command === "serve") await new Promise(() => {});

// ---------------------------------------------------------------- the check

const { default: puppeteer } = await import("puppeteer");
const out = path.resolve(opt("out", "garden-check"));
mkdirSync(out, { recursive: true });
const report = {
  release,
  source,
  origin,
  started: new Date().toISOString(),
  checks: {},
  shots: [],
  console: [],
  violations: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: has("headed") ? false : true,
  args: [
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-gpu",
    "--use-angle=d3d11",
    "--enable-unsafe-swiftshader",
  ],
});

async function open(viewport, query = "debug") {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on("console", (m) => {
    // The simulated outage's own 502s, and the page saying it got no state,
    // are the point of that step, not a fault.
    if (outage && /status of 502|garden: no state this time/.test(m.text())) return;
    // Puppeteer names a console.warn "warn" (the protocol's "warning").
    const type = m.type() === "warning" ? "warn" : m.type();
    if (type === "error" || type === "warn")
      report.console.push({ type, text: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) =>
    report.console.push({ type: "pageerror", text: String(e).slice(0, 400) }),
  );
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await page.goto(`${origin}/?${query}`, { waitUntil: "domcontentloaded" });
  return page;
}

async function ready(page, timeout = 90_000) {
  await page.waitForFunction(() => document.getElementById("curtain")?.hidden === true, {
    timeout,
    polling: 500,
  });
}

const setCamera = (page, mode) => page.click(`.lenses button[data-camera="${mode}"]`);
const shot = async (page, name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  report.shots.push(path.basename(file));
};

try {
  // Desktop: every camera.
  const desk = await open({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await ready(desk);
  report.gpu = await desk.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  for (const mode of ["tracking", "macro", "observation", "free"]) {
    await setCamera(desk, mode);
    await sleep(mode === "tracking" ? 6000 : 4000);
    await shot(desk, `desktop-${mode}`);
  }
  await setCamera(desk, "tracking");

  // Frame pacing and resolution over five seconds.
  report.checks.frames = await desk.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const end = last + 5000;
        const tick = (t) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const g = window.garden;
            resolve({
              count: times.length,
              median: times[times.length >> 1],
              p90: times[Math.floor(times.length * 0.9)],
              dpr: g?.adaptive().dpr ?? null,
              preset:
                document.querySelector('input[name="quality"]:checked')?.value ?? null,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

  // Two observers: the same presented moment and the same fly. A tab in the
  // background draws nothing (its presented moment is its last frame's), so
  // each is sampled in front; the difference allows for the time between.
  const second = await open({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await ready(second);
  await sleep(3000);
  const sample = (p) =>
    p.evaluate(() => {
      const g = window.garden;
      const pic = g.picture();
      return {
        at: Date.now(),
        visible: document.visibilityState,
        presented: g.presented(),
        position: pic?.pose?.position ?? null,
        life: document.getElementById("life-identity")?.textContent,
      };
    });
  const inFront = async (p) => {
    await p.bringToFront();
    await sleep(1000);
    return sample(p);
  };
  const a = await inFront(desk);
  const b = await inFront(second);
  const drift = Math.abs(a.presented - (a.at - b.at) / 1000 - b.presented);
  report.checks.observers = {
    a,
    b,
    presentedDifferenceS: drift,
    sameLife: a.life === b.life,
    ok: drift < 0.35 && a.life === b.life,
  };

  // Reload: the same individual, the presented clock continuous.
  const before = await sample(second);
  await second.reload({ waitUntil: "domcontentloaded" });
  await ready(second);
  await sleep(1500);
  const after = await sample(second);
  report.checks.reload = {
    before,
    after,
    sameLife: before.life === after.life,
    ok: before.life === after.life && after.presented >= before.presented,
  };
  await second.close();
  await desk.bringToFront();

  // Outage: the page says so, keeps the last picture, and recovers by itself.
  outage = true;
  await desk.waitForFunction(
    () =>
      ["reconnecting", "offline"].includes(
        document.getElementById("status")?.dataset.state ?? "",
      ),
    { timeout: 30_000, polling: 500 },
  );
  const during = await desk.evaluate(
    () => document.getElementById("status-text")?.textContent,
  );
  await shot(desk, "desktop-outage");
  outage = false;
  await desk.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "live",
    { timeout: 45_000, polling: 500 },
  );
  report.checks.outage = { during, recovered: true, ok: true };

  // Memory: switch cameras and presets, then compare.
  // Collected first, so the heap figure is what is still held, not garbage waiting.
  const cdp = await desk.createCDPSession();
  const memory = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return desk.evaluate(() => {
      const info = window.garden.scene()?.renderer.info;
      return {
        heap: performance.memory?.usedJSHeapSize ?? null,
        geometries: info?.memory.geometries,
        textures: info?.memory.textures,
        programs: info?.programs?.length,
      };
    });
  };
  const m0 = await memory();
  for (let i = 0; i < 3; i++) {
    for (const mode of ["observation", "macro", "free", "tracking"]) {
      await setCamera(desk, mode);
      await sleep(700);
    }
    await desk.click("#picture-toggle");
    await desk.click('input[name="quality"][value="performance"]');
    await sleep(2500);
    await desk.click('input[name="quality"][value="high"]');
    await sleep(2500);
    await desk.click("#picture-toggle");
  }
  await sleep(1500);
  const m1 = await memory();
  const heapGrowth = m0.heap !== null && m1.heap !== null ? m1.heap - m0.heap : null;
  report.checks.memory = {
    before: m0,
    after: m1,
    heapGrowth,
    ok:
      m1.geometries <= m0.geometries + 2 &&
      m1.textures <= m0.textures + 2 &&
      (heapGrowth === null || heapGrowth < 8e6),
  };
  await desk.close();

  // Phone.
  const phone = await open({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await ready(phone);
  await sleep(6000);
  await shot(phone, "phone-tracking");
  await phone.click("#panel-toggle");
  await sleep(800);
  await shot(phone, "phone-panel");
  await phone.click("#panel-toggle");
  await setCamera(phone, "observation");
  await sleep(3000);
  await shot(phone, "phone-observation");
  await phone.close();

  // Without WebGL: the plain garden.
  const plain = await browser.newPage();
  await plain.setViewport({ width: 1200, height: 800 });
  await plain.evaluateOnNewDocument(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return kind === "webgl2" || kind === "webgl" ? null : get.call(this, kind, ...rest);
    };
  });
  await plain.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await ready(plain, 30_000);
  await sleep(1500);
  await shot(plain, "fallback-2d");
  report.checks.fallback = {
    renderer: await plain.evaluate(
      () => document.getElementById("exhibit")?.dataset.renderer,
    ),
    ok: true,
  };
  await plain.close();
} finally {
  await browser.close();
  server.close();
}

// Requests: only GETs, only this origin, the API only at /api/state.
const bad = requests.filter(
  (r) => r.method !== "GET" || (r.path.startsWith("/api/") && r.path !== "/api/state"),
);
// Errors fail the check; warnings are listed for a person to read.
const errors = report.console.filter((c) => c.type !== "warn");
const warnings = report.console.filter((c) => c.type === "warn");
report.checks.requests = {
  total: requests.length,
  api: requests.filter((r) => r.path === "/api/state").length,
  bad,
  ok: bad.length === 0,
};
report.checks.console = {
  errors: errors.length,
  warnings: warnings.length,
  ok: errors.length === 0,
};
report.ok = Object.values(report.checks).every((c) => c.ok !== false);
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      gpu: report.gpu,
      frames: report.checks.frames,
      observers: report.checks.observers?.ok,
      reload: report.checks.reload?.ok,
      memory: report.checks.memory,
      requests: report.checks.requests,
      console: report.console.slice(0, 12),
    },
    null,
    2,
  ),
);
process.exit(report.ok ? 0 : 1);
