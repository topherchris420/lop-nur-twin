/**
 * Headless process smoke runner. Does not persist across restarts, does not
 * expose a public endpoint, and must not be enabled as a production daemon.
 *
 * Finite mode: node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --ticks 100
 * Continuous development mode: ... --continuous
 */
import { setTimeout as delay } from "node:timers/promises";
import { HeadlessBethesdaLife } from "../src/bethesda/life/headless.js";

const TICK_MS = 100;
const MAX_BACKLOG_TICKS = 300;

function parseMode(args: string[]): { continuous: boolean; ticks: number } {
  if (args.length === 1 && args[0] === "--continuous") {
    return { continuous: true, ticks: 0 };
  }
  if (args.length === 2 && args[0] === "--ticks") {
    const value = Number(args[1]);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 10_000) {
      return { continuous: false, ticks: value };
    }
  }
  throw new Error("Use --ticks N (0–10000) or --continuous (development only)");
}

async function run() {
  const args = process.argv.slice(
    process.argv[2]?.endsWith("bethesda-life-headless.ts") ? 3 : 2,
  );
  const echo = args.includes("--echo");
  const mode = parseMode(args.filter((arg) => arg !== "--echo"));
  const life = new HeadlessBethesdaLife(undefined, echo ? { echo: "full" } : {});
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
