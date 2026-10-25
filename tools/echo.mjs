#!/usr/bin/env node
/** Production ECHO panel regression, including no-WebGL and narrow screens. */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:4192";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4192",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
const results = [],
  errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
};
try {
  for (let k = 0; k < 100; k++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  for (const enabled of [false, true]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => {
      // This one error is the explicitly injected no-WebGL fault, whose fallback is asserted below.
      if (String(e) !== "Error: THREE.WebGLRenderer: Error creating WebGL context.")
        errors.push(String(e));
    });
    await page.setViewport({ width: 1100, height: 800 });
    // Both routes must keep working without a GPU. This also bounds test cost.
    const disableWebGL = () => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : original.call(this, kind, ...args);
      };
    };
    await page.goto(`${origin}/?quality=1${enabled ? "&echo=1" : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => document.body.innerText.includes("EVIDENCE TIMELINE"),
      { polling: 100 },
    );
    await page.evaluate(disableWebGL);
    await page.keyboard.press("Backquote");
    await page.waitForSelector("#anomaly-coordinate");
    await page.type("#anomaly-coordinate", "38.9847,-77.0947");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-bethesda="active"]');
    check(
      "injected WebGL failure has a visible fallback",
      (await page.evaluate(() => document.body.innerText)).includes(
        "3D rendering is unavailable",
      ),
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Fly",
        ),
      { polling: 100 },
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Fly")
        .click(),
    );
    await page.waitForSelector('details[aria-label="Project ECHO self-model"]');
    await page.click('details[aria-label="Project ECHO self-model"] summary');
    const text = await page.$eval(
      'details[aria-label="Project ECHO self-model"]',
      (el) => el.innerText,
    );
    check(
      enabled ? "experimental configuration selected" : "baseline remains default",
      text.includes(enabled ? "fly-echo/v1/full" : "baseline (ECHO off)"),
    );
    if (enabled) {
      check(
        "estimates and researcher truth are distinct",
        text.includes("Researcher truth") && text.includes("unavailable to self-model"),
      );
      check(
        "uncertainty and memory visible",
        text.includes("Uncertainty") && text.includes("Memory"),
      );
      const modelTick = () =>
        page.$eval('details[aria-label="Project ECHO self-model"]', (el) =>
          Number(
            [...el.querySelectorAll("dt")].find((dt) => dt.textContent === "Model tick")
              ?.nextElementSibling?.textContent,
          ),
        );
      const before = await modelTick();
      await page.waitForFunction(
        (tick) => {
          const el = document.querySelector(
            'details[aria-label="Project ECHO self-model"]',
          );
          return (
            Number(
              [...el.querySelectorAll("dt")].find((dt) => dt.textContent === "Model tick")
                ?.nextElementSibling?.textContent,
            ) > tick
          );
        },
        { polling: 100 },
        before,
      );
      check("opening the panel does not pause the clock", Number.isFinite(before));
      await page.evaluate(axe);
      const violations = await page.evaluate(async () =>
        (
          await globalThis.axe.run(
            document.querySelector('section[aria-label="Digital fly"]'),
          )
        ).violations
          .filter((v) => ["serious", "critical"].includes(v.impact))
          .map((v) => v.id),
      );
      check("panel accessibility", violations.length === 0, violations.join(","));
      await mkdir("shots/project-echo", { recursive: true });
      await page.screenshot({ path: "shots/project-echo/desktop.png" });
      await page.setViewport({ width: 390, height: 844 });
      const box = await page.$eval('section[aria-label="Digital fly"]', (el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          width: innerWidth,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      check(
        "panel stays within mobile viewport",
        box.left >= 0 && box.right <= box.width && box.scrollWidth <= box.clientWidth + 1,
        JSON.stringify(box),
      );
      await page.screenshot({ path: "shots/project-echo/mobile.png" });
    }
    await page.close();
  }
  check("no unexpected browser exceptions", errors.length === 0, errors.join("; "));
  await writeFile(
    "shots/project-echo/verification.json",
    JSON.stringify({ results, errors }, null, 2) + "\n",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
if (results.some((r) => !r.ok)) process.exitCode = 1;
