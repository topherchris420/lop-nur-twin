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
 * Fastino's key for Glide (`api/glide/decision.ts`) and the LLM key follow the
 * same rule, and so do the R.A.I.N. runtime's three: the TypeSafe key it may
 * use for Jev as a decision engine, the model server's bearer token
 * (`RAIN_LLM_API_KEY`) and the key that certifies pre-registrations
 * (`RAIN_REGISTRY_SECRET`), all read in `api/rain/_config.ts` and passed by
 * value.
 * `tools/jev-secret-scan.mjs` checks the built bundle as well; this catches
 * the mistake before a build.
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
  it("no browser module mentions a key or a VITE_ copy of one", () => {
    const offenders = browserFiles.filter((path) =>
      /TYPESAFE_API_KEY|VITE_TYPESAFE|import\.meta\.env\.TYPESAFE|FASTINO_API_KEY|VITE_FASTINO|import\.meta\.env\.FASTINO|LLM_API_KEY|VITE_LLM_|import\.meta\.env\.LLM_|RAIN_LLM_API_KEY|RAIN_REGISTRY_SECRET|VITE_RAIN_|import\.meta\.env\.RAIN_/.test(
        read(path),
      ),
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
    expect(readers).toEqual([
      "api/jev/decision.ts",
      "api/rain/_config.ts",
      "vite.config.ts",
    ]);
  });

  it("the Fastino key is read only by Glide's server-side entry points", () => {
    const readers = [...walk(join(ROOT, "server")), ...walk(join(ROOT, "api"))]
      .concat([join(ROOT, "vite.config.ts")])
      .filter((path) => !/\.test\.ts$/.test(path))
      .filter((path) =>
        /(?:process\.env|env)\[\s*["']FASTINO_API_KEY["']\s*\]|process\.env\.FASTINO_API_KEY/.test(
          read(path),
        ),
      )
      .map((path) => relative(ROOT, path))
      .sort();
    expect(readers).toEqual(["api/glide/decision.ts", "vite.config.ts"]);
  });

  it("the LLM key is read only by its server-side entry points", () => {
    const readers = [...walk(join(ROOT, "server")), ...walk(join(ROOT, "api"))]
      .concat([join(ROOT, "vite.config.ts")])
      .filter((path) => !/\.test\.ts$/.test(path))
      .filter((path) =>
        /(?:process\.env|env)\[\s*["']LLM_API_KEY["']\s*\]|process\.env\.LLM_API_KEY/.test(
          read(path),
        ),
      )
      .map((path) => relative(ROOT, path))
      .sort();
    expect(readers).toEqual(["api/llm/decision.ts", "vite.config.ts"]);
  });

  it("the model server's token is read only by the R.A.I.N. runtime's server-side entry points", () => {
    const readers = [...walk(join(ROOT, "server")), ...walk(join(ROOT, "api"))]
      .concat([join(ROOT, "vite.config.ts")])
      .filter((path) => !/\.test\.ts$/.test(path))
      .filter((path) =>
        /(?:process\.env|env)\[\s*["']RAIN_LLM_API_KEY["']\s*\]|process\.env\.RAIN_LLM_API_KEY/.test(
          read(path),
        ),
      )
      .map((path) => relative(ROOT, path))
      .sort();
    expect(readers).toEqual(["api/rain/_config.ts", "vite.config.ts"]);
  });
  it("the registry secret is read only by the R.A.I.N. runtime's server-side entry points", () => {
    const readers = [...walk(join(ROOT, "server")), ...walk(join(ROOT, "api"))]
      .concat([join(ROOT, "vite.config.ts")])
      .filter((path) => !/\.test\.ts$/.test(path))
      .filter((path) =>
        /(?:process\.env|env)\[\s*["']RAIN_REGISTRY_SECRET["']\s*\]|process\.env\.RAIN_REGISTRY_SECRET/.test(
          read(path),
        ),
      )
      .map((path) => relative(ROOT, path))
      .sort();
    expect(readers).toEqual(["api/rain/_config.ts", "vite.config.ts"]);
  });
  it("the runtime under src/rain names no credential and reads no environment itself", () => {
    const offenders = walk(join(ROOT, "src", "rain")).filter((path) =>
      /TYPESAFE_API_KEY|RAIN_LLM_API_KEY|RAIN_REGISTRY_SECRET|process\.env/.test(
        read(path),
      ),
    );
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it("the SDK that talks to a provider is imported only on the server", () => {
    const offenders = browserFiles.filter((path) =>
      /@anthropic-ai\/sdk/.test(read(path)),
    );
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it("the committed example environment file carries no value", () => {
    const example = read(join(ROOT, ".env.example"));
    const line = example.split("\n").find((l) => l.startsWith("TYPESAFE_API_KEY="));
    expect(line).toBe("TYPESAFE_API_KEY=");
    const llm = example.split("\n").find((l) => l.startsWith("LLM_API_KEY="));
    expect(llm).toBe("LLM_API_KEY=");
    const fastino = example.split("\n").find((l) => l.startsWith("FASTINO_API_KEY="));
    expect(fastino).toBe("FASTINO_API_KEY=");
    expect(example.split("\n").find((l) => l.startsWith("RAIN_LLM_API_KEY="))).toBe(
      "RAIN_LLM_API_KEY=",
    );
    expect(example.split("\n").find((l) => l.startsWith("RAIN_REGISTRY_SECRET="))).toBe(
      "RAIN_REGISTRY_SECRET=",
    );
  });
});
