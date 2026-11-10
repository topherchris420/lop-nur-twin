#!/usr/bin/env node
/**
 * What every page pays before it can show anything.
 *
 *   node tools/front-door.mjs [dist]
 *
 * `index.html` is served for every route, so the scripts it loads, and
 * everything they import statically, are downloaded and evaluated by `/analysis`
 * and `/compare` exactly as by the twin. Those two are the routes that work when
 * WebGL does not. If the WebGL renderer is in that set, the page that exists for
 * a machine without WebGL still fetches and compiles it, and that is how this
 * check came to be written: React had been bundled into the three.js chunk, and
 * every route paid 300 kB (compressed) for a renderer most of them never start.
 *
 * It reads the built files, follows static imports only (a dynamic `import()`
 * is the point at which a route chooses to pay), and fails when
 *
 * - a chunk in that set contains the WebGL renderer, or
 * - the set outgrows its ceiling. The ceiling is a tripwire with room in it, not
 *   a target: raise it on purpose, in the commit that needs it, and say why.
 *
 * It prints the set either way, so a growth that stays under the ceiling is
 * still seen. `bun run build` ends with it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { gzipSync } from "node:zlib";

/** Compressed bytes of script the front door may hold before this fails. */
const CEILING_GZIP_BYTES = 160_000;
/** three.js names its renderer in its own messages; no other code here does. */
const RENDERER = /THREE\.WebGLRenderer/;

const dist = process.argv[2] ?? "dist";
const page = join(dist, "index.html");
if (!existsSync(page)) {
  console.error(`front-door: ${page} is missing; build first`);
  process.exit(2);
}

const html = readFileSync(page, "utf8");
/** The module scripts and module preloads of the page, as paths under `dist`. */
const roots = [
  ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g),
  ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
].map((m) => m[1].replace(/^\//, ""));
if (roots.length === 0) {
  console.error(`front-door: ${page} loads no module script`);
  process.exit(2);
}

/**
 * The chunks `file` imports statically. In the bundler's output a static
 * import is `from"./x.js"` or `import"./x.js"`; a dynamic one has a parenthesis
 * and is left alone.
 */
function staticImports(file, source) {
  const found = new Set();
  for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*"(\.{1,2}\/[^"]+\.js)"/g))
    found.add(posix.normalize(posix.join(dirname(file), m[1])));
  return found;
}

const seen = new Map();
const queue = [...roots];
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  const path = join(dist, file);
  if (!existsSync(path)) {
    console.error(`front-door: ${file} is imported but was not built`);
    process.exit(1);
  }
  const source = readFileSync(path, "utf8");
  seen.set(file, {
    bytes: Buffer.byteLength(source),
    gzip: gzipSync(source).length,
    renderer: RENDERER.test(source),
  });
  queue.push(...staticImports(file, source));
}

const chunks = [...seen].sort(([, a], [, b]) => b.gzip - a.gzip);
const total = chunks.reduce((n, [, c]) => n + c.gzip, 0);
const raw = chunks.reduce((n, [, c]) => n + c.bytes, 0);
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

console.log(
  `front-door: every route loads ${chunks.length} scripts, ${kb(total)} compressed (${kb(raw)} to compile)`,
);
for (const [file, c] of chunks.slice(0, 8))
  console.log(
    `  ${kb(c.gzip).padStart(9)}  ${file}${c.renderer ? "  <- WebGL renderer" : ""}`,
  );
if (chunks.length > 8) console.log(`  ... and ${chunks.length - 8} smaller`);

const failures = [];
const withRenderer = chunks.filter(([, c]) => c.renderer).map(([file]) => file);
if (withRenderer.length > 0)
  failures.push(
    `the WebGL renderer is loaded by every route, through ${withRenderer.join(", ")}: /analysis and /compare must work, and stay light, without it. Something the entry imports statically now sits in the same chunk as three.js (see the chunk groups in vite.config.ts).`,
  );
if (total > CEILING_GZIP_BYTES)
  failures.push(
    `${kb(total)} compressed is over the ${kb(CEILING_GZIP_BYTES)} ceiling. Find what a route now imports statically that it could load when it is needed; raise CEILING_GZIP_BYTES only on purpose.`,
  );
for (const failure of failures) console.error(`front-door: FAILED: ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
