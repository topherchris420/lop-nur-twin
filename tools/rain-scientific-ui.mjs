/** Inspect original retained scientific evidence through the real local service and browser. */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:4194",
  out = "shots/rain-scientific";
await mkdir(out, { recursive: true });
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("RAIN_")),
);
delete environment.TYPESAFE_API_KEY;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4194",
    "--strictPort",
  ],
  {
    env: {
      ...environment,
      RAIN_AUTONOMY_DIR: resolve(
        process.argv[2] ?? ".rain-research/scientific-scripted-20261011",
      ),
      RAIN_AUTONOMY_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
try {
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* preview is starting */
    }
    if (Date.now() > deadline || server.exitCode !== null)
      throw new Error("Preview did not start: " + serverLog);
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = await browser.newPage(),
    errors = [];
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/?quality=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("EVIDENCE TIMELINE"));
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-bethesda="active"]');
  const click = (name) =>
    page.evaluate((name) => {
      const target = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.trim().startsWith(name),
      );
      if (!target) throw new Error("Missing control: " + name);
      target.click();
    }, name);
  await click("~ telemetry");
  await page.waitForSelector("#city-event");
  await page.focus("#city-event");
  await page.keyboard.sendCharacter("resolve r.a.i.n.");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-rain-lab="active"]');
  await click("Inception Observatory / Researchers");
  await page.waitForSelector('[aria-label="Researcher interaction panel"]');
  await click("Ask, intervene, review proposals or archive research");
  const graph = '[aria-label="Scientific knowledge graph"]';
  await page.waitForSelector(graph);
  await page.waitForSelector('[aria-label="Research learning engine"]');
  await page.waitForSelector('[aria-label="Scientific experiment compiler"]');
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Numerical history") &&
      document.body.innerText.includes("evaluated"),
  );
  for (const name of [
    "Untested hypotheses",
    "Shared assumptions",
    "Contradiction inspector",
    "Missing evidence",
  ])
    await click(name);
  await page.$eval(graph, (e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: out + "/graph.png" });
  if ((await page.$$(graph + " svg line")).length === 0)
    throw new Error("Graph omits neighboring evidence relationships");
  await page.click(graph + " table button");
  await page.waitForSelector('[aria-label="Scientific provenance inspector"]');
  await page.focus('[aria-label="Scientific evidence provenance JSON"]');
  await page.$eval('[aria-label="Scientific experiment compiler"]', (e) =>
    e.scrollIntoView({ block: "start" }),
  );
  await page.screenshot({ path: out + "/compiler.png" });
  const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () =>
    (
      await globalThis.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      })
    ).violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  );
  const evidence = await page.evaluate(async () => {
    const response = await fetch("/api/rain/discovery");
    if (!response.ok) throw new Error("Discovery service unavailable");
    const view = await response.json();
    return {
      nodes: view.knowledge.nodes.length,
      edges: view.knowledge.edges.length,
      learning: view.learning.proposals.map((p) => p.status),
      numerical: view.scientific.records.map((r) => ({
        status: r.status,
        replay: r.replay,
        registry: r.registry_run_id,
      })),
      backends: view.scientific.capabilities.map((c) => c.id),
    };
  });
  if (
    evidence.backends.length !== 2 ||
    !evidence.numerical.some((r) => r.replay && r.registry) ||
    !evidence.nodes
  )
    throw new Error("Incomplete scientific service projection");
  await writeFile(
    out + "/validation.json",
    JSON.stringify(
      {
        origin,
        scope:
          "Retained scripted evidence; actual numerical results; no new inference or approval",
        errors,
        violations,
        evidence,
      },
      null,
      2,
    ),
  );
  if (errors.length || violations.length)
    throw new Error(JSON.stringify({ errors, violations }));
  console.log(
    "Scientific graph, learning history, compiler provenance and accessibility passed: " +
      out,
  );
} finally {
  await browser.close();
  server.kill();
  await writeFile(out + "/preview.log", serverLog);
}
