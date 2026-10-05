#!/usr/bin/env node
/**
 * Browser checks for Fastino's Glide in the player's seat.
 *
 *   node tools/glide.mjs                       # offline: no Fastino call is made
 *   FASTINO_LIVE_TEST=1 node tools/glide.mjs --live [--control precision|direct]
 *   node tools/glide.mjs http://localhost:5173
 *
 * Offline, `/api/glide/decision` is answered by a fake inside the test browser,
 * installed before the page loads (the application has no mock mode). It proves
 * the client: the LIVE GLIDE label, execution through the same controllers,
 * Glide's longer declared answer age (an answer three seconds late still acts,
 * where Jev's would time out), refusal of an answer that names the wrong
 * provider, the unavailable state, and takeover.
 *
 * `--live` asks the real Fastino API through the dev server's own
 * `/api/glide/decision` (start it with `FASTINO_API_KEY` in the environment or
 * in `.env.local`). It requires `FASTINO_LIVE_TEST=1`, so nothing spends credit
 * by accident. Hard failures are the plumbing — no decisions, a mislabelled
 * seat, missing probabilities, a leaked key, a broken takeover; what Glide chose
 * to do is reported, not required. `GLIDE_LIVE_SECONDS` sets the run length.
 *
 * Exits non-zero if any check fails.
 */

import {
  episode,
  launch,
  makeReporter,
  openPlay,
  option,
  pilotInput,
  playerState,
  runFor,
  telemetry,
  waitForPilot,
} from "./jev-harness.mjs";

const live = process.argv.includes("--live");
const control = option("control", "precision");
const origin =
  process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";

if (live && process.env.FASTINO_LIVE_TEST !== "1") {
  console.error(
    "glide.mjs --live calls the real Fastino API and spends credit.\n" +
      "Set FASTINO_LIVE_TEST=1 to confirm, and start the dev server with FASTINO_API_KEY set.",
  );
  process.exit(2);
}
if (!["precision", "direct"].includes(control)) {
  console.error("--control must be precision or direct");
  process.exit(2);
}

const { checks, check } = makeReporter();
const browser = await launch();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const idle = (input) =>
  input.moveX === 0 &&
  input.moveY === 0 &&
  !input.fire &&
  !input.ads &&
  !input.sprint &&
  !input.leanLeft &&
  !input.leanRight;

/* ------------------------------------------------------------------ */
/* A fake decision endpoint, inside the test browser only               */
/* ------------------------------------------------------------------ */

const AXES = ["move", "turn", "tilt", "weapon", "target", "aim", "go"];

/** A decision in the SystemOne endpoint's shape, as `source` would send it. */
function fakeDecision(observation, { source = "fastino", pick = {} } = {}) {
  const axes = {};
  const frame = {};
  for (const axis of AXES) {
    const options = observation.legal[axis];
    const choice = options.includes(pick[axis]) ? pick[axis] : options[0];
    frame[axis] = choice;
    if (options.length < 2) {
      axes[axis] = null;
      continue;
    }
    const rest = 0.3 / Math.max(1, options.length - 1);
    const probabilities = options.map((option) => [
      option,
      option === choice ? 0.7 : rest,
    ]);
    probabilities.sort((a, b) => b[1] - a[1]);
    axes[axis] = { choice, confidence: 0.55, probabilities };
  }
  return {
    schemaVersion: "blacksite-jev-decision/v3",
    sequence: observation.sequence,
    source,
    model: source === "fastino" ? "glide-test-double" : "jev-test-double",
    frame,
    axes,
    latencyMs: 12,
    usage: null,
  };
}

/**
 * Answer one decision path through `behaviour.current(observation)`, which
 * returns `{ status?, body, delayMs? }`; `behaviour.configured` is what the
 * status probe reports. Every other decision path is counted and refused, so
 * a check can assert the seat asked only its own endpoint.
 */
async function interceptDecisions(page, path, behaviour, strays) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/") || !url.includes("/decision")) {
      void request.continue();
      return;
    }
    if (!url.includes(path)) {
      strays.push(url);
      void request.abort("failed");
      return;
    }
    if (request.method() === "GET") {
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: behaviour.configured !== false,
          model: path.includes("glide") ? "glide-test-double" : "jev-test-double",
        }),
      });
      return;
    }
    const { observation } = JSON.parse(request.postData() ?? "{}");
    const reply = behaviour.current(observation);
    setTimeout(() => {
      void request
        .respond({
          status: reply.status ?? 200,
          contentType: "application/json",
          body: JSON.stringify(reply.body),
        })
        // A request the page has already aborted cannot be answered.
        .catch(() => undefined);
    }, reply.delayMs ?? 0);
  });
}

