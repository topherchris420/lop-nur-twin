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
 *    physics world before anything else validates them;
 *  - the keyboard path through the accessible view, which no screenshot and no
 *    axe rule can confirm actually works;
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

/** Opens a page, collecting page errors, and returns both. */
async function open(url, { settle = 2500, viewport, reducedMotion = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport ?? { width: 1440, height: 900 });
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
  ["/", "Geospatial Simulation Testbed", 6000],
  ["/analysis", "Structure analysis table", 2500],
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
];
for (const path of HOSTILE) {
  const { page, errors } = await open(`${previewOrigin}${path}`, {
    settle: path.startsWith("/analysis") ? 2000 : 5000,
  });
  const rendered = await page.evaluate(
    () =>
      document.querySelector("canvas") !== null ||
      document.querySelector("table") !== null,
  );
  check(
    `renders normally: ${path.slice(0, 58)}`,
    rendered && errors.length === 0,
    errors[0] ?? "clean",
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
    first.tag === "A" && /skip to the structure table/i.test(first.text),
    `${first.tag}: ${first.text.slice(0, 40)}`,
  );

  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterSkip = await page.evaluate(() => document.activeElement?.id ?? "");
  check(
    "activating the skip link moves focus to the table",
    afterSkip === "structure-table",
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
  for (let index = 0; index < 12; index += 1) {
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
    "tabbing reaches the four evidence filter checkboxes",
    stops.filter((stop) => stop.startsWith("INPUT")).length >= 5,
    `${stops.filter((stop) => stop.startsWith("INPUT")).length} inputs (search + filters)`,
  );
  check(
    "tab order is header, then controls, then table",
    stops[0].includes("Skip to the structure") &&
      stops.some((stop) => stop.includes("Open in 3D")),
    `${new Set(stops).size} distinct stops in ${stops.length} tabs`,
  );
  await page.close();
}

/* ------------------------------------------------------------------ */
/* 4. Evidence filtering and search                                    */
/* ------------------------------------------------------------------ */

console.log("\n=== evidence filtering and search ===");
{
  const { page, errors } = await open(`${previewOrigin}/analysis`, { settle: 2000 });
  const rowCount = () =>
    page.evaluate(() => document.querySelectorAll("tbody tr").length);
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
    const labels = [...document.querySelectorAll("label")];
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
    const labels = [...document.querySelectorAll("label")];
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
/* 5. Deep links between the table and the 3D dossier                  */
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
  await page.close();
}
{
  const { page, errors } = await open(`${previewOrigin}/?structure=hangar-main`, {
    settle: 7000,
  });
  const dossierText = await page.evaluate(() => document.body.innerText);
  check(
    "/?structure=… opens that dossier",
    dossierText.includes("Main assembly hangar") && /evidence record/i.test(dossierText),
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
/* 6. Narrow viewport                                                  */
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
/* 7. Reduced motion reaches the application state (dev build only)     */
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

await browser.close();

const failed = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
