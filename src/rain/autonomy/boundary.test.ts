/**
 * The autonomous researcher's boundary, checked on the source tree.
 *
 * A local model gets a research loop, not a computer: the code that runs the
 * loop must give it no shell, no filesystem beyond the research directory, no
 * network beyond the model server, and no path to the Lop Nur evidence ledger,
 * the source register, the model history or the city.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname);
const sources = readdirSync(dir).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "fixtures.ts",
);
const read = (f: string) => readFileSync(join(dir, f), "utf8");

describe("the autonomous researcher's boundary", () => {
  it("never reaches the evidence ledger, the site model, its sources or its history", () => {
    for (const f of sources)
      expect(read(f), f).not.toMatch(
        /lib\/(evidence|evidenceValidation|layout|siteData|temporal|modelHistory|measure|sources)\b|scripts\/|model-history/,
      );
  });
  it("starts no process, evaluates no text, and imports no shell", () => {
    for (const f of sources)
      expect(read(f), f).not.toMatch(
        /child_process|\beval\(|new Function\(|(?<!\.)\b(exec|execFile|execSync|execFileSync|spawn)\(|import\(\s*[^"'`]/,
      );
  });
  it("writes files only through the research store, and fetches only in the model adapters", () => {
    const writes =
      /\b(writeFileSync|appendFileSync|renameSync|mkdirSync|rmSync|unlinkSync|cpSync)\b/;
    expect(sources.filter((f) => writes.test(read(f)))).toEqual(["store.ts"]);
    expect(sources.filter((f) => /\bfetch\(/.test(read(f)))).toEqual(["models.ts"]);
  });
  it("never mutates a simulator: experiments run only through the lab's runner", () => {
    for (const f of sources)
      expect(read(f), f).not.toMatch(
        /\.(inject|accept|humanAction|movePlayer|setFocus|step)\(|new CitySimulation|simulation\.js"/,
      );
  });
  it("is reachable from no browser module", () => {
    const lab = join(dir, "..", "..", "bethesda");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(d, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [join(d, e.name)]
            : [],
      );
    const offenders = walk(lab).filter((f) =>
      /rain\/autonomy\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
