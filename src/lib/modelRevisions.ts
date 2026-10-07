/**
 * The model history's vocabulary and its pure derivation, shared by the
 * browser (`modelHistory.ts`), the recorder and the build's validator. Nothing
 * here reads the committed file, so the recorder can run before it exists.
 * See `modelHistory.ts` for what the history is and what it can say.
 */

export const MODEL_HISTORY_SCHEMA = "lop-nur-model-history/v1";

export interface ModelRevision {
  /** 1-based, contiguous. */
  revision: number;
  /** The first-parent commit on `main` whose generator produced this manifest. */
  commit: string;
  /** That commit's committer date, UTC ISO 8601: when this content landed. */
  committedAt: string;
  /** The commit's subject line, verbatim. */
  title: string;
  /** Path of the manifest, relative to `model-history/`. */
  manifest: string;
  manifestSha256: string;
  manifestSchemaVersion: string;
  /** SHA-256 over the canonical manifest minus `generatedAt` and `modelVersion`. */
  contentKey: string;
  /** When this revision was added to the history file — real time, not the commit's. */
  recordedAt: string;
}

/** Which of a subject's digests moved. */
export type ChangeAspect =
  | "placement"
  | "placement-or-first-observed-date"
  | "evidence"
  | "wording"
  | "uncertainty";

export const CHANGE_ASPECT_LABELS: Record<ChangeAspect, string> = {
  placement: "placement",
  "placement-or-first-observed-date": "placement or first-observed date",
  evidence: "evidence",
  wording: "wording",
  uncertainty: "uncertainty",
};

export type SubjectHistoryEvent =
  /** Present in the first recorded revision: entered by then, earlier unknown. */
  | { revision: number; kind: "present-at-origin" }
  | { revision: number; kind: "added" }
  | { revision: number; kind: "removed" }
  | { revision: number; kind: "changed"; aspects: readonly ChangeAspect[] };

export interface ModelHistoryFile {
  schema: typeof MODEL_HISTORY_SCHEMA;
  /** Why the record starts where it does, in words. */
  origin: { commit: string; reason: string };
  /** How every revision was produced, in words. */
  method: string;
  revisions: readonly ModelRevision[];
  /** Derived from the manifests; the build recomputes it and fails on a mismatch. */
  subjects: Readonly<Record<string, readonly SubjectHistoryEvent[]>>;
}

/* ------------------------------------------------------------------ */
/* Derivation (pure; shared by the recorder, the validator and tests)  */
/* ------------------------------------------------------------------ */

/** The per-subject fields a manifest row carries that history reads. */
export interface SubjectDigestRow {
  id: string;
  observedDate?: string;
  geometryHash: string;
  evidenceHash: string;
  wordingHash: string;
  uncertaintyHash: string;
}

export function changeAspects(
  before: SubjectDigestRow,
  after: SubjectDigestRow,
): ChangeAspect[] {
  const aspects: ChangeAspect[] = [];
  if (before.geometryHash !== after.geometryHash) {
    // The placement digest covers the first-observed date as well; if that
    // date moved, the digest cannot say whether the subject moved too.
    aspects.push(
      before.observedDate === after.observedDate
        ? "placement"
        : "placement-or-first-observed-date",
    );
  }
  if (before.evidenceHash !== after.evidenceHash) aspects.push("evidence");
  if (before.wordingHash !== after.wordingHash) aspects.push("wording");
  if (before.uncertaintyHash !== after.uncertaintyHash) aspects.push("uncertainty");
  return aspects;
}

/**
 * Each subject's events across consecutive revisions. Deterministic: subjects
 * sorted by id, events in revision order.
 */
export function deriveSubjectHistory(
  revisions: readonly { revision: number; subjects: readonly SubjectDigestRow[] }[],
): Record<string, SubjectHistoryEvent[]> {
  const table = new Map<string, SubjectHistoryEvent[]>();
  const push = (id: string, event: SubjectHistoryEvent) => {
    const list = table.get(id);
    if (list === undefined) table.set(id, [event]);
    else list.push(event);
  };

  let previous: ReadonlyMap<string, SubjectDigestRow> | null = null;
  for (const { revision, subjects } of revisions) {
    const current = new Map(subjects.map((row) => [row.id, row] as const));
    if (previous === null) {
      for (const id of current.keys()) push(id, { revision, kind: "present-at-origin" });
    } else {
      for (const [id, row] of current) {
        const before = previous.get(id);
        if (before === undefined) {
          push(id, { revision, kind: "added" });
          continue;
        }
        const aspects = changeAspects(before, row);
        if (aspects.length > 0) push(id, { revision, kind: "changed", aspects });
      }
      for (const id of previous.keys()) {
        if (!current.has(id)) push(id, { revision, kind: "removed" });
      }
    }
    previous = current;
  }

  return Object.fromEntries(
    [...table.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* The committed history                                               */
/* ------------------------------------------------------------------ */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function isRevision(value: unknown, index: number): value is ModelRevision {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["revision"] === index + 1 &&
    typeof v["commit"] === "string" &&
    /^[0-9a-f]{40}$/.test(v["commit"]) &&
    typeof v["committedAt"] === "string" &&
    ISO_INSTANT.test(v["committedAt"]) &&
    typeof v["title"] === "string" &&
    typeof v["manifest"] === "string" &&
    /^manifests\/r\d+\.json$/.test(v["manifest"]) &&
    typeof v["manifestSha256"] === "string" &&
    DIGEST.test(v["manifestSha256"]) &&
    typeof v["manifestSchemaVersion"] === "string" &&
    typeof v["contentKey"] === "string" &&
    DIGEST.test(v["contentKey"]) &&
    typeof v["recordedAt"] === "string" &&
    ISO_INSTANT.test(v["recordedAt"])
  );
}

/**
 * Shape-checks the committed file. The build verifies it in depth — every
 * manifest's bytes, the derived table, the current model against the latest
 * revision — so this only guards the types the interface relies on.
 */
export function parseModelHistory(value: unknown): ModelHistoryFile {
  if (typeof value !== "object" || value === null) {
    throw new Error("model history: not an object");
  }
  const v = value as Record<string, unknown>;
  if (v["schema"] !== MODEL_HISTORY_SCHEMA) {
    throw new Error(`model history: expected schema ${MODEL_HISTORY_SCHEMA}`);
  }
  const revisions = v["revisions"];
  if (!Array.isArray(revisions) || revisions.length === 0) {
    throw new Error("model history: no revisions");
  }
  revisions.forEach((revision, index) => {
    if (!isRevision(revision, index)) {
      throw new Error(`model history: revision ${index + 1} is malformed`);
    }
  });
  const subjects = v["subjects"];
  if (typeof subjects !== "object" || subjects === null || Array.isArray(subjects)) {
    throw new Error("model history: subjects table missing");
  }
  const origin = v["origin"] as { commit?: unknown; reason?: unknown } | undefined;
  if (typeof origin?.commit !== "string" || typeof origin.reason !== "string") {
    throw new Error("model history: origin missing");
  }
  if (typeof v["method"] !== "string") throw new Error("model history: method missing");
  return value as ModelHistoryFile;
}
