/**
 * Writes the digital fly's source digest into src/rain/scientific/flySource.ts.
 *
 *   node scripts/run-ts.mjs scripts/fly-source.ts           regenerate it
 *   node scripts/run-ts.mjs scripts/fly-source.ts --check   exit 1 if it is stale
 *
 * Run it after any change to the files flySourceDigest.ts covers (the fly's
 * simulation, the arena, the backend's rig and the fly contracts). The digest
 * is part of the fly's identity, so a record made before the change is listed
 * as made by other code instead of failing re-simulation. A change to the
 * fly's behaviour or parameters also bumps FLY_VERSION (AGENTS.md).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import {
  changedFlySources,
  computeFlySource,
  FLY_SOURCE_MODULE,
  renderFlySourceModule,
  workingTreeReader,
} from "../src/rain/scientific/flySourceDigest.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";

const root = process.cwd();
const digest = computeFlySource(workingTreeReader(root));
const count = Object.keys(digest.files).length;
if (process.argv.includes("--check")) {
  if (digest.sha256 !== FLY_SOURCE.sha256) {
    console.error(
      `[fly-source] stale: ${changedFlySources(FLY_SOURCE, digest).join(", ")} changed; run node scripts/run-ts.mjs scripts/fly-source.ts`,
    );
    process.exit(1);
  }
  console.log(`[fly-source] current: ${digest.sha256} over ${count} files`);
} else {
  const path = join(root, FLY_SOURCE_MODULE);
  const text = await format(renderFlySourceModule(digest), {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  const before = readFileSync(path, "utf8");
  if (before !== text) writeFileSync(path, text);
  console.log(
    `[fly-source] ${before === text ? "unchanged" : "wrote"} ${FLY_SOURCE_MODULE}: ${digest.sha256} over ${count} files`,
  );
}
