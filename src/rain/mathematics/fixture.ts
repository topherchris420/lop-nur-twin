/**
 * The substrate's test fixture as a source tree: a miniature `openai/math`
 * checkout (`fixtures/openai-math-fixture.json`) — four families copied
 * verbatim from the pinned commit, and synthetic entries, marked as such, that
 * exist to be refused or flagged. For tests and nothing else; no network, no
 * disk beyond the import.
 */
import fixture from "./fixtures/openai-math-fixture.json" with { type: "json" };
import { buildIndex, type SourceTree } from "./indexer.js";
import type { SubstrateIndex } from "./substrateIndex.js";

const files = fixture.files as Record<string, string | null>;

/** A file maps to its text, or to null when it exists and its bytes are never read. */
export function fixtureTree(
  overrides: Record<string, string | null | undefined> = {},
): SourceTree {
  const all: Record<string, string | null | undefined> = { ...files, ...overrides };
  return {
    read: (path) => {
      const v = Object.prototype.hasOwnProperty.call(all, path) ? all[path] : undefined;
      return typeof v === "string" ? v : null;
    },
    exists: (path) =>
      Object.prototype.hasOwnProperty.call(all, path) && all[path] !== undefined,
  };
}
export const FIXTURE_COMMIT = fixture.excerpted_from.commit;
export const FIXTURE_COMMIT_DATE = fixture.excerpted_from.commit_date;
/** Families copied verbatim from the pinned commit. */
export const REAL_FAMILIES = ["003", "017", "195", "223"] as const;

export function fixtureIndex(
  input: {
    commit?: string;
    generatedAt?: string;
    overrides?: Record<string, string | null | undefined>;
  } = {},
): SubstrateIndex {
  return buildIndex({
    tree: fixtureTree(input.overrides),
    commit: input.commit ?? FIXTURE_COMMIT,
    commitDate: FIXTURE_COMMIT_DATE,
    generatedAt: input.generatedAt ?? "2026-10-08T00:00:00.000Z",
    generator: "fixture",
  });
}
/** The fixture's raw file text, for tests that rearrange it. */
export const fixtureFile = (path: string) => files[path] ?? null;
