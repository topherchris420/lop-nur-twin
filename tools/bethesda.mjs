#!/usr/bin/env node
/** Production regression. Provider requests are intercepted before navigation;
 * no live model or external map service is used. Owns preview if no URL is given. */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url),
  axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const origin = process.argv[2] ?? "http://127.0.0.1:4182";
const server = process.argv[2]
  ? null
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4182",
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
let browser, page;
let providerCalls = 0;
const checks = [],
  errors = [],
  resources = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + detail : ""}`);
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Preview is not listening yet. */
    }
    await delay(100);
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });
  page = await browser.newPage();
  page.setDefaultTimeout(60000);
  // Keep real WebGL enabled, with a bounded raster budget on software GPUs.
  await page.setViewport({ width: 960, height: 640 });
  // These are timer/DOM conditions, not render-frame conditions. Puppeteer's
  // default rAF polling can stall behind a slow SwiftShader frame in CI.
  const waitFor = (predicate, ...args) =>
    page.waitForFunction(predicate, { polling: 100, timeout: 60000 }, ...args);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    globalThis.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      globalThis.__csp.push(e.effectiveDirective),
    );
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    resources.push(r.url());
    if (r.url().includes("/api/jev/decision")) {
      providerCalls++;
      void r.respond({
        status: 503,
        contentType: "application/json",
        body: '{"error":"offline test double"}',
      });
    } else void r.continue();
  });
  await page.goto(origin + "/?quality=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitFor(() => document.body.innerText.includes("CONSTRUCTION TIMELINE"));
  check("Lop Nur opens normally", (await page.title()).startsWith("Lop Nur"));
  check("city not initially mounted", !(await page.$('[data-bethesda="active"]')));
  check("city bundle remains lazy", !resources.some((r) => /\/App-[^/]+\.js/.test(r)));
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-bethesda="active"]', { timeout: 60000 });
  await delay(1500);
  check("hidden resolver mounts Bethesda", (await page.title()).includes("Bethesda"));
  check("3D canvas exists", (await page.$$("canvas")).length >= 2);
  const click = async (name) =>
    page.evaluate((name) => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === name,
      );
      if (!button) throw new Error("Missing " + name);
      button.click();
    }, name);
  await mkdir("shots/bethesda", { recursive: true });
  // Use the existing public quality control without changing population or
  // simulation state. Both clicks run before another frame, avoiding Detail's
  // intermediate shadow allocation on the software renderer.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Visuals: auto",
    );
    if (!button) throw new Error("Missing visual quality control");
    button.click();
    button.click();
  });
  await waitFor(() => document.body.innerText.includes("Visuals: economy"));
  check("economy visuals remain selectable with WebGL", true);
  await click("Pause");
  await page.screenshot({ path: "shots/bethesda/survey.png" });
  await click("~ telemetry");
  await page.waitForSelector("#city-event");
  for (const event of [
    "Fire near Bethesda Row.",
    "A thunderstorm suddenly rolls through downtown Bethesda.",
    "The Metro station closes unexpectedly.",
    "A parade starts on Wisconsin Avenue.",
    "A strange unidentified object appears above Bethesda.",
  ]) {
    await page.focus("#city-event");
    await page.keyboard.sendCharacter(event);
    await page.keyboard.press("Enter");
    await waitFor(() => document.querySelector("#city-event").value === "");
    check(
      "scenario: " + event,
      await page.evaluate(() => document.body.innerText.includes("Event injected:")),
    );
  }
  await click("Close");
  await click("Resume");
  await click("Jev off");
  await waitFor(() => /fallback [1-9]/.test(document.body.innerText));
  await click("Jev on");
  await click("Walk");
  // Hold through actual simulation progress. A wall-clock sleep can elapse
  // entirely inside one software-rendered frame without a timer tick.
  const movementTick = await page.evaluate(() =>
    Number(/tick (\d+)/.exec(document.body.innerText)?.[1]),
  );
  await page.keyboard.down("KeyW");
  try {
    await waitFor(
      (tick) => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]) >= tick + 3,
      movementTick,
    );
  } finally {
    await page.keyboard.up("KeyW");
  }
  await click("Pause");
  await page.screenshot({ path: "shots/bethesda/walk-storm.png" });
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      void blob.text().then((text) => {
        globalThis.__cityExport = text;
      });
      return original.call(this, blob);
    };
  });
  await click("Export replay");
  await waitFor(() => typeof globalThis.__cityExport === "string");
  const trace = await page.evaluate(() => globalThis.__cityExport),
    parsed = JSON.parse(trace);
  check(
    "native fetch reaches mocked outage",
    providerCalls > 0 &&
      parsed.decisions.some((d) => d.source === "fallback" && d.reason === "unavailable"),
    `requests=${providerCalls}`,
  );
  check(
    "trace contains scenarios, movement, decisions and final hash",
    parsed.commands.filter((c) => c.type === "scenario").length === 5 &&
      parsed.commands.some((c) => c.type === "move") &&
      parsed.decisions.length > 0 &&
      parsed.finalHash.length > 0,
  );
  await writeFile("shots/bethesda/replay.json", trace);
  await (await page.$('input[type="file"]')).uploadFile("shots/bethesda/replay.json");
  await waitFor(() => document.body.innerText.includes("Replay verified"));
  check("re-import verifies decision history and state", true);
  await click("Resume");
  await writeFile("shots/bethesda/invalid-replay.json", "{}");
  await (
    await page.$('input[type="file"]')
  ).uploadFile("shots/bethesda/invalid-replay.json");
  await waitFor(() =>
    document.body.innerText.includes("Unsupported or oversized replay"),
  );
  check(
    "invalid replay preserves a running city",
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Pause",
      ),
    ),
  );
  await click("Pause");
  await click("Field notes");
  check(
    "fidelity and license are visible",
    await page.evaluate(
      () =>
        document.body.innerText.includes("bare-earth LiDAR DTM") &&
        document.body.innerText.includes("Redistribution permitted with attribution") &&
        document.body.innerText.includes("ODbL"),
    ),
  );
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
  });
  check(
    "city field notes pass serious/critical axe checks",
    violations.length === 0,
    JSON.stringify(violations),
  );
  check("no CSP violations", (await page.evaluate(() => globalThis.__csp)).length === 0);
  await click("Close field notes");
  await click("Return to the desert");
  await waitFor(() => document.title.startsWith("Lop Nur"));
  check("return restores Lop Nur", !(await page.$('[data-bethesda="active"]')));
  check("no page errors", errors.length === 0, errors.join("\n"));
  check(
    "no external map or assets requested",
    resources.every(
      (r) => r.startsWith(origin) || r.startsWith("data:") || r.startsWith("blob:"),
    ),
  );
  // Deliberate renderer failure after the normal error-free run. The city
  // must keep its independent timer and semantic controls alive.
  await waitFor(() => document.body.innerText.includes("CONSTRUCTION TIMELINE"));
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
        return null;
      return original.call(this, type, ...args);
    };
  });
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await waitFor(() => document.body.innerText.includes("3D rendering is unavailable"));
  const readTick = () =>
    page.evaluate(() => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]));
  const before = await readTick();
  await waitFor(
    (tick) => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]) > tick,
    before,
  );
  await click("~ telemetry");
  await page.focus("#city-event");
  await page.keyboard.sendCharacter("Fire near Bethesda Row.");
  await page.keyboard.press("Enter");
  check(
    "WebGL failure preserves city rules and scenario controls",
    await page.evaluate(() =>
      document.body.innerText.includes("Event injected: Fire near Bethesda Row"),
    ),
  );
  await writeFile("shots/bethesda/browser-checks.json", JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} catch (error) {
  await mkdir("shots/bethesda", { recursive: true });
  const hud = await Promise.race([
    page?.evaluate(() => document.body.innerText).catch(() => "unavailable"),
    delay(5000).then(() => "browser did not respond within 5 seconds"),
  ]);
  await writeFile("shots/bethesda/browser-checks.json", JSON.stringify(checks, null, 2));
  await writeFile(
    "shots/bethesda/browser-failure.json",
    JSON.stringify({ error: String(error), providerCalls, errors, hud }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server?.kill();
}
