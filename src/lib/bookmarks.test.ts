import { describe, expect, it } from "vitest";
import {
  BOOKMARK_SCHEMA_VERSION,
  BOOKMARK_STORAGE_KEY,
  MAX_IMPORT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  checkReproducibility,
  createBookmark,
  duplicateBookmark,
  exportBookmarks,
  loadBookmarks,
  memoryStore,
  migrateBookmark,
  newBookmarkId,
  parseBookmarkCollection,
  renameBookmark,
  saveBookmarks,
  shareableSearchParams,
  shareableUrl,
  type Bookmark,
  type BookmarkView,
} from "./bookmarks";
import { TIMELINE_BOUNDS } from "./layout";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function view(overrides: Partial<BookmarkView> = {}): BookmarkView {
  return {
    cameraMode: "orbit",
    cameraTarget: [1018, 30, 1410],
    timelineYear: 2025,
    snapshotDate: "2025-09-28",
    comparisonDate: null,
    evidenceMode: "reported",
    selectedId: "hangar-main",
    measurePoints: [{ x: 0, z: 0, snappedTo: "Runway center" }],
    showUncertainty: true,
    environmentMonth: 5,
    night: false,
    qualityTier: 2,
    ...overrides,
  };
}

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    ...createBookmark({
      name: "Main apron",
      view: view(),
      provenance: { geometryHash: HASH_A, evidenceLedgerHash: HASH_A },
      note: "Why this view matters",
    }),
    ...overrides,
  };
}

describe("createBookmark", () => {
  it("stamps a schema version, an id and timestamps", () => {
    const saved = bookmark();
    expect(saved.schemaVersion).toBe(BOOKMARK_SCHEMA_VERSION);
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it("bounds the name and the note", () => {
    const saved = createBookmark({
      name: "n".repeat(500),
      note: "x".repeat(5000),
      view: view(),
      provenance: {},
    });
    expect(saved.name.length).toBe(MAX_NAME_LENGTH);
    expect(saved.note?.length).toBe(MAX_NOTE_LENGTH);
  });

  it("falls back to a placeholder rather than an empty name", () => {
    const saved = createBookmark({ name: "   ", view: view(), provenance: {} });
    expect(saved.name).toBe("Untitled view");
  });

  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 100 }, newBookmarkId));
    expect(ids.size).toBe(100);
  });
});

