/**
 * One-time continuation of THE ORIGINAL ECHO organism, not a birth.
 * This CLI does not control Eva and cannot operate on her Python VM.
 *
 * DO NOT use --commit before a copy of the full live store and the exact old
 * release pass --check and a restore-tested backup exists. --check is read-only.
 * --commit requires a stopped service, lease ownership and an explicit matching
 * production individual authorization; it still refuses a changed parent.
 *
 * node scripts/run-ts.mjs scripts/bethesda-life-continue-habits.ts \
 *   --store DIR --from-release /opt/bethesda-life/releases/OLD_SHA --check
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import { HABIT_EVENT, HABIT_LIFE, type HabitOrganismLife } from "../src/bethesda/life/habitOrganism.js";
import { continueWithHabits } from "../src/bethesda/life/habitContinuation.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import { ORGANISM_LIFE, type OrganismLife } from "../src/bethesda/life/organism.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const ORIGINAL_ECHO = "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
const SAME_ENGINE_TICKS = 600;
const RECOVERY_TICKS = [1, 10, 100, 500];

async function main() {
  const args = process.argv.slice(process.argv.findIndex(x => x.endsWith("bethesda-life-continue-habits.ts")) + 1);
  if (
    args.length !== 5 ||
    args[0] !== "--store" ||
    args[2] !== "--from-release" ||
    (args[4] !== "--check" && args[4] !== "--commit")
  ) throw new Error("usage: --store DIR --from-release OLD_RELEASE_DIR --check|--commit");

  const dir = resolve(args[1]!);
  const oldRelease = realpathSync(resolve(args[3]!));
  const release = readFileSync(resolve(oldRelease, "RELEASE"), "utf8");
  const sha = release.split(/\r?\n/).find(x => /^commit [a-f0-9]{40}$/.test(x));
  if (!sha) throw new Error("old release has no pinned 40-character commit");
  if (oldRelease === resolve("."))
    throw new Error("old release must be an installed, separate source checkout");

  // The new kind's history verifier knows all the original's past eras.
  const store = LifeStore.open<HeadlessGenesis, HabitOrganismLife>(dir, HABIT_LIFE);
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  if (args[4] === "--commit" &&
      (source.birth.individual !== ORIGINAL_ECHO ||
       process.env.ECHO_HABITS_APPROVE_INDIVIDUAL !== ORIGINAL_ECHO))
    throw new Error("refusing production continuation without the exact original ECHO individual authorization");

  // Compare the old and new *organism* engines, without learning changes.
  // Both copies are disposable and start from the same authentic checkpoint.
  const old = (await import(pathToFileURL(resolve(oldRelease, "src/bethesda/life/organism.ts")).href)) as {
    ORGANISM_LIFE: LifeKind<HeadlessGenesis, unknown>;
  };
  const oldContinuity = (await import(pathToFileURL(resolve(oldRelease, "src/bethesda/life/continuity.ts")).href)) as {
    restoreLife(kind: LifeKind<HeadlessGenesis, unknown>, c: LifeCheckpoint<HeadlessGenesis>): unknown;
  };
  if (JSON.stringify(old.ORGANISM_LIFE.versions) !== JSON.stringify(ORGANISM_LIFE.versions))
    throw new Error("the old source is not the organism engine whose version wrote this checkpoint");
  let oldLife: unknown = oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
  let newLife: OrganismLife | null = restoreLife(ORGANISM_LIFE, source);
  old.ORGANISM_LIFE.step(oldLife, SAME_ENGINE_TICKS);
  ORGANISM_LIFE.step(newLife, SAME_ENGINE_TICKS);
  if (old.ORGANISM_LIFE.hash(oldLife) !== ORGANISM_LIFE.hash(newLife))
    throw new Error("behavior of the original organism differs on this release; refusing");
  oldLife = null;
  newLife = null;

  const upgradedUtc = new Date().toISOString();
  const result = continueWithHabits(source, upgradedUtc, stoppedUtc);
  const recovered = restoreLife(HABIT_LIFE, result.checkpoint);
  const mismatch = divergence(HABIT_LIFE, result.life, recovered, RECOVERY_TICKS);
  if (mismatch) throw new Error(`post-continuation recovery diverged after ${mismatch.after} ticks`);

  let committedUtc: string | null = null;
  if (args[4] === "--commit") {
    // The lease must be free: this is an explicit stopped-service migration.
    store.acquire();
    try {
      committedUtc = store.commit(result.checkpoint);
    } finally {
      store.release();
    }
    store.verify();
  }
  const event = result.checkpoint.events.find(e => e.kind === HABIT_EVENT);
  console.log(JSON.stringify({
    mode: args[4],
    individual: result.checkpoint.birth.individual,
    oldReleaseCommit: sha.split(" ")[1],
    tick: result.checkpoint.tick,
    sequence: result.checkpoint.sequence,
    parent: result.checkpoint.parent,
    preservedGraphDigest: result.preservedGraphDigest,
    sourceGraphDigest: source.graphDigest,
    sameEngineTicks: SAME_ENGINE_TICKS,
    recoveryTicks: RECOVERY_TICKS.reduce((a,b)=>a+b,0),
    preservation: event?.data.interpretation,
    committedUtc,
  }));
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
