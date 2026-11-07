/**
 * A recorded change of the deployed ECHO organism's plasticity mode (shadow,
 * active or disabled): one checkpoint at the unchanged tick whose graph differs
 * from its parent's in that one leaf (src/bethesda/life/plasticityContinuation.ts).
 * It is the only way the mode changes, and the way to turn the plasticity off:
 * never a restore of an earlier checkpoint.
 *
 * --check is read-only. --commit needs a stopped service (a free lease),
 * ECHO_PLASTICITY_APPROVE_INDIVIDUAL set to the original's id, and
 * ECHO_PLASTICITY_APPROVE_MODE set to the mode asked for.
 *
 *   node --max-old-space-size=4096 scripts/run-ts.mjs scripts/bethesda-life-plasticity-policy.ts \
 *     --store DIR --to shadow|active|disabled --reason "why, in a sentence" --check|--commit
 */
import { resolve } from "node:path";
import { divergence, restoreLife } from "../src/bethesda/life/continuity.js";
import type { HeadlessGenesis } from "../src/bethesda/life/headless.js";
import {
  PLASTICITY_LIFE,
  plasticityModeOf,
  type PlasticityOrganismLife,
} from "../src/bethesda/life/plasticOrganism.js";
import { changePlasticityPolicy } from "../src/bethesda/life/plasticityContinuation.js";
import { LifeStore } from "../src/bethesda/life/store.js";
import { isPlasticityMode } from "../src/bethesda/fly/echo/adaptiveBrain.js";

const ORIGINAL_ECHO = "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
const RECOVERY_TICKS = [1, 10, 100];

function main() {
  const args = process.argv.slice(
    process.argv.findIndex((x) => x.endsWith("bethesda-life-plasticity-policy.ts")) + 1,
  );
  if (
    args.length !== 7 ||
    args[0] !== "--store" ||
    args[2] !== "--to" ||
    args[4] !== "--reason" ||
    (args[6] !== "--check" && args[6] !== "--commit")
  )
    throw new Error(
      'usage: --store DIR --to shadow|active|disabled --reason "..." --check|--commit',
    );
  const to = args[3];
  if (!isPlasticityMode(to)) throw new Error("--to is shadow, active or disabled");
  const reason = args[5]!;
  const commit = args[6] === "--commit";
  const store = LifeStore.open<HeadlessGenesis, PlasticityOrganismLife>(
    resolve(args[1]!),
    PLASTICITY_LIFE,
    { holder: "plasticity policy" },
  );
  const { checkpoint: source, committedUtc: stoppedUtc } = store.headRecord();
  if (
    commit &&
    (source.birth.individual !== ORIGINAL_ECHO ||
      process.env.ECHO_PLASTICITY_APPROVE_INDIVIDUAL !== ORIGINAL_ECHO ||
      process.env.ECHO_PLASTICITY_APPROVE_MODE !== to)
  )
    throw new Error(
      "refusing a production policy change without the exact individual and mode authorization",
    );
  const change = changePlasticityPolicy(
    source,
    to,
    reason,
    new Date().toISOString(),
    stoppedUtc,
  );
  const recovered = restoreLife(PLASTICITY_LIFE, change.checkpoint);
  const mismatch = divergence(PLASTICITY_LIFE, change.life, recovered, RECOVERY_TICKS);
  if (mismatch)
    throw new Error(`the changed life diverged on restore after ${mismatch.after} ticks`);
  let committedUtc: string | null = null;
  if (commit) {
    store.acquire();
    try {
      committedUtc = store.commit(change.checkpoint);
    } finally {
      store.release();
    }
    store.verify();
    if (plasticityModeOf(store.head().graph!) !== to)
      throw new Error("the committed head does not hold the new mode");
  }
  console.log(
    JSON.stringify({
      mode: args[6],
      individual: change.checkpoint.birth.individual,
      from: change.from,
      to: change.to,
      tick: change.checkpoint.tick,
      sequence: change.checkpoint.sequence,
      parent: change.checkpoint.parent,
      committedUtc,
    }),
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
}
