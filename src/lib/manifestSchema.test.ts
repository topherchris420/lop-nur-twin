import { describe, expect, it } from "vitest";
import { parseModelHistory } from "./modelRevisions";
import { MANIFEST_SCHEMA_VERSION, manifestHashesComparable } from "./manifestSchema";
import historyFile from "../../model-history/index.json" with { type: "json" };

describe("manifest schema version", () => {
  it("is the version the generator wrote into the latest recorded manifest", () => {
    // The build refuses a model that is not its own latest recorded revision,
    // so the latest record's schema is the schema the generator writes today.
    const { revisions } = parseModelHistory(historyFile);
    const latest = [...revisions].sort((a, b) => b.revision - a.revision)[0];
    expect(latest?.manifestSchemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it("compares hashes only within one schema version", () => {
    expect(manifestHashesComparable("1.2.0", "1.2.0")).toBe(true);
    expect(manifestHashesComparable("1.1.0", "1.2.0")).toBe(false);
    expect(manifestHashesComparable(undefined, "1.2.0")).toBe(false);
  });
});
