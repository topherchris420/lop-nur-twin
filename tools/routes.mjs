#!/usr/bin/env node
/**
 * Route, parameter and interaction checks.
 *
 * The accessibility harness proves the markup is sound; this proves the app
 * survives the ways a real visitor arrives at it. Every check corresponds to
 * something that breaks in practice on a single-page application:
 *
 *  - a deep link opened cold, and the same URL refreshed, on a host that has
 *    to rewrite unknown paths to the app shell;
 *  - hostile or malformed query parameters, which reach a renderer and a
 *    physics world before anything else validates them — and, for the
 *    parameters whose job is state rather than rendering (`?year=`,
 *    `?compare=`, `?night=`, `?uncertainty=`, `?at=`), what actually reached
 *    the store;
 *  - `?liveTraffic=`, the one switch that can make a third-party request: only
 *    the documented value may make it, and the suite answers it locally so it
 *    never contacts the third party;
 *  - the keyboard path through the accessible view, which no screenshot and no
 *    axe rule can confirm actually works;
 *  - a browser without WebGL, where the 3D routes' fallbacks must be all that
 *    focus can reach — a control hidden behind a fallback is still a Tab stop;
 *  - evidence filtering, the one interactive control on `/analysis`;
 *  - reduced motion, which must reach the store rather than only the stylesheet;
 *  - a narrow viewport, where a wide table can silently push the page sideways.
 *
 *   node tools/routes.mjs                              # preview :4173 + dev :5173
 *   node tools/routes.mjs http://localhost:4173 http://localhost:5173
 *
 * The dev origin is only used for the checks that need `window.__twinStore`,
 * which is stripped from production builds. Pass `-` to skip them.
 *
 * Exits non-zero if any check fails.
 */

import puppeteer from "puppeteer";

// Expected timeline values come from the app's own code, so a change to the
// ledger's dates moves them too instead of leaving stale literals here.
await import("../scripts/ts-hooks.mjs");
const { TEMPORAL_SNAPSHOT_DATES, snapshotDateForYear } =
  await import("../src/lib/temporal.ts");
const { SITE_SIZE, TIMELINE_BOUNDS } = await import("../src/lib/layout.ts");

