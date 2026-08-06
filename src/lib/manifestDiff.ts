/**
 * Comparing two release manifests.
 *
 * The manifest already answered "is the copy I am looking at the copy that was
 * reviewed?". This answers the follow-up: *what changed, and is it the kind of
 * change I need to re-review?*
 *
 * The distinction that makes the answer useful is that the per-subject digests
 * separate four questions the manifest used to collapse into one moving hash —
 * did the geometry move, did the evidence change, did only the prose change,
 * and did what we admit not knowing change. A build that reworded a description
 * and a build that moved a hangar 40 m are not the same event, and before this
 * they were both "the evidence ledger hash is different".
 *
 * Everything here is pure and deterministic: the same pair of manifests always
 * produces the same diff, in the same order, so a diff can be pasted into a
 * review and reproduced.
 *
 * **Untrusted input.** One side of a comparison is a file a user chose. It is
 * parsed and validated here — shape, size, schema version — and nothing is read
 * off it before it passes. Nothing is fetched: comparison is between the
 * manifest this build serves and a file the user supplies, which keeps the
 * offline guarantee and means a hostile URL is not a thing this route can be
 * pointed at.
 */

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export interface ManifestSubjectDigest {
  id: string;
  kind: string;
  evidenceClass: string;
  confidence?: number;
  observedDate?: string;
  sourceIds: readonly string[];
  geometryHash: string;
  evidenceHash: string;
  wordingHash: string;
  uncertaintyHash: string;
}

export interface ManifestTemporalSummary {
  eventCount: number;
  byScope: Readonly<Record<string, number>>;
  byCategory: Readonly<Record<string, number>>;
  snapshotDates: readonly string[];
  emptyCategories: readonly string[];
}

export interface ComparableManifest {
  modelName: string;
  modelVersion: string;
  manifestSchemaVersion?: string;
  generatedAt: string;
  coordinateReferenceSystem?: string;
  evidenceRecordCount?: number;
  evidenceByClassification?: Readonly<Record<string, number>>;
  sourceCount?: number;
  structureCount?: number;
  segmentCount?: number;
  apronCount?: number;
  timelineYears?: { min: number; max: number };
  geometryHash: string;
  evidenceLedgerHash: string;
  subjectDigestHash?: string;
  subjects?: readonly ManifestSubjectDigest[];
  temporal?: ManifestTemporalSummary;
  validationStatus: string;
  validationErrorCount?: number;
  knownLimitations: readonly string[];
}

/** The schema major version this build knows how to diff. */
export const SUPPORTED_MANIFEST_MAJOR = 1;

/**
 * Largest manifest accepted from a file picker, in bytes.
 *
 * The manifest this build emits is around 46 kB. One megabyte is roughly
 * twenty times that — comfortable room for a much larger model, and small
 * enough that a hostile file cannot make `JSON.parse` the slow part of the
 * page. The limit is checked before parsing, not after.
 */
