/**
 * The digital fly's source digest: the code that decides what a fly experiment
 * does, hashed, so every plan and record names the code that made it.
 *
 * Covered, each file LF-normalized before hashing:
 * - the fly's simulation, found by following relative imports from
 *   `src/bethesda/fly/fly.ts` and the experiment arena `arena.ts`, with the
 *   data and library modules they import (`src/lib/noise.ts`, the skeleton
 *   data, the state hash). The drawn fly (FlyView, FlyPanel, pose, meshCodec),
 *   the city's world (bethesdaWorld, cityFly) and the VFB reference stay out
 *   until the simulation imports them;
 * - the backend's rig and analysis, `src/rain/scientific/fly.ts`;
 * - the fly section of the contracts, from the "digital fly" banner of
 *   `src/bethesda/rain/scientificProtocol.ts` to the next banner.
 * Packages (simplex-noise) are pinned by the lockfile, not hashed here.
 *
 * `scripts/fly-source.ts` writes the digest into `flySource.ts`;
 * `scripts/validate-bethesda.ts` and the fly tests fail when it is stale.
 * Node only: it reads the working tree or a git commit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { sha256, sha256Json } from "../sha256.js";

/** The generated module, relative to the repository root. */
export const FLY_SOURCE_MODULE = "src/rain/scientific/flySource.ts";
const ENTRIES = ["src/bethesda/fly/fly.ts", "src/bethesda/fly/arena.ts"];
const WHOLE = ["src/rain/scientific/fly.ts"];
const SECTION = {
  path: "src/bethesda/rain/scientificProtocol.ts",
  banner:
    "// --------------------------------------------------------------- digital fly",
};

export interface FlySourceDigest {
  sha256: string;
  /** Repository path (a section as `path#digital-fly`) to the SHA-256 of its LF-normalized text. */
  files: Record<string, string>;
}
/** Reads a repository file as text, or null when it does not exist there. */
export type FlySourceReader = (path: string) => string | null;

const lf = (text: string) => text.replace(/\r\n?/g, "\n");
const IMPORT =
  /\bfrom\s*["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|\bimport\s+["'](\.{1,2}\/[^"']+)["']/g;

function resolveImport(from: string, specifier: string, read: FlySourceReader): string {
  const target = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = target.endsWith(".js")
    ? [target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx", target]
    : /\.[a-z]+$/.test(target)
      ? [target]
      : [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`];
  for (const c of candidates) if (read(c) !== null) return c;
  throw new Error(`${from} imports ${specifier}, which does not exist`);
}

/** The fly's source digest as `read` sees the repository. */
export function computeFlySource(read: FlySourceReader): FlySourceDigest {
  const texts = new Map<string, string>();
  const queue = [...ENTRIES];
  while (queue.length) {
    const path = queue.shift()!;
    if (texts.has(path)) continue;
    const text = read(path);
    if (text === null) throw new Error(`fly source ${path} does not exist`);
    texts.set(path, lf(text));
    if (!/\.tsx?$/.test(path)) continue;
    for (const m of text.matchAll(IMPORT))
      queue.push(resolveImport(path, (m[1] ?? m[2] ?? m[3])!, read));
  }
  for (const path of WHOLE) {
    const text = read(path);
    if (text === null) throw new Error(`fly source ${path} does not exist`);
    texts.set(path, lf(text));
  }
  const contracts = read(SECTION.path);
  const start = contracts === null ? -1 : lf(contracts).indexOf(SECTION.banner);
  if (contracts === null || start < 0)
    throw new Error(`${SECTION.path} has no digital fly section`);
  const rest = lf(contracts).slice(start);
  const next = rest.indexOf("\n// ----", SECTION.banner.length);
  texts.set(`${SECTION.path}#digital-fly`, next < 0 ? rest : rest.slice(0, next + 1));
  const files = Object.fromEntries(
    [...texts.keys()].sort().map((path) => [path, sha256(texts.get(path)!)]),
  );
  return { sha256: sha256Json(files), files };
}

export function workingTreeReader(root: string): FlySourceReader {
  return (path) => {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      return null;
    }
  };
}

/** Reads files as a commit holds them; every read is null when git or the commit is missing. */
export function commitReader(root: string, commit: string): FlySourceReader {
  if (!/^[0-9a-f]{40}$/.test(commit)) return () => null;
  return (path) => {
    try {
      return execFileSync("git", ["show", `${commit}:${path}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 20_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  };
}

/** Whether git at `root` holds `commit` (false when git or the commit is missing). */
export function commitExists(root: string, commit: string | null): boolean {
  if (commit === null || !/^[0-9a-f]{40}$/.test(commit)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: root,
      timeout: 20_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Files whose digest differs between two source digests (added and removed included). */
export function changedFlySources(a: FlySourceDigest, b: FlySourceDigest): string[] {
  return [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])]
    .filter((path) => a.files[path] !== b.files[path])
    .sort();
}

/**
 * Whether `commit` holds the code with source digest `expected`: the files the
 * digest names, read from that commit, must hash to it.
 */
export function flySourceAtCommitErrors(
  root: string,
  commit: string | null,
  expected: string,
): string[] {
  if (commit === null || !/^[0-9a-f]{40}$/.test(commit))
    return ["no full producing commit is recorded"];
  try {
    const at = computeFlySource(commitReader(root, commit));
    return at.sha256 === expected
      ? []
      : [
          `commit ${commit.slice(0, 12)} holds different fly code (source ${at.sha256.slice(0, 12)})`,
        ];
  } catch (e) {
    return [
      `commit ${commit.slice(0, 12)} does not hold the fly's code here: ${e instanceof Error ? e.message : String(e)}`,
    ];
  }
}

/** The generated module's text (formatted by the script that writes it). */
export function renderFlySourceModule(digest: FlySourceDigest): string {
  return `/**
 * Generated by \`node scripts/run-ts.mjs scripts/fly-source.ts\`: never edit by hand.
 *
 * The SHA-256 of every source file that decides what a digital-fly experiment
 * does, LF-normalized (flySourceDigest.ts says which). flyIdentity() binds it,
 * so a plan and its record name the code that made them. The build validator
 * and the fly tests fail while it is stale.
 */
export const FLY_SOURCE: {
  readonly sha256: string;
  readonly files: Readonly<Record<string, string>>;
} = ${JSON.stringify(digest, null, 2)};
`;
}
