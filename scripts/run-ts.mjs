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
import { fileURLToPath, pathToFileURL } from "node:url";

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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Bun resolves `./layout`, `@/lib/layout` and `.ts` sources on its own. */
const isBun = typeof process.versions.bun === "string";

if (!isBun) {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(
      `run-ts.mjs: Node ${process.versions.node} cannot execute TypeScript directly.\n` +
        "Use Node 22.18 or newer, or install Bun (https://bun.sh).",
    );
    process.exit(2);
  }

  const { registerHooks } = await import("node:module");
  const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".mjs"];

  registerHooks({
    resolve(specifier, context, nextResolve) {
      let base = null;
      if (specifier.startsWith("@/")) {
        base = path.join(projectRoot, "src", specifier.slice(2));
      } else if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const parent = context.parentURL?.startsWith("file:")
          ? path.dirname(fileURLToPath(context.parentURL))
          : projectRoot;
        base = path.resolve(parent, specifier);
      }
      if (base !== null && !existsSync(base)) {
        for (const suffix of CANDIDATE_SUFFIXES) {
          if (existsSync(base + suffix)) {
            return { url: pathToFileURL(base + suffix).href, shortCircuit: true };
          }
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

await import(pathToFileURL(entry).href);
