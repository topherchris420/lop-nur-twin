#!/usr/bin/env node
/**
 * Repeatable episodes of Blacksite with a brain in the player's seat.
 *
 *   node tools/jev-benchmark.mjs --brain random --control direct [--episodes 3] [--seconds 90]
 *   JEV_LIVE_TEST=1 node tools/jev-benchmark.mjs --brain jev --control precision --episodes 3
 *
 * `--control direct|precision` is required, and every report names it. In
 * `precision` the brain chooses a target and an aim region and the local
 * tracking controller (`src/game/pilot/motor.ts`) executes them at frame rate;
 * a precision result is the brain's choices *and* that controller, never the
 * brain issuing every 60 Hz correction by itself.
 *
 * Options: --seed <n> (base seed; episode i uses seed+i), --mode tdm|domination|…,
 * --out <file.json> (default shots/jev-benchmark-<brain>-<time>.json), and an
 * origin (default http://localhost:5173 — the dev server, which exposes the dev
 * handles this reads). `--render` keeps real rendering; see jev-harness.mjs for
 * why it is off by default.
 *
 * Every number comes from the simulation: rounds the weapon runtime fired,
 * damage the resolver applied, kills and deaths the match recorded, metres the
 * controller moved, decisions the pilot executed. Nothing is estimated. A
 * statistic without samples is printed as "n/a", never as zero.
 *
 * ## The existing-bot baseline, and why it is not a controlled comparison
 *
 * The bot brain in `ai/bots.ts` drives its actor directly — it steers, aims with
 * a skill-scaled error cone and fires its own weapon runtime — so it cannot sit
 * in the player's seat without being rewritten, and it is not. Instead each
 * episode also measures the player's own teammates, the blue bots, in the same
 * match. They differ from a brain in the player's seat in ways that favour
 * *both* sides and that this tool cannot remove:
 *
 *  - Bots perceive through their own 55° cone out to 165 m, share contacts
 *    across the team, aim continuously with no step quantisation and act every
 *    frame with no decision latency.
 *  - The player's seat takes half damage from bots, deals 1.2× damage, and bots
 *    aiming at the player get a slower first shot and a wider cone
 *    (`COMBAT` in `core/combat.ts`, `PLAYER_MERCY` in `ai/bots.ts`).
 *
 * Read the bot rows as context for the match, not as a like-for-like opponent.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  episode,
  flag,
  launch,
  openPlay,
  option,
  runFor,
  waitForPilot,
} from "./jev-harness.mjs";

const brain = option("brain", "random");
const control = option("control", "");
const episodes = Number(option("episodes", "3"));
const seconds = Number(option("seconds", "90"));
const baseSeed = Number(option("seed", "42"));
const mode = option("mode", "tdm");
const origin =
  process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const out = option(
  "out",
  `shots/jev-benchmark-${brain}-${control}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

if (!["random", "jev"].includes(brain)) {
  console.error("--brain must be random or jev");
  process.exit(2);
}
if (!["direct", "precision"].includes(control)) {
  console.error(
    "--control must be direct or precision: a result has to say which controller produced it",
  );
  process.exit(2);
}
if (brain === "jev" && process.env.JEV_LIVE_TEST !== "1") {
  console.error(
    "benchmark:jev calls the real TypeSafe API and spends credit.\n" +
      "Set JEV_LIVE_TEST=1 to confirm, and start the dev server with TYPESAFE_API_KEY set.",
  );
  process.exit(2);
}
if (!Number.isInteger(episodes) || episodes < 1 || !(seconds > 0)) {
  console.error("--episodes must be a positive integer and --seconds positive");
  process.exit(2);
}

if (brain === "jev") {
  const status = await fetch(`${origin}/api/jev/decision`)
    .then((r) => r.json())
    .catch(() => null);
  if (!status?.configured) {
    console.error(
      `The decision service at ${origin} is not configured: ${JSON.stringify(status)}`,
    );
    process.exit(2);
  }
}

const browser = await launch();
const results = [];
const rawSamples = [];
const latency = [];
const serverLatency = [];
let aggregatePage = null;

try {
  for (let i = 0; i < episodes; i += 1) {
    const seed = baseSeed + i;
    const { page, errors } = await openPlay(
      browser,
      origin,
      `autoplay=1&quality=0&brain=${brain}&jevControl=${control}&seed=${seed}&mode=${mode}`,
    );
    await waitForPilot(page);
    // Count the blue bots' damage through the same read-only tap the pilot uses.
    await page.evaluate(() => {
      const { game } = globalThis.__combat;
      const bots = { dealt: 0, taken: 0, hits: 0, shots: 0 };
      globalThis.__benchBots = bots;
      const team = game.player.team;
      // A bot fires at most one round a frame and stamps lastFireTime when it
      // does, so a per-frame read counts its rounds without touching it.
      const last = new Map();
      const poll = () => {
        for (const actor of game.actors) {
          if (actor.isPlayer || actor.team !== team) continue;
          const t = actor.lastFireTime;
          if (last.has(actor.id) && t !== last.get(actor.id) && t > 0) bots.shots += 1;
          last.set(actor.id, t);
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
      globalThis.__combatModules.damageObservers.push((report) => {
        if (
          report.attacker &&
          !report.attacker.isPlayer &&
          report.attacker.team === team
        ) {
          if (report.victim.team !== team) {
            bots.dealt += report.amount;
            bots.hits += 1;
          }
        }
        if (!report.victim.isPlayer && report.victim.team === team)
          bots.taken += report.amount;
      });
      globalThis.__benchStart = game.actors
        .filter((a) => !a.isPlayer && a.team === team)
        .map((a) => ({ id: a.id, kills: a.kills, deaths: a.deaths }));
    });
    await page.evaluate(() => globalThis.__jev.resetMetrics());
    const wallStart = Date.now();
    const ran = await runFor(page, seconds, seconds * 6 + 60);
    const wall = (Date.now() - wallStart) / 1000;
    const metrics = await episode(page);
    const raw = metrics.raw;
    delete metrics.raw;
    const lastError = await page.evaluate(() => globalThis.__jev.telemetry.lastError);
    const samples = await page.evaluate(() => globalThis.__jev.samples());
    latency.push(...samples.latency);
    serverLatency.push(...samples.serverLatency);
    const context = await page.evaluate(() => {
      const { game } = globalThis.__combat;
      const team = game.player.team;
      const start = new Map(globalThis.__benchStart.map((b) => [b.id, b]));
      let kills = 0;
      let deaths = 0;
      let bots = 0;
      for (const actor of game.actors) {
        if (actor.isPlayer || actor.team !== team) continue;
        const before = start.get(actor.id);
        if (!before) continue;
        bots += 1;
        kills += actor.kills - before.kills;
        deaths += actor.deaths - before.deaths;
      }
      return {
        botBaseline: {
          bots,
          kills,
          deaths,
          ...globalThis.__benchBots,
        },
        score: {
          own: team === "blue" ? game.hud.scoreBlue : game.hud.scoreRed,
          enemy: team === "blue" ? game.hud.scoreRed : game.hud.scoreBlue,
        },
      };
    });
    rawSamples.push(raw);
    results.push({
      episode: i + 1,
      seed,
      simSecondsRequested: seconds,
      simSeconds: ran,
      wallSeconds: wall,
      metrics,
      ...context,
      lastError,
      pageErrors: errors.slice(0, 5),
    });
    const m = metrics;
    console.log(
      `episode ${i + 1}/${episodes} seed ${seed}: ${ran.toFixed(0)} s sim in ${wall.toFixed(0)} s wall · ` +
        `K ${m.kills} D ${m.deaths} · shots ${m.shotsFired} hits ${m.hits} · ` +
        `decisions ${m.decisions.accepted} · timeouts ${m.decisions.timeouts} · errors ${m.decisions.errors + m.decisions.invalid}` +
        (lastError ? ` · last error: ${lastError}` : ""),
    );
    if (i < episodes - 1) await page.close();
    else aggregatePage = page;
  }

  const aggregate = await aggregatePage.evaluate(
    (episodesMetrics, lat, srv) => globalThis.__jev.aggregate(episodesMetrics, lat, srv),
    results.map((r, i) => ({ ...r.metrics, raw: rawSamples[i] })),
    latency,
    serverLatency,
  );
  const bots = results.reduce(
    (acc, r) => {
      acc.kills += r.botBaseline.kills;
      acc.deaths += r.botBaseline.deaths;
      acc.dealt += r.botBaseline.dealt;
      acc.taken += r.botBaseline.taken;
      acc.hits += r.botBaseline.hits;
      acc.shots += r.botBaseline.shots;
      acc.botSeconds += r.botBaseline.bots * r.simSeconds;
      return acc;
    },
    { kills: 0, deaths: 0, dealt: 0, taken: 0, hits: 0, shots: 0, botSeconds: 0 },
  );

  const report = {
    tool: "tools/jev-benchmark.mjs",
    brain,
    control,
    controlNote:
      control === "precision"
        ? "The brain chose movement, weapon use, a target slot and an aim region about five times a second; a deterministic local controller executed the aiming and trigger discipline at frame rate. Results describe the brain and that controller together."
        : "The brain turned the view itself in fixed steps; no local controller assisted.",
    mode,
    origin,
    startedAt: new Date().toISOString(),
    episodesRequested: episodes,
    secondsPerEpisode: seconds,
    rendering: flag("render") ? "real" : "stubbed (matrices only; see jev-harness.mjs)",
    aggregate,
    blueBotBaseline: {
      note: "The player's own bot teammates in the same matches. Not a controlled comparison; see the header of this file.",
      ...bots,
      accuracy: bots.shots > 0 ? bots.hits / bots.shots : null,
      killsPerBotMinute: bots.botSeconds > 0 ? (bots.kills / bots.botSeconds) * 60 : null,
      deathsPerBotMinute:
        bots.botSeconds > 0 ? (bots.deaths / bots.botSeconds) * 60 : null,
    },
    episodes: results,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const fmt = (value, digits = 2) =>
    value === null || value === undefined || Number.isNaN(value)
      ? "n/a"
      : Number(value).toFixed(digits);
  const a = aggregate;
  const minutes = a.simSeconds / 60;
  console.log(
    `\n${brain.toUpperCase()} · ${control.toUpperCase()} CONTROL — ${a.episodes} episodes, ${fmt(a.simSeconds, 0)} s of match time`,
  );
  console.log(`  kills ${a.kills}   deaths ${a.deaths}   K/D ${fmt(a.killDeathRatio)}`);
  console.log(
    `  kills/min ${fmt(minutes > 0 ? a.kills / minutes : null)}   deaths/min ${fmt(minutes > 0 ? a.deaths / minutes : null)}`,
  );
  console.log(
    `  shots ${a.shotsFired}   hits ${a.hits}   accuracy ${a.accuracy === null ? "n/a" : `${(a.accuracy * 100).toFixed(1)}%`}`,
  );
  console.log(`  damage dealt ${fmt(a.damageDealt, 0)}   taken ${fmt(a.damageTaken, 0)}`);
  console.log(
    `  mean survival ${fmt(a.meanSurvivalS, 1)} s   moved ${fmt(a.distanceM, 0)} m`,
  );
  const sh = a.shooting;
  const dist = (d, digits = 2, unit = "") =>
    d.count === 0
      ? "n/a"
      : `mean ${fmt(d.mean, digits)}${unit} p50 ${fmt(d.p50, digits)}${unit} p95 ${fmt(d.p95, digits)}${unit} (n=${d.count})`;
  console.log(
    `  headshots ${sh.headshots}   upper-chest hits ${sh.upperChestHits}   shots/kill ${fmt(sh.shotsPerKill, 1)}   damage/shot ${fmt(sh.damagePerShot, 1)}   ADS ${sh.adsFraction === null ? "n/a" : `${(sh.adsFraction * 100).toFixed(0)}%`}`,
  );
  console.log(
    `  aim error at shot (nearest visible enemy ≤10°): ${dist(sh.shotErrorDeg, 2, "°")}`,
  );
  console.log(
    `  aim error while an enemy is ≤10° from the crosshair: ${dist(sh.aimErrorDeg, 2, "°")}`,
  );
  console.log(`  engagement range at shot: ${dist(sh.engagementRangeM, 0, " m")}`);
  if (a.motor) {
    const m = a.motor;
    console.log(`  controller tracking error: ${dist(m.trackingErrorDeg, 3, "°")}`);
    console.log(
      `  acquisition: ${dist(m.acquisitionS, 2, " s")}   first hit: ${dist(m.timeToFirstHitS, 2, " s")}`,
    );
    console.log(
      `  targets bound ${m.targetsBound} · switches ${m.targetSwitches} · lost from sight ${m.targetLosses} · releases ${JSON.stringify(m.releases)}`,
    );
    console.log(
      `  fire gate held ${m.gateSuppressed}/${m.triggerOpportunities} trigger opportunities (${m.gateSuppressedFraction === null ? "n/a" : `${(m.gateSuppressedFraction * 100).toFixed(0)}%`}) · recoil counter per shot ${dist(m.recoilCompensationDeg, 3, "°")}`,
    );
    console.log(
      `  decision → first controller step: ${dist(m.executionLatencyMs, 1, " ms")}`,
    );
  }
  if (a.fallbackSeconds > 0)
    console.log(`  under fallback: ${fmt(a.fallbackSeconds, 1)} s`);
  console.log(
    `  decisions ${a.decisions.accepted} (requested ${a.decisions.requested}) · fallback ${a.decisions.fallback} · ` +
      `timeouts ${a.decisions.timeouts} · stale ${a.decisions.stale} · invalid ${a.decisions.invalid} · errors ${a.decisions.errors} · rate-limited ${a.decisions.rateLimited} · unavailable ${a.decisions.unavailable}`,
  );
  console.log(
    `  latency (round trip) mean ${fmt(a.latency.meanMs, 0)} ms · p50 ${fmt(a.latency.p50Ms, 0)} ms · p95 ${fmt(a.latency.p95Ms, 0)} ms · n=${a.latency.count}`,
  );
  if (a.serverLatency.count > 0) {
    console.log(
      `  latency (server → TypeSafe) mean ${fmt(a.serverLatency.meanMs, 0)} ms · p50 ${fmt(a.serverLatency.p50Ms, 0)} ms · p95 ${fmt(a.serverLatency.p95Ms, 0)} ms`,
    );
  }
  if (a.models.length > 0) console.log(`  models ${a.models.join(", ")}`);
  for (const axis of ["move", "turn", "tilt", "weapon", "target", "aim"]) {
    const top = Object.entries(a.actions[axis])
      .filter(([, n]) => n > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    console.log(`  ${axis.padEnd(6)} ${top}`);
  }
  console.log(
    `  blue bots (context, not a controlled baseline): kills ${bots.kills}, deaths ${bots.deaths}, ` +
      `hits ${bots.hits}/${bots.shots} (${bots.shots > 0 ? ((bots.hits / bots.shots) * 100).toFixed(1) : "n/a"}%), ` +
      `kills/bot-min ${fmt(report.blueBotBaseline.killsPerBotMinute)}, deaths/bot-min ${fmt(report.blueBotBaseline.deathsPerBotMinute)}`,
  );
  console.log(`\nwrote ${out}`);
} finally {
  await browser.close();
}
