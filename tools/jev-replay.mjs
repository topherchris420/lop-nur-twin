#!/usr/bin/env node
/**
 * Replay a recorded pilot trace without calling any model.
 *
 *   node tools/jev-replay.mjs <trace.jsonl> [origin]
 *   bun run replay:jev -- shots/blacksite-jev-trace-….jsonl
 *
 * A trace is written by the HUD's SAVE TRACE button (or `__jev.exportTrace()`
 * in a dev build). This loads it into `/play?brain=replay` with the trace's own
 * seed and mode, lets the pilot re-issue every recorded control frame at its
 * recorded simulation time, and checks that the frames executed are the frames
 * recorded, in order.
 *
 * What a replay does *not* reproduce, and this tool reports rather than hides:
 * the world. Frame pacing in a browser is not deterministic, so the bots, the
 * spread and the damage diverge from the recording within seconds — the same
 * controls land in a different match. A replay reproduces the control stream;
 * it is not a recording of the outcome. The HUD labels it REPLAY throughout.
 *
 * Exits non-zero if the trace is rejected or the executed controls differ.
 */

import { readFileSync } from "node:fs";
import {
  episode,
  launch,
  openPlay,
  runFor,
  telemetry,
  waitForPilot,
} from "./jev-harness.mjs";

const path = process.argv
  .slice(2)
  .find((a) => !a.startsWith("http") && !a.startsWith("--"));
const origin =
  process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:5173";
if (!path) {
  console.error("usage: node tools/jev-replay.mjs <trace.jsonl> [origin]");
  process.exit(2);
}

const text = readFileSync(path, "utf8");
let header;
try {
  header = JSON.parse(text.split("\n")[0]);
} catch {
  console.error("The first line of the trace is not JSON.");
  process.exit(1);
}
const source = text
  .split("\n")
  .slice(1)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  .filter((entry) => entry.type === "decision" && typeof entry.actionStart === "number")
  .sort((a, b) => a.actionStart - b.actionStart || a.sequence - b.sequence);
if (source.length === 0) {
  console.error("The trace has no executed decisions.");
  process.exit(1);
}
const span = source[source.length - 1].actionStart - source[0].actionStart;
const seed = Number.isInteger(header?.seed) ? header.seed : 0;
const mode =
  typeof header?.mode === "string" && /^[a-z]+$/.test(header.mode) ? header.mode : "tdm";

const browser = await launch();
let failed = false;
try {
  const { page, errors } = await openPlay(
    browser,
    origin,
    `autoplay=1&quality=0&brain=replay&seed=${seed}&mode=${mode}`,
  );
  const loaded = await page.evaluate((t) => globalThis.__jev.loadTrace(t), text);
  if (!loaded.ok) {
    console.error(`Trace rejected: ${loaded.error}`);
    process.exit(1);
  }
  await waitForPilot(page);
  await runFor(page, span + 1.5, (span + 1.5) * 6 + 60);
  const replayed = await page.evaluate(() =>
    globalThis.__jev.pilot.recorder.records.map((r) => r.frame),
  );
  const skipped = await page.evaluate(
    () =>
      globalThis.__jev.pilot.recorder.events.filter((e) => e.kind === "skipped").length,
  );
  const t = await telemetry(page);
  const ep = await episode(page);

  // Skipped frames (two due in one step) drop out of the replay; compare the
  // replayed sequence against the source with those removed in order.
  let matched = 0;
  let cursor = 0;
  for (const frame of replayed) {
    while (
      cursor < source.length &&
      JSON.stringify(source[cursor].frame) !== JSON.stringify(frame)
    ) {
      cursor += 1;
    }
    if (cursor < source.length) {
      matched += 1;
      cursor += 1;
    }
  }
  const recordedShots = source.reduce((n, r) => n + (r.execution?.shotsFired ?? 0), 0);

  console.log(`trace ${path}`);
  console.log(
    `  header: brain ${header.brain}, seed ${seed}, mode ${mode}, ${source.length} executed decisions over ${span.toFixed(1)} s`,
  );
  console.log(`  label during replay: ${t.label}`);
  console.log(
    `  frames replayed: ${replayed.length} (${skipped} skipped as superseded within one step)`,
  );
  console.log(`  replayed frames found in recorded order: ${matched}/${replayed.length}`);
  console.log(
    `  rounds fired: recorded ${recordedShots}, replay ${ep.shotsFired} (the world is not reproduced; see header)`,
  );
  console.log(`  page errors: ${errors.length === 0 ? "none" : errors[0]}`);
  failed =
    t.label !== "REPLAY" ||
    replayed.length === 0 ||
    matched !== replayed.length ||
    replayed.length + skipped < source.length * 0.95 ||
    errors.length > 0;
  console.log(failed ? "\nFAIL" : "\nreplay reproduced the recorded control stream");
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
