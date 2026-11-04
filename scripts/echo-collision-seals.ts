/**
 * One line for each checkpoint in a store: its sequence and everything that seals it.
 * Compaction drops an old checkpoint's graph and rewrites its file, as it does at every
 * commit, so this is what stays the same when a store's history stays the same.
 * Read-only.
 *
 *   node scripts/run-ts.mjs scripts/echo-collision-seals.ts DIR
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const at = process.argv.findIndex((a) => a.endsWith("echo-collision-seals.ts"));
const dir = process.argv[at + 1];
if (!dir) throw new Error("needs DIR");
const folder = join(dir, "checkpoints");
for (const name of readdirSync(folder).sort()) {
  if (!name.endsWith(".json")) continue;
  const { checkpoint: c } = JSON.parse(readFileSync(join(folder, name), "utf8")) as {
    checkpoint: {
      sequence: number;
      tick: number;
      digest: string;
      parent: string | null;
      stateHash: string;
      graphDigest: string;
    };
  };
  process.stdout.write(
    `${c.sequence} ${c.tick} ${c.digest} ${c.parent} ${c.stateHash} ${c.graphDigest}\n`,
  );
}