const previewOrigin = process.argv[2] ?? "http://localhost:4173";
const devOrigin = process.argv[3] ?? "http://localhost:5173";

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name.padEnd(52)} ${detail}`);
};

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a page, collecting page errors, and returns both. */
async function open(
  url,
  { settle = 2500, viewport, reducedMotion = false, onRequest, webgl = true } = {},
) {
  const page = await browser.newPage();
  await page.setViewport(viewport ?? { width: 1440, height: 900 });
  if (!webgl) {
    // A browser that cannot start WebGL, as the app's own probe sees it.
    await page.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
          return null;
        return original.call(this, type, ...args);
      };
    });
  }
  if (onRequest) {
    await page.setRequestInterception(true);
    page.on("request", onRequest);
  }
  if (reducedMotion) {
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("GL Driver") || text.includes("DevTools")) return;
    errors.push(text.slice(0, 200));
  });
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await new Promise((resolve) => setTimeout(resolve, settle));
  return { page, errors, status: response?.status() ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 1. Every route loads directly and survives a refresh                */
/* ------------------------------------------------------------------ */

console.log("\n=== direct load and refresh ===");
for (const [path, expectedTitleFragment, settle] of [
  ["/", "Lop Nur Twin", 6000],
  ["/analysis", "Structure analysis table", 2500],
  ["/compare", "Model manifest comparison", 2500],
  ["/evaluation", "Blacksite evaluation", 2500],
  ["/play", "Blacksite", 6000],
]) {
  const { page, errors, status } = await open(`${previewOrigin}${path}`, { settle });
  check(`${path} direct load returns 200`, status === 200, `HTTP ${status}`);
  const title = await page.title();
  check(
    `${path} sets a descriptive title`,
    title.includes(expectedTitleFragment),
    title.slice(0, 60),
  );
  check(`${path} loads without page errors`, errors.length === 0, errors[0] ?? "clean");

  await page.reload({ waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, settle));
  const titleAfterReload = await page.title();
  check(
    `${path} survives a refresh`,
    titleAfterReload.includes(expectedTitleFragment),
    titleAfterReload.slice(0, 60),
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 2. Hostile and malformed query parameters                           */
/* ------------------------------------------------------------------ */

console.log("\n=== malformed and hostile query parameters ===");
const HOSTILE = [
  "/?quality=999999",
  "/?quality=-1&month=99",
  "/?quality=1e309",
  `/?structure=${encodeURIComponent("../../etc/passwd")}`,
  `/?structure=${encodeURIComponent("<script>alert(1)</script>")}`,
  "/?structure=does-not-exist",
  `/analysis?structure=${encodeURIComponent("'; DROP TABLE structures;--")}`,
  "/analysis?structure=" + "a".repeat(500),
  "/?evidence=not-a-mode&snapshot=2025-02-30",
  "/?evidence=observed&snapshot=9999-99-99",
  `/?snapshot=${encodeURIComponent("<script>alert(1)</script>")}`,
  "/analysis?kinds=structure,unknown&distance=1e309",
  `/analysis?anchor=${encodeURIComponent("<script>alert(1)</script>")}&distance=500`,
  "/analysis?anchor=rwy-05-23&distance=-1",
  "/analysis?spatialDate=2025-02-30&presence=established",
  "/analysis?uncertainty=-1&includeUnknown=yes",
  "/compare?anything=" + "b".repeat(300),
  "/compare?before=r999&after=r0",
  `/compare?before=${encodeURIComponent("<script>alert(1)</script>")}&after=1e309`,
  "/compare?before=r01&after=R2",
  `/evaluation?file=${encodeURIComponent("../../etc/passwd")}&x=${"c".repeat(300)}`,
];
for (const path of HOSTILE) {
  const { page, errors } = await open(`${previewOrigin}${path}`, {
    settle:
      path.startsWith("/analysis") ||
      path.startsWith("/compare") ||
      path.startsWith("/evaluation")
        ? 2000
        : 5000,
  });
  // "The app rendered something real": the twin draws a canvas, `/analysis`
  // draws its table, and `/compare` draws its heading before either manifest is
  // loaded — which is its correct empty state, not a failure.
  const rendered = await page.evaluate(
    () =>
      document.querySelector("canvas") !== null ||
      document.querySelector("table") !== null ||
      document.querySelector("h1") !== null,
  );
  check(
    `renders normally: ${path.slice(0, 58)}`,
    rendered && errors.length === 0,
    errors[0] ?? "clean",
  );
  await page.close();
}

{
  // Two recorded model revisions by name: the comparison is drawn from the
  // manifests bundled with the build, with no file and no fetch to a third
  // party. A malformed name above leaves the page empty instead.
  const { page, errors } = await open(`${previewOrigin}/compare?before=r1&after=r2`, {
    settle: 2500,
  });
  const status = await page.evaluate(
    () => document.querySelector("#comparison [role=status]")?.textContent ?? "",
  );
  check(
    "/compare?before=r1&after=r2 compares two recorded revisions",
    /differences? across/.test(status) && errors.length === 0,
    errors[0] ?? status.slice(0, 80),
  );
  await page.close();
}

{
  const { page, errors } = await open(
    `${previewOrigin}/play?at=1e308,-1e308&look=notanumber&mode=<script>&near=-5&autoplay=yes`,
    { settle: 6000 },
  );
  const hasCanvas = await page.evaluate(() => document.querySelector("canvas") !== null);
  check(
    "/play survives hostile spawn, look, mode and near values",
    hasCanvas && errors.length === 0,
    errors[0] ?? "clean",
  );
  // `autoplay=yes` is not `1`, so the menu must still be showing.
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(
    "/play?autoplay=yes does not start a match",
    /illustrative simulation/i.test(bodyText),
    "banner present",
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 3. Keyboard navigation on the accessible route                      */
/* ------------------------------------------------------------------ */

console.log("\n=== keyboard navigation on /analysis ===");
{
  const { page } = await open(`${previewOrigin}/analysis`, { settle: 2000 });
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName ?? "", text: (active?.textContent ?? "").trim() };
  });
  check(
    "first Tab reaches the skip-navigation link",
    first.tag === "A" && /skip to spatial query results/i.test(first.text),
    `${first.tag}: ${first.text.slice(0, 40)}`,
  );

  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterSkip = await page.evaluate(() => document.activeElement?.id ?? "");
  check(
    "activating the skip link moves focus to the table",
    afterSkip === "spatial-query-results",
    `focus: #${afterSkip}`,
  );

  await page.close();
}

