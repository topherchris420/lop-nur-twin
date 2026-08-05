#!/usr/bin/env node
/**
 * Automated accessibility and browser-hardening checks.
 *
 * Runs axe-core against the production build of every route and, in the same
 * pass, records any Content-Security-Policy violation the page triggers.
 * Both belong together: they are the two things that only show up when the
 * real artifact is served with the real headers, and both are invisible to a
 * screenshot.
 *
 * The default target is `vite preview`, which serves `dist/` with the same
 * security headers `vercel.json` and `deploy/nginx.conf` set, so a policy that
 * breaks the app fails here rather than in production.
 *
 *   bun run build
 *   bun run preview &          # http://localhost:4173
 *   bun run a11y
 *   node tools/a11y.mjs http://localhost:5173   # or against the dev server
 *
 * `/analysis` is the accessible, non-3D view of the model and is held to a
 * hard standard: any serious or critical axe violation fails the run. `/` and
 * `/play` are WebGL surfaces whose primary content is a canvas; their results
 * are reported in full and only CSP violations and page errors fail them.
 * This split is deliberate and documented in docs/ACCESSIBILITY.md — automated
 * checks cover a minority of WCAG criteria and no claim of full conformance is
 * made anywhere in this repository.
 *
 * Exits non-zero if a gating check fails.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const origin = process.argv[2] ?? "http://localhost:4173";

/** `gate: true` means axe violations fail the run, not just get printed. */
const ROUTES = [
  { path: "/analysis", label: "Accessible analysis table", gate: true, settle: 1500 },
  { path: "/", label: "3D analytical twin", gate: false, settle: 6000 },
  { path: "/play", label: "Blacksite simulation menu", gate: false, settle: 6000 },
];

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});

let failures = 0;
const summaries = [];

for (const route of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("GL Driver") || text.includes("DevTools")) return;
    pageErrors.push(text.slice(0, 300));
  });

  // CSP violations surface as a DOM event, not as a console error Puppeteer
  // can attribute, so collect them in the page itself.
  await page.evaluateOnNewDocument(() => {
    globalThis.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__cspViolations.push({
        directive: event.effectiveDirective,
        blocked: String(event.blockedURI).slice(0, 160),
      });
    });
  });

  const url = `${origin}${route.path}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, route.settle));

  await page.evaluate(axeSource);
  const results = await page.evaluate(
    async (tags) =>
      await globalThis.axe.run(document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      }),
    AXE_TAGS,
  );

  const csp = await page.evaluate(() => globalThis.__cspViolations ?? []);
  const title = await page.title();
  await page.close();

  const violations = results.violations ?? [];
  const gating = violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  console.log(`\n=== ${route.path} — ${route.label} ===`);
  console.log(`  title: ${title}`);
  console.log(`  axe:   ${violations.length} violation type(s), ${gating.length} serious/critical`);
  for (const violation of violations) {
    console.log(`   - [${violation.impact}] ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes.slice(0, 3)) {
      console.log(`       ${node.target.join(" ")}`);
    }
    if (violation.nodes.length > 3) {
      console.log(`       …and ${violation.nodes.length - 3} more node(s)`);
    }
  }
  console.log(`  csp:   ${csp.length} violation(s)`);
  for (const violation of csp) {
    console.log(`   - ${violation.directive} blocked ${violation.blocked}`);
  }
  console.log(`  errors: ${pageErrors.length}`);
  for (const error of pageErrors.slice(0, 5)) console.log(`   - ${error}`);

  if (csp.length > 0) {
    failures += 1;
    console.log(`  FAIL: content security policy blocked something on ${route.path}`);
  }
  if (pageErrors.length > 0) {
    failures += 1;
    console.log(`  FAIL: page errors on ${route.path}`);
  }
  if (route.gate && gating.length > 0) {
    failures += 1;
    console.log(`  FAIL: ${gating.length} serious/critical axe violation(s) on ${route.path}`);
  }

  summaries.push({
    path: route.path,
    axeViolations: violations.length,
    gating: gating.length,
    csp: csp.length,
    errors: pageErrors.length,
  });
}

await browser.close();

console.log("\n--- summary ---");
for (const summary of summaries) {
  console.log(
    `${summary.path.padEnd(10)} axe ${String(summary.axeViolations).padStart(2)} ` +
      `(serious/critical ${summary.gating}) · csp ${summary.csp} · errors ${summary.errors}`,
  );
}
console.log(
  "\nAutomated checks cover only part of WCAG 2.1 AA. Manual checks remain: " +
    "screen-reader narration, keyboard-only task completion, zoom to 200%, " +
    "and colour-contrast review of the WebGL canvas itself. " +
    "See docs/ACCESSIBILITY.md — this repository makes no Section 508 conformance claim.",
);

if (failures > 0) {
  console.error(`\n[a11y] ${failures} gating check(s) failed`);
  process.exit(1);
}
console.log("\n[a11y] OK");
