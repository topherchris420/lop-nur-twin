#!/usr/bin/env node
/**
 * Offline browser checks for the LLM seat. Calls no model and spends nothing.
 *
 *   node tools/llm.mjs            # or: bun run llm
 *
 * Starts the test double from `tools/fake-llm.mjs` and a dev server on its own
 * port wired to it, then plays `/play?brain=llm` and asserts that:
 *
 *  - decisions arrive through the real endpoint and adapter and are executed;
 *  - every one names the test double's model, so nothing else answered;
 *  - the HUD says LIVE LLM, and the page never talked to anything but its own
 *    origin (the browser never sees the provider or the key);
 *  - confidence is recorded as verbalized, with no probability invented;
 *  - accounting is filled (bytes, tokens, provider latency, question hash);
 *  - answers a second late are still accepted under the LLM's declared limits,
 *    and each is revalidated at execution;
 *  - an upstream failure every fifth call is retried server-side and counted.
 */

import { FAKE_KEY, FAKE_MODEL, startDevServer, startFakeLlm } from "./fake-llm.mjs";
import { launch, makeReporter, openPlay, runFor, waitForPilot } from "./jev-harness.mjs";

const PORT = 5175;
const { check, checks } = makeReporter();
const fake = await startFakeLlm({ seed: 11, latencyMs: [400, 1200], failEvery: 5 });
const dev = await startDevServer(PORT, {
  LLM_PROVIDER: "openai-compatible",
  LLM_BASE_URL: fake.baseUrl,
  LLM_API_KEY: FAKE_KEY,
  LLM_MODEL: FAKE_MODEL,
  LLM_MAX_RETRIES: "1",
});
const browser = await launch();
try {
  const status = await (await fetch(`${dev.origin}/api/llm/decision`)).json();
  check(
    "the endpoint reports itself configured",
    status.configured === true,
    JSON.stringify({ provider: status.provider, model: status.model }),
  );
  check("its status names no key", !JSON.stringify(status).includes(FAKE_KEY));

  const { page, errors } = await openPlay(
    browser,
    dev.origin,
    "autoplay=1&quality=0&seed=42&mode=tdm&brain=llm&jevControl=precision&jevNav=places",
    {
      beforeNavigate: async (p) => {
        await p.setRequestInterception(true);
        p.on("request", (request) => {
          const url = new URL(request.url());
          // Anything leaving the page's own origin would be a leak of the seam.
          if (url.origin !== dev.origin && !url.protocol.startsWith("data"))
            globalThis.__offOrigin = (globalThis.__offOrigin ?? 0) + 1;
          request.continue();
        });
      },
    },
  );
  await waitForPilot(page);
  await page.evaluate(() => globalThis.__jev.resetMetrics());
  await runFor(page, 25, 120);
  const t = await page.evaluate(() => ({
    label: globalThis.__jev.telemetry.label,
    status: globalThis.__jev.telemetry.status,
  }));
  const ev = await page.evaluate(() => globalThis.__jev.evaluation());
  const ep = await page.evaluate(() => globalThis.__jev.episode());
  const executed = ev.decisions.filter(
    (d) =>
      d.validation.status === "executed" || d.validation.status === "executed_illegal",
  );

  check(
    "decisions arrived and executed",
    executed.length >= 5,
    `${ev.decisions.length} accepted, ${executed.length} executed`,
  );
  check(
    "every decision names the test double",
    ev.decisions.every((d) => d.accounting.model === FAKE_MODEL),
    [...new Set(ev.decisions.map((d) => d.accounting.model))].join(","),
  );
  check("the HUD says LIVE LLM", t.label === "LIVE LLM", `${t.label} · ${t.status}`);
  check(
    "the page talked only to its own origin",
    (globalThis.__offOrigin ?? 0) === 0,
    String(globalThis.__offOrigin ?? 0),
  );
  check(
    "confidence is verbalized and no probability is invented",
    ev.decisions.every(
      (d) =>
        d.confidence.source === "verbalized" &&
        Object.values(d.confidence.perAxis).every((a) => a.probability === null),
    ),
  );
  const a = ev.decisions[0]?.accounting;
  check(
    "accounting is filled from the real path",
    a &&
      a.provider === "openai-compatible" &&
      a.requestBytes > 0 &&
      a.responseBytes > 0 &&
      a.inputTokens > 0 &&
      /^[0-9a-f]{16}$/.test(a.questionHash ?? ""),
    a
      ? JSON.stringify({
          req: a.requestBytes,
          res: a.responseBytes,
          in: a.inputTokens,
          lat: a.providerLatencyMs,
        })
      : "none",
  );
  const slow = ev.decisions.filter((d) => (d.accounting.wallLatencyMs ?? 0) > 1000);
  check(
    "late answers are accepted under the declared limits",
    ev.interface?.maxDecisionAgeMs >= 12000 && slow.length > 0,
    `${slow.length} answers over 1 s; max age ${ev.interface?.maxDecisionAgeMs} ms`,
  );
  check(
    "every executed decision was revalidated at execution",
    executed.every((d) => d.validation.ageAtExecutionMs !== null),
  );
  check(
    "server-side retries are counted",
    ev.decisions.some((d) => (d.accounting.retries ?? 0) > 0) || fake.log.failures === 0,
    `fake failures ${fake.log.failures}, decisions with retries ${ev.decisions.filter((d) => d.accounting.retries > 0).length}`,
  );
  check(
    "the fake saw the key only in its Authorization header, and a schema every time",
    fake.log.authorized === fake.log.requests &&
      fake.log.withSchema === fake.log.requests,
    JSON.stringify(fake.log),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(`  counters: ${JSON.stringify(ep.decisions)}`);
} finally {
  await browser.close();
  dev.close();
  await fake.close();
}
const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed (test double: no model was called)`,
);
process.exit(failed.length > 0 ? 1 : 0);