export const MAX_MANIFEST_BYTES = 1_000_000;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type ManifestParseResult =
  | { ok: true; manifest: ComparableManifest; warnings: readonly string[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseSubjects(value: unknown): readonly ManifestSubjectDigest[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const subjects: ManifestSubjectDigest[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = stringField(entry, "id");
    const geometryHash = stringField(entry, "geometryHash");
    const evidenceHash = stringField(entry, "evidenceHash");
    if (id === undefined || geometryHash === undefined || evidenceHash === undefined) {
      continue;
    }
    const sourceIds = Array.isArray(entry["sourceIds"])
      ? entry["sourceIds"].filter((item): item is string => typeof item === "string")
      : [];
    subjects.push({
      id,
      kind: stringField(entry, "kind") ?? "unknown",
      evidenceClass: stringField(entry, "evidenceClass") ?? "unknown",
      ...(numberField(entry, "confidence") === undefined
        ? {}
        : { confidence: numberField(entry, "confidence") }),
      ...(stringField(entry, "observedDate") === undefined
        ? {}
        : { observedDate: stringField(entry, "observedDate") }),
      sourceIds,
      geometryHash,
      evidenceHash,
      wordingHash: stringField(entry, "wordingHash") ?? "",
      uncertaintyHash: stringField(entry, "uncertaintyHash") ?? "",
    });
  }
  // Sorted here rather than trusted from the file: a diff's output order must
  // not depend on how a third party ordered their array.
  return subjects.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/**
 * Parses and validates a manifest from untrusted JSON text.
 *
 * Rejects — safely, with a message rather than a throw — anything oversized,
 * unparseable, structurally wrong, or from an incompatible schema major
 * version. A *minor* version difference is a warning, not an error: 1.0 and 1.1
 * agree on every field 1.0 defines, and refusing to compare an older manifest
 * would make the feature useless for its main job, which is comparing a build
 * against an earlier one.
 */
export function parseManifest(text: string): ManifestParseResult {
  if (text.length > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      error: `Manifest is ${text.length} bytes, over the ${MAX_MANIFEST_BYTES}-byte limit. Comparison is refused rather than attempted.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Manifest must be a JSON object." };
  }

  const geometryHash = stringField(parsed, "geometryHash");
  const evidenceLedgerHash = stringField(parsed, "evidenceLedgerHash");
  const modelName = stringField(parsed, "modelName");
  const modelVersion = stringField(parsed, "modelVersion");
  const generatedAt = stringField(parsed, "generatedAt");
  const validationStatus = stringField(parsed, "validationStatus");

  const missing = (
    [
      ["modelName", modelName],
      ["modelVersion", modelVersion],
      ["generatedAt", generatedAt],
      ["geometryHash", geometryHash],
      ["evidenceLedgerHash", evidenceLedgerHash],
      ["validationStatus", validationStatus],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Not a model manifest: missing required field(s) ${missing.join(", ")}.`,
    };
  }

  const warnings: string[] = [];
  const schemaVersion = stringField(parsed, "manifestSchemaVersion");
  if (schemaVersion === undefined) {
    warnings.push(
      "Manifest declares no schema version. It is treated as 1.0 and only the fields present are compared.",
    );
  } else {
    const major = Number.parseInt(schemaVersion.split(".")[0] ?? "", 10);
    if (!Number.isInteger(major)) {
      return {
        ok: false,
        error: `Manifest schema version "${schemaVersion}" is not a version number.`,
      };
    }
    if (major !== SUPPORTED_MANIFEST_MAJOR) {
      return {
        ok: false,
        error: `Manifest schema version ${schemaVersion} is incompatible with this build, which reads major version ${SUPPORTED_MANIFEST_MAJOR}. Fields with the same name may not mean the same thing, so the comparison is refused rather than guessed.`,
      };
    }
    if (schemaVersion !== "1.1.0") {
      warnings.push(
        `Manifest schema version ${schemaVersion} differs from this build's 1.1.0. Fields it does not carry are reported as unavailable rather than as changes.`,
      );
    }
  }

  const knownLimitations = Array.isArray(parsed["knownLimitations"])
    ? parsed["knownLimitations"].filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const subjects = parseSubjects(parsed["subjects"]);
  if (subjects === undefined) {
    warnings.push(
      "Manifest carries no per-subject digests, so this comparison is limited to totals and whole-model hashes.",
    );
  }

  const temporal = isRecord(parsed["temporal"])
    ? (parsed["temporal"] as unknown as ManifestTemporalSummary)
    : undefined;
  const timelineYearsRaw = parsed["timelineYears"];
  const timelineYears = isRecord(timelineYearsRaw)
    ? {
        min: numberField(timelineYearsRaw, "min") ?? Number.NaN,
        max: numberField(timelineYearsRaw, "max") ?? Number.NaN,
      }
    : undefined;

  return {
    ok: true,
    warnings,
    manifest: {
      modelName: modelName!,
      modelVersion: modelVersion!,
      ...(schemaVersion === undefined ? {} : { manifestSchemaVersion: schemaVersion }),
      generatedAt: generatedAt!,
      ...(stringField(parsed, "coordinateReferenceSystem") === undefined
        ? {}
        : {
            coordinateReferenceSystem: stringField(parsed, "coordinateReferenceSystem"),
          }),
      ...(numberField(parsed, "evidenceRecordCount") === undefined
        ? {}
        : { evidenceRecordCount: numberField(parsed, "evidenceRecordCount") }),
      ...(isRecord(parsed["evidenceByClassification"])
        ? {
            evidenceByClassification: parsed["evidenceByClassification"] as Record<
              string,
              number
            >,
          }
        : {}),
      ...(numberField(parsed, "sourceCount") === undefined
        ? {}
        : { sourceCount: numberField(parsed, "sourceCount") }),
      ...(numberField(parsed, "structureCount") === undefined
        ? {}
        : { structureCount: numberField(parsed, "structureCount") }),
      ...(numberField(parsed, "segmentCount") === undefined
        ? {}
        : { segmentCount: numberField(parsed, "segmentCount") }),
      ...(numberField(parsed, "apronCount") === undefined
        ? {}
        : { apronCount: numberField(parsed, "apronCount") }),
      ...(timelineYears === undefined ? {} : { timelineYears }),
      geometryHash: geometryHash!,
      evidenceLedgerHash: evidenceLedgerHash!,
      ...(stringField(parsed, "subjectDigestHash") === undefined
        ? {}
        : { subjectDigestHash: stringField(parsed, "subjectDigestHash") }),
      ...(subjects === undefined ? {} : { subjects }),
      ...(temporal === undefined ? {} : { temporal }),
      validationStatus: validationStatus!,
      ...(numberField(parsed, "validationErrorCount") === undefined
        ? {}
        : { validationErrorCount: numberField(parsed, "validationErrorCount") }),
      knownLimitations,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

/**
 * What kind of change a difference is.
 *
 * The categories are the point of the whole module: they let a reviewer skip a
 * build that only rewrote prose and stop on one that moved a footprint.
 */
export type ChangeCategory =
  /** The modeled geometry itself moved, turned or resized. */
  | "analytical-model"
  /** A classification, confidence, source or count changed. */
  | "evidence"
  /** What the model admits not knowing changed. */
  | "uncertainty"
  /** Only the prose describing something changed. */
  | "documentation"
  /** Release metadata: version, generation time, validation status. */
  | "release-metadata";

export const CHANGE_CATEGORIES: readonly ChangeCategory[] = [
  "analytical-model",
  "evidence",
  "uncertainty",
  "documentation",
  "release-metadata",
];

export const CHANGE_CATEGORY_META: Record<
  ChangeCategory,
  { label: string; glyph: string; description: string }
> = {
  "analytical-model": {
    label: "Analytical model",
    glyph: "▲",
    description:
      "Modeled geometry changed: something moved, turned, resized, or was added or removed. This is the category that needs a spatial re-review.",
  },
  evidence: {
    label: "Evidence",
    glyph: "◆",
    description:
      "A classification, a confidence rank, a cited source or a record count changed. The claims are different even where the geometry is not.",
  },
  uncertainty: {
    label: "Uncertainty",
    glyph: "◇",
    description:
      "What the model admits not knowing changed — a tolerance, an identification level, a temporal bound.",
  },
  documentation: {
    label: "Documentation",
    glyph: "¶",
    description:
      "Only the wording changed: a name, a description, an analyst note. No claim and no geometry moved.",
  },
  "release-metadata": {
    label: "Release metadata",
    glyph: "#",
    description:
      "Version, generation time, schema version or validation status. Says nothing about the model's content.",
  },
};

export interface ManifestDifference {
  category: ChangeCategory;
  /** The subject this concerns, or `model` for a whole-model field. */
  subjectId: string;
  field: string;
  before: string;
  after: string;
}

export interface ManifestDiff {
  empty: boolean;
  differences: readonly ManifestDifference[];
  addedSubjectIds: readonly string[];
  removedSubjectIds: readonly string[];
  /** True when neither manifest carries per-subject digests. */
  subjectComparisonAvailable: boolean;
  /** Categories with at least one difference, in declaration order. */
  categoriesTouched: readonly ChangeCategory[];
  /** Things this comparison cannot see, stated rather than implied. */
  notCovered: readonly string[];
}

function show(value: unknown): string {
  if (value === undefined) return "not present";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${key}=${String(entry)}`)
      .join(", ");
  }
  return String(value);
}

const NOT_COVERED: readonly string[] = [
  "Shader, post-processing and lighting work. Nothing about how the scene is lit or graded reaches the manifest, so two builds that look completely different can produce an identical diff.",
  "Camera behaviour, HUD layout and interaction changes.",
  "The Blacksite simulation at /play. It runs on the same geometry and contributes no analytical claim, so it is deliberately outside the manifest.",
  "Dependency versions. The software bill of materials produced by CI covers those.",
];

/**
 * Deterministic difference between two manifests.
 *
 * Output order is fixed: whole-model fields in declaration order, then subjects
 * by id, then per-subject fields in declaration order. The same pair of inputs
 * always produces byte-identical output, which is what makes a pasted diff
 * checkable.
 */
export function diffManifests(
  before: ComparableManifest,
  after: ComparableManifest,
): ManifestDiff {
  const differences: ManifestDifference[] = [];
  const add = (
    category: ChangeCategory,
    subjectId: string,
    field: string,
    left: unknown,
    right: unknown,
  ) => {
    const leftText = show(left);
    const rightText = show(right);
    if (leftText === rightText) return;
    differences.push({ category, subjectId, field, before: leftText, after: rightText });
  };

  /* ---------------------------------------------- whole-model fields */
  add("release-metadata", "model", "modelName", before.modelName, after.modelName);
  add(
    "release-metadata",
    "model",
    "modelVersion",
    before.modelVersion,
    after.modelVersion,
  );
  add(
    "release-metadata",
    "model",
    "manifestSchemaVersion",
    before.manifestSchemaVersion,
    after.manifestSchemaVersion,
  );
  add("release-metadata", "model", "generatedAt", before.generatedAt, after.generatedAt);
  add(
    "release-metadata",
    "model",
    "validationStatus",
    before.validationStatus,
    after.validationStatus,
  );
  add(
    "release-metadata",
    "model",
    "validationErrorCount",
    before.validationErrorCount,
    after.validationErrorCount,
  );

  add(
    "analytical-model",
    "model",
    "geometryHash",
    before.geometryHash,
    after.geometryHash,
  );
  add(
    "analytical-model",
    "model",
    "coordinateReferenceSystem",
    before.coordinateReferenceSystem,
    after.coordinateReferenceSystem,
  );
  add(
    "analytical-model",
    "model",
    "structureCount",
    before.structureCount,
    after.structureCount,
  );
  add(
    "analytical-model",
    "model",
    "segmentCount",
    before.segmentCount,
    after.segmentCount,
  );
  add("analytical-model", "model", "apronCount", before.apronCount, after.apronCount);
  add(
    "analytical-model",
    "model",
    "timelineYears",
    before.timelineYears,
    after.timelineYears,
  );

  add(
    "evidence",
    "model",
    "evidenceLedgerHash",
    before.evidenceLedgerHash,
    after.evidenceLedgerHash,
  );
  add(
    "evidence",
    "model",
    "evidenceRecordCount",
    before.evidenceRecordCount,
    after.evidenceRecordCount,
  );
  add(
    "evidence",
    "model",
    "evidenceByClassification",
    before.evidenceByClassification,
    after.evidenceByClassification,
  );
  add("evidence", "model", "sourceCount", before.sourceCount, after.sourceCount);
  add(
    "evidence",
    "model",
    "temporalEventCount",
    before.temporal?.eventCount,
    after.temporal?.eventCount,
  );
  add(
    "uncertainty",
    "model",
    "temporalEventsByScope",
    before.temporal?.byScope,
    after.temporal?.byScope,
  );

  add(
    "documentation",
    "model",
    "knownLimitationCount",
    before.knownLimitations.length,
    after.knownLimitations.length,
  );
  const beforeLimitations = new Set(before.knownLimitations);
  const afterLimitations = new Set(after.knownLimitations);
  for (const limitation of after.knownLimitations) {
    if (!beforeLimitations.has(limitation)) {
      differences.push({
        category: "documentation",
        subjectId: "model",
        field: "knownLimitations (added)",
        before: "not present",
        after: limitation,
      });
    }
  }
  for (const limitation of before.knownLimitations) {
    if (!afterLimitations.has(limitation)) {
      differences.push({
        category: "documentation",
        subjectId: "model",
        field: "knownLimitations (removed)",
        before: limitation,
        after: "not present",
      });
    }
  }

  /* ---------------------------------------------- per-subject fields */
  const subjectComparisonAvailable =
    before.subjects !== undefined && after.subjects !== undefined;
  const beforeSubjects = new Map(
    (before.subjects ?? []).map((subject) => [subject.id, subject]),
  );
  const afterSubjects = new Map(
    (after.subjects ?? []).map((subject) => [subject.id, subject]),
  );
  const addedSubjectIds: string[] = [];
  const removedSubjectIds: string[] = [];

  if (subjectComparisonAvailable) {
    const ids = [...new Set([...beforeSubjects.keys(), ...afterSubjects.keys()])].sort();
    for (const id of ids) {
      const left = beforeSubjects.get(id);
      const right = afterSubjects.get(id);
      if (left === undefined) {
        addedSubjectIds.push(id);
        differences.push({
          category: "analytical-model",
          subjectId: id,
          field: "subject",
          before: "not present",
          after:
            `added as ${right?.evidenceClass ?? "unknown"} ${right?.kind ?? ""}`.trim(),
        });
        continue;
      }
      if (right === undefined) {
        removedSubjectIds.push(id);
        differences.push({
          category: "analytical-model",
          subjectId: id,
          field: "subject",
          before: `present as ${left.evidenceClass} ${left.kind}`,
          after: "not present",
        });
        continue;
      }
      add("analytical-model", id, "geometryHash", left.geometryHash, right.geometryHash);
      add("analytical-model", id, "observedDate", left.observedDate, right.observedDate);
      add("evidence", id, "evidenceClass", left.evidenceClass, right.evidenceClass);
      add("evidence", id, "confidence", left.confidence, right.confidence);
      add("evidence", id, "sources", left.sourceIds, right.sourceIds);
      add("evidence", id, "evidenceHash", left.evidenceHash, right.evidenceHash);
      add(
        "uncertainty",
        id,
        "uncertaintyHash",
        left.uncertaintyHash,
        right.uncertaintyHash,
      );
      add("documentation", id, "wordingHash", left.wordingHash, right.wordingHash);
    }
  }

  const touched = new Set(differences.map((difference) => difference.category));
  const notCovered = [...NOT_COVERED];
  if (!subjectComparisonAvailable) {
    notCovered.unshift(
      "Per-subject changes. At least one manifest carries no `subjects` array, so only totals and whole-model hashes could be compared.",
    );
  }

  return {
    empty: differences.length === 0,
    differences,
    addedSubjectIds,
    removedSubjectIds,
    subjectComparisonAvailable,
    categoriesTouched: CHANGE_CATEGORIES.filter((category) => touched.has(category)),
    notCovered,
  };
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

/** CSV of the differences. Quoted per RFC 4180 so a comma in a note is safe. */
export function diffToCsv(diff: ManifestDiff): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ["category", "subject", "field", "before", "after"].join(","),
    ...diff.differences.map((difference) =>
      [
        difference.category,
        difference.subjectId,
        difference.field,
        difference.before,
        difference.after,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return `${rows.join("\n")}\n`;
}

/** Markdown table of the differences, for pasting into a review. */
export function diffToMarkdown(
  diff: ManifestDiff,
  before: ComparableManifest,
  after: ComparableManifest,
): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const lines = [
    `# Model manifest comparison`,
    "",
    `- **Before:** ${before.modelName} ${before.modelVersion}, generated ${before.generatedAt}`,
    `- **After:** ${after.modelName} ${after.modelVersion}, generated ${after.generatedAt}`,
    "",
  ];
  if (diff.empty) {
    lines.push("No differences. Every compared field is identical.", "");
  } else {
    lines.push(
      `${diff.differences.length} difference(s) across: ${diff.categoriesTouched
        .map((category) => CHANGE_CATEGORY_META[category].label)
        .join(", ")}.`,
      "",
      "| Category | Subject | Field | Before | After |",
      "| --- | --- | --- | --- | --- |",
      ...diff.differences.map(
        (difference) =>
          `| ${CHANGE_CATEGORY_META[difference.category].label} | \`${difference.subjectId}\` | ${escape(
            difference.field,
          )} | ${escape(difference.before)} | ${escape(difference.after)} |`,
      ),
      "",
    );
  }
  lines.push("## Not covered by this comparison", "");
  for (const item of diff.notCovered) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}
