/**
 * Reading the committed records a claim rests on, and remembering which were read.
 *
 * A binding (`bindings.ts`) recomputes a sentence of the claims register from
 * the repository's own records. Everything it reads goes through this module,
 * so the check can say which files a number came from and name them by
 * SHA-256: a claim's evidence cannot move without the generated report moving
 * with it.
 *
 * Navigation is checked at run time. A record whose shape changed stops the
 * binding with the path that was missing, instead of yielding `undefined` and
 * a sentence that happens to print.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** The files read since the innermost `traced` began. */
let trace: Set<string> | null = null;
const cache = new Map<string, Buffer>();

function bytes(path: string): Buffer {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes(".."))
    throw new Error(`records are named by repository path, not "${path}"`);
  trace?.add(path);
  let found = cache.get(path);
  if (!found) {
    found = readFileSync(join(ROOT, path));
    cache.set(path, found);
  }
  return found;
}

/** Runs `fn` and returns its value with every record it read, sorted. */
export function traced<T>(fn: () => T): { value: T; files: string[] } {
  const outer = trace;
  const mine = new Set<string>();
  trace = mine;
  try {
    const value = fn();
    return { value, files: [...mine].sort() };
  } finally {
    trace = outer;
    if (outer) for (const f of mine) outer.add(f);
  }
}

export function readText(path: string): string {
  return bytes(path).toString("utf8");
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readText(path)) as unknown;
  } catch (cause) {
    throw new Error(`${path} is not JSON: ${String(cause)}`);
  }
}

/** One JSON value per non-empty line. */
export function readJsonl(path: string): unknown[] {
  return readText(path)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (cause) {
        throw new Error(`${path} line ${i + 1} is not JSON: ${String(cause)}`);
      }
    });
}

/** The files of `dir` whose names match, as repository paths, sorted. */
export function listFiles(dir: string, pattern: RegExp): string[] {
  const names = readdirSync(join(ROOT, dir))
    .filter((name) => pattern.test(name))
    .sort();
  if (names.length === 0) throw new Error(`no file in ${dir} matches ${String(pattern)}`);
  return names.map((name) => `${dir}/${name}`);
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(bytes(path)).digest("hex");
}

/** One digest for a set of records: SHA-256 over `path sha256` lines, sorted by path. */
export function evidenceDigest(files: readonly string[]): string {
  const lines = [...files].sort().map((f) => `${f} ${fileSha256(f)}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

type Step = string | number;

function steps(path: string | readonly Step[]): readonly Step[] {
  if (typeof path !== "string") return path;
  const out: Step[] = [];
  for (const part of path.split(".")) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) throw new Error(`cannot read the path "${path}"`);
    if (m[1] !== "") out.push(m[1]!);
    for (const index of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(index[1]));
  }
  return out;
}

/**
 * The value at `path` (`"a.b[0].c"`, or an array of keys and indexes for a key
 * that holds a dot). Throws when any step is missing.
 */
export function at(value: unknown, path: string | readonly Step[]): unknown {
  let here = value;
  const walked: Step[] = [];
  for (const step of steps(path)) {
    walked.push(step);
    const next: unknown =
      typeof step === "number"
        ? Array.isArray(here)
          ? (here as unknown[])[step]
          : undefined
        : here !== null && typeof here === "object" && !Array.isArray(here)
          ? (here as Record<string, unknown>)[step]
          : undefined;
    if (next === undefined)
      throw new Error(`the record has nothing at ${walked.join(".")}`);
    here = next;
  }
  return here;
}

/** A value for an error message: its JSON, cut short. */
function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? "nothing";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export function num(value: unknown, path: string | readonly Step[] = []): number {
  const v = at(value, path);
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error(`expected a finite number at ${String(path)}, found ${shown(v)}`);
  return v;
}

export function str(value: unknown, path: string | readonly Step[] = []): string {
  const v = at(value, path);
  if (typeof v !== "string")
    throw new Error(`expected a string at ${String(path)}, found ${shown(v)}`);
  return v;
}

export function list(value: unknown, path: string | readonly Step[] = []): unknown[] {
  const v = at(value, path);
  if (!Array.isArray(v)) throw new Error(`expected a list at ${String(path)}`);
  return v as unknown[];
}

export function keys(value: unknown, path: string | readonly Step[] = []): string[] {
  const v = at(value, path);
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new Error(`expected an object at ${String(path)}`);
  return Object.keys(v);
}

/**
 * The one item of `items` that `test` accepts. A binding names the cell it
 * means; none or several is a record that no longer says what the binding
 * assumed, and stops it.
 */
export function only<T>(
  items: readonly T[],
  test: (item: T) => boolean,
  what: string,
): T {
  const found = items.filter(test);
  if (found.length !== 1)
    throw new Error(`expected exactly one ${what}, found ${found.length}`);
  return found[0]!;
}
