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
 *          ... --store DIR --check                          (--verify, then restore the head in
 *                                                            memory; no lease, nothing written)
 * As a service on one machine: deploy/bethesda-life/ (docs/BETHESDA_CONTINUOUS_LIFE.md).
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
import {
  removeObservation,
  writeObservation,
} from "../src/bethesda/life/observationFile.js";
import { LifeStore } from "../src/bethesda/life/store.js";
import { PROFILES } from "../src/bethesda/simulation.js";

const TICK_MS = 100;
/**
 * How far the clock may fall behind wall time before the run stops. A
 * verified checkpoint of a full-grown city blocks it for about 18 s on the
 * development laptop and two or three times that on a slower cloud core;
 * the ticks it falls behind are computed afterwards, never skipped.
 */
const MAX_BACKLOG_TICKS = 1800;
/** A durable life is checkpointed every this many ticks (five simulated minutes). */
const CHECKPOINT_TICKS = 3000;
/** The file the observer reads (observation.ts), named by the service; none without it. */
const OBSERVE_ENV = "BETHESDA_LIFE_OBSERVE";
/** A durable life is observed every this many ticks (one simulated second). */
const OBSERVE_TICKS = 10;

type Clock = { continuous: true } | { continuous: false; ticks: number };
interface Mode {
  clock: Clock | null;
  controller: "reduced-order" | "echo";
  store: string | null;
  create: boolean;
  verify: boolean;
  check: boolean;
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
  const check = take(args, "--check", false) === true;
  if ((create || verify || check) && !store)
    throw new Error("--create, --verify and --check need --store DIR");
  if (Number(create) + Number(verify) + Number(check) > 1)
    throw new Error("use one of --create, --verify and --check");
  if (create || verify || check) {
    if (args.length) throw new Error(`unexpected ${args.join(" ")}`);
    return { clock: null, controller: named, store, create, verify, check };
  }
  return { clock: parseClock(args), controller: named, store, create, verify, check };
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
  if (mode.check) {
    // What a resume would do first, without the lease: restoreLife throws on any mismatch.
    const { checkpoint } = store.headRecord();
    const life = restoreLife(BETHESDA_LIFE, checkpoint);
    print(life, {
      individual: checkpoint.birth.individual,
      checkpoint: checkpoint.sequence,
      restored: true,
    });
    return;
  }
  const epoch = store.acquire();
  const { checkpoint, committedUtc } = store.headRecord();
  const life = restoreLife(BETHESDA_LIFE, checkpoint);
  // What the observer may see (observation.ts), when the service names a file
  // for it: written about once a second, beside the life and never into it. A
  // failure to write it is reported once and never stops the life.
  const observed = process.env[OBSERVE_ENV] || null;
  let head = { sequence: checkpoint.sequence, tick: checkpoint.tick, committedUtc };
  let observedTick = -Infinity,
    observeError = "";
  const observe = (checkpointing = false) => {
    observedTick = life.city.tick;
    if (!observed) return;
    try {
      writeObservation(
        observed,
        life.observation({
          individual: checkpoint.birth.individual,
          epoch,
          checkpoint: head,
          checkpointing,
          observedUtc: new Date().toISOString(),
        }),
      );
      observeError = "";
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== observeError)
        process.stderr.write(`observation not written: ${message}\n`);
      observeError = message;
    }
  };
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
    // The clock waits while it is made and verified: the observer is told so.
    observe(true);
    const next = checkpointLife(BETHESDA_LIFE, life, {
      genesis: previous.genesis,
      birth: previous.birth,
      previous,
      events: pending,
    });
    // Verified before it is committed: it must restore to this very life.
    restoreLife(BETHESDA_LIFE, next);
    // Making and verifying it can outlast a good part of the lease on a slow machine.
    store.renew();
    head = { sequence: next.sequence, tick: next.tick, committedUtc: store.commit(next) };
    previous = next;
    pending = [];
    sinceCheckpoint = 0;
    observe();
  };
  let lastTick = life.city.tick;
  observe();
  try {
    await live(life, mode.clock!, (l) => {
      sinceCheckpoint += l.city.tick - lastTick;
      lastTick = l.city.tick;
      store.renew();
      if (sinceCheckpoint >= CHECKPOINT_TICKS) commit();
      if (l.city.tick - observedTick >= OBSERVE_TICKS) observe();
    });
    if (life.city.tick !== previous.tick || pending.length) commit();
  } finally {
    // A stopped life is unavailable at once, not stale for a few seconds.
    if (observed) removeObservation(observed);
  }
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
