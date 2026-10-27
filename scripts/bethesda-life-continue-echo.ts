/**
 * Explicit one-time continuation of the deployed ECHO v2 individual on ECHO v3.
 * --check is read-only; --commit needs the service stopped and its lease released.
 * node scripts/run-ts.mjs scripts/bethesda-life-continue-echo.ts \
 *   --store DIR --from-release /opt/bethesda-life/releases/3db627b... --check|--commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import {
  continueEchoSelfModel,
  ECHO_UPGRADED_LIFE,
  SELF_MODEL_UPGRADE_SOURCE,
} from "../src/bethesda/life/echoUpgrade.js";
import type {
  HeadlessBethesdaLife,
  HeadlessGenesis,
} from "../src/bethesda/life/headless.js";
import { LifeStore } from "../src/bethesda/life/store.js";

async function run() {
  const self = process.argv.findIndex((a) =>
    a.endsWith("bethesda-life-continue-echo.ts"),
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
      .includes(`commit ${SELF_MODEL_UPGRADE_SOURCE}`)
  )
    throw new Error("the source must be the exact deployed 3db627b release");
  // Verify with the engine that actually wrote the checkpoint, before transforming it.
  const old = (await import(
    pathToFileURL(resolve(previous, "src/bethesda/life/echoUpgrade.ts")).href
  )) as {
    ECHO_UPGRADED_LIFE: LifeKind<HeadlessGenesis, unknown>;
  };
  const oldContinuity = (await import(
    pathToFileURL(resolve(previous, "src/bethesda/life/continuity.ts")).href
  )) as {
    restoreLife(
      kind: LifeKind<HeadlessGenesis, unknown>,
      c: LifeCheckpoint<HeadlessGenesis>,
    ): unknown;
  };
  const store = LifeStore.open<HeadlessGenesis, HeadlessBethesdaLife>(
    dir,
    ECHO_UPGRADED_LIFE,
  );
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  process.stderr.write("Checking the source checkpoint on its original engine\n");
  oldContinuity.restoreLife(old.ECHO_UPGRADED_LIFE, source);
  const upgradedUtc = new Date().toISOString();
  process.stderr.write("Checking the preserved graph and the new ECHO v3 checkpoint\n");
  const { life, checkpoint } = continueEchoSelfModel(source, upgradedUtc, stoppedUtc);
  // Prove deterministic future recovery, using disposable in-memory continuations only.
  // No backup store is ever advanced or committed as a second writer.
  const restored = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
  process.stderr.write("Checking deterministic continuation after restore\n");
  const mismatch = divergence(ECHO_UPGRADED_LIFE, life, restored, [1, 10, 100, 500]);
  if (mismatch)
    throw new Error(`upgrade recovery diverged after ${mismatch.after} ticks`);
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
  const event = checkpoint.events.find((e) => e.kind === "self-model-upgrade")!;
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
      inquiryOpen: event.data.inquiryOpen,
      versions: checkpoint.versions,
      recoveryTicks: 611,
      committedUtc,
    }) + "\n",
  );
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
