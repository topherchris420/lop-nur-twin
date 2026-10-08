import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every file Vercel deploys as a function, against the functions `vercel.json`
 * declares. The project deploys on the Hobby plan, which refuses a deployment
 * with more than twelve functions — after the build has passed, so nothing
 * before this test notices. Underscore-prefixed files are shared modules and
 * are not deployed.
 */
const LIMIT = 12;
const root = new URL("../../", import.meta.url);
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8")) as {
  functions: Record<string, unknown>;
};
const deployed = (dir: string): string[] =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? deployed(`${dir}/${e.name}`)
      : /\.ts$/.test(e.name) && !e.name.startsWith("_") && !/\.test\.ts$/.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  );

describe("the deployment's functions", () => {
  const files = deployed("api").sort();
  it(`number at most ${LIMIT}, the Hobby plan's limit`, () => {
    expect(files.length).toBeLessThanOrEqual(LIMIT);
  });
  it("are exactly the functions vercel.json declares", () => {
    expect(Object.keys(vercel.functions).sort()).toEqual(files);
  });
});
