/**
 * Headless process smoke runner. Does not persist across restarts, does not
 * expose a public endpoint, and must not be enabled as a production daemon.
 *
 * Finite mode: node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --ticks 100
 * Continuous development mode: ... --continuous
 * Either with Project ECHO's experimental controller: ... --controller echo
 */
import { setTimeout as delay } from "node:timers/promises";
import { HeadlessBethesdaLife } from "../src/bethesda/life/headless.js";

const TICK_MS = 100;
const MAX_BACKLOG_TICKS = 300;

function parseMode(all: string[]): {
  continuous: boolean;
  ticks: number;
  controller: "reduced-order" | "echo";
} {
  const at = all.indexOf("--controller");
  const named = at >= 0 ? all[at + 1] : "reduced-order";
  if (named !== "reduced-order" && named !== "echo")
    throw new Error("--controller is reduced-order (the default) or echo");
  const controller = named;
  const args = at >= 0 ? [...all.slice(0, at), ...all.slice(at + 2)] : all;
  return { ...parseClock(args), controller };
}

function parseClock(args: string[]): { continuous: boolean; ticks: number } {
  if (args.length === 1 && args[0] === "--continuous") {
    return { continuous: true, ticks: 0 };
  }
  if (args.length === 2 && args[0] === "--ticks") {
    const value = Number(args[1]);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 10_000) {
      return { continuous: false, ticks: value };
    }
  }
  throw new Error(
    "Use --ticks N (0–10000) or --continuous (development only), optionally with --controller echo",
  );
}

async function run() {
  // Under scripts/run-ts.mjs the script's own path is still in argv: read what follows it.
  const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-headless.ts"));
  const mode = parseMode(process.argv.slice(self + 1));
  const life = new HeadlessBethesdaLife(undefined, { flyController: mode.controller });
  if (!mode.continuous) {
    life.advanceTicks(mode.ticks);
    process.stdout.write(JSON.stringify(life.status()) + "\n");
    return;
  }

  process.stderr.write(
    "Development-only in-memory clock; no durable checkpoint or single-writer lease.\n",
  );
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  const start = performance.now();
  let lastLog = start;
  while (!stopping) {
    const now = performance.now();
    const target = Math.floor((now - start) / TICK_MS);
    const due = target - life.city.tick;
    if (due > MAX_BACKLOG_TICKS) {
      throw new Error(`Headless city fell ${due} ticks behind wall time`);
    }
    if (due > 0) life.advanceTicks(due);
    if (now - lastLog >= 60_000) {
      process.stdout.write(JSON.stringify(life.status()) + "\n");
      lastLog = now;
    }
    await delay(Math.max(1, TICK_MS - ((performance.now() - start) % TICK_MS)));
  }
  process.stdout.write(JSON.stringify(life.status()) + "\n");
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
