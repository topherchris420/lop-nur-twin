/**
 * Every committed bench archive, re-verified on every CI run: files against
 * the manifest, the archived protocol against the frozen one in src/, the
 * held-out seeds re-derived, the summary recomputed from the raw records and
 * the report re-rendered, byte for byte. A committed verification.json must
 * name the current manifest; it records the re-simulation, which only the
 * platform that made the records can do (CI cannot).
 *
 * A failing or inconclusive experiment still verifies: this checks that the
 * record is honest, not that the result is good.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "../../rain/sha256.js";
import { EVIDENCE_FILES, manifestDigest, type Manifest } from "./archive.js";
import { parseProtocol, type Split } from "./protocol.js";
import { verifyStatic, type Verification } from "./verify.js";

const ROOT = "docs/benchmarks/echo-metrology";
const dirs = (d: string) =>
  existsSync(d) ? readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()) : [];

const archives: { protocol: string; split: Split; folder: string }[] = [];
for (const protocol of dirs(ROOT))
  for (const split of ["dev", "heldout"] as const) {
    const folder = join(ROOT, protocol, split);
    if (existsSync(join(folder, "manifest.json")))
      archives.push({ protocol, split, folder });
  }

const read = (folder: string) =>
  Object.fromEntries(
    [...EVIDENCE_FILES, "manifest.json"].map((n) => {
      const p = join(folder, n);
      return [n, existsSync(p) ? readFileSync(p, "utf8") : undefined];
    }),
  );

describe("the committed bench archives", () => {
  it("exist", () => {
    expect(archives.map((a) => `${a.protocol}/${a.split}`)).toContain(
      "plasticity-locomotor-v1/dev",
    );
  });

  for (const a of archives)
    describe(`${a.protocol}/${a.split}`, () => {
      const files = read(a.folder);
      const frozen = parseProtocol(
        JSON.parse(
          readFileSync(`src/bethesda/metrology/protocols/${a.protocol}.json`, "utf8"),
        ),
      );

      it("pass every static check", { timeout: 120_000 }, () => {
        const v = verifyStatic(frozen, a.split, files);
        expect(v.checks.filter((c) => !c.passed)).toEqual([]);
      });

      it("carry a verification of this very manifest, re-simulated where the records were made", () => {
        const path = join(a.folder, "verification.json");
        expect(existsSync(path), `${path} missing`).toBe(true);
        const v = JSON.parse(readFileSync(path, "utf8")) as Verification;
        const m = JSON.parse(files["manifest.json"]!) as Manifest;
        expect(v.manifestDigest).toBe(manifestDigest(m));
        expect(v.status).toBe("VERIFIED");
        expect(v.replay.status).toBe("matched");
        expect(v.replay.units.length).toBeGreaterThanOrEqual(10);
      });
    });

  it("include each adapter report as its manifest says", () => {
    for (const name of dirs(ROOT).filter((n) => n.startsWith("reproduction-"))) {
      const folder = join(ROOT, name);
      const m = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
        files: Record<string, string>;
      };
      for (const [file, digest] of Object.entries(m.files))
        expect(sha256(readFileSync(join(folder, file), "utf8")), `${name}/${file}`).toBe(
          digest,
        );
    }
  });
});
