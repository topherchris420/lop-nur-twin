import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { intelligenceExportPath } from "./intelligence-export-path.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-export-path-"));
  for (const name of ["journal", "public", "dist", "docs"]) mkdirSync(join(root, name));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("CPU evidence export destinations", () => {
  const path = (
    requested: string | undefined,
    kind: "publication" | "archive" = "archive",
  ) => intelligenceExportPath(root, join(root, "journal"), requested, kind);

  it("allows a new documentation archive and public summary without requiring both", () => {
    expect(path("docs/receipt")).toBe(join(root, "docs", "receipt"));
    expect(path("public/viewer", "publication")).toBe(join(root, "public", "viewer"));
    expect(path(undefined)).toBeUndefined();
  });

  it("rejects an existing directory or record instead of merging or replacing it", () => {
    writeFileSync(join(root, "docs", "old.json"), "preserved");
    expect(() => path("docs")).toThrow("new directory");
    expect(() => path("docs/old.json")).toThrow("new directory");
  });

  it("rejects raw archives in deployable static trees", () => {
    expect(() => path("public/receipt")).toThrow("static website");
    expect(() => path("dist/receipt")).toThrow("static website");
  });

  it("rejects repository escape and journal recursion before copying", () => {
    expect(() => path("..")).toThrow("inside");
    expect(() => path("../outside-receipt")).toThrow("inside");
    expect(() => path("journal/receipt")).toThrow("overlap");
  });
});