function notConfigured() {
  return {
    status: 503,
    body: {
      schemaVersion: "blacksite-jev-decision/v3",
      sequence: null,
      error: { code: "not_configured", message: "FASTINO_API_KEY is not configured." },
      retryAfterMs: null,
    },
  };
}

const hudLabel = (page) =>
  page.$eval("[data-jev-hud]", (el) => ({
    label: el.dataset.jevLabel,
    text: el.querySelector("span.font-bold")?.textContent ?? "",
    title: el.getAttribute("aria-label") ?? "",
  }));

/* ------------------------------------------------------------------ */
/* Offline checks                                                      */
/* ------------------------------------------------------------------ */

async function offline() {
  console.log("\nGlide client against a fake endpoint (no Fastino call)");
  {
    const strays = [];
    const behaviour = {
      current: (obs) => ({
        body: fakeDecision(obs, { pick: { move: "FORWARD", weapon: "FIRE" } }),
      }),
    };
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=glide&seed=7",
      {
        beforeNavigate: (fresh) =>
          interceptDecisions(fresh, "/api/glide/decision", behaviour, strays),
      },
    );
    await waitForPilot(page);
    const before = await playerState(page);
    await runFor(page, 5);
    const after = await playerState(page);
    const t = await telemetry(page);
    const ep = await episode(page);
    const hud = await hudLabel(page);
    const negotiated = await page.evaluate(() => globalThis.__jev.pilot.negotiated);
    check(
      "every decision came from the test double",
      ep.models.length === 1 && ep.models[0] === "glide-test-double",
      ep.models.join(", "),
    );
    check("a Fastino answer is labelled LIVE GLIDE", t.label === "LIVE GLIDE", t.label);
    check(
      "the HUD panel says LIVE GLIDE under a GLIDE title",
      hud.label === "LIVE GLIDE" && hud.title.startsWith("GLIDE"),
      `${hud.label} · ${hud.title}`,
    );
    check("it executes", ["EXECUTING", "DECIDING"].includes(t.status), t.status);
    check(
      "decisions were accepted",
      ep.decisions.accepted > 5,
      `${ep.decisions.accepted} accepted`,
    );
    check(
      "the player moved under Glide's FORWARD",
      Math.hypot(after.x - before.x, after.z - before.z) > 1,
      `${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m`,
    );
    check(
      "the weapon fired through the weapon runtime",
      ep.shotsFired > 0,
      `${ep.shotsFired} rounds`,
    );
    check(
      "the seat negotiated Glide's declared limits",
      negotiated?.maxDecisionAgeMs === 8000 && negotiated?.requestTimeoutMs === 8000,
      `age ${negotiated?.maxDecisionAgeMs} ms, timeout ${negotiated?.requestTimeoutMs} ms`,
    );
    check(
      "the browser asked only Glide's endpoint",
      strays.length === 0,
      strays[0] ?? "none elsewhere",
    );
    const records = await page.evaluate(() =>
      globalThis.__jev.pilot.evalRecords.slice(0, 5).map((r) => ({
        brain: r.brain,
        provider: r.accounting.provider,
        source: r.confidence.source,
        moveP: r.confidence.perAxis.move?.probability ?? null,
      })),
    );
    check(
      "decision records name Glide, Fastino and its probabilities",
      records.length > 0 &&
        records.every(
          (r) =>
            r.brain === "glide" &&
            r.provider === "fastino" &&
            r.source === "provider-probability" &&
            r.moveP === 0.7,
        ),
      JSON.stringify(records[0] ?? null),
    );

    // An answer that names the other provider is refused, and never shown as Jev.
    behaviour.current = (obs) => ({ body: fakeDecision(obs, { source: "typesafe" }) });
    const acceptedBefore = (await episode(page)).decisions.accepted;
    await runFor(page, 2.5);
    const wrong = await telemetry(page);
    const acceptedAfter = (await episode(page)).decisions.accepted;
    check(
      "a TypeSafe-sourced answer on Glide's endpoint is refused",
      acceptedAfter === acceptedBefore &&
        /expected fastino/.test(wrong.lastError ?? "") &&
        wrong.status === "ERROR",
      `${acceptedAfter - acceptedBefore} accepted · ${wrong.status} · ${wrong.lastError}`,
    );
    check("and never labelled LIVE JEV", wrong.label !== "LIVE JEV", wrong.label);
    check("nothing stays held after refusals", idle(await pilotInput(page)), "released");

    // Unavailable: the server has no key. The game keeps running.
    behaviour.current = () => notConfigured();
    const cut = await playerState(page);
    await runFor(page, 2.5);
    const down = await telemetry(page);
    const cutEnd = await playerState(page);
    const downHud = await hudLabel(page);
    check(
      "a missing key shows UNAVAILABLE",
      down.status === "UNAVAILABLE",
      `${down.status} (${down.lastError})`,
    );
    check(
      "the panel reads GLIDE UNAVAILABLE",
      downHud.text === "GLIDE UNAVAILABLE",
      downHud.text,
    );
    check(
      "gameplay continues while unavailable",
      cutEnd.time - cut.time > 2,
      `${(cutEnd.time - cut.time).toFixed(1)} s`,
    );

    await page.keyboard.press("KeyH");
    await sleep(300);
    const human = await telemetry(page);
    check("H returns the player to the human", human.brain === "human", human.brain);
    check(
      "takeover releases every AI-held control",
      idle(await pilotInput(page)),
      "released",
    );
    check("no page errors", errors.length === 0, errors[0] ?? "clean");
    await page.close();
  }

  console.log("\nGlide's answer age: three seconds late still acts; Jev's would not");
  for (const [brain, path] of [
    ["glide", "/api/glide/decision"],
    ["jev", "/api/jev/decision"],
  ]) {
    const strays = [];
    const behaviour = {
      current: (obs) => ({
        delayMs: 3000,
        body: fakeDecision(obs, { source: brain === "glide" ? "fastino" : "typesafe" }),
      }),
    };
    const { page, errors } = await openPlay(
      browser,
      origin,
      `autoplay=1&quality=0&brain=${brain}&seed=11`,
      { beforeNavigate: (fresh) => interceptDecisions(fresh, path, behaviour, strays) },
    );
    await waitForPilot(page);
    await runFor(page, 12, 60);
    const ep = await episode(page);
    if (brain === "glide") {
      check(
        "Glide: answers 3 s late are accepted and executed",
        ep.decisions.accepted >= 2 && ep.decisions.timeouts === 0,
        `${ep.decisions.accepted} accepted, ${ep.decisions.timeouts} timeouts, ${ep.decisions.stale} stale`,
      );
    } else {
      check(
        "Jev, same delay: every request times out, none acts",
        ep.decisions.accepted === 0 && ep.decisions.timeouts > 0,
        `${ep.decisions.accepted} accepted, ${ep.decisions.timeouts} timeouts`,
      );
    }
    check(`${brain}: no page errors`, errors.length === 0, errors[0] ?? "clean");
    await page.close();
  }

  console.log("\nthe menu offers Glide");
  {
    const strays = [];
    const behaviour = { current: (obs) => ({ body: fakeDecision(obs) }) };
    const { page, errors } = await openPlay(browser, origin, "brain=glide&quality=0", {
      beforeNavigate: (fresh) =>
        interceptDecisions(fresh, "/api/glide/decision", behaviour, strays),
    });
    // The boot screen waits for a key before it shows the menu.
    await page
      .waitForFunction(() => /PRESS ANY KEY/i.test(document.body.innerText), {
        timeout: 30000,
      })
      .catch(() => undefined);
    await page.keyboard.press("Enter");
    const found = await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button[aria-pressed]")].some(
            (b) => b.textContent?.trim() === "Glide",
          ) && /Glide ready/i.test(document.body.innerText),
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false);
    const pressed = await page.evaluate(
      () =>
        [...document.querySelectorAll("button[aria-pressed]")]
          .find((b) => b.textContent?.trim() === "Glide")
          ?.getAttribute("aria-pressed") ?? "absent",
    );
    check(
      "a Glide choice, selected by ?brain=glide, reporting its service",
      found && pressed === "true",
      `aria-pressed=${pressed}`,
    );
    check("menu: no page errors", errors.length === 0, errors[0] ?? "clean");
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
/* Live checks: the real Fastino API through the dev server            */
/* ------------------------------------------------------------------ */

