/**
 * One-time continuation of THE ORIGINAL ECHO organism onto embodied plasticity
 * (src/bethesda/life/plasticOrganism.ts), not a birth. It starts in shadow mode:
 * it learns and changes no command. This CLI cannot reach Eva or her VM.
 *
 * --check is read-only: it opens the store without the lease and writes nothing.
 * --commit needs a stopped service (a free lease), the exact source release
 * installed beside it, and ECHO_PLASTICITY_APPROVE_INDIVIDUAL set to the
 * original's id; it still refuses a changed parent. After a commit, the source
 * release refuses the store: forward fixes only (docs/EVA_ECHO_ACTIVATION.md).
 *
 *   node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-continue-plasticity.ts \
 *     --store DIR --from-release /opt/bethesda-life/releases/<PLASTICITY_CONTINUATION_SOURCE> --check
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../src/rain/sha256.js";
import {
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeKind,
} from "../src/bethesda/life/continuity.js";
import {
  PLASTICITY_CONTINUATION_SOURCE,
  PLASTICITY_EVENT,
  PLASTICITY_LIFE,
  plasticityProjection,
  type PlasticityOrganismLife,
} from "../src/bethesda/life/plasticOrganism.js";
import { continueWithPlasticity } from "../src/bethesda/life/plasticityContinuation.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import { ORGANISM_LIFE, type OrganismLife } from "../src/bethesda/life/organism.js";
import { indexGraph, snapshotGraph } from "../src/bethesda/life/snapshot.js";
import { LifeStore } from "../src/bethesda/life/store.js";

const ORIGINAL_ECHO = "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
const SAME_ENGINE_TICKS = 600;
const SHADOW_TICKS = 600;
const RECOVERY_TICKS = [1, 10, 100, 500];

async function main() {
  const args = process.argv.slice(
    process.argv.findIndex((x) => x.endsWith("bethesda-life-continue-plasticity.ts")) + 1,
  );
  if (
    args.length !== 5 ||
    args[0] !== "--store" ||
    args[2] !== "--from-release" ||
    (args[4] !== "--check" && args[4] !== "--commit")
  )
    throw new Error(
      "usage: --store DIR --from-release SOURCE_RELEASE_DIR --check|--commit",
    );
  const commit = args[4] === "--commit";
  const dir = resolve(args[1]!);
  const oldRelease = realpathSync(resolve(args[3]!));
  if (oldRelease === realpathSync(resolve(".")))
    throw new Error("the source release must be an installed, separate source tree");
  const pinned = readFileSync(resolve(oldRelease, "RELEASE"), "utf8")
    .split(/\r?\n/)
    .includes(`commit ${PLASTICITY_CONTINUATION_SOURCE}`);
  if (!pinned)
    throw new Error(
      `the source release must be the exact ${PLASTICITY_CONTINUATION_SOURCE} release`,
    );

  // The new kind's history verifier knows all the original's past eras.
  const store = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
    dir,
    PLASTICITY_LIFE,
    {
      holder: "plasticity continuation",
    },
  );
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  if (
    commit &&
    (source.birth.individual !== ORIGINAL_ECHO ||
      process.env.ECHO_PLASTICITY_APPROVE_INDIVIDUAL !== ORIGINAL_ECHO)
  )
    throw new Error(
      "refusing production continuation without the exact original ECHO individual authorization",
    );

  // 1. The source restores on the release that wrote it, and this release's
  //    organism engine lives on from it exactly as that one does.
  const old = (await import(
    pathToFileURL(resolve(oldRelease, "src/bethesda/life/organism.ts")).href
  )) as { ORGANISM_LIFE: LifeKind<HeadlessGenesis, unknown> };
  const oldContinuity = (await import(
    pathToFileURL(resolve(oldRelease, "src/bethesda/life/continuity.ts")).href
  )) as {
    restoreLife(
      kind: LifeKind<HeadlessGenesis, unknown>,
      c: LifeCheckpoint<HeadlessGenesis>,
    ): unknown;
  };
  if (
    JSON.stringify(old.ORGANISM_LIFE.versions) !== JSON.stringify(ORGANISM_LIFE.versions)
  )
    throw new Error(
      "the source release is not the organism engine whose versions wrote this checkpoint",
    );
  let oldLife: unknown = oldContinuity.restoreLife(old.ORGANISM_LIFE, source);
  let newLife: OrganismLife | null = restoreLife(ORGANISM_LIFE, source);
  old.ORGANISM_LIFE.step(oldLife, SAME_ENGINE_TICKS);
  ORGANISM_LIFE.step(newLife, SAME_ENGINE_TICKS);
  if (old.ORGANISM_LIFE.hash(oldLife) !== ORGANISM_LIFE.hash(newLife))
    throw new Error(
      "the original organism behaves differently on this release; refusing",
    );
  oldLife = null;

  // 2. The continuation, in memory: every old byte preserved, starting in shadow mode.
  const upgradedUtc = new Date().toISOString();
  const result = continueWithPlasticity(source, upgradedUtc, stoppedUtc);

  // 3. Shadow mode changes nothing: beside the organism restored from the same
  //    source, the continued life holds exactly the organism's graph once the
  //    addition is taken out, random streams included.
  newLife = restoreLife(ORGANISM_LIFE, source);
  const shadow = restoreLife(PLASTICITY_LIFE, result.checkpoint);
  ORGANISM_LIFE.step(newLife, SHADOW_TICKS);
  PLASTICITY_LIFE.step(shadow, SHADOW_TICKS);
  const organismDigest = sha256(
    JSON.stringify(
      snapshotGraph(
        newLife,
        indexGraph(ORGANISM_LIFE.build(structuredClone(source.genesis))),
      ),
    ),
  );
  const shadowDigest = plasticityProjection(
    snapshotGraph(
      shadow,
      indexGraph(PLASTICITY_LIFE.build(structuredClone(source.genesis))),
    ),
  );
  if (shadowDigest !== organismDigest)
    throw new Error(
      `shadow mode changed the organism within ${SHADOW_TICKS} ticks; refusing`,
    );
  newLife = null;

  // 4. Two restores of the continuation stay the same life.
  const recovered = restoreLife(PLASTICITY_LIFE, result.checkpoint);
  const mismatch = divergence(PLASTICITY_LIFE, result.life, recovered, RECOVERY_TICKS);
  if (mismatch)
    throw new Error(`post-continuation recovery diverged after ${mismatch.after} ticks`);

  let committedUtc: string | null = null;
  if (commit) {
    // The lease must be free: this is an explicit stopped-service migration.
    store.acquire();
    try {
      committedUtc = store.commit(result.checkpoint);
    } finally {
      store.release();
    }
    store.verify();
  }
  const event = result.checkpoint.events.find((e) => e.kind === PLASTICITY_EVENT);
  console.log(
    JSON.stringify({
      mode: args[4],
      individual: result.checkpoint.birth.individual,
      sourceRelease: PLASTICITY_CONTINUATION_SOURCE,
      tick: result.checkpoint.tick,
      sequence: result.checkpoint.sequence,
      parent: result.checkpoint.parent,
      preservedGraphDigest: result.preservedGraphDigest,
      sourceGraphDigest: source.graphDigest,
      sameEngineTicks: SAME_ENGINE_TICKS,
      shadowTicks: SHADOW_TICKS,
      shadowUnchanged: true,
      recoveryTicks: RECOVERY_TICKS.reduce((a, b) => a + b, 0),
      startMode: event?.data.mode,
      committedUtc,
    }),
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
