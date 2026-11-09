/**
 * The bench's boundary, checked rather than described. It measures research
 * subjects only, so it may not reach a store, a checkpoint, the network, the VM
 * or a release; nothing the deployed life runs may import it; and its modules
 * draw no randomness and read no clock of their own, so a record depends on
 * its unit alone.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BENCH = "src/bethesda/metrology";
const slash = (p: string) => p.split("\\").join("/");

function files(dir: string, keep = /\.(ts|tsx|mjs|js)$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path, keep);
    return keep.test(name) && !/\.test\.tsx?$/.test(name) ? [slash(path)] : [];
  });
}

/** Every module specifier a source imports: `from "x"`, `import "x"` and `import("x")`. */
const IMPORT = /(?:\bfrom\s+|^\s*import\s+|\bimport\s*\(\s*)"([^"]+)"/gm;
const specifiers = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(IMPORT)].map((m) => m[1]!);

const modules = files(BENCH).filter((f) => !f.includes("/view/"));

/** What the bench's modules may import: themselves, the yard's fly and organisms, the study they extend. */
const ALLOWED: readonly RegExp[] = [
  /^\.\/[A-Za-z]+(\.js)?$/,
  /^\.\/protocols\/[a-z0-9-]+\.json$/,
  /^\.\.\/life\/(organism|plasticOrganism|individuality)(\.js)?$/,
  /^\.\.\/fly\/(fly|neural|perturbation)(\.js)?$/,
  /^\.\.\/fly\/echo\/adaptiveBrain(\.js)?$/,
  /^\.\.\/plasticity\/(study|analysis)(\.js)?$/,
  /^\.\.\/firstContact\/originals(\.js)?$/,
  /^\.\.\/simulation(\.js)?$/,
  /^\.\.\/\.\.\/lib\/noise(\.js)?$/,
  /^\.\.\/\.\.\/rain\/sha256(\.js)?$/,
];

describe("the metrology bench's boundary", () => {
  it("has modules to check", () => {
    expect(modules.length).toBeGreaterThanOrEqual(10);
  });

  it("imports only the research yard, never a store, a server, the network or a file", () => {
    const outside = modules.flatMap((f) =>
      specifiers(f)
        .filter((s) => !ALLOWED.some((a) => a.test(s)))
        .map((s) => `${f}: ${s}`),
    );
    expect(outside).toEqual([]);
    for (const f of modules)
      expect(readFileSync(f, "utf8"), f).not.toMatch(/LifeStore|bethesdaStore|fetch\(|WebSocket/);
  });

  it("draws no randomness and reads no clock: the runner is handed its clock", () => {
    for (const f of modules)
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /Math\.random|Date\.now|new Date\(|performance\.now|process\./,
      );
  });

  it("is imported only by its own command line and its research view", () => {
    const users = [
      ...files("src"),
      ...files("scripts"),
      ...files("server"),
      ...files("api"),
    ]
      .filter((p) => !p.startsWith(`${BENCH}/`))
      .filter((p) => specifiers(p).some((s) => /(^|\/)metrology\//.test(s)));
    expect(users.sort()).toEqual(["scripts/echo-metrology.ts"]);
  });

  it("keeps its synthetic records in tests: only a test imports the testkit", () => {
    const importers = [...files(BENCH, /\.tsx?$/), ...files("scripts", /\.tsx?$/)]
      .filter((p) => specifiers(p).some((s) => /testkit(\.js)?$/.test(s)))
      .filter((p) => !p.endsWith("/testkit.ts"));
    expect(importers).toEqual([]);
  });

  it("is named nowhere in what the VM deploys", () => {
    for (const p of files("deploy", /./))
      expect(readFileSync(p, "utf8"), p).not.toMatch(/metrology|eimb/i);
  });
});
