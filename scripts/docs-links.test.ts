/**
 * Every relative link in the repository's Markdown resolves: the file exists,
 * and a `#fragment` into a Markdown file names one of its headings as GitHub
 * renders them. The documentation is how a researcher finds a record and a
 * maintainer finds a procedure, so a link that rots is a broken path to
 * evidence. External links are not fetched.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** Not documentation of this repository, or not ours to keep. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-garden",
  "shots",
  "coverage",
  "experiments",
  "target",
  "worktrees",
  ".rain-research",
  ".fly-neural",
  ".fly-physics",
]);
/**
 * Kept byte for byte as written elsewhere: its links point where they did
 * there, and its folder's README gives their targets here.
 */
const PRESERVED = new Set(["docs/research/echo-immortal/archive-v1/verification.md"]);

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) markdownFiles(join(dir, e.name), out);
    } else if (e.isFile() && e.name.endsWith(".md")) out.push(join(dir, e.name));
  }
  return out;
}

/** GitHub's heading anchor: rendered text, lowercased, punctuation dropped, spaces to hyphens. */
function headingSlug(heading: string): string {
  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

const withoutFences = (text: string) => text.replace(/```[\s\S]*?```/g, "");

const anchorCache = new Map<string, Set<string>>();
function anchors(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const seen = new Map<string, number>();
  const found = new Set<string>();
  const text = readFileSync(path, "utf8");
  for (const line of withoutFences(text).split("\n")) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const slug = headingSlug(m[1]!);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    found.add(n === 0 ? slug : `${slug}-${n}`);
  }
  for (const m of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) found.add(m[1]!);
  anchorCache.set(path, found);
  return found;
}

function brokenLinks(file: string): string[] {
  const text = withoutFences(readFileSync(file, "utf8"));
  const links = [
    ...[...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]!),
    ...[...text.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!),
  ];
  const broken: string[] = [];
  for (const link of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const [target = "", fragment] = link.split("#", 2);
    const path = target ? normalize(join(dirname(file), decodeURI(target))) : file;
    if (!existsSync(path)) broken.push(`${link} (no such file)`);
    else if (fragment && path.endsWith(".md") && !anchors(path).has(fragment))
      broken.push(`${link} (no such heading)`);
  }
  return broken;
}

describe("documentation links", () => {
  it("computes anchors the way GitHub renders them", () => {
    expect(headingSlug("Individual continuity (`src/bethesda/life/`)")).toBe(
      "individual-continuity-srcbethesdalife",
    );
    expect(headingSlug("7. Memory, workspace and second look (ECHO-03–05)")).toBe(
      "7-memory-workspace-and-second-look-echo-0305",
    );
    expect(headingSlug("Rehearsal on the deployed individual's backup")).toBe(
      "rehearsal-on-the-deployed-individuals-backup",
    );
  });

  it("all resolve, to a file and to a heading", () => {
    const broken = markdownFiles(ROOT)
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .filter((file) => !PRESERVED.has(file))
      .flatMap((file) => brokenLinks(file).map((b) => `${file}: ${b}`));
    expect(broken).toEqual([]);
  });
});
