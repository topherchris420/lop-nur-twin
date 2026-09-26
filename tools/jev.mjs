#!/usr/bin/env node
/**
 * Browser checks for the pilot seat: does a brain actually drive the player
 * through the real game, and does every failure leave the game playable?
 *
 *   node tools/jev.mjs                      # offline: no TypeSafe call is made
 *   JEV_LIVE_TEST=1 node tools/jev.mjs --live
 *   node tools/jev.mjs http://localhost:5173
 *
 * Offline, the Jev path is exercised against a fake decision endpoint that this
 * script intercepts inside the test browser — the application has no mock mode
 * and never serves one. It proves the client: validation, labels, failure
 * states, stale answers, takeover, switching, death and respawn, replay.
 *
 * `--live` talks to the real TypeSafe Jev API through the dev server's own
 * `/api/jev/decision` (start it with `TYPESAFE_API_KEY` in the environment or in
 * `.env.local`). It requires `JEV_LIVE_TEST=1`, so nothing spends API credit by
 * accident, and reports what Jev demonstrated in the run — it cannot force a
 * model to reload or to walk, so behaviours it did not choose are reported as
 * "not observed", not as failures. Hard failures are the plumbing: no
 * decisions, a frozen simulation, a leaked key, a broken takeover.
 *
 * Exits non-zero if any check fails.
 */

import {
  episode,
  launch,
  makeReporter,
  openPlay,
  pilotInput,
  playerState,
  runFor,
  telemetry,
  waitForPilot,
} from "./jev-harness.mjs";

const live = process.argv.includes("--live");
const origin =
  process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";

if (live && process.env.JEV_LIVE_TEST !== "1") {
  console.error(
    "jev.mjs --live calls the real TypeSafe API and spends credit.\n" +
      "Set JEV_LIVE_TEST=1 to confirm, and start the dev server with TYPESAFE_API_KEY set.",
  );
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

const AXES = ["move", "turn", "tilt", "weapon"];

function fakeDecision(observation, pick = {}) {
  const axes = {};
  const frame = {};
  for (const axis of AXES) {
    const options = observation.legal[axis];
    const choice = options.includes(pick[axis]) ? pick[axis] : options[0];
    const rest = 0.3 / Math.max(1, options.length - 1);
    const probabilities = options.map((option) => [
      option,
      option === choice ? 0.7 : rest,
    ]);
    probabilities.sort((a, b) => b[1] - a[1]);
    axes[axis] = { choice, confidence: 0.55, probabilities };
    frame[axis] = choice;
  }
  return {
    schemaVersion: "blacksite-jev-decision/v1",
    sequence: observation.sequence,
    source: "typesafe",
    model: "jev-test-double",
    frame,
    axes,
    latencyMs: 12,
    usage: null,
  };
}

/** Route `/api/jev/decision` through `behaviour()`; everything else passes. */
async function interceptDecisions(page, behaviour) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/jev/decision")) {
      void request.continue();
      return;
    }
    if (request.method() === "GET") {
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: true, model: "jev-test-double" }),
      });
      return;
    }
    const { observation } = JSON.parse(request.postData() ?? "{}");
    void Promise.resolve(behaviour.current(observation)).then((reply) => {
      if (reply === "abort") return request.abort("failed");
      if (reply === "hang") return undefined; // never answer: the client must time out
      return request.respond({
        status: reply.status ?? 200,
        contentType: "application/json",
        body: JSON.stringify(reply.body),
      });
    });
  });
}

/** Let the match respawn the player if a phase left them dead. */
async function untilAlive(page) {
  for (let i = 0; i < 60; i += 1) {
    if ((await playerState(page)).alive) return;
    await sleep(250);
  }
}

/* ------------------------------------------------------------------ */
/* Offline checks                                                      */
/* ------------------------------------------------------------------ */

