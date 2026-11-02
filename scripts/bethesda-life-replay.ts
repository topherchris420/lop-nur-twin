#!/usr/bin/env node
/**
 * Re-derives the deployed Bethesda life's checkpoints from an unpacked backup
 * (src/bethesda/life/replay.ts). It takes no lease and writes nothing to a
 * store, so it cannot fork the individual, and it needs no access to the VM.
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-replay.ts --store STORE
 *        [--from-store OLDER_STORE] [--individual HEX] [--ledger ledger.jsonl]
 *        [--out RECORD.json]
 *
 * With --store alone it starts from the oldest checkpoint STORE still holds
 * whole. With --from-store it starts from OLDER_STORE's head and reproduces
 * every checkpoint STORE has since, however many that is. --individual is the
 * one this must be. --ledger holds every checkpoint seen in public: each must be
 * in this chain, those before the start included, since a chain rewritten from
 * birth with an honest last stretch would otherwise pass.
 *
 * It runs in a checkout of the release that made the store (the name of the
 * archive says which), under the Node version that release ran on, and compares
 * as much as that release allows (replay.ts says how much, and why).
 *
 * Exit 0: every checkpoint reproduced. Exit 1: the replay and the record
 * disagree, or it could not finish; the record says which, in `difference`,
 * `stopped` or `reason`. Exit 75: no checkpoint follows the one to start from, so
 * there is nothing to judge, and no record. It prints one JSON line per
 * checkpoint and the record last.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { bethesdaStoreKind } from "../src/bethesda/life/bethesdaStore.js";
import { sameVersions, type LifeCheckpoint } from "../src/bethesda/life/continuity.js";
import * as headless from "../src/bethesda/life/headless.js";
import type {
  HeadlessBethesdaLife,
  HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import { OrganismLife } from "../src/bethesda/life/organism.js";
import { REPLAY_SCHEMA, replayChain } from "../src/bethesda/life/replay.js";
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

/**
 * Every checkpoint seen in public against this chain, wherever the replay starts.
 * A line lower than the one before it is the ledger openly recording a rewind, and
 * what it rewound past is no longer expected here. /live keeps saying it happened.
 */
function judgeLedger(path: string, dir: string, head: Checkpoint, individual: string) {
  const anchors = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map(
      (line) =>
        JSON.parse(line) as { individual: string; checkpoint: number; digest: string },
    )
    .filter((a) => a.individual === individual);
  const standing: typeof anchors = [];
  let rewound = 0;
  for (const a of anchors) {
    while (standing.length && standing.at(-1)!.checkpoint > a.checkpoint) {
      standing.pop();
      rewound += 1;
    }
    if (
      standing.at(-1)?.checkpoint === a.checkpoint &&
      standing.at(-1)?.digest !== a.digest
    ) {
      standing.pop();
      rewound += 1;
    }
    if (standing.at(-1)?.checkpoint !== a.checkpoint) standing.push(a);
  }
  const contradicted = standing
    .filter((a) => {
      if (a.checkpoint > head.sequence) return true;
      try {
        return checkpointIn(dir, a.checkpoint).digest !== a.digest;
      } catch {
        return true;
      }
    })
    .map((a) => a.checkpoint);
  return { checked: standing.length, rewound, contradicted };
}

const machine = {
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
};
const started = performance.now();
const cost = () => ({
  wallSeconds: Math.round((performance.now() - started) / 100) / 10,
  peakMB: Math.round(process.resourceUsage().maxRSS / 1024),
});

/** Published as it stands, so nothing in it may start a mention, tag or code span. */
const inert = (s: string) => s.replace(/[@<>`]/g, "").slice(0, 500);

function finish(path: string | undefined, record: { passed: boolean }): void {
  if (path) writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  say(record);
  process.exitCode = record.passed ? 0 : 1;
}

function run(o: Record<string, string>): void {
  if (!o.store) throw new Error("--store DIR is required");
  const store = openStore(o.store);
  const head = store.head();
  if (o.individual && head.birth.individual !== o.individual)
    throw new Error(`the store holds ${head.birth.individual}, not ${o.individual}`);

  let from: Checkpoint;
  if (o["from-store"]) {
    from = openStore(o["from-store"]).head();
    // Both copies must be the same life: the record of `from` has to be in the newer chain.
    if (from.sequence > head.sequence)
      throw new Error(
        `the newer store ends at ${head.sequence}, before ${from.sequence}`,
      );
    const same = checkpointIn(o.store, from.sequence);
    if (same.digest !== from.digest)
      throw new Error(
        `the stores disagree at checkpoint ${from.sequence}: ${from.digest} and ${same.digest}`,
      );
  } else {
    from = oldestWhole(o.store, head);
  }
  if (from.sequence === head.sequence) {
    say({ nothing: `no checkpoint follows ${from.sequence}` });
    process.exitCode = 75;
    return;
  }
  const later: Checkpoint[] = [];
  for (let s = from.sequence + 1; s <= head.sequence; s++) {
    const c = checkpointIn(o.store, s);
    // The newest is compared whole. It holds whatever the earlier ones led to.
    later.push(s === head.sequence ? c : { ...c, graph: null });
  }

  // Each release says for itself whether its seals can be reproduced.
  const sealsRequired = "OBSERVATION_LEAVES_NO_TRACE" in headless;
  const outcome = replayChain(store.kind, from, later, {
    derived: (life) => (life instanceof OrganismLife ? life.takeArchive() : []),
    seals: sealsRequired,
    onMatch: (point, ticks) =>
      say({ reproduced: point.sequence, tick: point.tick, ticks }),
  });
  const ledger = o.ledger
    ? judgeLedger(o.ledger, o.store, head, head.birth.individual)
    : null;
  const passed =
    !outcome.difference &&
    !outcome.stopped &&
    outcome.to.sequence === head.sequence &&
    !ledger?.contradicted.length;
  finish(o.out, {
    schema: REPLAY_SCHEMA,
    passed,
    reason: ledger?.contradicted.length
      ? `this chain contradicts what the ledger saw at ${ledger.contradicted.slice(0, 5).join(", ")}`
      : null,
    individual: head.birth.individual,
    versions: head.versions,
    machine,
    from: outcome.from,
    to: outcome.to,
    head: { sequence: head.sequence, tick: head.tick, digest: head.digest },
    reproduced: outcome.matched,
    ticks: outcome.ticks,
    seals: { required: sealsRequired, reproduced: outcome.seals },
    graphs: outcome.graphs,
    ledger,
    difference: outcome.difference,
    stopped: outcome.stopped,
    ...cost(),
  } as { passed: boolean });
}

const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-replay.ts"));
const given = options(process.argv.slice(self + 1));
try {
  run(given);
} catch (error) {
  // A chain that cannot even be read is a finding as well, and it must leave a record.
  const reason = inert(error instanceof Error ? error.message : String(error));
  process.stderr.write(`${reason}\n`);
  finish(given.out, {
    schema: REPLAY_SCHEMA,
    passed: false,
    reason,
    individual: given.individual ?? null,
    versions: null,
    machine,
    from: null,
    to: null,
    head: null,
    reproduced: 0,
    ticks: 0,
    seals: null,
    graphs: 0,
    ledger: null,
    difference: null,
    stopped: null,
    ...cost(),
  } as { passed: boolean });
}
