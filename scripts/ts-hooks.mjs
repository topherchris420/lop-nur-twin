/**
 * TypeScript resolution for Node, shared by `run-ts.mjs` and any tool that
 * imports the repository's TypeScript in-process. Importing this module
 * registers the hooks once; under Bun it does nothing, because Bun resolves
 * `./layout`, `@/lib/layout` and `.ts` sources on its own.
 *
 * Node ≥ 22.18 strips types itself; these hooks add the two lines of
 * resolution it is missing: the `@/` alias, and extensionless or `.js`
 * specifiers that name a `.ts` source.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Bun resolves `./layout`, `@/lib/layout` and `.ts` sources on its own. */
const isBun = typeof process.versions.bun === "string";

if (!isBun) {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    console.error(
      `ts-hooks.mjs: Node ${process.versions.node} cannot execute TypeScript directly.\n` +
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
        // Modules shared with the Vercel function import each other as
        // `./x.js`, because native Node ESM on that platform needs the
        // extension. Here the source is still `./x.ts`.
        if (base.endsWith(".js") && existsSync(`${base.slice(0, -3)}.ts`)) {
          return {
            url: pathToFileURL(`${base.slice(0, -3)}.ts`).href,
            shortCircuit: true,
          };
        }
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
