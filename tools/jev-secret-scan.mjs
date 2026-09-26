#!/usr/bin/env node
/**
 * Prove the browser build carries no TypeSafe credential.
 *
 * The Jev decision endpoint reads `TYPESAFE_API_KEY` on the server. Nothing in
 * `src/` may read it, and `src/game/pilot/secretBoundary.test.ts` checks the
 * source — but a secret leaks through the *build*: a `VITE_` copy inlined by
 * Vite, a `define`, a source map that quotes a config file. So this reads every
 * file under the output directory, source maps included, and fails on:
 *
 *  - the variable's name, `TYPESAFE_API_KEY` or `VITE_TYPESAFE…`;
 *  - anything shaped like a TypeSafe key (`apikey_` followed by a long token);
 *  - the actual key, when `TYPESAFE_API_KEY` is set in this environment — as it
 *    is on a Vercel build. The value is compared, never printed.
 *
 *   node tools/jev-secret-scan.mjs            # scans dist/
 *   node tools/jev-secret-scan.mjs path/to/output
 *
 * Runs as the last step of `bun run build`. Exits non-zero on any finding.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? "dist";
if (!existsSync(root)) {
  console.error(`jev-secret-scan: no such directory: ${root}`);
  process.exit(2);
}

const key = (process.env.TYPESAFE_API_KEY ?? "").trim();
const patterns = [
  {
    name: "credential variable name",
    test: (text) => /TYPESAFE_API_KEY|VITE_TYPESAFE/.test(text),
  },
  { name: "TypeSafe-shaped key", test: (text) => /apikey_[A-Za-z0-9_]{24,}/.test(text) },
];
if (key.length >= 12) {
  patterns.push({
    name: "the configured TYPESAFE_API_KEY value",
    test: (text) => text.includes(key),
  });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const findings = [];
let scanned = 0;
for (const path of walk(root)) {
  const text = readFileSync(path).toString("latin1");
  scanned += 1;
  for (const pattern of patterns) {
    if (pattern.test(text))
      findings.push(`${relative(process.cwd(), path)}: ${pattern.name}`);
  }
}

if (findings.length > 0) {
  console.error("jev-secret-scan: the build output contains credential material:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(
  `jev-secret-scan: ${scanned} files in ${root}/ clean` +
    (key.length >= 12 ? " (including the configured key's value)" : ""),
);
