/**
 * Explicit one-time continuation of the deployed ECHO v3 individual as the
 * organism (src/bethesda/life/organism.ts): the same individual and its whole
 * graph, with mushroom-body learning, olfactory navigation and recoverable
 * physiology added. --check is read-only; --commit needs the service stopped
 * and its lease released. Nothing here advances a store or runs a second
 * writer: every forward check is a disposable in-memory copy.
 * node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-organism.ts \
 *   --store DIR --from-release /opt/bethesda-life/releases/d25e1f3... --check|--commit
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
import { ECHO_UPGRADED_LIFE } from "../src/bethesda/life/echoUpgrade.js";
import type {
  HeadlessBethesdaLife,
  HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import {
  ORGANISM_CONTINUATION_SOURCE,
  ORGANISM_EVENT,
  ORGANISM_LIFE,
  type OrganismLife,
} from "../src/bethesda/life/organism.js";
import { continueAsOrganism } from "../src/bethesda/life/organismContinuation.js";
import { GRAPH_SCHEMA } from "../src/bethesda/life/snapshot.js";
import { LifeStore } from "../src/bethesda/life/store.js";

/** How long the deployed engine and this release each continue the v3 fly before their hashes are compared. */
const SAME_ENGINE_TICKS = 600;
const RECOVERY_TICKS = [1, 10, 100, 500];

async function run() {
  const self = process.argv.findIndex((a) =>
    a.endsWith("bethesda-life-continue-organism.ts"),
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
      .includes(`commit ${ORGANISM_CONTINUATION_SOURCE}`)
  )
    throw new Error("the source must be the exact deployed d25e1f3 release");
  // Verify with the engine that actually wrote the checkpoint, before transforming it.
  const old = (await import(
    pathToFileURL(resolve(previous, "src/bethesda/life/echoUpgrade.ts")).href
  )) as { ECHO_UPGRADED_LIFE: LifeKind<HeadlessGenesis, unknown> };
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
      "this individual already continued as the organism; nothing was changed",
    );
  process.stderr.write("Checking the source checkpoint on its original engine\n");
  let deployed: unknown = oldContinuity.restoreLife(old.ECHO_UPGRADED_LIFE, source);
  // This release must continue the v3 fly exactly as the deployed engine does,
  // so nothing but the declared additions differs after the continuation.
  process.stderr.write(
    `Checking that this release continues the v3 fly as its own engine does (${SAME_ENGINE_TICKS} ticks, in memory)\n`,
  );
  let here: HeadlessBethesdaLife | null = restoreLife(ECHO_UPGRADED_LIFE, source);
  old.ECHO_UPGRADED_LIFE.step(deployed, SAME_ENGINE_TICKS);
  ECHO_UPGRADED_LIFE.step(here, SAME_ENGINE_TICKS);
  const sameEngine =
    old.ECHO_UPGRADED_LIFE.hash(deployed) === ECHO_UPGRADED_LIFE.hash(here);
  deployed = here = null;
  if (!sameEngine)
    throw new Error(
      "this release does not continue the ECHO v3 fly as the deployed engine does; nothing was changed",
    );
  const upgradedUtc = new Date().toISOString();
  process.stderr.write("Checking the preserved graph and the new organism checkpoint\n");
  const { life, checkpoint } = continueAsOrganism(source, upgradedUtc, stoppedUtc);
  // Prove deterministic future recovery, using disposable in-memory continuations only.
  const restored = restoreLife(ORGANISM_LIFE, checkpoint);
  process.stderr.write("Checking deterministic continuation after restore\n");
  const mismatch = divergence(ORGANISM_LIFE, life, restored, RECOVERY_TICKS);
  if (mismatch)
    throw new Error(`organism recovery diverged after ${mismatch.after} ticks`);
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
  const event = checkpoint.events.find((e) => e.kind === ORGANISM_EVENT)!;
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
      preservedGraphDigest: event.data.preservedGraphDigest,
      kept: event.data.kept,
      introduced: event.data.introduced,
      versions: checkpoint.versions,
      sameEngineTicks: SAME_ENGINE_TICKS,
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
