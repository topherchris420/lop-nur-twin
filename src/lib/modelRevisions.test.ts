import { describe, expect, it } from "vitest";
import {
  changeAspects,
  deriveSubjectHistory,
  parseModelHistory,
  type SubjectDigestRow,
} from "./modelRevisions";

const row = (
  id: string,
  overrides: Partial<SubjectDigestRow> = {},
): SubjectDigestRow => ({
  id,
  observedDate: "2025-09-28",
  geometryHash: "g",
  evidenceHash: "e",
  wordingHash: "w",
  uncertaintyHash: "u",
  ...overrides,
});

describe("changeAspects", () => {
  it("names each digest that moved, and nothing else", () => {
    expect(changeAspects(row("a"), row("a"))).toEqual([]);
    expect(
      changeAspects(row("a"), row("a", { evidenceHash: "e2", wordingHash: "w2" })),
    ).toEqual(["evidence", "wording"]);
  });

  it("never calls a re-dating a move", () => {
    // The placement digest covers the first-observed date, so when the date
    // moved too the digest cannot say whether the subject did.
    expect(changeAspects(row("a"), row("a", { geometryHash: "g2" }))).toEqual([
      "placement",
    ]);
    expect(
      changeAspects(
        row("a"),
        row("a", { geometryHash: "g2", observedDate: "2025-11-04" }),
      ),
    ).toEqual(["placement-or-first-observed-date"]);
  });
});

describe("deriveSubjectHistory", () => {
  it("records presence at the origin, additions, changes and removals in revision order", () => {
    const table = deriveSubjectHistory([
      { revision: 1, subjects: [row("a"), row("b")] },
      { revision: 2, subjects: [row("a", { wordingHash: "w2" }), row("b"), row("c")] },
      { revision: 3, subjects: [row("a", { wordingHash: "w2" }), row("c")] },
    ]);
    expect(table).toEqual({
      a: [
        { revision: 1, kind: "present-at-origin" },
        { revision: 2, kind: "changed", aspects: ["wording"] },
      ],
      b: [
        { revision: 1, kind: "present-at-origin" },
        { revision: 3, kind: "removed" },
      ],
      c: [{ revision: 2, kind: "added" }],
    });
  });

  it("is deterministic and ordered by subject id", () => {
    const input = [{ revision: 1, subjects: [row("z"), row("a"), row("m")] }];
    expect(Object.keys(deriveSubjectHistory(input))).toEqual(["a", "m", "z"]);
    expect(JSON.stringify(deriveSubjectHistory(input))).toBe(
      JSON.stringify(deriveSubjectHistory(input)),
    );
  });
});

describe("parseModelHistory", () => {
  const revision = {
    revision: 1,
    commit: "0".repeat(40),
    committedAt: "2026-08-06T01:27:03Z",
    title: "t",
    manifest: "manifests/r1.json",
    manifestSha256: `sha256:${"a".repeat(64)}`,
    manifestSchemaVersion: "1.1.0",
    contentKey: `sha256:${"b".repeat(64)}`,
    recordedAt: "2026-10-07T07:44:00Z",
  };
  const file = {
    schema: "lop-nur-model-history/v1",
    origin: { commit: "0".repeat(40), reason: "r" },
    method: "m",
    revisions: [revision],
    subjects: {},
  };

  it("accepts a well-formed file", () => {
    expect(parseModelHistory(file).revisions).toHaveLength(1);
  });

  it("refuses a gap in the numbering, a short commit, a typed-in date and another schema", () => {
    expect(() =>
      parseModelHistory({ ...file, revisions: [{ ...revision, revision: 2 }] }),
    ).toThrow();
    expect(() =>
      parseModelHistory({ ...file, revisions: [{ ...revision, commit: "088c729" }] }),
    ).toThrow();
    expect(() =>
      parseModelHistory({
        ...file,
        revisions: [{ ...revision, committedAt: "6 Aug 2026" }],
      }),
    ).toThrow();
    expect(() => parseModelHistory({ ...file, schema: "other/v1" })).toThrow();
    expect(() => parseModelHistory({ ...file, revisions: [] })).toThrow();
  });
});
