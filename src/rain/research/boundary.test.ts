import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
describe("native research program boundary", () => {
  it("has no executable code, subprocess, filesystem writer, arbitrary network client or simulator mutation", () => {
    for (const file of readdirSync(__dirname).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const s = readFileSync(join(__dirname, file), "utf8");
      expect(s, file).not.toMatch(
        /child_process|\beval\(|new Function\(|\bfetch\(|\b(writeFileSync|mkdirSync|appendFileSync|unlinkSync)\b|new CitySimulation|\.(inject|step|accept|movePlayer)\(/,
      );
      expect(s, file).not.toMatch(/process\.env|lib\/(evidence|layout|siteData)/);
    }
  });
});
