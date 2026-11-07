/**
 * The plasticity study runs research flies only. Nothing the deployed life runs
 * may import it, and it may not reach a store, a release or the VM.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const slash = (p: string) => p.split("\\").join("/");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [slash(path)] : [];
  });
}

const importsOf = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);

describe("the plasticity study's boundary", () => {
  it("is imported by nothing outside itself but its own script", () => {
    const users = [...files("src"), ...files("scripts"), ...files("server")]
      .filter((p) => !p.startsWith("src/bethesda/plasticity/"))
      .filter((p) =>
        importsOf(p).some((i) => /(^|\/)plasticity\/(study|analysis)(\.js)?$/.test(i)),
      );
    expect(users).toEqual(["scripts/echo-plasticity-evaluate.ts"]);
  });

  it("never opens a store, a release or the network", () => {
    for (const path of files("src/bethesda/plasticity")) {
      for (const i of importsOf(path))
        expect(i, path).not.toMatch(
          /store|bethesdaStore|node:(fs|net|http|https|child_process)/,
        );
      expect(readFileSync(path, "utf8"), path).not.toMatch(/LifeStore|fetch\(/);
    }
  });
});
