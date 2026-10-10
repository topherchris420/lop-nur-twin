/** Browser verification against a local server and retained native research records.
 * No mocked inference, proposals or approvals. Captures are inspection views.
 */
import puppeteer from "puppeteer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const origin = process.argv[2] ?? "http://127.0.0.1:4191";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  throw new Error("Local verification origin required");
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const out = "shots/rain-inception";
await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/?quality=1", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("EVIDENCE TIMELINE"),
      { timeout: 60000 },
    );
  } catch (error) {
    console.log(
      "Boot diagnostics",
      await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 1600),
      })),
      errors,
    );
    await page.screenshot({ path: out + "/boot-failure.png" });
    throw error;
  }
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-bethesda="active"]');
  const click = async (name) =>
    page.evaluate((name) => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.trim().startsWith(name),
      );
      if (!button) throw new Error("Missing button: " + name);
      button.click();
    }, name);
  await click("~ telemetry");
  await page.waitForSelector("#city-event");
  await page.focus("#city-event");
  await page.keyboard.sendCharacter("resolve r.a.i.n.");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-rain-lab="active"]');
  await click("Inception Observatory / Researchers");
  await page.waitForSelector('[aria-label="Researcher interaction panel"]');
  await page.screenshot({ path: out + "/researchers.png" });
  await click("Ask, intervene, review proposals or archive research");
  await page.waitForSelector('[aria-label="Autonomous discovery workbench"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Inception Observatory"]')
      ?.textContent.includes("generation 1"),
  );
  await click("Inspect / enter recorded world");
  await page.waitForSelector('[aria-label="Descendant world inspection"]');
  await page.waitForFunction(() =>
    document.body.innerText.includes("Select a completed experiment"),
  );
  await click("Enter / restart bounded world replay");
  try {
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Replay verified:") ||
        document.body.innerText.includes("Host replay verified;") ||
        document.body.innerText.includes("Replay failed;"),
      {
        timeout: 180000,
      },
    );
  } catch (error) {
    console.log(
      await page.$eval('[aria-label="Descendant world inspection"]', (e) => e.innerText),
    );
    await page.screenshot({ path: out + "/replay-failure.png" });
    throw error;
  }
  if (
    await page.$eval('[aria-label="Descendant world inspection"]', (e) =>
      e.textContent.includes("Replay failed;"),
    )
  )
    throw new Error(
      await page.$eval(
        '[aria-label="Descendant world inspection"]',
        (e) => e.textContent,
      ),
    );
  await page.$eval('[aria-label="Descendant world inspection"]', (e) =>
    e.scrollIntoView({ block: "start" }),
  );
  await click("Show 3D reconstruction");
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector("[data-rain-replay-preview] canvas")?.dataset
          .rainReplayFrame,
      ) >= 3,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.screenshot({ path: out + "/descendant-replay.png", fullPage: false });
  const axe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  await page.evaluate(axe);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
  });
  const archive = await page.evaluate(async () => {
    const response = await fetch("/api/rain/discovery?archive=bethesda-rain");
    if (!response.ok) throw new Error("Archive failed");
    const data = await response.json();
    return {
      schema: data.schema,
      records: data.records.length,
      artifacts: data.artifacts.length,
      hash: data.archive_sha256,
    };
  });
  if (
    archive.schema !== "rain-inception-archive/v1" ||
    archive.records < 1 ||
    archive.artifacts < 1
  )
    throw new Error("Incomplete archive");
  await writeFile(
    out + "/validation.json",
    JSON.stringify(
      {
        origin,
        scope:
          "Retained scripted research; actual simulator evidence; no new inference or authorization",
        errors,
        violations,
        archive,
      },
      null,
      2,
    ),
  );
  if (errors.length || violations.length)
    throw new Error(JSON.stringify({ errors, violations }));
  console.log(
    "Inception browser inspection, verified descendant replay, archive and axe passed:",
    out,
  );
} finally {
  await browser.close();
}
