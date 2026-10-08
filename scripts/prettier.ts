/**
 * Prettier for the import and export scripts, run the same way on every
 * platform.
 *
 * `node_modules/.bin/prettier` is a shell script on Unix and only exists as
 * `prettier.cmd` on Windows, which `execFileSync` cannot start without a
 * shell. Running the package's own CLI entry with the current runtime (Node,
 * or Bun under `bun`) needs neither a shell nor a platform branch, and formats
 * exactly as `npx prettier` does: same version, same config, same ignores.
 */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRETTIER_CLI = join(REPO, "node_modules", "prettier", "bin", "prettier.cjs");

/**
 * The text Prettier would write to `path`, computed without touching the
 * file, so a caller can format every output before it writes any of them.
 */
export function formatAs(path: string, text: string): string {
  return execFileSync(process.execPath, [PRETTIER_CLI, "--stdin-filepath", path], {
    input: text,
    encoding: "utf8",
    maxBuffer: 1 << 29,
  });
}

/** Formats a file in place. */
export function formatFile(path: string): void {
  execFileSync(process.execPath, [PRETTIER_CLI, "--write", path], { stdio: "ignore" });
}
