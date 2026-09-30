#!/usr/bin/env node
/** Staged, offline browser regressions for shared places and navigation-only replay. */
import { launch, openPlay, runFor, waitForPilot, makeReporter } from "./jev-harness.mjs";

const origin = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:5173";
const { check, checks } = makeReporter();
const browser = await launch();
try {
  const { page, errors } = await openPlay(
    browser,
    origin,
    "autoplay=1&quality=0&brain=human&mode=domination&jevNav=places&seed=42",
  );
  await waitForPilot(page);
  // Stage a known objective on flat, empty collision geometry. These are
  // plumbing fixtures, not gameplay or model-performance measurements.
  const start = await page.evaluate(async () => {
    const { CollisionWorld } = await import("/src/game/physics/collisionWorld.ts");
    const { game } = globalThis.__combat;
    globalThis.__combatSim.bots.update = () => {};
    globalThis.__combatSim.director.update = () => {};
    const p = game.player;
    const y = p.position.y;
    game.world = new CollisionWorld(() => y);
    game.hud.objectiveZones = [
      {
        id: "fixture",
        name: "Fixture",
        x: p.position.x + 10,
        z: p.position.z,
        radius: 5,
        owner: null,
        contested: false,
        progress: 0,
      },
    ];
    return { x: p.position.x, z: p.position.z };
  });
  await runFor(page, 0.6);
  const human = await page.evaluate(() => ({
    text: document.querySelector("[data-place-notes]")?.textContent,
    shown: document.querySelector("[data-place-notes]")?.hidden === false,
    notes: globalThis.__jev.pilot.fieldNotes.places,
    decisions: globalThis.__jev.episode().decisions.accepted,
    x: globalThis.__combat.game.player.position.x,
    z: globalThis.__combat.game.player.position.z,
  }));
  check(
    "human sees bounded objective field notes",
    human.shown && human.notes.some((p) => p.kind === "objective"),
    human.text,
  );
  check(
    "reading places neither calls a brain nor moves the human",
    human.decisions === 0 && Math.hypot(human.x - start.x, human.z - start.z) < 0.1,
  );

  // Compare the actual human capture with the exact observation builder used
  // by model seats; no second geometry or enemy-safety implementation in the HUD.
  const equal = await page.evaluate(() => {
    const p = globalThis.__jev.pilot;
    const obs = p.perception.capture({
      sequence: 1,
      previousFrame: null,
      previousOutcome: null,
      control: "direct",
      trackedId: null,
      navigation: "places",
      travel: null,
    });
    return (
      JSON.stringify(obs.perception.places) ===
      JSON.stringify(
        p.fieldNotes.places.map((place) =>
          Object.fromEntries(
            Object.entries(place).filter(([key]) => key !== "x" && key !== "z"),
          ),
        ),
      )
    );
  });
  check("human field notes come from the same observation", equal);

  for (const control of ["direct", "precision"]) {
    const loaded = await page.evaluate(async (control) => {
      const { TraceRecorder } = await import("/src/game/pilot/recorder.ts");
      const { IDLE_FRAME } = await import("/src/game/pilot/contract.ts");
      const { game, store } = globalThis.__combat;
      const recorder = new TraceRecorder();
      recorder.begin({
        brain: "script",
        policy: "skirmisher",
        seed: 42,
        control,
        navigation: "places",
        interface: null,
        mode: "domination",
        matchId: "staged-replay",
        startedAt: new Date().toISOString(),
        build: null,
      });
      for (let i = 0; i < 8; i++)
        recorder.record({
          type: "decision",
          timestamp: new Date().toISOString(),
          sequence: i,
          source: "script",
          observationHash: "staged",
          legal: {},
          frame: { ...IDLE_FRAME, go: i === 0 ? "PLACE_0" : "CONTINUE" },
          axes: null,
          model: null,
          latencyMs: null,
          serverLatencyMs: null,
          actionStart: i * 0.2,
          actionExpiry: i * 0.2 + 0.4,
          actionEnd: null,
          endReason: null,
          execution: null,
          playerAfter: null,
          matchId: "staged-replay",
          seed: 42,
        });
      game.hud.objectiveZones[0].x = game.player.position.x + 10;
      const result = globalThis.__jev.loadTrace(recorder.toJsonl());
      store.getState().setBrain("replay");
      return result;
    }, control);
    check(`${control}: navigation-only trace loads`, loaded.ok === true);
    await runFor(page, 0.8);
    const replay = await page.evaluate(() => ({
      nav: globalThis.__jev.pilot.navigator.active,
      trace: globalThis.__jev.pilot.recorder.records,
      label: globalThis.__jev.telemetry.label,
    }));
    check(
      `${control}: target NONE still binds the chosen place`,
      replay.nav && replay.trace.some((r) => r.travel?.placeBound === true),
      replay.label,
    );
    await page.evaluate(() => globalThis.__jev.takeover());
    await runFor(page, 0.2);
    check(
      `${control}: human takeover releases navigation`,
      await page.evaluate(() => !globalThis.__jev.pilot.navigator.active),
    );
  }
  await page.evaluate(() => {
    globalThis.__combat.game.player.alive = false;
  });
  await runFor(page, 0.2);
  check(
    "death hides field notes",
    await page.evaluate(() => document.querySelector("[data-place-notes]").hidden),
  );
  check("no page errors", errors.length === 0, errors[0] ?? "clean");
  await page.close();
} finally {
  await browser.close();
}
console.log(
  `\n${checks.filter((c) => c.pass).length}/${checks.length} checks passed (staged offline fixtures)`,
);
if (checks.some((c) => !c.pass)) process.exitCode = 1;
