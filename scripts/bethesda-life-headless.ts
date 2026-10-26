/**
 * Headless process runner. Without `--store` nothing persists: the life is
 * in memory and ends with the process. With `--store DIR` the life is one
 * individual kept in DIR (src/bethesda/life/store.ts): born once with
 * `--create`, then resumed from its newest checkpoint by every later run,
 * checkpointed (and each checkpoint verified by restoring it) as it goes.
 * It exposes no endpoint and is not a production daemon.
 *
 * Finite mode: node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --ticks 100
 * Continuous development mode: ... --continuous
 * Either with Project ECHO's experimental controller: ... --controller echo
 * Durable: ... --store DIR --create [--controller echo]   (a birth: ticks 0)
 *          ... --store DIR --ticks N | --continuous         (resume, live, checkpoint)
 *          ... --store DIR --verify                         (check the chain; resume nothing)
 */
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  BETHESDA_LIFE,
  headlessGenesis,
  HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import {
  birth,
  checkpointLife,
  restoreLife,
  type LifeEvent,
} from "../src/bethesda/life/continuity.js";
import { LifeStore } from "../src/bethesda/life/store.js";
import { PROFILES } from "../src/bethesda/simulation.js";

const TICK_MS = 100;
const MAX_BACKLOG_TICKS = 300;
/** A durable life is checkpointed every this many ticks (five simulated minutes). */
const CHECKPOINT_TICKS = 3000;

type Clock = { continuous: true } | { continuous: false; ticks: number };
interface Mode {
  clock: Clock | null;
  controller: "reduced-order" | "echo";
  store: string | null;
  create: boolean;
  verify: boolean;
}

function take(args: string[], flag: string, value: boolean): string | true | null {
  const at = args.indexOf(flag);
  if (at < 0) return null;
  const v = value ? args[at + 1] : true;
  if (value && (v === undefined || String(v).startsWith("--")))
    throw new Error(`${flag} needs a value`);
  args.splice(at, value ? 2 : 1);
  return v ?? null;
}

function parseMode(all: string[]): Mode {
  const args = [...all];
  const named = (take(args, "--controller", true) as string | null) ?? "reduced-order";
  if (named !== "reduced-order" && named !== "echo")
    throw new Error("--controller is reduced-order (the default) or echo");
  const store = take(args, "--store", true) as string | null;
  const create = take(args, "--create", false) === true;
  const verify = take(args, "--verify", false) === true;
  if ((create || verify) && !store)
    throw new Error("--create and --verify need --store DIR");
  if (create || verify) {
    if (args.length) throw new Error(`unexpected ${args.join(" ")}`);
    return { clock: null, controller: named, store, create, verify };
  }
  return { clock: parseClock(args), controller: named, store, create, verify };
}

function parseClock(args: string[]): Clock {
  if (args.length === 1 && args[0] === "--continuous") return { continuous: true };
  if (args.length === 2 && args[0] === "--ticks") {
    const value = Number(args[1]);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 10_000)
      return { continuous: false, ticks: value };
  }
  throw new Error(
    "Use --ticks N (0–10000) or --continuous (development only), optionally with --controller echo or --store DIR",
  );
}

const print = (life: HeadlessBethesdaLife, extra: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ ...life.status(), ...extra }) + "\n");

/** Runs the clock: a fixed number of ticks, or wall time until a signal. */
async function live(
  life: HeadlessBethesdaLife,
  clock: Clock,
  each: (life: HeadlessBethesdaLife) => void,
): Promise<void> {
  if (!clock.continuous) {
    for (let left = clock.ticks; left > 0;) {
      const n = Math.min(left, CHECKPOINT_TICKS);
      life.advanceTicks(n);
      left -= n;
      each(life);
    }
    return;
  }
  let stopping = false;
  process.once("SIGTERM", () => (stopping = true));
  process.once("SIGINT", () => (stopping = true));
  const start = performance.now();
  const startTick = life.city.tick;
  let lastLog = start;
  while (!stopping) {
    const now = performance.now();
    const target = startTick + Math.floor((now - start) / TICK_MS);
    const due = target - life.city.tick;
    if (due > MAX_BACKLOG_TICKS)
      throw new Error(`Headless city fell ${due} ticks behind wall time`);
    if (due > 0) {
      life.advanceTicks(due);
      each(life);
    }
    if (now - lastLog >= 60_000) {
      print(life);
      lastLog = now;
    }
    await delay(Math.max(1, TICK_MS - ((performance.now() - start) % TICK_MS)));
  }
}

async function durable(mode: Mode & { store: string }): Promise<void> {
  if (mode.create) {
    const genesis = headlessGenesis(PROFILES[1], mode.controller);
    const b = birth(BETHESDA_LIFE.id, genesis, randomBytes(16).toString("hex"));
    const life = BETHESDA_LIFE.build(structuredClone(genesis));
    const first = checkpointLife(BETHESDA_LIFE, life, {
      genesis,
      birth: b,
      previous: null,
    });
    LifeStore.create(mode.store, BETHESDA_LIFE, first).release();
    print(life, { individual: b.individual, checkpoint: 0 });
    return;
  }
  const store = LifeStore.open<HeadlessGenesis, HeadlessBethesdaLife>(
    mode.store,
    BETHESDA_LIFE,
  );
  if (mode.verify) {
    process.stdout.write(JSON.stringify(store.verify()) + "\n");
    return;
  }
  store.acquire();
  const { checkpoint, committedUtc } = store.headRecord();
  const life = restoreLife(BETHESDA_LIFE, checkpoint);
  // The life was paused while no process ran; those ticks were not computed and are not claimed.
  let pending: LifeEvent[] = [
    {
      tick: life.city.tick,
      kind: "gap",
      data: {
        stoppedUtc: committedUtc,
        resumedUtc: new Date().toISOString(),
        policy: "paused",
      },
    },
  ];
  let previous = checkpoint;
  let sinceCheckpoint = 0;
  const commit = () => {
    const next = checkpointLife(BETHESDA_LIFE, life, {
      genesis: previous.genesis,
      birth: previous.birth,
      previous,
      events: pending,
    });
    // Verified before it is committed: it must restore to this very life.
    restoreLife(BETHESDA_LIFE, next);
    store.commit(next);
    previous = next;
    pending = [];
    sinceCheckpoint = 0;
  };
  let lastTick = life.city.tick;
  await live(life, mode.clock!, (l) => {
    sinceCheckpoint += l.city.tick - lastTick;
    lastTick = l.city.tick;
    store.renew();
    if (sinceCheckpoint >= CHECKPOINT_TICKS) commit();
  });
  if (life.city.tick !== previous.tick || pending.length) commit();
  store.release();
  print(life, { individual: previous.birth.individual, checkpoint: previous.sequence });
}

async function run() {
  // Under scripts/run-ts.mjs the script's own path is still in argv: read what follows it.
  const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-headless.ts"));
  const mode = parseMode(process.argv.slice(self + 1));
  if (mode.store) return durable({ ...mode, store: mode.store });
  const life = new HeadlessBethesdaLife(undefined, { flyController: mode.controller });
  if (mode.clock!.continuous)
    process.stderr.write(
      "Development-only in-memory clock; pass --store DIR to keep the life.\n",
    );
  await live(life, mode.clock!, () => {});
  print(life);
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