{
  // A fresh page for the tab walk: neither blurring nor reloading resets
  // Chrome's sequential-focus starting point, so a walk that continues from
  // the skip link's target would never reach the controls above the table.
  const { page } = await open(`${previewOrigin}/analysis`, { settle: 2000 });
  const stops = [];
  // The budget has to cover every focus stop above the table, and `/analysis`
  // now carries the evidence-mode radio group, two snapshot date pickers and
  // the bookmark controls before the search field. Walking further is the point
  // of the check — that the order is header, then controls, then rows — not a
  // relaxation of it.
  for (let index = 0; index < 130; index += 1) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return "";
        const label = active.id || active.getAttribute("aria-label") || "";
        const text = (active.textContent ?? "").trim().slice(0, 24);
        return `${active.tagName}:${label}:${text}`;
      }),
    );
  }
  check(
    "tabbing reaches the search field",
    stops.some((stop) => stop.includes("structure-search")),
    `stop ${stops.findIndex((stop) => stop.includes("structure-search")) + 1} of ${stops.length}`,
  );
  check(
    "tabbing reaches spatial query controls",
    stops.some((stop) => stop.includes("spatial-support")) &&
      stops.some((stop) => stop.includes("spatial-anchor")) &&
      stops.filter((stop) => stop.startsWith("INPUT")).length >= 13,
    `${stops.filter((stop) => stop.startsWith("INPUT")).length} inputs`,
  );
  const searchStop = stops.findIndex((stop) => stop.includes("structure-search"));
  const spatialSupportStop = stops.findIndex((stop) => stop.includes("spatial-support"));
  check(
    "tab order is header, then spatial controls, then structure controls",
    stops[0].includes("Skip to spatial query") &&
      spatialSupportStop !== -1 &&
      searchStop !== -1 &&
      spatialSupportStop < searchStop,
    `skip link first, spatial support at ${spatialSupportStop + 1}, structure search at ${searchStop + 1} of ${stops.length}`,
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 4. Evidence filtering and search                                    */
/* ------------------------------------------------------------------ */

console.log("\n=== evidence filtering and search ===");
{
  const { page, errors } = await open(`${previewOrigin}/analysis`, { settle: 2000 });
  // Scoped to the structure table. The page carries several tables now — the
  // temporal event ledger, and the snapshot and change tables when a date is
  // selected — so a bare `tbody tr` counts rows this check is not about.
  const rowCount = () =>
    page.evaluate(() => document.querySelectorAll("#structure-table tbody tr").length);
  // The row count lives in its own status element; select it by content so a
  // second status region (the manifest reader) cannot be mistaken for it.
  const statusText = () =>
    page.evaluate(() => {
      const regions = [...document.querySelectorAll("[role='status']")];
      const counter = regions.find((node) =>
        /Showing \d+ of \d+/.test(node.textContent ?? ""),
      );
      return (counter?.textContent ?? "").trim();
    });

  const allRows = await rowCount();
  check("table lists every modeled structure", allRows === 45, `${allRows} rows`);

  // Uncheck "Illustrative".
  await page.evaluate(() => {
    const section = document.querySelector("#table-heading")?.closest("section");
    const labels = [...(section?.querySelectorAll("label") ?? [])];
    const target = labels.find((label) => /illustrative/i.test(label.textContent ?? ""));
    target?.querySelector("input")?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const filtered = await rowCount();
  check(
    "unchecking a classification filters the table",
    filtered < allRows && filtered > 0,
    `${allRows} → ${filtered} rows`,
  );
  check(
    "the visible count is announced as text",
    (await statusText()).includes(`${filtered} of ${allRows}`),
    await statusText(),
  );

  // Restore, then search.
  await page.evaluate(() => {
    const section = document.querySelector("#table-heading")?.closest("section");
    const labels = [...(section?.querySelectorAll("label") ?? [])];
    const target = labels.find((label) => /illustrative/i.test(label.textContent ?? ""));
    target?.querySelector("input")?.click();
  });
  await page.type("#structure-search", "fuel");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const searched = await rowCount();
  check(
    "search narrows the table",
    searched > 0 && searched < allRows,
    `${searched} rows`,
  );
  check("filtering produced no page errors", errors.length === 0, errors[0] ?? "clean");
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 5. Deterministic spatial query deep links                           */
/* ------------------------------------------------------------------ */

console.log("\n=== deterministic spatial query ===");
{
  const { page, errors } = await open(
    `${previewOrigin}/analysis?anchor=rwy-05-23&distance=500`,
    { settle: 2500 },
  );
  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#spatial-query-results tbody tr")];
    const status = [...document.querySelectorAll("[role='status']")].find((node) =>
      /modeled spatial subject/.test(node.textContent ?? ""),
    );
    const buttons = [...document.querySelectorAll("button")].filter((button) =>
      /^Export (JSON|CSV|GeoJSON)$/.test(button.textContent?.trim() ?? ""),
    );
    return {
      count: rows.length,
      first: rows[0]?.querySelector("th")?.textContent ?? "",
      status: status?.textContent ?? "",
      exportsEnabled: buttons.length === 3 && buttons.every((button) => !button.disabled),
    };
  });
  check(
    "runway proximity deep link returns ordered results",
    state.count > 0 && /tri-north/.test(state.first),
    `${state.count} rows · first ${state.first.trim().slice(0, 40)}`,
  );
  check(
    "spatial result count is announced as text",
    state.status.includes(String(state.count)),
    state.status.trim(),
  );
  check(
    "valid spatial results enable all three exports",
    state.exportsEnabled,
    state.exportsEnabled ? "JSON, CSV, GeoJSON" : "export disabled",
  );
  check(
    "spatial query deep link has no page errors",
    errors.length === 0,
    errors[0] ?? "clean",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const firstAfterReload = await page.evaluate(
    () => document.querySelector("#spatial-query-results tbody tr th")?.textContent ?? "",
  );
  check(
    "spatial query ordering survives refresh",
    firstAfterReload === state.first,
    firstAfterReload.trim().slice(0, 40),
  );
  await page.close();
}

for (const [path, expected] of [
  [
    "/analysis?kinds=structure,aircraft&support=without-direct-observation",
    "without direct observation",
  ],
  ["/analysis?uncertainty=0&includeUnknown=1", "unknown uncertainty"],
  ["/analysis?spatialDate=2025-09-13&presence=established", "snapshot presence"],
]) {
  const { page, errors } = await open(`${previewOrigin}${path}`, { settle: 2000 });
  const rows = await page.evaluate(
    () => document.querySelectorAll("#spatial-query-results tbody tr").length,
  );
  check(
    `spatial filter works: ${expected}`,
    rows > 0 && errors.length === 0,
    `${rows} rows`,
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 6. Deep links between the table and the 3D dossier                  */
/* ------------------------------------------------------------------ */

console.log("\n=== deep links between the two views ===");
{
  const { page } = await open(`${previewOrigin}/analysis?structure=hangar-main`, {
    settle: 2000,
  });
  const marked = await page.evaluate(() =>
    (document.querySelector("#row-hangar-main")?.textContent ?? "").includes(
      "opened from the 3D dossier",
    ),
  );
  check("/analysis?structure=… highlights the row", marked, "row-hangar-main");
  // The highlighted row opens the same claim inspector the 3D dossier shows,
  // so the route that works without WebGL answers the same questions.
  const inspector = await page.evaluate(
    () => document.querySelector("#claim-hangar-main")?.textContent ?? "",
  );
  check(
    "/analysis?structure=… opens the claim inspector beneath the row",
    /How much is known/.test(inspector) &&
      /The evidence establishes/.test(inspector) &&
      /Entered this model/.test(inspector),
    inspector.slice(0, 80) || "no inspector",
  );
  await page.close();
}
{
  const { page, errors } = await open(`${previewOrigin}/?structure=hangar-main`, {
    settle: 7000,
  });
  const dossierText = await page.evaluate(() => document.body.innerText);
  check(
    "/?structure=… opens that dossier",
    dossierText.includes("Main assembly hangar") &&
      /How much is known/i.test(dossierText) &&
      /What supports it/i.test(dossierText),
    "dossier visible",
  );
  check(
    "the dossier states a coordinate reference system",
    dossierText.includes("EPSG:32645"),
    "EPSG:32645",
  );
  check("deep link produced no page errors", errors.length === 0, errors[0] ?? "clean");
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 7. Narrow viewport                                                  */
/* ------------------------------------------------------------------ */

console.log("\n=== mobile viewport (390 x 844) ===");
for (const [path, settle] of [
  ["/analysis", 2500],
  ["/", 6000],
]) {
  const { page } = await open(`${previewOrigin}${path}`, {
    settle,
    viewport: { width: 390, height: 844, hasTouch: true },
  });
  // Wide content must scroll inside its own container while the page itself
  // stays put. `documentElement.scrollWidth` is not a usable probe here: the
  // root element is `overflow: hidden`, and Chrome still reports a descendant
  // scroller's extent through it. Measure the body box and the scroller.
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector("#structure-table");
    return {
      body: document.body.scrollWidth,
      inner: window.innerWidth,
      scrollerClient: scroller?.clientWidth ?? null,
      scrollerScroll: scroller?.scrollWidth ?? null,
    };
  });
  check(
    `${path} lays out at a 390 px viewport`,
    overflow.inner === 390,
    `innerWidth ${overflow.inner}`,
  );
  check(
    `${path} keeps page content inside the viewport at 390 px`,
    overflow.body <= overflow.inner + 1,
    `body ${overflow.body} · viewport ${overflow.inner}`,
  );
  if (overflow.scrollerClient !== null) {
    check(
      `${path} scrolls the wide table inside its own container`,
      overflow.scrollerClient <= overflow.inner &&
        (overflow.scrollerScroll ?? 0) > overflow.scrollerClient,
      `container ${overflow.scrollerClient} · content ${overflow.scrollerScroll}`,
    );
  }
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 7b. The twin's HUD panels never cover one another                    */
/* ------------------------------------------------------------------ */

// The bottom panels share one grid (`.hud-dock`); before it, the timeline sat
// on the site map and the pan-stick on every phone, the legend on the
// telemetry, and an opened legend ran off the top of a 720 px laptop. Measure
// the boxes rather than look at a frame: a covered control still renders.
console.log("\n=== HUD layout across screens ===");
for (const view of [
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "phone held sideways", width: 844, height: 390, touch: true },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "narrow window", width: 600, height: 800, touch: false },
  { name: "laptop", width: 1280, height: 720, touch: false },
]) {
  const { page } = await open(`${previewOrigin}/`, {
    settle: 6000,
    viewport: {
      width: view.width,
      height: view.height,
      isMobile: view.touch,
      hasTouch: view.touch,
    },
  });
  const layout = await page.evaluate(() => {
    const box = (name, el) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0
        ? { name, l: r.left, t: r.top, r: r.right, b: r.bottom }
        : null;
    };
    const stick = [...document.querySelectorAll("span")].find(
      (s) => s.textContent === "pan",
    )?.parentElement;
    const boxes = [
      box("top bar", document.querySelector(".topbar-controls")),
      box("title", document.querySelector(".site-title")),
      box("telemetry", document.querySelector(".telemetry-panel")),
      box("legend", document.querySelector(".evidence-legend")),
      box("timeline", document.querySelector(".timeline-panel")),
      box("site map", document.querySelector(".minimap-panel")),
      box("pan-stick", stick),
    ].filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        if (
          Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 &&
          Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1
        )
          overlaps.push(`${a.name} × ${b.name}`);
      }
    const outside = boxes
      .filter((p) => p.l < 0 || p.t < 0 || p.r > innerWidth + 1 || p.b > innerHeight + 1)
      .map((p) => p.name);
    return { overlaps, outside, stick: !!stick };
  });
  check(
    `${view.name}: no HUD panel covers another`,
    layout.overlaps.length === 0 && layout.outside.length === 0,
    [...layout.overlaps, ...layout.outside.map((n) => `${n} off screen`)].join(", ") ||
      "clear",
  );
  check(
    `${view.name}: the pan-stick is ${view.touch ? "offered" : "left out"}`,
    layout.stick === view.touch,
  );
  const opened = await page.evaluate(async () => {
    const legend = document.querySelector(".evidence-legend");
    const toggle = legend.querySelector("button[aria-controls=evidence-legend-body]");
    if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const r = legend.getBoundingClientRect(),
      bar = document.querySelector(".topbar-controls").getBoundingClientRect();
    return {
      inside:
        r.top >= 0 &&
        r.bottom <= innerHeight + 1 &&
        r.left >= 0 &&
        r.right <= innerWidth + 1,
      underBar:
        Math.min(r.right, bar.right) - Math.max(r.left, bar.left) > 1 &&
        Math.min(r.bottom, bar.bottom) - Math.max(r.top, bar.top) > 1,
    };
  });
  check(
    `${view.name}: the opened legend stays on screen and clear of the top bar`,
    opened.inside && !opened.underBar,
    JSON.stringify(opened),
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 8. Reduced motion reaches the application state (dev build only)     */
/* ------------------------------------------------------------------ */

if (devOrigin !== "-") {
  console.log("\n=== reduced motion (dev build) ===");
  const { page } = await open(`${devOrigin}/`, { settle: 7000, reducedMotion: true });
  const state = await page.evaluate(() => {
    const store = globalThis.__twinStore;
    if (!store) return null;
    const { reducedMotion, autoQuality } = store.getState();
    return { reducedMotion, autoQuality };
  });
  if (state === null) {
    check("reduced-motion preference reaches the store", false, "__twinStore missing");
  } else {
    check(
      "prefers-reduced-motion sets the store flag",
      state.reducedMotion === true,
      `reducedMotion=${state.reducedMotion}`,
    );
    check(
      "reduced motion disables adaptive quality promotion",
      state.autoQuality === false,
      `autoQuality=${state.autoQuality}`,
    );
  }
  await page.close();

  const pinned = await open(`${devOrigin}/?quality=999999`, { settle: 6000 });
  const tier = await pinned.page.evaluate(
    () => globalThis.__twinStore?.getState().qualityTier ?? null,
  );
  check(
    "an out-of-range ?quality is clamped, not trusted",
    tier !== null && tier >= 0 && tier <= 3,
    `tier=${tier}`,
  );
  await pinned.page.close();
} else {
  console.log("\n=== reduced motion (dev build) === skipped");
}

/* ------------------------------------------------------------------ */
/* 9. The one third-party request stays opt-in                         */
/* ------------------------------------------------------------------ */

console.log("\n=== ?liveTraffic= stays opt-in ===");
{
  const ADSB_HOST = "api.adsb.lol";
  /** Opens the twin and answers any ADS-B request locally with an empty sky. */
  const openTraffic = async (query, settle) => {
    const seen = { count: 0, afterMs: null };
    const started = Date.now();
    const opened = await open(`${previewOrigin}/?${query}`, {
      settle,
      onRequest: (request) => {
        if (new URL(request.url()).hostname !== ADSB_HOST) {
          void request.continue();
          return;
        }
        seen.count += 1;
        seen.afterMs ??= Date.now() - started;
        void request.respond({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: '{"ac":[]}',
        });
      },
    });
    return { ...opened, seen };
  };

  // The control: the documented value does make the request, so the checks
  // below cannot pass merely because the layer never mounts.
  const control = await openTraffic("liveTraffic=1", 0);
  const deadline = Date.now() + 30000;
  while (control.seen.count === 0 && Date.now() < deadline) await sleep(250);
  check(
    "?liveTraffic=1 makes the ADS-B request (answered here)",
    control.seen.count > 0 && control.errors.length === 0,
    control.seen.count > 0
      ? `after ${control.seen.afterMs} ms`
      : (control.errors[0] ?? "no request in 30 s"),
  );
  await control.page.close();

  // Wait at least twice as long as the control took before calling it absent.
  const settle = Math.min(30000, Math.max(8000, 2 * (control.seen.afterMs ?? 4000)));
  const HOSTILE_TRAFFIC = [
    ["yes", "liveTraffic=yes"],
    ["TRUE", "liveTraffic=TRUE"],
    ["1e309", "liveTraffic=1e309"],
    ["<script>", `liveTraffic=${encodeURIComponent("<script>alert(1)</script>")}`],
    ["(empty)", "liveTraffic="],
    ["yes, then 1", "liveTraffic=yes&liveTraffic=1"],
  ];
  for (const [label, query] of HOSTILE_TRAFFIC) {
    const { page, errors, seen } = await openTraffic(query, settle);
    const rendered = await page.evaluate(() => document.querySelector("canvas") !== null);
    check(
      `?liveTraffic=${label} makes no third-party request`,
      seen.count === 0 && rendered && errors.length === 0,
      seen.count > 0 ? `${seen.count} request(s)` : (errors[0] ?? "none"),
    );
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
/* 10. State parameters reach the store as documented (dev build only)  */
/* ------------------------------------------------------------------ */

if (devOrigin !== "-") {
  console.log("\n=== ?year=, ?compare=, ?night=, ?uncertainty=, ?at= (dev build) ===");
  const earliest = TEMPORAL_SNAPSHOT_DATES[0];
  const edge = SITE_SIZE / 2;
  const enc = encodeURIComponent;
  const DEFAULTS = {
    snapshotDate: null,
    comparisonDate: null,
    night: false,
    showUncertainty: false,
    target: null,
  };
  // Each case is one cold load; every expectation in it is its own check.
  // `target` is the camera target of the last fly-to the load requested.
  const CASES = [
    {
      query: "year=1e309&compare=2025-02-30&night=yes&uncertainty=yes&at=1,foo",
      expect: DEFAULTS,
    },
    {
      query: `year=2021.5&compare=${enc("<script>")}&night=TRUE&uncertainty=TRUE&at=${enc("<script>")}`,
      expect: DEFAULTS,
    },
    {
      // Out-of-range integers clamp to the timeline's ends; the rest are flags
      // and a point clamped to the modeled site.
      query: "year=-99999&compare=1999-01-01&night=1&uncertainty=1&at=1e308,-1e308",
      expect: {
        snapshotDate: snapshotDateForYear(TIMELINE_BOUNDS.minYear),
        comparisonDate: null,
        night: true,
        showUncertainty: true,
        target: [edge, 0, -edge],
      },
    },
    {
      query: `year=99999&compare=${earliest}`,
      expect: { snapshotDate: null, comparisonDate: earliest },
    },
    {
      // An invalid snapshot falls through to the legacy year (one that is
      // not a timeline end, so it cannot pass by clamping).
      query: "snapshot=2025-02-30&year=2024&at=100,-200",
      expect: { snapshotDate: snapshotDateForYear(2024), target: [100, 0, -200] },
    },
    {
      // A valid snapshot wins over the year; `?at=` frames after `?structure=`.
      query: `snapshot=${earliest}&year=1999&structure=hangar-main&at=100,-200`,
      expect: {
        snapshotDate: earliest,
        selectedId: "hangar-main",
        target: [100, 0, -200],
      },
    },
  ];
  const sameTarget = (actual, expected) =>
    expected === null
      ? actual === null
      : Array.isArray(actual) && expected.every((v, i) => Math.abs(actual[i] - v) < 1e-6);
  for (const { query, expect } of CASES) {
    const { page, errors } = await open(`${devOrigin}/?${query}`, { settle: 0 });
    const ready = await page
      .waitForFunction(
        () => globalThis.__twinStore != null && document.querySelector("canvas") !== null,
        { timeout: 60000, polling: 250 },
      )
      .then(() => true)
      .catch(() => false);
    const read = () =>
      page.evaluate(() => {
        const s = globalThis.__twinStore?.getState();
        if (!s) return null;
        return {
          snapshotDate: s.snapshotDate,
          comparisonDate: s.comparisonDate,
          night: s.night,
          showUncertainty: s.showUncertainty,
          selectedId: s.selectedId,
          target: s.flyTo ? [...s.flyTo.target] : null,
        };
      });
    // A fly-to is requested from an effect after mount: give it a moment.
    let state = ready ? await read() : null;
    for (
      let i = 0;
      state && expect.target && !sameTarget(state.target, expect.target) && i < 20;
      i += 1
    ) {
      await sleep(250);
      state = await read();
    }
    if (state && expect.target === null) {
      // No fly-to is expected: give a late one time to appear before saying so.
      await sleep(1000);
      state = await read();
    }
    const short = query.length > 30 ? `${query.slice(0, 30)}…` : query;
    check(
      `?${short} loads cleanly`,
      ready && state !== null && errors.length === 0,
      errors[0] ?? "clean",
    );
    if (state === null) {
      await page.close();
      continue;
    }
    for (const [key, value] of Object.entries(expect)) {
      const actual = state[key];
      const pass = key === "target" ? sameTarget(actual, value) : actual === value;
      check(`  ${key} = ${JSON.stringify(value)}`, pass, `got ${JSON.stringify(actual)}`);
    }
    await page.close();
  }
} else {
  console.log(
    "\n=== ?year=, ?compare=, ?night=, ?uncertainty=, ?at= (dev build) === skipped",
  );
}

/* ------------------------------------------------------------------ */
/* 11. Without WebGL, focus reaches only what can be seen              */
/* ------------------------------------------------------------------ */

console.log("\n=== without WebGL ===");
for (const [path, ways] of [
  ["/", ["/analysis", "/compare"]],
  ["/play", ["/evaluation", "/analysis"]],
]) {
  const { page, errors } = await open(`${previewOrigin}${path}`, {
    settle: 3000,
    webgl: false,
  });
  const stops = [];
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      // The first line box: a wrapped link's bounding box can centre on the gap.
      const box = active.getClientRects()[0];
      const hit = box
        ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        : null;
      return {
        label: `${active.tagName}:${(active.textContent ?? "").trim().slice(0, 30)}`,
        href: active.getAttribute("href"),
        seen: hit !== null && active.contains(hit),
      };
    });
    if (stop) stops.push(stop);
  }
  const hidden = stops.filter((stop) => !stop.seen);
  check(
    `${path} without WebGL: every Tab stop can be seen`,
    stops.length > 0 && hidden.length === 0,
    hidden.length > 0 ? `hidden: ${hidden[0].label}` : `${stops.length} stops`,
  );
  check(
    `${path} without WebGL: Tab reaches ${ways.join(" and ")}`,
    ways.every((way) => stops.some((stop) => stop.href === way)),
    [...new Set(stops.map((stop) => stop.href))].join(" "),
  );
  check(
    `${path} without WebGL: no page errors`,
    errors.length === 0,
    errors[0] ?? "clean",
  );
  await page.close();
}

await browser.close();

const failed = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
