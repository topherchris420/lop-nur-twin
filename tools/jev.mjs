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

const AXES = ["move", "turn", "tilt", "weapon", "target", "aim", "go"];

/**
 * A decision in the endpoint's shape. An axis with one legal option is not
 * asked — no answer, and the frame takes that option — exactly as the server
 * does it.
 */
function fakeDecision(observation, pick = {}) {
  const axes = {};
  const frame = {};
  for (const axis of AXES) {
    const options = observation.legal[axis];
    const choice = options.includes(pick[axis]) ? pick[axis] : options[0];
    if (options.length < 2) {
      axes[axis] = null;
      frame[axis] = choice;
      continue;
    }
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
    schemaVersion: "blacksite-jev-decision/v3",
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

/**
 * Bring a live enemy in front of the living player, on clear ground with a
 * sight line to the chest, and turn the player to face it. The enemy comes to
 * the player rather than the reverse: the player's position is one the game
 * has already checked is clear. Returns whether an enemy could be placed.
 */
function stageEnemy(page) {
  return page.evaluate(() => {
    const { game } = globalThis.__combat;
    const p = game.player;
    if (!p.alive) return false;
    const enemy = game.actors.find((a) => !a.isPlayer && a.alive && a.team !== p.team);
    if (!enemy) return false;
    const V = game.cameraForward.constructor;
    const eye = new V(p.position.x, p.position.y + 1.62, p.position.z);
    for (const dist of [22, 16, 11]) {
      for (let i = 0; i < 12; i += 1) {
        const yaw = p.yaw + (i % 2 === 0 ? 1 : -1) * Math.floor(i / 2) * 0.15;
        const x = p.position.x - Math.sin(yaw) * dist;
        const z = p.position.z - Math.cos(yaw) * dist;
        const y = game.world.groundAt(x, z);
        if (!game.world.isPositionFree({ x, y, z, isVector3: true }, 0.4, 1.8)) continue;
        const chest = new V(x, y + 1.3, z);
        if (!game.world.hasLineOfSight(eye, chest, 3, enemy.id)) continue;
        enemy.position.set(x, y, z);
        enemy.velocity.set(0, 0, 0);
        enemy.stance = "stand";
        p.velocity.set(0, 0, 0);
        p.yaw = yaw;
        p.pitch = 0;
        return true;
      }
    }
    return false;
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
      "autoplay=1&quality=0&brain=random&jevControl=direct&seed=42",
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
        schemaVersion: "blacksite-jev-decision/v3",
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
    // Wait for it rather than a fixed interval: the errors above can leave the
    // loop backing off for up to 4 s before it asks again, and a death abandons
    // the request in flight uncounted, so a timeout needs a full
    // REQUEST_TIMEOUT_MS on one life. A fixed 3.5 s sleep failed intermittently.
    // The counter changes in the request callback; telemetry catches up on
    // the next pilot tick/frame. Wait for both in one browser snapshot so a
    // fresh timeout cannot be paired with the previous HTTP error's status.
    const hangState = () =>
      page.evaluate(() => ({
        timeouts: globalThis.__jev.pilot.metrics.counters.timeouts,
        status: globalThis.__jev.telemetry.status,
        alive: globalThis.__combat.game.player.alive,
      }));
    const beforeHang = await hangState();
    behaviour.current = () => "hang";
    let afterHang = beforeHang;
    const timedOut = (state) =>
      state.timeouts > beforeHang.timeouts &&
      (!state.alive || state.status === "TIMEOUT");
    const hangDeadline = Date.now() + 15000;
    while (!timedOut(afterHang) && Date.now() < hangDeadline) {
      await sleep(250);
      afterHang = await hangState();
    }
    check(
      "a hung request becomes TIMEOUT",
      timedOut(afterHang),
      `${afterHang.timeouts - beforeHang.timeouts} timeouts, ${afterHang.status}`,
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
        schemaVersion: "blacksite-jev-decision/v3",
        sequence: null,
        error: { code: "not_configured", message: "no key" },
        retryAfterMs: null,
      },
    });
    await sleep(3000);
    t = await telemetry(page);
    const alive = (await playerState(page)).alive;
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

  /* ------------------------------------------------ precision control */
  console.log("\nprecision control against a fake endpoint (no TypeSafe call)");
  {
    // The fake always engages the first listed enemy, aimed, on the upper chest,
    // and sweeps the view while nobody is listed: the bots no longer walk into
    // a view that never turns (they stay out of sight lines across open ground).
    const engage = (obs) => ({
      body: fakeDecision(obs, {
        move: "HOLD",
        turn: obs.perception.visibleEnemies.length > 0 ? "NO_TURN" : "TURN_RIGHT_MEDIUM",
        weapon: obs.legal.weapon.includes("ADS_FIRE") ? "ADS_FIRE" : "RELOAD",
        target: "TARGET_0",
        aim: "UPPER_CHEST",
      }),
    });
    const behaviour = { current: engage };
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=jev&jevControl=precision&seed=7",
      { beforeNavigate: (fresh) => interceptDecisions(fresh, behaviour) },
    );
    await waitForPilot(page);
    const control = await page.evaluate(() => globalThis.__jev.telemetry.control);
    check("the seat reports precision control", control === "precision", control);

    // Observe the real sight queries and telemetry in the SAME controller step.
    // Reading actor positions later mixed pre-movement telemetry with post-movement
    // geometry, and hard-coded standing heights ignored stance and heat shimmer.
    // The wrapper records only; every query still reaches the real collision world.
    await page.evaluate(() => {
      const { game } = globalThis.__combat;
      const motor = globalThis.__jev.pilot.motor;
      const apply = motor.apply;
      const audit = { latest: { bound: false }, measured: 0, blind: 0 };
      globalThis.__precisionAudit = audit;
      motor.apply = function (input, sense, trigger, dt) {
        const sightline = sense.sightline;
        const seen = new Set();
        sense.sightline = (id, point) => {
          const visible = sightline(id, point);
          if (visible) seen.add(id);
          return visible;
        };
        try {
          apply.call(this, input, sense, trigger, dt);
          const m = this.telemetry;
          const target = game.actorById.get(m.targetId);
          audit.latest =
            m.bound && target
              ? {
                  bound: true,
                  id: m.targetId,
                  error: m.errorDeg,
                  gate: m.gate,
                  alive: target.alive,
                  team: target.team !== game.player.team,
                  sight: seen.has(m.targetId),
                }
              : { bound: false };
          if (m.bound && m.errorDeg !== null) {
            audit.measured += 1;
            if (!seen.has(m.targetId)) audit.blind += 1;
          }
        } finally {
          sense.sightline = sightline;
        }
      };
    });

    // Sample until the controller has had enough to show, not for a fixed
    // time. An enemy enters view by chance (bots avoid open sight lines, and
    // frame pacing is not deterministic): a fixed 20 s on this seed bound
    // anywhere from 4 to 17 of 80 samples, and even waiting up to 80 s bound
    // only 5–10 of 320 on a slow runner, which failed CI on main. So the
    // harness does not wait for luck: whenever no enemy is bound it stands a
    // live one in the player's sight line (`stageEnemy`, as closeup.mjs does),
    // and the controller is then judged on tracking it, which is what this
    // check is about. The staging is the harness's; the controller still
    // decides what to bind and how to aim, and is measured against the
    // authoritative geometry exactly as before.
    const samples = [];
    const WANT_MEASURED = 20;
    const MAX_SAMPLES = 320;
    const RESTAGE_AFTER = 8; // samples (2 s) without a bound enemy
    let measuredSoFar = 0;
    let unbound = 0;
    while (samples.length < MAX_SAMPLES && measuredSoFar < WANT_MEASURED) {
      if (unbound >= RESTAGE_AFTER) {
        await stageEnemy(page);
        unbound = 0;
      }
      await runFor(page, 0.25);
      const sample = await page.evaluate(() => globalThis.__precisionAudit.latest);
      // A kill can resolve after the controller's step in the same frame, so a
      // sample may catch it still bound to an enemy that has just died. The
      // controller checks the body on every step; the fault would be staying
      // bound, so step on and require the release.
      if (sample.bound && !sample.alive) {
        await runFor(page, 0.1);
        sample.released = await page.evaluate((id) => {
          const m = globalThis.__jev.telemetry.motor;
          return !m.bound || m.targetId !== id;
        }, sample.id);
      }
      samples.push(sample);
      unbound = sample.bound ? 0 : unbound + 1;
      if (sample.bound && sample.error !== null) measuredSoFar += 1;
    }
    const bound = samples.filter((x) => x.bound);
    const measured = bound.filter((x) => x.error !== null);
    check(
      "the tracking controller binds the enemy Jev named",
      bound.length > 5,
      `${bound.length}/${samples.length} samples bound`,
    );
    const justKilled = bound.filter((x) => !x.alive);
    check(
      "it only ever binds living enemies",
      bound.every((x) => x.team && (x.alive || x.released)),
      `alive, opposing; ${justKilled.length} caught in the kill frame, ` +
        `${justKilled.filter((x) => x.released).length} released next step`,
    );
    const audit = await page.evaluate(() => globalThis.__precisionAudit);
    check(
      "it never measures an enemy without a sight line in the same step",
      audit.measured > 0 && audit.blind === 0,
      `${audit.blind} of ${audit.measured} measured steps without sight`,
    );
    const tight = measured.filter((x) => x.error < 0.5).length;
    check(
      "tracking holds the crosshair on the chosen region",
      measured.length > 0 && tight / measured.length > 0.5,
      `${tight}/${measured.length} samples under 0.5°`,
    );
    const ep = await episode(page);
    check(
      "rounds leave through the weapon runtime and some land",
      ep.shotsFired > 0 && ep.hits > 0,
      `${ep.hits}/${ep.shotsFired}`,
    );
    check(
      "the episode is labelled with its controller",
      ep.brain === "jev" && ep.control === "precision" && ep.motor !== null,
      `${ep.brain}/${ep.control}`,
    );
    check(
      "the fire gate reports what it suppressed",
      ep.motor !== null &&
        ep.motor.triggerOpportunities >= ep.motor.gateSuppressed &&
        ep.motor.gateSuppressedFraction !== null,
      ep.motor
        ? `${ep.motor.gateSuppressed}/${ep.motor.triggerOpportunities}`
        : "never bound",
    );
    const trace = await page.evaluate(() => globalThis.__jev.exportTrace());
    const header = JSON.parse(trace.split("\n")[0]);
    check(
      "the trace header names the controller",
      header.control === "precision" && header.traceVersion === "blacksite-jev-trace/v3",
      `${header.control} ${header.traceVersion}`,
    );
    check(
      "trace frames carry the target slot and aim region",
      trace.includes('"target":"TARGET_0"') && trace.includes('"aim":"UPPER_CHEST"'),
      "TARGET_0 / UPPER_CHEST",
    );

    // Outage: answers stop. Nothing is re-confirmed, so within the binding
    // timeout the controller lets go and the trigger stays released.
    behaviour.current = () => ({
      status: 503,
      body: {
        schemaVersion: "blacksite-jev-decision/v3",
        sequence: null,
        error: { code: "not_configured", message: "outage" },
        retryAfterMs: null,
      },
    });
    await runFor(page, 2);
    const outage = await page.evaluate(() => ({
      bound: globalThis.__jev.telemetry.motor.bound,
      fire: globalThis.__jev.pilot.input.fire,
      status: globalThis.__jev.telemetry.status,
    }));
    check(
      "during an outage tracking releases and nothing fires",
      !outage.bound && !outage.fire,
      `${outage.status}, bound=${outage.bound}`,
    );
    behaviour.current = engage;
    // An unavailable service backs the loop off for 5 s before it asks again,
    // so a fixed wait shorter than that failed intermittently. Wait for it.
    let recovered = await telemetry(page);
    for (
      let waited = 0;
      waited < 10 &&
      !(
        recovered.label === "LIVE JEV" &&
        ["EXECUTING", "DECIDING", "OBSERVING"].includes(recovered.status)
      );
      waited += 0.5
    ) {
      await runFor(page, 0.5);
      recovered = await telemetry(page);
    }
    check(
      "control resumes after the outage",
      recovered.label === "LIVE JEV" &&
        ["EXECUTING", "DECIDING", "OBSERVING"].includes(recovered.status),
      recovered.status,
    );

    await page.keyboard.press("KeyH");
    await sleep(300);
    const after = await page.evaluate(() => ({
      bound: globalThis.__jev.telemetry.motor.bound,
      brain: globalThis.__jev.telemetry.brain,
    }));
    check(
      "takeover releases the tracking controller too",
      after.brain === "human" && !after.bound && idle(await pilotInput(page)),
      `${after.brain}, bound=${after.bound}`,
    );
    check(
      "no page errors under precision control",
      errors.length === 0,
      errors[0] ?? "clean",
    );
    await page.close();
  }

  /* ------------------------------------------------ Elite Operator */
  console.log("\nplaces navigation against a fake endpoint (no TypeSafe call)");
  {
    // The fake takes the first place offered, keeps going while it travels,
    // and otherwise engages what it sees. Every observation it is sent is kept.
    const seen = [];
    const go = (obs) => {
      seen.push(obs);
      const legal = obs.legal.go;
      const choice = legal.includes("CONTINUE")
        ? "CONTINUE"
        : (legal.find((g) => g.startsWith("PLACE_")) ?? "NONE");
      return {
        body: fakeDecision(obs, {
          move: "HOLD",
          turn:
            obs.perception.visibleEnemies.length > 0 ? "NO_TURN" : "TURN_RIGHT_MEDIUM",
          weapon: obs.legal.weapon.includes("ADS_FIRE") ? "ADS_FIRE" : "NO_FIRE",
          target: "TARGET_0",
          aim: "UPPER_CHEST",
          go: choice,
        }),
      };
    };
    const behaviour = { current: go };
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=jev&jevControl=precision&jevNav=places&seed=11",
      { beforeNavigate: (fresh) => interceptDecisions(fresh, behaviour) },
    );
    await waitForPilot(page);
    await page.evaluate(() => globalThis.__jev.resetMetrics());
    await runFor(page, 40);
    const navigation = await page.evaluate(() => globalThis.__jev.telemetry.navigation);
    check("the seat reports places navigation", navigation === "places", navigation);
    const offered = seen.filter((o) => o.perception.places.length > 0);
    check(
      "observations list places once there is something to place against",
      offered.length > 0,
      `${offered.length} of ${seen.length} observations`,
    );
    const kinds = new Set(offered.flatMap((o) => o.perception.places.map((p) => p.kind)));
    check(
      "places are of the contract's kinds",
      [...kinds].every((k) =>
        ["cover", "advance", "flank", "withdraw", "objective"].includes(k),
      ),
      [...kinds].join(", ") || "none",
    );
    check(
      "a place carries bearings and distances, never coordinates",
      offered.every((o) =>
        o.perception.places.every(
          (p) => !("x" in p) && !("z" in p) && Object.keys(p).length === 6,
        ),
      ),
      "six facts per place",
    );
    check(
      "GO is offered for exactly the places listed",
      seen.every(
        (o) =>
          o.legal.go.filter((g) => g.startsWith("PLACE_")).length ===
          o.perception.places.length,
      ),
      "slots match",
    );
    const ep = await episode(page);
    check(
      "the navigator took the body to chosen places",
      ep.places !== null && ep.places.chosen > 0 && ep.distanceM > 5,
      ep.places
        ? `${ep.places.chosen} chosen, ended ${JSON.stringify(ep.places.releases)}, moved ${Math.round(ep.distanceM)} m`
        : "none chosen",
    );
    check(
      "every statistic names its interface",
      ep.navigation === "places" && ep.control === "precision" && ep.intervalMs === 200,
      `${ep.control} · ${ep.navigation} · ${ep.intervalMs} ms`,
    );
    const trace = await page.evaluate(() => globalThis.__jev.exportTrace());
    const header = JSON.parse(trace.split("\n")[0]);
    check(
      "the trace header records the negotiated interface",
      header.navigation === "places" && header.interface?.intervalMs === 200,
      JSON.stringify(header.interface),
    );
    check(
      "the debrief is kept for the seat",
      ep.debrief && ep.debrief.aliveSeconds > 30,
      ep.debrief
        ? `${Math.round(ep.debrief.aliveSeconds)} s alive, ${Math.round((ep.debrief.exposedFraction ?? 0) * 100)}% in a sight line`
        : "missing",
    );
    check("no page errors under places", errors.length === 0, errors[0] ?? "clean");
    await page.close();
  }
  {
    const seen = [];
    const behaviour = {
      current: (obs) => {
        seen.push(obs);
        return { body: fakeDecision(obs, { move: "HOLD" }) };
      },
    };
    const { page } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&brain=jev&jevControl=precision&jevNav=steps&seed=11",
      { beforeNavigate: (fresh) => interceptDecisions(fresh, behaviour) },
    );
    await waitForPilot(page);
    await runFor(page, 6);
    check(
      "?jevNav=steps lists no places and offers no destination",
      seen.length > 0 &&
        seen.every(
          (o) =>
            o.navigation === "steps" &&
            o.perception.places.length === 0 &&
            o.legal.go.length === 1,
        ),
      `${seen.length} observations`,
    );
    await page.close();
  }

  console.log("\nElite Operator (human)");
  {
    const { page, errors } = await openPlay(
      browser,
      origin,
      "autoplay=1&quality=0&playerProfile=elite",
    );
    await waitForPilot(page);
    await runFor(page, 1);
    const state = await page.evaluate(() => ({
      profile: globalThis.__combat.store.getState().playerProfile,
      flag: globalThis.__combat.game.hud.eliteOperator,
      brain: globalThis.__jev.telemetry.brain,
      episode: globalThis.__jev.episode(),
    }));
    check(
      "?playerProfile=elite turns Elite Operator on, visibly",
      state.profile === "elite" && state.flag === true,
      `${state.profile}, HUD chip ${state.flag}`,
    );
    check(
      "a human episode is labelled with its profile",
      state.brain === "human" &&
        state.episode.control === "none" &&
        state.episode.profile === "elite",
      `${state.episode.brain}/${state.episode.control}/${state.episode.profile}`,
    );
    await page.evaluate(() =>
      globalThis.__combat.store.getState().setPlayerProfile("standard"),
    );
    await runFor(page, 0.5);
    const off = await page.evaluate(() => globalThis.__combat.game.hud.eliteOperator);
    check("switching back to standard turns it off", off === false, `chip ${off}`);
    check(
      "no page errors with Elite Operator",
      errors.length === 0,
      errors[0] ?? "clean",
    );
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
  report(
    "tracked enemies Jev chose (precision controller)",
    (ep.motor?.targetsBound ?? 0) > 0,
    ep.motor
      ? `${ep.motor.targetsBound} bound, tracking error p50 ${ep.motor.trackingErrorDeg.p50?.toFixed(3) ?? "n/a"}°`
      : `control ${ep.control}`,
  );
  report(
    "the fire gate held rounds that were unlikely to land",
    (ep.motor?.gateSuppressed ?? 0) > 0,
    ep.motor ? `${ep.motor.gateSuppressed}/${ep.motor.triggerOpportunities}` : "n/a",
  );
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
