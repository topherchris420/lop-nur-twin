/**
 * Release manifest generator.
 *
 * Writes `public/model-manifest.json`: a small, machine-readable statement of
 * what a given build of this model contains, what coordinate frame it is in,
 * how many claims it makes, and what it does not know. It exists so a
 * reviewer can answer "is the copy I am looking at the copy that was
 * reviewed?" without reading the source.
 *
 *   bun run manifest
 *
 * Determinism rules, because a hash nobody can reproduce is decoration:
 *
 * - Hash inputs are canonicalised (object keys sorted recursively, arrays kept
 *   in their declared order) before hashing with SHA-256 from `node:crypto`.
 * - Only model content feeds the hashes. No paths, usernames, environment
 *   variables, timestamps or machine details are read or emitted.
 * - `generatedAt` is the one field that moves between runs. Set
 *   `SOURCE_DATE_EPOCH` to pin it and the whole file becomes byte-reproducible.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_SEGMENTS,
  APRONS,
  FLATTEN_PADS,
  STRUCTURES,
  TIMELINE_BOUNDS,
} from "../src/lib/layout";
import { PUBLIC_SOURCES, SITE_PROFILE } from "../src/lib/siteData";
import {
  EVIDENCE_LEDGER,
  GEOGRAPHIC_CRS,
  KNOWN_LIMITATIONS,
  PRIMARY_CRS,
  CONFIDENCE_SCALE_NOTE,
  evidenceClassificationCounts,
} from "../src/lib/evidence";
import { validateEvidenceLedger } from "../src/lib/evidenceValidation";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: recursively sorted keys, no whitespace, `undefined` dropped.
 * Arrays keep their order because order is meaningful in the layout (a runway
 * runs from `from` to `to`) and the ledger is already sorted by record id.
 */
function canonicalize(value: unknown): Json {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const out: { [key: string]: Json } = {};
    for (const [key, entryValue] of entries) out[key] = canonicalize(entryValue);
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Refusing to hash a non-finite number; the model data is invalid");
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  throw new Error(`Refusing to hash unsupported value of type ${typeof value}`);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")}`;
}

/** Reproducible build timestamp: `SOURCE_DATE_EPOCH` wins when it is set. */
function generatedAt(): string {
  const pinned = process.env.SOURCE_DATE_EPOCH;
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    return new Date(Number(pinned.trim()) * 1000).toISOString();
  }
  return new Date().toISOString();
}

function modelVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

/* ------------------------------------------------------------------ */
/* Hash inputs                                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything that decides where a thing sits in the world. Presentation-only
 * fields (descriptions, labels) are deliberately excluded so a wording fix
 * does not read as a geometry change.
 */
const geometryInput = {
  crs: PRIMARY_CRS,
  siteExtentM: SITE_PROFILE.worldExtentM,
  runwayCenterEastingM: SITE_PROFILE.localCrs.runwayCenterEastingM,
  runwayCenterNorthingM: SITE_PROFILE.localCrs.runwayCenterNorthingM,
  segments: ALL_SEGMENTS.map((segment) => ({
    id: segment.id,
    kind: segment.kind,
    from: segment.from,
    to: segment.to,
    width: segment.width,
    observedDate: segment.observedDate,
  })),
  aprons: APRONS.map((apron) => ({
    id: apron.id,
    center: apron.center,
    size: apron.size,
    rotation: apron.rotation,
    observedDate: apron.observedDate,
  })),
  structures: STRUCTURES.map((structure) => ({
    id: structure.id,
    type: structure.type,
    position: structure.position,
    rotation: structure.rotation,
    size: structure.size,
    observedDate: structure.observedDate,
    evidenceStatus: structure.evidence.status,
    evidenceConfidence: structure.evidence.confidence,
    sourceIds: structure.evidence.sourceIds,
  })),
  flattenPads: FLATTEN_PADS.map((pad) => ({ center: pad.center, radius: pad.radius })),
};

const ledgerInput = EVIDENCE_LEDGER.map((record) => ({ ...record }));

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

const validation = validateEvidenceLedger(EVIDENCE_LEDGER);
const classificationCounts = evidenceClassificationCounts();

const manifest = {
  modelName: "Lop Nur Geospatial Simulation Testbed",
  modelVersion: modelVersion(),
  manifestSchemaVersion: "1.0.0",
  generatedAt: generatedAt(),
  coordinateReferenceSystem: PRIMARY_CRS,
  geographicReferenceSystem: GEOGRAPHIC_CRS,
  verticalReference: SITE_PROFILE.terrainDatum.verticalReference,
  siteExtentM: SITE_PROFILE.worldExtentM,
  evidenceRecordCount: EVIDENCE_LEDGER.length,
  evidenceByClassification: classificationCounts,
  sourceCount: PUBLIC_SOURCES.length,
  structureCount: STRUCTURES.length,
  segmentCount: ALL_SEGMENTS.length,
  apronCount: APRONS.length,
  timelineYears: { min: TIMELINE_BOUNDS.minYear, max: TIMELINE_BOUNDS.maxYear },
  geometryHash: sha256(geometryInput),
  evidenceLedgerHash: sha256(ledgerInput),
  validationStatus: validation.errors.length === 0 ? "passed" : "failed",
  validationErrorCount: validation.errors.length,
  confidenceScale: CONFIDENCE_SCALE_NOTE,
  classification: "UNCLASSIFIED // PUBLIC SOURCES ONLY",
  assurance: {
    governmentCertified: false,
    fedrampAuthorized: false,
    cmmcCertified: false,
    approvedForClassifiedInformation: false,
    approvedForControlledUnclassifiedInformation: false,
    operationalIntelligenceProduct: false,
  },
  knownLimitations: KNOWN_LIMITATIONS,
  generator: {
    script: "scripts/generate-manifest.ts",
    hashAlgorithm: "SHA-256 over canonical JSON (recursively sorted object keys, UTF-8)",
    reproducibility:
      "Set SOURCE_DATE_EPOCH to pin generatedAt; every other field is a pure function of the committed model data.",
  },
} as const;

const outputDirectory = path.join(projectRoot, "public");
const outputFile = path.join(outputDirectory, "model-manifest.json");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (validation.errors.length > 0) {
  console.error(
    `[manifest] wrote public/model-manifest.json with validationStatus="failed" (${validation.errors.length} error(s)):`,
  );
  for (const error of validation.errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `[manifest] public/model-manifest.json — ${manifest.structureCount} structures, ` +
    `${manifest.evidenceRecordCount} evidence records, ${manifest.sourceCount} sources`,
);
console.log(`[manifest] geometry  ${manifest.geometryHash}`);
console.log(`[manifest] evidence  ${manifest.evidenceLedgerHash}`);
