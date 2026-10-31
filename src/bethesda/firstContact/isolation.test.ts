/**
 * The research code stays beside production, never inside it: nothing that
 * runs, serves or deploys either original imports the first-contact or
 * augmentation modules, and the fly's experiment digest does not cover them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeFlySource } from "../../rain/scientific/flySourceDigest";

const PRODUCTION = [
  "src/bethesda/life",
  "src/bethesda/fly",
  "src/bethesda/live",
  "src/garden",
  "src/routes",
  "src/components",
  "src/lib",
  "server",
  "api",
  "deploy",
];
const PRODUCTION_SCRIPTS = /^scripts\/(bethesda-life-|garden-)/;
const RESEARCH = /firstContact|bethesda\/augmentation|\.\.\/augmentation/;

function files(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|mjs|js|sh|service|py)$/.test(name)) out.push(p);
  }
  return out;
}

describe("first contact is isolated from production", () => {
  it("no production module imports it", () => {
    const offenders: string[] = [];
    const all = [
      ...PRODUCTION.flatMap(files),
      ...files("scripts").filter((f) => PRODUCTION_SCRIPTS.test(f.replaceAll("\\", "/"))),
    ];
    expect(all.length).toBeGreaterThan(50);
    for (const f of all) if (RESEARCH.test(readFileSync(f, "utf8"))) offenders.push(f);
    expect(offenders).toEqual([]);
  });

  it("the fly's experiment digest does not reach it", () => {
    const digest = computeFlySource((path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    });
    expect(Object.keys(digest.files).filter((f) => RESEARCH.test(f))).toEqual([]);
  });
});
