/**
 * The exhibit page's promises that can be read from its source: it only ever
 * asks the garden for its state, it has a button for every camera and no
 * other, and nothing in the page needs the inline scripts or styles its
 * Content-Security-Policy forbids. What it looks like is checked in a browser
 * (`tools/garden.mjs check`).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GARDEN = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(path.join(GARDEN, rel), "utf8");
const sources = (dir: string): string[] =>
  readdirSync(path.join(GARDEN, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(path.join(dir, e.name))
      : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)
        ? [path.join(dir, e.name)]
        : [],
  );
const html = read("ui/index.html");

describe("the exhibit page", () => {
  it("asks the garden for one thing, its state, and never sends anything", () => {
    const code = sources(".").map((f) => [f, read(f)] as const);
    const calls = code.flatMap(([f, s]) =>
      [...s.matchAll(/\bfetch\(([^,)]*)/g)].map(
        (m) => `${f.replaceAll("\\", "/")}: ${m[1]}`,
      ),
    );
    // The state, and the fly's FlyBody mesh: a file of the release itself, bundled from the repository.
    expect(calls.sort()).toEqual([
      "scene/fly.ts: MESH_URL[lod]",
      "ui/main.ts: STATE_URL",
    ]);
    expect(read("ui/main.ts")).toMatch(/const STATE_URL = "\/api\/state";/);
    expect(read("scene/fly.ts")).toMatch(
      /0: new URL\("\.\.\/\.\.\/bethesda\/fly\/data\/flybody-lod0\.json", import\.meta\.url\)/,
    );
    for (const [f, s] of code) {
      expect(s, f).not.toMatch(
        /XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon/,
      );
      expect(s, f).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
      expect(s, f).not.toMatch(/["']\/api\/(?!state["'])/);
    }
  });

  it("has a button for every camera, in order, and no other", () => {
    // Read from the source: the camera module brings in Three.js, which these tests leave to the browser.
    const modes = /export const CAMERA_MODES = \[([^\]]+)\] as const;/.exec(
      read("scene/camera.ts"),
    )?.[1];
    const buttons = [
      ...html.matchAll(/<button type="button" data-camera="([a-z]+)"/g),
    ].map((m) => m[1]);
    const list = (s: string | undefined) =>
      s
        ?.split(",")
        .map((m) => m.trim().replaceAll('"', ""))
        .filter(Boolean);
    expect(buttons).toEqual(list(modes));
    const page = /const CAMERAS = \[([^\]]+)\] as const/.exec(read("ui/main.ts"))?.[1];
    expect(list(page)).toEqual(buttons);
  });

  it("needs no inline script, style or handler (the garden's CSP forbids them)", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i);
  });

  it("labels modelled, reported and established statements apart", () => {
    for (const tag of ["tag-modelled", "tag-reported", "tag-established"])
      expect(html).toContain(tag);
    expect(html).toMatch(
      /From real flies <span class="tag tag-established">Established<\/span>/,
    );
  });
});
