#!/usr/bin/env node
/** Repeatable street/survey captures of the real UI. No model requests or state hooks. */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const origin = process.argv[2] ?? "http://127.0.0.1:4183";
const output = process.argv[3] ?? "shots/bethesda/look";
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
        "4183",
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Preview may not be listening yet. */
    }
    await delay(100);
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) {
      external.push(r.url());
      void r.abort();
    } else void r.continue();
  });
  await page.evaluateOnNewDocument(() =>
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 }),
  );
  await page.goto(origin + "/?quality=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => document.body.innerText.includes("CONSTRUCTION TIMELINE"),
    { timeout: 60000 },
  );
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-bethesda="active"]', { timeout: 60000 });
  const click = async (name) =>
    page.evaluate((name) => {
      const b = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === name,
      );
      if (!b) throw new Error("Missing " + name);
      b.click();
    }, name);
  await delay(4000);
  await click("Pause");
  await page.screenshot({ path: output + "/arrival-auto.png" });
  await click("Survey");
  await delay(1000);
  await page.screenshot({ path: output + "/survey-auto.png" });
  await click("Walk");
  await delay(1500);
  await page.screenshot({ path: output + "/street-auto.png" });
  const hasDetail = await page.evaluate(() =>
    document.body.innerText.includes("Visuals: auto"),
  );
  if (hasDetail) {
    await click("Visuals: auto");
    await delay(2000);
  }
  await page.screenshot({ path: output + "/street-detail.png" });
  // Turn in place through pointer drag, just as a person would.
  await page.mouse.move(600, 350);
  await page.mouse.down();
  await page.mouse.move(1020, 350, { steps: 12 });
  await page.mouse.up();
  await delay(1200);
  await page.screenshot({ path: output + "/street-west.png" });
  await click("Survey");
  await delay(1500);
  await page.screenshot({ path: output + "/survey-detail.png" });
  const report = {
    errors,
    external,
    detailAvailable: hasDetail,
    renderer: await page.evaluate(() => {
      const c = [...document.querySelectorAll("canvas")].find((c) => c.width > 500);
      const gl = c?.getContext("webgl2");
      return gl?.getParameter(gl.RENDERER) ?? "unknown";
    }),
    hud: await page.evaluate(() => document.body.innerText),
  };
  await writeFile(output + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ errors, external, captures: output }));
  if (errors.length || external.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}
