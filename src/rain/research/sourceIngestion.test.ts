import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSourceVersion, admitSourceVersion } from "./sourceIngestion.js";
import { ResearchStore } from "../autonomy/store.js";
import { sha256 } from "../sha256.js";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-source-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const metadata = {
  collection: "fixture-poetry",
  version: 1,
  previous_sha256: null,
  title: "Test fixture, not a founder work",
  creator: "Fixture author",
  category: "poetry" as const,
};
describe("opt-in source versions", () => {
  it("binds exact document bytes and excerpt, preserves revisions and requires explicit approval", () => {
    const store = new ResearchStore(root);
    const first = prepareSourceVersion("Rhythm and silence. More text.", metadata, 0, 19);
    expect(first.manifest.document_sha256).toBe(sha256("Rhythm and silence. More text."));
    expect(() => admitSourceVersion(store, first, "wrong", "Test.Operator")).toThrow(
      "approval",
    );
    expect(store.discoveryEntries()).toEqual([]);
    admitSourceVersion(store, first, first.manifest_sha256, "Test.Operator");
    expect(() =>
      admitSourceVersion(store, first, first.manifest_sha256, "Test.Operator"),
    ).toThrow("current version");
    const second = prepareSourceVersion("Revised rhythm.", {
      ...metadata,
      version: 2,
      previous_sha256: first.manifest_sha256,
    });
    admitSourceVersion(store, second, second.manifest_sha256, "Test.Operator");
    const entries = new ResearchStore(root).discoveryEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.payload).toMatchObject({ manifest: first.manifest });
    expect(second.source.id).not.toBe(first.source.id);
    expect(second.source.reading_scope).toContain("not independently verified");
  });
  it("rejects substituted content, invalid ranges, stale parents, controls and concurrent ingestion", () => {
    const store = new ResearchStore(root),
      first = prepareSourceVersion("Fixture text", metadata);
    expect(() => prepareSourceVersion("x", metadata, 0, 2)).toThrow();
    expect(() => prepareSourceVersion("\u0000", metadata)).toThrow();
    expect(() => prepareSourceVersion("x".repeat(1048577), metadata)).toThrow();
    expect(() =>
      admitSourceVersion(
        store,
        { ...first, source: { ...first.source, excerpt: "different" } },
        first.manifest_sha256,
        "Test.Operator",
      ),
    ).toThrow();
    expect(() =>
      admitSourceVersion(
        store,
        { ...first, source: { ...first.source, authors: ["Invented author"] } },
        first.manifest_sha256,
        "Test.Operator",
      ),
    ).toThrow();
    const release = store.acquireLock("active-study");
    expect(() =>
      admitSourceVersion(store, first, first.manifest_sha256, "Test.Operator"),
    ).toThrow("locked");
    release();
    const invalid = prepareSourceVersion("Fixture text", { ...metadata, version: 2 });
    expect(() =>
      admitSourceVersion(store, invalid, invalid.manifest_sha256, "Test.Operator"),
    ).toThrow("current version");
  });
});
