/**
 * Builds the live garden's exhibit page (src/garden/ui) as one release
 * directory, ready to sit beside the previous ones on the garden's VM:
 *
 *   dist-garden/<release>/index.html        the page (installed as the site's index)
 *   dist-garden/<release>/assets/…          hashed scripts, styles and FlyBody meshes
 *   dist-garden/<release>/flybody-LICENSE.txt
 *   dist-garden/<release>/manifest.json     sha256 of every file, for the deploy check
 *
 * A release is named by the day it was built and a digest of its files, so a
 * new one never overwrites an old one, and the same sources built on the same
 * day get the same name. Large text assets get a `.gz` twin that nginx can
 * serve with `gzip_static on` (an optional server change; without it they are
 * ignored).
 *
 *   node scripts/run-ts.mjs scripts/garden-build.ts
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "dist-garden");
const PLACEHOLDER = "__GARDEN_RELEASE__";
const staging = path.join(OUT, `.staging-${process.pid}`);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const rel = (p: string, base: string) => path.relative(base, p).split(path.sep).join("/");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

rmSync(staging, { recursive: true, force: true });
await build({
  configFile: false,
  root: path.join(ROOT, "src/garden/ui"),
  base: `/${PLACEHOLDER}/`,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: staging,
    emptyOutDir: true,
    // Nothing inline: the garden's CSP allows only same-origin scripts, styles and requests.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    target: "es2022",
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200,
  },
});
copyFileSync(
  path.join(ROOT, "src/bethesda/fly/data/LICENSE.md"),
  path.join(staging, "flybody-LICENSE.txt"),
);

// Name the release by its content, then write that name where the placeholder base stands.
const built = files(staging).sort();
const digest = createHash("sha256");
for (const f of built) digest.update(rel(f, staging)).update(readFileSync(f));
const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const release = `garden-${day}-${digest.digest("hex").slice(0, 12)}`;
for (const f of built) {
  if (!/\.(html|js|css)$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  if (text.includes(PLACEHOLDER)) writeFileSync(f, text.replaceAll(PLACEHOLDER, release));
}
const html = readFileSync(path.join(staging, "index.html"), "utf8");
if (/<script(?![^>]*\bsrc=)[^>]*>|\sstyle=|\son[a-z]+=/i.test(html))
  throw new Error(
    "index.html has inline script, style or handlers; the CSP forbids them",
  );

const manifest: Record<string, string> = {};
for (const f of files(staging).sort()) {
  const r = rel(f, staging);
  const bytes = readFileSync(f);
  manifest[r] = sha256(bytes);
  if (/\.(js|css|json|html|txt)$/.test(f) && bytes.length > 1400)
    writeFileSync(`${f}.gz`, gzipSync(bytes, { level: 9 }));
}
let source = "unknown";
try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "src/garden",
      "src/bethesda/fly",
      "scripts/garden-build.ts",
    ],
    { encoding: "utf8" },
  ).trim();
  source = dirty ? `${head} with uncommitted changes` : head;
} catch {
  // Not a git checkout: the manifest says so.
}
writeFileSync(
  path.join(staging, "manifest.json"),
  `${JSON.stringify({ release, source, built: new Date().toISOString(), sha256: manifest }, null, 2)}\n`,
);

const final = path.join(OUT, release);
rmSync(final, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
// Windows can hold a just-written file open for a moment (indexers, antivirus): copy if a rename is refused.
try {
  renameSync(staging, final);
} catch {
  cpSync(staging, final, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
}
const total = Object.keys(manifest).reduce(
  (n, r) => n + statSync(path.join(final, r)).size,
  0,
);
console.log(
  `garden release ${release}: ${Object.keys(manifest).length} files, ${(total / 1024).toFixed(0)} KiB`,
);
console.log(path.relative(ROOT, final));
