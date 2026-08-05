import { describe, expect, it } from "vitest";
import {
  MAX_MANIFEST_BYTES,
  diffManifests,
  diffToCsv,
  diffToMarkdown,
  parseManifest,
  type ComparableManifest,
  type ManifestSubjectDigest,
} from "./manifestDiff";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

function subject(overrides: Partial<ManifestSubjectDigest> = {}): ManifestSubjectDigest {
  return {
    id: "hangar-main",
    kind: "structure",
    evidenceClass: "interpreted",
    confidence: 0.55,
    sourceIds: ["sentinel-2-scene-2025"],
    geometryHash: HASH_A,
    evidenceHash: HASH_A,
    wordingHash: HASH_A,
    uncertaintyHash: HASH_A,
    ...overrides,
  };
}

function manifest(overrides: Partial<ComparableManifest> = {}): ComparableManifest {
  return {
    modelName: "Lop Nur Geospatial Simulation Testbed",
    modelVersion: "0.1.0",
    manifestSchemaVersion: "1.1.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    geometryHash: HASH_A,
    evidenceLedgerHash: HASH_A,
    validationStatus: "passed",
    knownLimitations: ["This is a public-source reconstruction."],
    subjects: [subject()],
    ...overrides,
  };
}

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = parseManifest(JSON.stringify(manifest()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.geometryHash).toBe(HASH_A);
    expect(result.manifest.subjects?.length).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("refuses an oversized file before parsing it", () => {
    const result = parseManifest("x".repeat(MAX_MANIFEST_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/over the .* limit/);
  });

  it("refuses malformed JSON without throwing", () => {
    const result = parseManifest("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("File is not valid JSON.");
  });

  it("refuses a JSON value that is not an object", () => {
    for (const text of ["[]", '"a string"', "42", "null"]) {
      const result = parseManifest(text);
      expect(result.ok).toBe(false);
    }
  });

  it("names every missing required field", () => {
    const result = parseManifest(JSON.stringify({ modelName: "x" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("geometryHash");
    expect(result.error).toContain("evidenceLedgerHash");
    expect(result.error).toContain("validationStatus");
  });

  it("refuses an incompatible schema major version", () => {
    const result = parseManifest(
      JSON.stringify(manifest({ manifestSchemaVersion: "2.0.0" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/incompatible with this build/);
  });

  it("warns rather than refusing on a minor version difference", () => {
    const result = parseManifest(
      JSON.stringify(manifest({ manifestSchemaVersion: "1.0.0" })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/1\.0\.0 differs/);
  });

  it("refuses a schema version that is not a version number", () => {
    const result = parseManifest(
      JSON.stringify(manifest({ manifestSchemaVersion: "latest" })),
    );
    expect(result.ok).toBe(false);
  });

  it("warns when a manifest carries no per-subject digests", () => {
    const withoutSubjects = manifest();
    delete (withoutSubjects as { subjects?: unknown }).subjects;
    const result = parseManifest(JSON.stringify(withoutSubjects));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/no per-subject digests/);
  });

  it("drops subject rows that are missing their identifying fields", () => {
    const result = parseManifest(
      JSON.stringify(
        manifest({
          subjects: [
            subject(),
            { id: "broken" } as ManifestSubjectDigest,
            "not an object" as unknown as ManifestSubjectDigest,
          ],
        }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.subjects?.length).toBe(1);
  });

  it("sorts subjects itself rather than trusting the file's order", () => {
    const result = parseManifest(
      JSON.stringify(
        manifest({
          subjects: [subject({ id: "zulu" }), subject({ id: "alpha" })],
        }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.subjects?.map((entry) => entry.id)).toEqual(["alpha", "zulu"]);
  });

  it("ignores a non-string entry in knownLimitations", () => {
    const result = parseManifest(
      JSON.stringify(
        manifest({ knownLimitations: ["real", 42, null] as unknown as string[] }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.knownLimitations).toEqual(["real"]);
  });
});

describe("diffManifests", () => {
  it("reports an empty diff for identical manifests", () => {
    const diff = diffManifests(manifest(), manifest());
    expect(diff.empty).toBe(true);
    expect(diff.differences).toEqual([]);
    expect(diff.categoriesTouched).toEqual([]);
  });

  it("classes a moved subject as an analytical-model change", () => {
    const diff = diffManifests(
      manifest(),
      manifest({
        geometryHash: HASH_B,
        subjects: [subject({ geometryHash: HASH_B })],
      }),
    );
    expect(diff.categoriesTouched).toContain("analytical-model");
    expect(diff.categoriesTouched).not.toContain("documentation");
  });

  it("classes a reworded description as documentation only", () => {
    const diff = diffManifests(
      manifest(),
      manifest({ subjects: [subject({ wordingHash: HASH_B })] }),
    );
    // The whole point of the per-subject digests: this must not read as an
    // analytical or evidence change.
    expect(diff.categoriesTouched).toEqual(["documentation"]);
    expect(diff.differences).toHaveLength(1);
    expect(diff.differences[0]?.field).toBe("wordingHash");
  });

  it("classes a revised classification as an evidence change", () => {
    const diff = diffManifests(
      manifest(),
      manifest({
        subjects: [subject({ evidenceClass: "reported", evidenceHash: HASH_B })],
      }),
    );
    expect(diff.categoriesTouched).toEqual(["evidence"]);
  });

  it("classes a changed envelope as an uncertainty change", () => {
    const diff = diffManifests(
      manifest(),
      manifest({ subjects: [subject({ uncertaintyHash: HASH_B })] }),
    );
    expect(diff.categoriesTouched).toEqual(["uncertainty"]);
  });

  it("reports added and removed subjects", () => {
    const diff = diffManifests(
      manifest({ subjects: [subject({ id: "gone" })] }),
      manifest({ subjects: [subject({ id: "new" })] }),
    );
    expect(diff.addedSubjectIds).toEqual(["new"]);
    expect(diff.removedSubjectIds).toEqual(["gone"]);
  });

  it("reports added and removed known limitations individually", () => {
    const diff = diffManifests(
      manifest({ knownLimitations: ["one", "two"] }),
      manifest({ knownLimitations: ["two", "three"] }),
    );
    const fields = diff.differences.map((difference) => difference.field);
    expect(fields).toContain("knownLimitations (added)");
    expect(fields).toContain("knownLimitations (removed)");
  });

  it("says so when one side carries no per-subject digests", () => {
    const withoutSubjects = manifest();
    delete (withoutSubjects as { subjects?: unknown }).subjects;
    const diff = diffManifests(withoutSubjects, manifest());
    expect(diff.subjectComparisonAvailable).toBe(false);
    expect(diff.notCovered[0]).toMatch(/Per-subject changes/);
  });

  it("always states what the manifest cannot see", () => {
    const diff = diffManifests(manifest(), manifest());
    // An empty diff means the manifests agree, not that the builds are the
    // same. Saying so is not optional.
    expect(diff.notCovered.join(" ")).toMatch(/[Ss]hader/);
    expect(diff.notCovered.join(" ")).toMatch(/Blacksite/);
  });

  it("is deterministic and ordered", () => {
    const before = manifest({
      subjects: [subject({ id: "zulu" }), subject({ id: "alpha" })],
    });
    const after = manifest({
      subjects: [
        subject({ id: "alpha", geometryHash: HASH_B }),
        subject({ id: "zulu", geometryHash: HASH_C }),
      ],
    });
    const first = diffManifests(before, after);
    const second = diffManifests(before, after);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const subjectRows = first.differences
      .filter((difference) => difference.subjectId !== "model")
      .map((difference) => difference.subjectId);
    expect(subjectRows).toEqual([...subjectRows].sort());
  });
});

describe("exports", () => {
  it("quotes CSV fields so a comma in a value is safe", () => {
    const diff = diffManifests(
      manifest({ knownLimitations: ["a, b, c"] }),
      manifest({ knownLimitations: ['a "quoted" thing'] }),
    );
    const csv = diffToCsv(diff);
    expect(csv.split("\n")[0]).toBe("category,subject,field,before,after");
    expect(csv).toContain('"a, b, c"');
    expect(csv).toContain('""quoted""');
  });

  it("escapes pipes so a Markdown table survives a value containing one", () => {
    const diff = diffManifests(
      manifest({ knownLimitations: ["before | after"] }),
      manifest({ knownLimitations: ["plain"] }),
    );
    const markdown = diffToMarkdown(diff, manifest(), manifest());
    expect(markdown).toContain("before \\| after");
  });

  it("states an empty diff in words rather than emitting an empty table", () => {
    const markdown = diffToMarkdown(
      diffManifests(manifest(), manifest()),
      manifest(),
      manifest(),
    );
    expect(markdown).toContain("No differences.");
    expect(markdown).toContain("## Not covered by this comparison");
  });
});
