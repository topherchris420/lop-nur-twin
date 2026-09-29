#!/usr/bin/env node
/**
 * Run one of the repository's TypeScript build scripts under either runtime.
 *
 * The data validator and the manifest generator import the same modules the
 * application does, so they have to understand TypeScript and extensionless
 * imports. Bun does both natively. Node does neither by default — but since
 * v22.18 it strips types itself, and `module.registerHooks` supplies the two
 * lines of resolution it is missing. Wiring that up here means an evaluator
 * with only Node installed can still run `npm run validate:data`,
 * `npm run manifest` and `npm run build` and get identical output, which is a
 * precondition for anyone reproducing a release.
 *
 *   node scripts/run-ts.mjs scripts/validate-data.ts
 *   bun  scripts/run-ts.mjs scripts/validate-data.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.argv[2];
if (target === undefined) {
  console.error("usage: run-ts.mjs <script.ts> [args...]");
  process.exit(2);
}

const entry = path.resolve(process.cwd(), target);
if (!existsSync(entry)) {
  console.error(`run-ts.mjs: no such script: ${target}`);
  process.exit(2);
}

// The resolution hooks live in their own module so tools that import the
// evaluation library in-process (tools/experiment.mjs) resolve exactly as the
// build scripts do.
await import("./ts-hooks.mjs");

await import(pathToFileURL(entry).href);
