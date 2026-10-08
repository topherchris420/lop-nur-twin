/**
 * The release manifest's schema version, and the one rule for when two
 * manifests' hashes may be compared.
 *
 * `scripts/generate-manifest.ts` writes `manifestSchemaVersion`; `/compare`
 * (`manifestDiff.ts`) and the bookmark reproducibility check (`bookmarks.ts`)
 * read it. `manifestSchema.test.ts` fails when this constant and the latest
 * recorded manifest in `model-history/` disagree, so a schema bump cannot leave
 * the readers describing the previous one. The module is dependency-free so
 * the generator can import it too.
 *
 * History: 1.1.0 added `subjects`, `subjectDigestHash` and `temporal`; 1.2.0
 * narrowed the whole-model `geometryHash` to placement alone (evidence
 * attributes used to be in it), so the same model hashes differently either
 * side of it.
 */
export const MANIFEST_SCHEMA_VERSION = "1.2.0";

/**
 * Whether hashes written under two manifest schema versions mean the same
 * thing and may be compared.
 *
 * Deliberately strict: only the same version qualifies (two undeclared
 * versions are the same pre-versioning schema). A false "unchanged" or a false
 * "moved" is worse than "cannot be compared", so any schema difference —
 * including one that happened not to touch a given hash — is reported as
 * incomparable rather than guessed at.
 */
export function manifestHashesComparable(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left === right;
}