async function offline() {
  /* ------------------------------------------------ human default */
  console.log("\nhuman (default)");
  {
    const { page, errors } = await openPlay(browser, origin, "autoplay=1&quality=0");
    await sleep(1500);
    const t = await telemetry(page);
    check("no ?brain means the human controls the player", t.brain === "human", t.label);
    check("status is OFF for the human", t.status === "OFF", t.status);
    check("no pilot panel is shown", (await page.$("[data-jev-hud]")) === null, "absent");
    check("loads without page errors", errors.length === 0, errors[0] ?? "clean");
    await page.close();
  }

  /* ------------------------------------------------ random baseline */
  console.log("\nrandom baseline");
  const traces = [];
  for (let run = 0; run < 2; run += 1) {
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=random&seed=42",
    );
    await waitForPilot(page);
    const before = await playerState(page);
    await runFor(page, 12);
    const after = await playerState(page);
    const t = await telemetry(page);
    const ep = await episode(page);
    traces.push(
      await page.evaluate(() =>
        globalThis.__jev.pilot.recorder.records.map((r) => ({
          frame: r.frame,
          legal: r.legal,
        })),
      ),
    );
    if (run === 0) {
      check("RANDOM is labelled RANDOM, never LIVE JEV", t.label === "RANDOM", t.label);
      check(
        "HUD panel reports RANDOM",
        (await page.$eval("[data-jev-hud]", (el) => el.dataset.jevLabel)) === "RANDOM",
        "data-jev-label",
      );
      check(
        "random decisions were executed",
        ep.decisions.accepted > 20,
        `${ep.decisions.accepted} decisions`,
      );
      check(
        "decisions stay under the cadence cap",
        ep.decisions.accepted / Math.max(1, ep.simSeconds) <= 5.5,
        `${(ep.decisions.accepted / ep.simSeconds).toFixed(1)}/s`,
      );
      check("the player moved", ep.distanceM > 1, `${ep.distanceM.toFixed(1)} m`);
      check(
        "the view turned",
        Math.abs(after.yaw - before.yaw) > 0.05,
        `${((after.yaw - before.yaw) * 57.3).toFixed(0)}°`,
      );
      check(
        "the weapon fired through the weapon runtime",
        ep.shotsFired > 0,
        `${ep.shotsFired} rounds`,
      );
      check(
        "no probabilities are shown for the random brain",
        t.frameSource === "random" || t.frameSource === null,
        String(t.frameSource),
      );
      check("no page errors", errors.length === 0, errors[0] ?? "clean");
    }
    await page.close();
  }
  {
    // Same seed, same legal options: same frames. Legal sets diverge when the
    // game state does, so only decisions made from identical options compare.
    const [a, b] = traces;
    let compared = 0;
    let agreed = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (JSON.stringify(a[i].legal) !== JSON.stringify(b[i].legal)) break;
      compared += 1;
      if (JSON.stringify(a[i].frame) === JSON.stringify(b[i].frame)) agreed += 1;
    }
    check(
      "seed 42 reproduces the same random action sequence",
      compared >= 5 && agreed === compared,
      `${agreed}/${compared} identical`,
    );
  }

  /* ------------------------------------------------ Jev client path */
  console.log("\nJev client against a fake endpoint (no TypeSafe call)");
  {
    const behaviour = {
      current: (obs) => ({
        body: fakeDecision(obs, { move: "FORWARD", weapon: "FIRE" }),
      }),
    };
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=jev&seed=7",
      { beforeNavigate: (fresh) => interceptDecisions(fresh, behaviour) },
    );
    await waitForPilot(page);
    await runFor(page, 4);
    let t = await telemetry(page);
    // Offline means offline: the real service must not have answered anything.
    const models = await page.evaluate(() => globalThis.__jev.episode().models);
    check(
      "every decision was answered by the test double, none by TypeSafe",
      models.length === 1 && models[0] === "jev-test-double",
      models.join(", "),
    );
    check(
      "a TypeSafe-shaped answer is labelled LIVE JEV",
      t.label === "LIVE JEV",
      t.label,
    );
    check("it executes", t.status === "EXECUTING" || t.status === "DECIDING", t.status);

    // Regression: resetting the statistics mid-frame once made the next
    // observation report negative shots, which the server refused forever.
    const beforeReset = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(() => globalThis.__jev.resetMetrics());
      await runFor(page, 0.3);
    }
    await runFor(page, 2);
    const afterReset = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    check(
      "statistics resets mid-frame never produce an invalid observation",
      afterReset.invalid === 0 && afterReset.accepted > 3,
      `${afterReset.accepted} accepted since the last reset, ${afterReset.invalid} invalid (was ${beforeReset.invalid})`,
    );
    check(
      "the reported model is carried through",
      t.model === "jev-test-double",
      String(t.model),
    );

    // A server error: the game keeps running, nothing stays held.
    behaviour.current = () => ({
      status: 502,
      body: {
        schemaVersion: "blacksite-jev-decision/v1",
        sequence: null,
        error: { code: "upstream_error", message: "test" },
        retryAfterMs: null,
      },
    });
    const errStart = await playerState(page);
    await runFor(page, 2.5);
    t = await telemetry(page);
    const errEnd = await playerState(page);
    check("HTTP errors show ERROR", t.status === "ERROR", `${t.status} (${t.lastError})`);
    check(
      "the simulation keeps running through errors",
      errEnd.time - errStart.time > 2,
      `${(errEnd.time - errStart.time).toFixed(1)} s`,
    );
    check(
      "no input stays held after errors",
      idle(await pilotInput(page)),
      JSON.stringify(await pilotInput(page)),
    );

    await untilAlive(page);
    // A hung request: timeout, then recovery. An idle player may be killed
    // meanwhile, and DEAD rightly outranks TIMEOUT, so the counter decides.
    const beforeHang = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    behaviour.current = () => "hang";
    await sleep(3500);
    t = await telemetry(page);
    let alive = (await playerState(page)).alive;
    const afterHang = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    check(
      "a hung request becomes TIMEOUT",
      afterHang.timeouts > beforeHang.timeouts && (!alive || t.status === "TIMEOUT"),
      `${afterHang.timeouts - beforeHang.timeouts} timeouts, ${t.status}`,
    );
    check(
      "no input stays held while timing out",
      idle(await pilotInput(page)),
      "released",
    );

    // Unavailable. A dead player asks for nothing, so wait out any respawn.
    await untilAlive(page);
    behaviour.current = () => ({
      status: 503,
      body: {
        schemaVersion: "blacksite-jev-decision/v1",
        sequence: null,
        error: { code: "not_configured", message: "no key" },
        retryAfterMs: null,
      },
    });
    await sleep(3000);
    t = await telemetry(page);
    alive = (await playerState(page)).alive;
    const afterUnavailable = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    check(
      "an unconfigured service shows UNAVAILABLE",
      afterUnavailable.unavailable > 0 && (!alive || t.status === "UNAVAILABLE"),
      `${afterUnavailable.unavailable} unavailable, ${t.status}`,
    );
    if (alive) {
      const shown = await page.$eval("[data-jev-hud]", (el) => el.textContent ?? "");
      check(
        "the panel says JEV UNAVAILABLE",
        shown.includes("JEV UNAVAILABLE"),
        "panel text",
      );
    }

    // Invalid answers: wrong sequence and an unknown control are rejected.
    const counts = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    behaviour.current = (obs) => {
      const reply = fakeDecision(obs);
      reply.sequence = obs.sequence - 1;
      return { body: reply };
    };
    await sleep(6500); // the unavailable backoff is five seconds
    behaviour.current = (obs) => {
      const reply = fakeDecision(obs);
      reply.frame.weapon = "SELF_DESTRUCT";
      reply.axes.weapon.choice = "SELF_DESTRUCT";
      return { body: reply };
    };
    await sleep(3000);
    const after = await page.evaluate(() => ({
      ...globalThis.__jev.pilot.metrics.counters,
    }));
    check(
      "mismatched sequences and unknown controls are rejected",
      after.invalid - counts.invalid >= 2,
      `${after.invalid - counts.invalid} rejected`,
    );
    check(
      "nothing invalid was executed",
      after.accepted === counts.accepted,
      `${after.accepted - counts.accepted} accepted`,
    );

    // Recovery.
    behaviour.current = (obs) => ({ body: fakeDecision(obs, { weapon: "FIRE" }) });
    await sleep(4500);
    t = await telemetry(page);
    check(
      "control resumes when answers are valid again",
      t.status === "EXECUTING" || t.status === "DECIDING",
      t.status,
    );
    check("no page errors on the Jev path", errors.length === 0, errors[0] ?? "clean");

    // Takeover by keyboard.
    await page.keyboard.press("KeyH");
    await sleep(300);
    t = await telemetry(page);
    const takeover = await playerState(page);
    check(
      "H hands control to the human immediately",
      t.brain === "human" && t.status === "OFF",
      `${t.brain}/${t.status}`,
    );
    check(
      "takeover releases every AI-held control",
      idle(await pilotInput(page)),
      "released",
    );
    check(
      "the match keeps running after takeover",
      takeover.screen === "playing",
      takeover.screen,
    );
    const storeBrain = await page.evaluate(
      () => globalThis.__combat.store.getState().brain,
    );
    check("the store records the takeover", storeBrain === "human", storeBrain);
    await page.close();
  }

  /* ------------------------------------------------ fallback label */
  console.log("\nfallback");
  {
    const behaviour = {
      current: () => ({
        status: 502,
        body: { error: { code: "upstream_error", message: "x" } },
      }),
    };
    const { page } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=jev&fallback=random&seed=3",
      { beforeNavigate: (fresh) => interceptDecisions(fresh, behaviour) },
    );
    await waitForPilot(page);
    await runFor(page, 3);
    const t = await telemetry(page);
    const ep = await episode(page);
    check(
      "fallback frames are labelled FALLBACK, never LIVE JEV",
      t.label === "FALLBACK",
      `${t.label}/${t.frameSource}`,
    );
    check(
      "the fallback keeps the player acting at the normal cadence",
      ep.decisions.fallback > 8,
      `${ep.decisions.fallback} fallback frames`,
    );
    const trace = await page.evaluate(() =>
      globalThis.__jev.pilot.recorder.records.map((r) => r.source),
    );
    check(
      "the trace marks every fallback decision as fallback",
      trace.length > 0 && trace.every((s) => s === "fallback-random"),
      `${trace.length} records: ${[...new Set(trace)].join(", ")}`,
    );
    await page.close();
  }

  /* ------------------------------------------------ switching, death, respawn */
  console.log("\nswitching, death and respawn");
  {
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=random&seed=11",
    );
    await waitForPilot(page);
    await runFor(page, 2);
    for (const next of ["human", "random", "human", "random"]) {
      await page.evaluate(
        (brain) => globalThis.__combat.store.getState().setBrain(brain),
        next,
      );
      await sleep(250);
      const t = await telemetry(page);
      if (next === "human") {
        check(
          `switching to ${next} releases the brain's controls`,
          idle(await pilotInput(page)) && t.status === "OFF",
          t.status,
        );
      }
    }
    await runFor(page, 2);
    const beforeDeath = await episode(page);

    await page.evaluate(() => {
      const { game } = globalThis.__combat;
      const enemy = game.actors.find((a) => !a.isPlayer && a.team !== game.player.team);
      const v = {
        x: 0,
        y: 0,
        z: 1,
        clone() {
          return this;
        },
        normalize() {
          return this;
        },
      };
      game.damageQueue.push({
        targetId: game.player.id,
        attackerId: enemy ? enemy.id : 1,
        amount: 400,
        kind: "bullet",
        region: "chest",
        direction: v,
        point: {
          x: game.player.position.x,
          y: game.player.position.y + 1.2,
          z: game.player.position.z,
          clone() {
            return this;
          },
        },
        distanceM: 10,
        penetrated: false,
        weaponId: "oslo-14",
        time: game.time,
      });
    });
    await runFor(page, 0.5);
    let t = await telemetry(page);
    const dead = await playerState(page);
    check(
      "the player can be killed while a brain plays",
      dead.alive === false,
      `alive=${dead.alive}`,
    );
    check(
      "the pilot reports DEAD and holds nothing",
      t.status === "DEAD" && idle(await pilotInput(page)),
      t.status,
    );
    await runFor(page, 7);
    t = await telemetry(page);
    const back = await playerState(page);
    const afterRespawn = await episode(page);
    check(
      "the normal match flow respawns the player",
      back.alive === true,
      `alive=${back.alive}`,
    );
    check(
      "decisions resume after respawn",
      afterRespawn.decisions.accepted > beforeDeath.decisions.accepted + 5,
      `${afterRespawn.decisions.accepted - beforeDeath.decisions.accepted} new`,
    );
    check(
      "the death is counted once",
      afterRespawn.deaths - beforeDeath.deaths === 1,
      `${afterRespawn.deaths - beforeDeath.deaths}`,
    );
    check(
      "no page errors through death and respawn",
      errors.length === 0,
      errors[0] ?? "clean",
    );

    // Replay what this run recorded.
    const trace = await page.evaluate(() => globalThis.__jev.exportTrace());
    await page.close();
    const replay = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=replay&seed=11",
    );
    const loaded = await replay.page.evaluate(
      (text) => globalThis.__jev.loadTrace(text),
      trace,
    );
    check(
      "a recorded trace loads for replay",
      loaded.ok === true,
      JSON.stringify(loaded).slice(0, 80),
    );
    await waitForPilot(replay.page);
    await runFor(replay.page, 4);
    const rt = await telemetry(replay.page);
    const rep = await episode(replay.page);
    check("replay is labelled REPLAY, never LIVE JEV", rt.label === "REPLAY", rt.label);
    check(
      "replayed frames execute through the same controls",
      rep.decisions.accepted > 5,
      `${rep.decisions.accepted} frames`,
    );
    const rejected = await replay.page.evaluate(() =>
      globalThis.__jev.loadTrace(
        '{"type":"header","traceVersion":"blacksite-jev-trace/v0"}',
      ),
    );
    check(
      "an incompatible trace is rejected cleanly",
      rejected.ok === false,
      rejected.error ?? "",
    );
    check(
      "no page errors on replay",
      replay.errors.length === 0,
      replay.errors[0] ?? "clean",
    );
    await replay.page.close();
  }

  /* ------------------------------------------------ hostile parameters */
  console.log("\nhostile parameters");
  {
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=%3Cscript%3E&seed=1e309&fallback=evil&trace=..%2F..%2Fetc",
    );
    await sleep(1500);
    const t = await telemetry(page);
    const store = await page.evaluate(() => {
      const s = globalThis.__combat.store.getState();
      return { brain: s.brain, seed: s.brainSeed, fallback: s.brainFallback };
    });
    check(
      "an unknown brain falls back to the human",
      t.brain === "human" && store.brain === "human",
      store.brain,
    );
    check(
      "a malformed seed falls back to the default",
      store.seed === 0x5eed1,
      String(store.seed),
    );
    check(
      "an unknown fallback is ignored",
      store.fallback === null,
      String(store.fallback),
    );
    check(
      "no page errors from hostile parameters",
      errors.length === 0,
      errors[0] ?? "clean",
    );
    await page.close();
  }
}