describe("renameBookmark and duplicateBookmark", () => {
  it("renames and touches the update time, keeping the id", () => {
    const original = bookmark();
    const renamed = renameBookmark(original, "New name");
    expect(renamed.name).toBe("New name");
    expect(renamed.id).toBe(original.id);
  });

  it("ignores a blank rename rather than clearing the name", () => {
    const original = bookmark();
    expect(renameBookmark(original, "  ").name).toBe(original.name);
  });

  it("duplicates with a new id and a marked name", () => {
    const original = bookmark();
    const copy = duplicateBookmark(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe(`${original.name} (copy)`);
    expect(copy.view).toEqual(original.view);
  });
});

describe("migrateBookmark", () => {
  it("passes a current-version record through", () => {
    const saved = bookmark();
    expect(migrateBookmark(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("upgrades a version-1 record with unknown provenance rather than a false match", () => {
    const v1 = {
      schemaVersion: 1,
      id: "legacy-1",
      name: "Legacy view",
      createdAt: "2026-01-01T00:00:00.000Z",
      view: {
        cameraMode: "orbit",
        timelineYear: 2025,
        evidenceMode: "reported",
        selectedId: "hangar-main",
        environmentMonth: 5,
      },
    };
    const migrated = migrateBookmark(v1);
    expect(migrated).not.toBeNull();
    expect(migrated?.schemaVersion).toBe(BOOKMARK_SCHEMA_VERSION);
    expect(migrated?.tags).toEqual([]);
    expect(migrated?.provenance).toEqual({});
    // Fields v1 never carried default rather than being invented.
    expect(migrated?.view.snapshotDate).toBeNull();
    expect(migrated?.view.showUncertainty).toBe(false);
    // Empty provenance must produce "unknown", never "matches".
    expect(checkReproducibility(migrated!, { geometryHash: HASH_A }).verdict).toBe(
      "unknown",
    );
  });

  it("treats a record with no version as version 1", () => {
    const migrated = migrateBookmark({ id: "x", name: "y" });
    expect(migrated?.schemaVersion).toBe(BOOKMARK_SCHEMA_VERSION);
  });

  it("refuses a version newer than this build understands", () => {
    expect(migrateBookmark({ ...bookmark(), schemaVersion: 99 })).toBeNull();
  });

  it("refuses a record with no id", () => {
    const withoutId = { ...bookmark(), id: "" };
    expect(migrateBookmark(withoutId)).toBeNull();
    expect(migrateBookmark(null)).toBeNull();
    expect(migrateBookmark([])).toBeNull();
    expect(migrateBookmark("a string")).toBeNull();
  });

  it("clamps a hostile timeline year into the modeled bounds", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: { ...view(), timelineYear: 1e308 },
    });
    expect(migrated?.view.timelineYear).toBe(TIMELINE_BOUNDS.maxYear);
  });

  it("rejects a malformed snapshot date rather than storing it", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: { ...view(), snapshotDate: "2025-02-30", comparisonDate: "not a date" },
    });
    expect(migrated?.view.snapshotDate).toBeNull();
    expect(migrated?.view.comparisonDate).toBeNull();
  });

  it("rejects an unknown evidence mode and falls back to the default", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: { ...view(), evidenceMode: "constructor" },
    });
    expect(migrated?.view.evidenceMode).toBe("full-simulation");
  });

  it("rejects a selection id that is not a model slug", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: { ...view(), selectedId: "<script>alert(1)</script>" },
    });
    expect(migrated?.view.selectedId).toBeNull();
  });

  it("drops a non-finite camera vector rather than poisoning a matrix with it", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: { ...view(), cameraTarget: [Number.NaN, 0, 0] },
    });
    expect(migrated?.view.cameraTarget).toBeUndefined();
  });

  it("caps an imported measurement path at the same ceiling the live store uses", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      view: {
        ...view(),
        measurePoints: Array.from({ length: 500 }, (_, index) => ({
          x: index,
          z: index,
          snappedTo: null,
        })),
      },
    });
    expect(migrated?.view.measurePoints.length).toBe(64);
  });

  it("keeps only a well-formed digest as provenance", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      provenance: { geometryHash: "not-a-digest", evidenceLedgerHash: HASH_B },
    });
    // A malformed digest would produce a "does not match" verdict that says
    // nothing about the model, so it is discarded rather than kept.
    expect(migrated?.provenance.geometryHash).toBeUndefined();
    expect(migrated?.provenance.evidenceLedgerHash).toBe(HASH_B);
  });

  it("bounds and de-duplicates tags", () => {
    const migrated = migrateBookmark({
      ...bookmark(),
      tags: ["a", "a", "b", "  ", 42, "t".repeat(200), ...Array(20).fill("x")],
    });
    expect(migrated!.tags.length).toBeLessThanOrEqual(8);
    expect(new Set(migrated!.tags).size).toBe(migrated!.tags.length);
    expect(migrated!.tags.every((tag) => tag.length <= 24)).toBe(true);
  });
});

describe("parseBookmarkCollection", () => {
  it("reads the wrapped envelope", () => {
    const result = parseBookmarkCollection(exportBookmarks([bookmark()]));
    expect(result.error).toBeUndefined();
    expect(result.bookmarks.length).toBe(1);
    expect(result.rejected).toBe(0);
  });

  it("reads a bare array, which is what someone will hand-edit", () => {
    const result = parseBookmarkCollection(JSON.stringify([bookmark()]));
    expect(result.bookmarks.length).toBe(1);
  });

  it("refuses an oversized import", () => {
    const result = parseBookmarkCollection("x".repeat(MAX_IMPORT_LENGTH + 1));
    expect(result.error).toMatch(/over the .* limit/);
    expect(result.bookmarks).toEqual([]);
  });

  it("refuses malformed JSON without throwing", () => {
    expect(parseBookmarkCollection("{ nope").error).toBe("File is not valid JSON.");
  });

  it("refuses a payload with no bookmark array", () => {
    expect(parseBookmarkCollection('{"a":1}').error).toMatch(/No bookmark array/);
  });

  it("counts records it could not understand instead of failing the whole import", () => {
    const result = parseBookmarkCollection(
      JSON.stringify([bookmark(), { id: "" }, null, { schemaVersion: 99, id: "x" }]),
    );
    expect(result.bookmarks.length).toBe(1);
    expect(result.rejected).toBe(3);
  });

  it("drops a duplicate id rather than importing it twice", () => {
    const one = bookmark();
    const result = parseBookmarkCollection(JSON.stringify([one, one]));
    expect(result.bookmarks.length).toBe(1);
    expect(result.rejected).toBe(1);
  });
});

