#!/usr/bin/env node
/**
 * Re-derives the deployed Bethesda life's checkpoints from an unpacked backup
 * (src/bethesda/life/replay.ts). It takes no lease and writes nothing to a
 * store, so it cannot fork the individual, and it needs no access to the VM.
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-replay.ts --store STORE
 *        [--from-store OLDER_STORE] [--ledger ledger.jsonl] [--out RECORD.json]
 *
 * With --store alone it starts from the oldest checkpoint STORE still holds
 * whole. With --from-store it starts from OLDER_STORE's head and reproduces
 * every checkpoint STORE has since, however many that is.
 *
 * It runs in a checkout of the release that made the store (the name of the
 * archive says which), under the Node version that release ran on. Exit 0: every
 * seal reproduced. Exit 1: the replay and the record disagree, or it could not
 * finish. It prints one JSON line per checkpoint and the record last.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { bethesdaStoreKind } from "../src/bethesda/life/bethesdaStore.js";
import { sameVersions, type LifeCheckpoint } from "../src/bethesda/life/continuity.js";
import type {
  HeadlessBethesdaLife,
  HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import { OrganismLife } from "../src/bethesda/life/organism.js";
import {
  REPLAY_SCHEMA,
  replayChain,
  type ReplayOutcome,
} from "../src/bethesda/life/replay.js";
import { LifeStore } from "../src/bethesda/life/store.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

const say = (o: object): void => {
  process.stdout.write(JSON.stringify(o) + "\n");
};

function options(args: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (!flag?.startsWith("--") || !value) throw new Error(`incomplete option ${flag}`);
    o[flag.slice(2)] = value;
  }
  return o;
}

const openStore = (dir: string) =>
  LifeStore.open<HeadlessGenesis, HeadlessBethesdaLife>(dir, bethesdaStoreKind(dir));

/**
 * One checkpoint as stored, read from the store's files. This script runs inside
 * old releases, whose LifeStore may not offer this; the file layout is the store's
 * schema (store.ts), and LifeStore.open has already checked every seal and link.
 */
const checkpointIn = (dir: string, sequence: number): Checkpoint =>
  (
    JSON.parse(
      readFileSync(
        join(dir, "checkpoints", `${String(sequence).padStart(12, "0")}.json`),
        "utf8",
      ),
    ) as { checkpoint: Checkpoint }
  ).checkpoint;

/**
 * The oldest checkpoint the store still holds whole and this engine can restore: a
 * store compacts all but its newest few, and just after a recorded continuation
 * some of those were made by the engine before it.
 */
function oldestWhole(dir: string, head: Checkpoint): Checkpoint {
  let c = head;
  while (c.sequence > 0) {
    const older = checkpointIn(dir, c.sequence - 1);
    if (!older.graph || !sameVersions(older.versions, head.versions)) break;
    c = older;
  }
  return c;
}

/** The ledger's anchors this replay reproduced, of those it covers; the chain before `from` is out of its reach. */
function anchorsReproduced(path: string, outcome: ReplayOutcome) {
  const reproduced = new Set(outcome.digests);
  const anchors = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { checkpoint: number; digest: string });
  const covered = anchors.filter(
    (a) => a.checkpoint > outcome.from.sequence && a.checkpoint <= outcome.to.sequence,
  );
  const wrong = covered.filter((a) => !reproduced.has(a.digest));
  return { covered: covered.length, contradicted: wrong.map((a) => a.checkpoint) };
}

function run() {
  const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-replay.ts"));
  const o = options(process.argv.slice(self + 1));
  if (!o.store) throw new Error("--store DIR is required");
  const started = performance.now();
  const store = openStore(o.store);
  const head = store.head();

  let from: Checkpoint;
  if (o["from-store"]) {
    from = openStore(o["from-store"]).head();
    // Both copies must be the same life: the record of `from` has to be in the newer chain.
    const same = checkpointIn(o.store, from.sequence);
    if (same.digest !== from.digest)
      throw new Error(
        `the stores disagree at checkpoint ${from.sequence}: ${from.digest} and ${same.digest}`,
      );
  } else {
    from = oldestWhole(o.store, head);
  }
  const later: Checkpoint[] = [];
  for (let s = from.sequence + 1; s <= head.sequence; s++) {
    later.push({ ...checkpointIn(o.store, s), graph: null });
  }
  if (!later.length) throw new Error("no checkpoint follows the one to start from");

  const outcome = replayChain(store.kind, from, later, {
    derived: (life) => (life instanceof OrganismLife ? life.takeArchive() : []),
    onMatch: (point, ticks) =>
      say({ reproduced: point.sequence, tick: point.tick, ticks }),
  });
  const ledger = o.ledger ? anchorsReproduced(o.ledger, outcome) : null;
  const passed =
    !outcome.difference &&
    !outcome.stopped &&
    outcome.to.sequence === head.sequence &&
    !ledger?.contradicted.length;
  const record = {
    schema: REPLAY_SCHEMA,
    passed,
    individual: head.birth.individual,
    versions: head.versions,
    machine: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    from: outcome.from,
    to: outcome.to,
    head: { sequence: head.sequence, tick: head.tick, digest: head.digest },
    reproduced: outcome.matched,
    ticks: outcome.ticks,
    ledger,
    difference: outcome.difference,
    stopped: outcome.stopped,
    wallSeconds: Math.round((performance.now() - started) / 100) / 10,
    peakMB: Math.round(process.resourceUsage().maxRSS / 1024),
  };
  if (o.out) writeFileSync(o.out, JSON.stringify(record, null, 2) + "\n");
  say(record);
  process.exitCode = passed ? 0 : 1;
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