/* ------------------------------------------------------------------ */
/* Live checks — the real TypeSafe Jev API                             */
/* ------------------------------------------------------------------ */

async function liveChecks() {
  const status = await fetch(`${origin}/api/jev/decision`).then((r) => r.json());
  check(
    "the dev server's decision service is configured",
    status.configured === true,
    JSON.stringify(status).slice(0, 90),
  );
  if (!status.configured) return;

  const seconds = Number(process.env.JEV_LIVE_SECONDS ?? 45);
  const { page, errors } = await openPlay(
    browser,
    origin,
    "autoplay=1&quality=0&brain=jev&seed=42",
  );
  const posted = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/jev/decision") && request.method() === "POST") {
      posted.push(request.postData() ?? "");
    }
  });
  await waitForPilot(page);
  const start = await playerState(page);
  await runFor(page, seconds);
  const mid = await playerState(page);
  const t = await telemetry(page);
  const ep = await episode(page);
  const trace = await page.evaluate(() => globalThis.__jev.pilot.recorder.records);

  check(
    "the real API answered",
    ep.decisions.accepted > 20,
    `${ep.decisions.accepted} decisions`,
  );
  check(
    "a concrete Jev model version was reported",
    /^jev-\d/.test(t.model ?? ""),
    String(t.model),
  );
  check("the HUD says LIVE JEV", t.label === "LIVE JEV", t.label);
  check(
    "the browser sent only { session, observation }",
    posted.length > 0 &&
      posted.every(
        (body) => Object.keys(JSON.parse(body)).sort().join() === "observation,session",
      ),
    `${posted.length} requests`,
  );
  check(
    "no request carried a credential",
    posted.every((body) => !/apikey_|Bearer/i.test(body)),
    "clean",
  );

  // What Jev chose to do, and what the game did about it. A model cannot be
  // made to reload or walk, so these are reported rather than required.
  const executed = trace.filter((r) => r.actionStart !== null);
  const did = (axis, pattern) =>
    executed.filter((r) => pattern.test(r.frame[axis])).length;
  const report = (name, observed, detail) =>
    console.log(`  ${observed ? "seen" : "----"} ${name.padEnd(58)} ${detail}`);
  report(
    "moved (movement controls executed)",
    did("move", /^(FORWARD|BACK|STRAFE|SPRINT)/) > 0,
    `${did("move", /^(FORWARD|BACK|STRAFE|SPRINT)/)} frames, ${ep.distanceM.toFixed(1)} m moved`,
  );
  report(
    "turned (turn controls executed)",
    did("turn", /^TURN/) > 0,
    `${did("turn", /^TURN/)} frames, yaw ${(((mid.yaw - start.yaw) * 180) / Math.PI).toFixed(0)}° net`,
  );
  report(
    "aimed vertically (tilt controls executed)",
    did("tilt", /^LOOK/) > 0,
    `${did("tilt", /^LOOK/)} frames`,
  );
  report("fired the existing weapon", ep.shotsFired > 0, `${ep.shotsFired} rounds`);
  report("reloaded", did("weapon", /^RELOAD/) > 0, `${did("weapon", /^RELOAD/)} frames`);
  report(
    "hit something (damage resolver)",
    ep.hits > 0,
    `${ep.hits} hits, ${ep.damageDealt.toFixed(0)} damage`,
  );
  report("took damage", ep.damageTaken > 0, `${ep.damageTaken.toFixed(0)}`);
  report("died and kept deciding after respawn", ep.deaths > 0, `${ep.deaths} deaths`);
  console.log(
    `  latency: mean ${ep.latency.meanMs?.toFixed(0)} ms, p50 ${ep.latency.p50Ms?.toFixed(0)} ms, p95 ${ep.latency.p95Ms?.toFixed(0)} ms (${ep.latency.count} samples)`,
  );

  // An API interruption: the game must keep running and recover.
  await page.setRequestInterception(true);
  let blocking = true;
  page.on("request", (request) => {
    if (blocking && request.url().includes("/api/jev/decision"))
      void request.abort("failed");
    else void request.continue();
  });
  const cut = await playerState(page);
  await runFor(page, 3);
  const during = await telemetry(page);
  const cutEnd = await playerState(page);
  check(
    "an API interruption shows an error, not a decision",
    ["ERROR", "TIMEOUT", "UNAVAILABLE"].includes(during.status),
    during.status,
  );
  check(
    "gameplay continues through the interruption",
    cutEnd.time - cut.time > 2.5,
    `${(cutEnd.time - cut.time).toFixed(1)} s`,
  );
  check(
    "nothing stays held during the interruption",
    idle(await pilotInput(page)),
    "released",
  );
  blocking = false;
  await runFor(page, 5);
  const recovered = await telemetry(page);
  check(
    "live decisions resume after the interruption",
    recovered.label === "LIVE JEV" &&
      ["EXECUTING", "DECIDING"].includes(recovered.status),
    `${recovered.label}/${recovered.status}`,
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
