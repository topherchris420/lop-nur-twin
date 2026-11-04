/**
 * Explicit one-time continuation of the deployed organism onto the repaired
 * physics (src/bethesda/life/physicsRepair.ts, docs/ECHO_COLLISION.md): the same
 * individual and its whole graph, on digital-fly/9. --check is read-only; --commit
 * needs the service stopped and its lease released. Nothing here advances a store
 * or runs a second writer: every forward check is a disposable in-memory copy.
 * node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-physics.ts \
 *   --store DIR --from-release /opt/bethesda-life/releases/bdb7c02... --check|--commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  divergence,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import {
  ORGANISM_LIFE,
  PHYSICS_REPAIR_EVENT,
  PHYSICS_REPAIR_SOURCE,
  type OrganismLife,
} from "../src/bethesda/life/organism.js";
import { continueOnRepairedPhysics } from "../src/bethesda/life/physicsRepair.js";
import { GRAPH_SCHEMA } from "../src/bethesda/life/snapshot.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const RECOVERY_TICKS = [1, 10, 100, 500];

async function run() {
  const self = process.argv.findIndex((a) =>
    a.endsWith("bethesda-life-continue-physics.ts"),
  );
  const args = process.argv.slice(self + 1);
  if (
    args.length !== 5 ||
    args[0] !== "--store" ||
    args[2] !== "--from-release" ||
    (args[4] !== "--check" && args[4] !== "--commit")
  )
    throw new Error("Use --store DIR --from-release DIR --check|--commit");
  const dir = resolve(args[1]!);
  const previous = resolve(args[3]!);
  if (
    !readFileSync(resolve(previous, "RELEASE"), "utf8")
      .split(/\r?\n/)
      .includes(`commit ${PHYSICS_REPAIR_SOURCE}`)
  )
    throw new Error(
      `the source must be the exact deployed ${PHYSICS_REPAIR_SOURCE} release`,
    );
  // Verify with the engine that actually wrote the checkpoint, before transforming it.
  const old = (await import(
    pathToFileURL(resolve(previous, "src/bethesda/life/organism.ts")).href
  )) as { ORGANISM_LIFE: LifeKind<HeadlessGenesis, unknown> };
  const oldContinuity = (await import(
    pathToFileURL(resolve(previous, "src/bethesda/life/continuity.ts")).href
  )) as {
    restoreLife(
      kind: LifeKind<HeadlessGenesis, unknown>,
      c: LifeCheckpoint<HeadlessGenesis>,
    ): unknown;
  };
  const store = LifeStore.open<HeadlessGenesis, OrganismLife>(dir, ORGANISM_LIFE);
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  if (sameVersions(source.versions, { ...ORGANISM_LIFE.versions, graph: GRAPH_SCHEMA }))
    throw new Error(
      "this individual is already on the repaired physics; nothing was changed",
    );
  process.stderr.write("Checking the source checkpoint on its original engine\n");
  oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
  const upgradedUtc = new Date().toISOString();
  process.stderr.write("Checking the preserved graph and the new checkpoint\n");
  const { life, checkpoint, preservedGraphDigest } = continueOnRepairedPhysics(
    source,
    upgradedUtc,
    stoppedUtc,
  );
  // Prove deterministic future recovery, using disposable in-memory continuations only.
  const restored = restoreLife(ORGANISM_LIFE, checkpoint);
  process.stderr.write("Checking deterministic continuation after restore\n");
  const mismatch = divergence(ORGANISM_LIFE, life, restored, RECOVERY_TICKS);
  if (mismatch) throw new Error(`repair recovery diverged after ${mismatch.after} ticks`);
  let committedUtc: string | null = null;
  if (args[4] === "--commit") {
    // Take the lease only after the expensive checks. Commit also checks the
    // exact parent again, so a checkpoint written meanwhile is never overwritten.
    store.acquire();
    try {
      committedUtc = store.commit(checkpoint);
    } finally {
      store.release();
    }
    store.verify();
  }
  const event = checkpoint.events.find((e) => e.kind === PHYSICS_REPAIR_EVENT)!;
  process.stdout.write(
    JSON.stringify({
      mode: args[4],
      individual: checkpoint.birth.individual,
      tick: checkpoint.tick,
      previousSequence: source.sequence,
      sequence: checkpoint.sequence,
      parent: checkpoint.parent,
      genesisDigest: checkpoint.genesisDigest,
      sourceGraphDigest: source.graphDigest,
      preservedGraphDigest,
      physics: event.data.physics,
      changed: event.data.changed,
      body: event.data.body,
      kept: event.data.kept,
      versions: checkpoint.versions,
      recoveryTicks: RECOVERY_TICKS.reduce((a, b) => a + b, 0),
      pausedFromUtc: stoppedUtc,
      upgradedUtc,
      committedUtc,
    }) + "\n",
  );
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