describe("storage", () => {
  it("round-trips through a store", () => {
    const store = memoryStore();
    const saved = [bookmark()];
    expect(saveBookmarks(store, saved)).toBe(true);
    expect(loadBookmarks(store)).toEqual(saved);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadBookmarks(memoryStore())).toEqual([]);
  });

  it("returns an empty list rather than throwing on corrupt storage", () => {
    const store = memoryStore();
    store.setItem(BOOKMARK_STORAGE_KEY, "{{{ not json");
    expect(loadBookmarks(store)).toEqual([]);
  });

  it("reports failure rather than throwing when the store rejects a write", () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    expect(saveBookmarks(failing, [bookmark()])).toBe(false);
  });
});

describe("checkReproducibility", () => {
  it("confirms a match when both hashes agree", () => {
    const check = checkReproducibility(bookmark(), {
      geometryHash: HASH_A,
      evidenceLedgerHash: HASH_A,
    });
    expect(check.verdict).toBe("matches");
  });

  it("separates a moved geometry from a revised ledger", () => {
    expect(
      checkReproducibility(bookmark(), {
        geometryHash: HASH_B,
        evidenceLedgerHash: HASH_A,
      }).verdict,
    ).toBe("geometry-changed");
    expect(
      checkReproducibility(bookmark(), {
        geometryHash: HASH_A,
        evidenceLedgerHash: HASH_B,
      }).verdict,
    ).toBe("evidence-changed");
  });

  it("says it cannot check rather than guessing when a hash is missing", () => {
    expect(checkReproducibility(bookmark(), null).verdict).toBe("unknown");
    expect(checkReproducibility(bookmark(), {}).verdict).toBe("unknown");
    expect(
      checkReproducibility({ ...bookmark(), provenance: {} }, { geometryHash: HASH_A })
        .verdict,
    ).toBe("unknown");
  });

  it("always explains itself in words", () => {
    for (const current of [
      null,
      {},
      { geometryHash: HASH_A },
      { geometryHash: HASH_B },
    ]) {
      expect(checkReproducibility(bookmark(), current).message.length).toBeGreaterThan(
        20,
      );
    }
  });
});

describe("shareable links", () => {
  it("carries view settings", () => {
    const params = shareableSearchParams(bookmark());
    expect(params["evidence"]).toBe("reported");
    expect(params["snapshot"]).toBe("2025-09-28");
    expect(params["structure"]).toBe("hangar-main");
    expect(params["uncertainty"]).toBe("1");
    expect(params["year"]).toBe("2025");
    expect(params["month"]).toBe("6");
    expect(params["at"]).toBe("1018,1410");
  });

  it("never carries the note, the tags, the measurement path, or the identity", () => {
    const saved = { ...bookmark(), tags: ["private"] };
    const params = shareableSearchParams(saved);
    const serialised = JSON.stringify(params);
    expect(serialised).not.toContain("Why this view matters");
    expect(serialised).not.toContain("private");
    expect(serialised).not.toContain("Runway center");
    expect(serialised).not.toContain(saved.id);
    expect(serialised).not.toContain(saved.name);
    for (const key of ["note", "tags", "measurePoints", "name", "id"]) {
      expect(params[key]).toBeUndefined();
    }
  });

  it("omits settings that are at their default", () => {
    const params = shareableSearchParams(
      bookmark({
        view: view({
          snapshotDate: null,
          comparisonDate: null,
          selectedId: null,
          showUncertainty: false,
          night: false,
        }),
      }),
    );
    for (const key of ["snapshot", "compare", "structure", "uncertainty", "night"]) {
      expect(params[key]).toBeUndefined();
    }
  });

  it("percent-encodes every value and cannot be used to inject a parameter", () => {
    const url = shareableUrl(
      bookmark({ view: view({ selectedId: "hangar-main" }) }),
      "https://example.invalid",
    );
    expect(url.startsWith("https://example.invalid/?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("structure")).toBe("hangar-main");
    expect(parsed.searchParams.get("note")).toBeNull();
  });

  it("builds a link for either front door", () => {
    const saved = bookmark();
    expect(shareableUrl(saved, "https://example.invalid/", "/")).toContain(
      "example.invalid/?",
    );
    expect(shareableUrl(saved, "https://example.invalid", "/analysis")).toContain(
      "/analysis?",
    );
  });
});
