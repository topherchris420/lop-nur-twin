import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  corpusFingerprint,
  discoverCorpus,
  hashCorpusDocuments,
  isCorpusPath,
} from "./corpus.js";
import corpus from "./data/corpus.json" with { type: "json" };
import perspectives from "./data/perspectives.json" with { type: "json" };
import source from "./data/source.json" with { type: "json" };
import { PERSPECTIVES, type Perspective, SOUL_FILES } from "./meeting/perspectives.js";
import { soulText } from "./meeting/souls.js";

/**
 * The bundled R.A.I.N. evidence corpus and SOUL files: every byte is named by
 * the import manifest, and the corpus fingerprint is the one the DEMO
 * recording was made against.
 */
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

describe("bundled R.A.I.N. source data", () => {
  it("names its origin and license", () => {
    expect(source.schema).toBe("rain-source/v1");
    expect(source.repository).toBe("topherchris420/james_library");
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.license).toBe("MIT");
    expect(Number.isNaN(Date.parse(source.importedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(source.commitDate))).toBe(false);
    // LICENSE.md reproduces the source repository's MIT license inside a fence; the
    // manifest names that text by hash.
    const notice = readFileSync(join(__dirname, "data", "LICENSE.md"), "utf8");
    const fenced = /```\n([\s\S]*?)```/.exec(notice)?.[1] ?? "";
    expect(sha(fenced)).toBe(source.licenseSha256);
    expect(notice).toContain(source.commit);
    expect(fenced).toContain(source.attribution);
    expect(corpus.license).toBe("MIT");
    expect(perspectives.license).toBe("MIT");
  });

  it("hashes every corpus file to its manifest entry; the fingerprint is the DEMO's", () => {
    expect(corpus.schema).toBe("rain-corpus/v1");
    expect(corpus.files).toHaveLength(source.corpus.files);
    for (const file of corpus.files) {
      expect(sha(file.text), file.path).toBe(file.sha256);
      expect(Buffer.byteLength(file.text, "utf8"), file.path).toBe(file.bytes);
      expect(isCorpusPath(file.path), file.path).toBe(true);
    }
    const docs = corpus.files.map((f) => ({ path: f.path, text: f.text }));
    expect(discoverCorpus(docs)).toHaveLength(docs.length);
    expect(docs.map((d) => d.path)).toEqual([...docs.map((d) => d.path)].sort());
    expect(corpusFingerprint(hashCorpusDocuments(docs))).toBe(
      source.corpus.fingerprintSha256,
    );
  });

  it("carries the four SOUL files, hashed and attributed", () => {
    expect(perspectives.schema).toBe("rain-perspectives/v1");
    expect(perspectives.souls.map((s) => s.name)).toEqual([...PERSPECTIVES]);
    for (const soul of perspectives.souls) {
      const name = soul.name as Perspective;
      expect(sha(soul.text), soul.file).toBe(soul.sha256);
      expect(Buffer.byteLength(soul.text, "utf8")).toBe(soul.bytes);
      expect(soul.file).toBe(SOUL_FILES[name]);
      expect(soulText(name)).toBe(soul.text);
    }
    expect(source.perspectives.files.map((f) => [f.name, f.file, f.sha256])).toEqual(
      perspectives.souls.map((s) => [s.name, s.file, s.sha256]),
    );
  });
});
