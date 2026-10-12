#!/usr/bin/env node
/**
 * Copies the Noeterra engine (built by `npm run noeterra:wasm`) into public/,
 * where /noeterra loads it. The module is a build product and is never
 * committed. Without it the build still succeeds and /noeterra says the engine
 * is not part of this build.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const from = "noeterra/target/wasm32-unknown-unknown/release/noeterra.wasm";
const to = "public/noeterra/noeterra.wasm";
if (existsSync(from)) {
  mkdirSync("public/noeterra", { recursive: true });
  copyFileSync(from, to);
  console.log(`noeterra: ${from} -> ${to}`);
} else {
  // A copy left from an earlier build would otherwise ship an engine built from
  // whatever source was last compiled here.
  rmSync(to, { force: true });
  console.log(
    "noeterra: engine not built (npm run noeterra:wasm); /noeterra will report it unavailable",
  );
}
