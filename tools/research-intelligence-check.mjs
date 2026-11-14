/** Read-only browser checks of the generated observatory. Build first. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, sep, extname } from "node:path";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = resolve(process.argv[2] ?? "dist/research-intelligence");
const csp = JSON.parse(readFileSync("vercel.json", "utf8"))
  .headers.flatMap((entry) => entry.headers)
  .find((entry) => entry.key === "Content-Security-Policy").value;
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const report = JSON.parse(readFileSync(resolve(root, "evidence.json"), "utf8"));
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!target.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = readFileSync(target);
    response
      .writeHead(200, {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Content-Type":
          { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }[
            extname(target)
          ] ?? "application/octet-stream",
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const checks = [];
  mkdirSync("shots", { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.evaluateOnNewDocument(() => {
      globalThis.__observatoryCsp = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        globalThis.__observatoryCsp.push(event.effectiveDirective);
      });
    });
    await page.goto(origin, { waitUntil: "networkidle0" });
    const rows = await page.$$eval("[data-design-row]", (elements) => elements.length);
    assert.equal(rows, report.designs.length);
    // Keyboard actions exercise the external script under the production CSP.
    await page.focus("#design-search");
    await page.keyboard.type("qnp-fixed-null");
    assert.equal(
      await page.$$eval("[data-design-row]:not([hidden])", (elements) => elements.length),
      1,
    );
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.focus("#design-filter");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const issues = report.designs.filter(
      (design) =>
        design.error !== null ||
        [design.screen?.verdict, design.confirmation?.verdict].some(
          (value) => value === "falsified" || value === "invalid",
        ),
    ).length;
    assert.equal(
      await page.$$eval("[data-design-row]:not([hidden])", (elements) => elements.length),
      issues,
    );
    await page.focus("#design-filter");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.focus("#open-details");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.$$eval(".design-detail[open]", (elements) => elements.length),
      rows,
    );
    // Opening the provenance details used to exceed the phone's content width.
    await page.focus("#provenance > details > summary");
    await page.keyboard.press("Enter");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `${name} document overflow`);
    // Inject only the test auditor through CDP; application controls ran without it.
    await page.evaluate(axe);
    const accessibility = await page.evaluate(async () => {
      const result = await globalThis.axe.run();
      return {
        passes: result.passes.length,
        violations: result.violations.map(({ id, impact }) => ({ id, impact })),
        incomplete: result.incomplete.length,
      };
    });
    assert.deepEqual(accessibility.violations, []);
    assert.deepEqual(errors, []);
    const cspViolations = await page.evaluate(() => globalThis.__observatoryCsp);
    assert.deepEqual(cspViolations, []);
    assert.ok(requests.every((request) => request.startsWith(origin + "/")));
    await page.focus("#close-details");
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      document.querySelector("#provenance > details").open = false;
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: `shots/research-intelligence-${name}.png`,
      fullPage: true,
    });
    checks.push({
      name,
      width,
      height,
      rows,
      issues,
      keyboard_filter_and_details: true,
      document_overflow: overflow,
      accessibility,
      errors,
      cspViolations,
      requested_paths: requests.map((request) => new URL(request).pathname),
    });
    await page.close();
  }
  const receipt = {
    schema: "rain-observatory-browser-check/v2",
    checked_at: new Date().toISOString(),
    browser: await browser.version(),
    study_id: report.study_id,
    plan_sha256: report.plan_sha256,
    html_sha256: hash(resolve(root, "index.html")),
    script_sha256: hash(resolve(root, "observatory.js")),
    evidence_sha256: hash(resolve(root, "evidence.json")),
    production_csp: csp,
    checks,
    limitations: [
      "Automated checks do not establish full WCAG conformance or screen-reader usability.",
      "This checks the exported information-policy report; it does not execute research.",
    ],
  };
  writeFileSync(
    "shots/research-intelligence-browser-qa.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await browser?.close();
}
