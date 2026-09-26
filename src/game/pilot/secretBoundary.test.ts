import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The credential boundary, checked on the source tree.
 *
 * The TypeSafe key is read in exactly two places — the Vercel function and the
 * Vite middleware, both server-side — and passed to `server/jev/handler.ts`.
 * Browser code must not read it, must not ask for a `VITE_`-prefixed copy
 * (Vite would inline that into the bundle), and must not import server code.
 * `tools/jev-secret-scan.mjs` checks the built bundle as well; this catches the
 * mistake before a build.
 */

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const browserFiles = walk(join(ROOT, "src")).filter(
  (path) => !/\.test\.tsx?$/.test(path),
);
const read = (path: string): string => readFileSync(path, "utf8");

describe("credential boundary", () => {
  it("no browser module mentions the key or a VITE_ copy of it", () => {
    const offenders = browserFiles.filter((path) =>
      /TYPESAFE_API_KEY|VITE_TYPESAFE|import\.meta\.env\.TYPESAFE/.test(read(path)),
    );
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it("no browser module reads server environment variables", () => {
    const offenders = browserFiles.filter((path) => /process\.env/.test(read(path)));
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it("no browser module imports server code", () => {
    const offenders = browserFiles.filter((path) =>
      /from\s+["'][^"']*\/server\//.test(read(path)),
    );
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it("the key is read only by the server-side entry points", () => {
    const readers = [...walk(join(ROOT, "server")), ...walk(join(ROOT, "api"))]
      .concat([join(ROOT, "vite.config.ts")])
      .filter((path) => !/\.test\.ts$/.test(path))
      // A read, not a mention: the handler names the variable in its 503.
      .filter((path) =>
        /(?:process\.env|env)\[\s*["']TYPESAFE_API_KEY["']\s*\]|process\.env\.TYPESAFE_API_KEY/.test(
          read(path),
        ),
      )
      .map((path) => relative(ROOT, path))
      .sort();
    expect(readers).toEqual(["api/jev/decision.ts", "vite.config.ts"]);
  });

  it("the committed example environment file carries no value", () => {
    const example = read(join(ROOT, ".env.example"));
    const line = example.split("\n").find((l) => l.startsWith("TYPESAFE_API_KEY="));
    expect(line).toBe("TYPESAFE_API_KEY=");
  });
});
