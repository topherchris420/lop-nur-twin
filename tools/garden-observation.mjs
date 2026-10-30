#!/usr/bin/env node
/** Browser regressions for the observer, using bundled states and the real CSP.
 * No live service or simulation is touched. Run after garden:build.
 * node tools/garden-observation.mjs [--headless-shell]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const out = path.resolve("garden-check/observation");
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ["tools/garden.mjs", "serve", "--port", "0"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Garden server startup timed out")),
      15_000,
    );
    let output = "";
    server.stdout.on("data", (data) => {
      output += data;
      const found = output.match(/at (http:\/\/127\.0\.0\.1:\d+)\//);
      if (found) {
        clearTimeout(timeout);
        resolve(found[1]);
      }
    });
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Garden server exited ${code}`));
    });
  });
  browser = await puppeteer.launch({
    headless: process.argv.includes("--headless-shell") ? "shell" : true,
    pipe: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // The observer must work without a GPU. This check exercises the real 2D fallback.
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`garden-check CSP: ${event.violatedDirective}`),
    );
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return kind === "webgl2" || kind === "webgl" ? null : get.call(this, kind, ...rest);
    };
  });
  const fixture = JSON.parse(
    readFileSync("src/garden/core/fixtures/live-2026-10-26.json", "utf8"),
  );
  let state = structuredClone(fixture.sequences["fence-to-stone"][0]);
  const clockStart = state.server_time;
  const wallStart = Date.now();
  let outage = false;
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.text().startsWith("garden-check CSP:")) errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
    if (request.url() === `${origin}/api/state`) {
      void request.respond({
        status: outage ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...state,
          server_time: clockStart + (Date.now() - wallStart) / 1000,
        }),
      });
    } else void request.continue();
  });
  await page.goto(`${origin}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.getElementById("curtain").hidden);
  assert.equal(await page.$eval("#exhibit", (el) => el.dataset.renderer), "2d");
  assert.notEqual(
    await page.$eval("#learned-trials", (el) => el.textContent),
    "not reported",
  );
  await page.screenshot({ path: path.join(out, "desktop.png") });
  await page.click("#pause");
  const tick = await page.$eval("#observation-tick", (el) =>
    Number(el.textContent.replaceAll(",", "")),
  );
  const downloads = path.join(out, `downloads-${Date.now()}`);
  mkdirSync(downloads);
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await page.click("#save-observation");
  const deadline = Date.now() + 10_000;
  while (!readdirSync(downloads).some((f) => f.endsWith(".json"))) {
    assert.ok(Date.now() < deadline, "Observation download completes");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const record = JSON.parse(
    readFileSync(path.join(downloads, `garden-observation-${tick}.json`), "utf8"),
  );
  assert.equal(record.schema, "garden-observation/v1");
  assert.equal(record.observation.lifeId, state.life_id);
  assert.equal(record.observation.ticks, tick);
  assert.equal(record.presentation.paused, true);
  assert.equal(record.source.endpoint, `${origin}/api/state`);
  outage = true;
  await page.waitForFunction(
    () => document.getElementById("status").dataset.state === "reconnecting",
    { timeout: 20_000 },
  );
  assert.equal(
    await page.$eval("#pause", (el) => el.getAttribute("aria-pressed")),
    "true",
  );
  assert.equal(await page.$eval("#retry-connection", (el) => el.hidden), false);
  // Synthetic identity transition: same memory ids, different text, omitted learning.
  state = {
    ...state,
    life_id: "test-new-individual",
    learning: null,
    moments: [{ ...state.moments[0], text: "Synthetic identity-change fixture." }],
  };
  outage = false;
  await page.click("#retry-connection");
  await page.waitForFunction(
    () => document.getElementById("learned-trials").textContent === "not reported",
  );
  assert.equal(
    await page.$eval("#pause", (el) => el.getAttribute("aria-pressed")),
    "false",
  );
  assert.equal(await page.$eval("#life-name-row", (el) => el.hidden), true);
  assert.equal(await page.$eval("#learned-body", (el) => el.textContent), "");
  assert.match(
    await page.$eval("#memories", (el) => el.textContent),
    /Synthetic identity-change fixture/,
  );
  assert.equal(await page.$eval("#life-change", (el) => el.hidden), false);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => document.getElementById("curtain")?.hidden);
  if (
    await page.$eval(
      "#panel-toggle",
      (el) => el.getAttribute("aria-expanded") === "false",
    )
  )
    await page.click("#panel-toggle");
  await page.screenshot({ path: path.join(out, "phone.png") });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "No phone overflow",
  );
  // Use the bundled axe source; it performs no network requests.
  await page.evaluate(readFileSync("node_modules/axe-core/axe.min.js", "utf8"));
  const violations = await page.evaluate(async () =>
    (await axe.run()).violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    ),
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every((r) => r.method === "GET" && new URL(r.url).origin === origin),
  );
  const report = {
    ok: true,
    fixture: "recorded state plus labelled synthetic identity transition",
    export: true,
    pausedOutage: true,
    identityChange: true,
    missingLearning: true,
    memoryRefresh: true,
    mobileOverflow: false,
    accessibilityViolations: violations.length,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
