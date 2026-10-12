/** Reads the built Noeterra module from disk. Server-side only; nothing is fetched. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NoeterraEngine } from "./noeterraEngine.js";

export const NOETERRA_WASM =
  "noeterra/target/wasm32-unknown-unknown/release/noeterra.wasm";

/** The engine, or null with the reason when the module has not been built. */
export function loadNoeterraEngine(
  root: string,
): { engine: NoeterraEngine; path: string } | { engine: null; reason: string } {
  const path = join(root, NOETERRA_WASM);
  if (!existsSync(path))
    return {
      engine: null,
      reason: `the Noeterra engine is not built (${NOETERRA_WASM}); run npm run noeterra:wasm`,
    };
  return { engine: NoeterraEngine.fromBytes(new Uint8Array(readFileSync(path))), path };
}