async function liveChecks() {
  const status = await fetch(`${origin}/api/glide/decision`)
    .then((r) => r.json())
    .catch(() => null);
  check(
    "the dev server's Glide service is configured",
    status?.configured === true && status?.service === "blacksite-glide",
    JSON.stringify(status).slice(0, 120),
  );
  if (!status?.configured) return;

  const seconds = Number(process.env.GLIDE_LIVE_SECONDS ?? 45);
  const { page, errors } = await openPlay(
    browser,
    origin,
    `autoplay=1&quality=0&brain=glide&jevControl=${control}&seed=42`,
  );
  const posted = [];
  const answered = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/glide/decision") && request.method() === "POST")
      posted.push(request.postData() ?? "");
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/api/glide/decision") &&
      response.request().method() === "POST"
    )
      void response
        .text()
        .then((text) => answered.push(text))
        .catch(() => undefined);
  });
  await waitForPilot(page);
  await runFor(page, seconds, seconds * 4 + 60);
  const t = await telemetry(page);
  const ep = await episode(page);
  const records = await page.evaluate(() =>
    globalThis.__jev.pilot.evalRecords.map((r) => ({
      brain: r.brain,
      provider: r.accounting.provider,
      model: r.accounting.model,
      source: r.confidence.source,
      perAxis: r.confidence.perAxis,
      frame: r.frame,
      latency: r.accounting.providerLatencyMs,
      inputTokens: r.accounting.inputTokens,
      outputTokens: r.accounting.outputTokens,
    })),
  );

  check(
    "the real API answered",
    ep.decisions.accepted >= 5,
    `${ep.decisions.accepted} accepted of ${ep.decisions.requested} requested`,
  );
  check("Fastino reported the model it ran", t.model === "glide", String(t.model));
  check("the HUD says LIVE GLIDE", t.label === "LIVE GLIDE", t.label);
  check(
    "every record names Glide, Fastino and provider probabilities",
    records.length > 0 &&
      records.every(
        (r) =>
          r.brain === "glide" &&
          r.provider === "fastino" &&
          r.source === "provider-probability" &&
          typeof r.perAxis.move?.probability === "number" &&
          typeof r.perAxis.move?.confidence === "number",
      ),
    `${records.length} records`,
  );
  check(
    "the browser sent only { session, observation }",
    posted.length > 0 &&
      posted.every(
        (body) => Object.keys(JSON.parse(body)).sort().join() === "observation,session",
      ),
    `${posted.length} requests`,
  );
  const key = process.env.FASTINO_API_KEY ?? "";
  check(
    "no request or response carried a credential",
    [...posted, ...answered].every(
      (text) =>
        !/fast_sk_|Bearer/i.test(text) && (key.length < 12 || !text.includes(key)),
    ),
    `${posted.length + answered.length} bodies`,
  );

  const lat = records.map((r) => r.latency).filter((v) => typeof v === "number");
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  console.log(
    `  ----  Fastino latency (server-measured): n=${lat.length} p50=${pct(0.5)} ms p95=${pct(0.95)} ms max=${lat.at(-1)} ms`,
  );
  console.log(`  ----  decisions: ${JSON.stringify(ep.decisions)}`);
  const tokens = records.filter((r) => r.inputTokens !== null);
  if (tokens.length > 0)
    console.log(
      `  ----  tokens per decision: input ${tokens[0].inputTokens}, output ${tokens[0].outputTokens} (first record)`,
    );
  const tally = (axis) => {
    const counts = {};
    for (const r of records) counts[r.frame[axis]] = (counts[r.frame[axis]] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(" ");
  };
  for (const axis of [
    "move",
    "turn",
    "weapon",
    ...(control === "precision" ? ["target", "aim"] : []),
  ])
    console.log(`  ----  chose ${axis.padEnd(7)} ${tally(axis)}`);
  console.log(
    `  ----  match: ${ep.kills} kills, ${ep.deaths} deaths, ${ep.shotsFired} rounds, ${ep.hits} hits, ${ep.distanceM.toFixed(0)} m moved`,
  );

  await page.keyboard.press("KeyH");
  await sleep(300);
  const after = await telemetry(page);
  check(
    "TAKE CONTROL returns the player to the human",
    after.brain === "human",
    after.status,
  );
  check(
    "takeover releases every AI-held control",
    idle(await pilotInput(page)),
    "released",
  );
  check("no page errors in the live run", errors.length === 0, errors[0] ?? "clean");
  await page.close();
}

try {
  if (live) await liveChecks();
  else await offline();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
