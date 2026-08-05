/**
 * Evidence ledger validation.
 *
 * These are the checks that stop the model from making a claim it cannot
 * support. They run in `bun run validate:data`, again inside the manifest
 * generator (whose `validationStatus` field would otherwise be a promise
 * nobody keeps), and are exported as a plain function so a future test or
 * service can call them without a build step.
 *
 * Every rule here exists because the failure it catches is one a reviewer
 * would reasonably call a false claim: an interpretation labelled as an
 * observation, a reported fact with nothing to cite, a measurement in a
 * coordinate system the project does not actually register to.
 */

import {
  EVIDENCE_CLASSIFICATIONS,
  MODEL_INTERNAL_SOURCE_ID,
  SUPPORTED_COORDINATE_REFERENCE_SYSTEMS,
  isKnownEvidenceSubject,
  isKnownGeometryId,
  type EvidenceClassification,
  type EvidenceRecord,
} from "./evidence";
import { STRUCTURES } from "./layout";
import { PUBLIC_SOURCES } from "./siteData";

/** Classifications whose subject can only ever be modeled or scenario content. */
const NON_OBSERVABLE_STATUSES: ReadonlySet<EvidenceClassification> = new Set([
  "interpreted",
  "illustrative",
]);

/**
 * Words that assert a claim has been checked and stands. They are legitimate
 * on an observed or reported record and a false statement on an interpreted
 * or illustrative one, so the check is scoped by classification rather than
 * banning the vocabulary. The negated forms are the *honest* usage — "not a
 * verified facility", "not an authoritative identification" — and the whole
 * project is written in them, so a match only fails when no negation appears
 * shortly before it.
 */
const VERIFICATION_WORD = /\b(verified|confirmed|authenticated|certified|authoritative|official)\b/gi;
const NEGATION_BEFORE = /\b(not|no|never|nor|neither|without|cannot|remains?|remain)\b/i;

function assertsVerification(text: string): boolean {
  VERIFICATION_WORD.lastIndex = 0;
  for (let match = VERIFICATION_WORD.exec(text); match !== null; match = VERIFICATION_WORD.exec(text)) {
    const preceding = text.slice(Math.max(0, match.index - 60), match.index);
    if (!NEGATION_BEFORE.test(preceding)) return true;
  }
  return false;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RECORD_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export interface EvidenceValidationResult {
  errors: readonly string[];
  recordCount: number;
}

export function validateEvidenceLedger(
  ledger: readonly EvidenceRecord[],
): EvidenceValidationResult {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);

  /* -------------------------------------------------- source register */
  const sourceIds = new Set<string>();
  for (const source of PUBLIC_SOURCES) {
    if (sourceIds.has(source.id)) {
      fail(`Source register: source id "${source.id}" is duplicated`);
    }
    sourceIds.add(source.id);
  }
  if (sourceIds.has(MODEL_INTERNAL_SOURCE_ID)) {
    fail(
      `Source register: "${MODEL_INTERNAL_SOURCE_ID}" is reserved for model-internal claims and must not name a public source`,
    );
  }

  /* -------------------------------------------------- per-record rules */
  const seenRecordIds = new Set<string>();
  const knownRecordIds = new Set(ledger.map((record) => record.id));
  const classifications = new Set<string>(EVIDENCE_CLASSIFICATIONS);
  const supportedCrs = new Set<string>(SUPPORTED_COORDINATE_REFERENCE_SYSTEMS);

  for (const record of ledger) {
    const at = `Evidence record "${record.id}"`;

    if (!RECORD_ID.test(record.id)) {
      fail(`${at} must use a lowercase, hyphen-or-dot separated id of 3-128 characters`);
    }
    if (seenRecordIds.has(record.id)) {
      fail(`${at} is duplicated in the ledger`);
    }
    seenRecordIds.add(record.id);

    // 1. Confidence must be a real number inside the published range.
    if (
      typeof record.confidence !== "number" ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    ) {
      fail(`${at} confidence ${String(record.confidence)} must be a finite number in [0, 1]`);
    }

    // 2. A record must describe something the model actually contains.
    if (!isKnownEvidenceSubject(record.subjectId)) {
      fail(`${at} references unknown subject "${record.subjectId}"`);
    }

    // 3. Geometry-backed subjects must resolve to a real layout record.
    if (
      (record.subjectKind === "structure" ||
        record.subjectKind === "aircraft" ||
        record.subjectKind === "pavement") &&
      !isKnownGeometryId(record.subjectId)
    ) {
      fail(`${at} claims geometry "${record.subjectId}" that does not exist in the layout`);
    }

    // 4. The classification must be one of the four published values.
    if (!classifications.has(record.classification)) {
      fail(`${at} has invalid classification "${String(record.classification)}"`);
    }

    if (record.claim.trim().length === 0) {
      fail(`${at} must state a claim`);
    }

    // 5. Observed and reported claims must point at something citable.
    if (record.classification === "observed" || record.classification === "reported") {
      if (record.sourceTitle.trim().length === 0) {
        fail(`${at} is ${record.classification} and must name a source`);
      }
      if (record.sourceUrl === undefined || record.sourceUrl.trim().length === 0) {
        fail(`${at} is ${record.classification} and must reference a source URL`);
      }
      if (record.sourceId === undefined || record.sourceId === MODEL_INTERNAL_SOURCE_ID) {
        fail(
          `${at} is ${record.classification} and must cite an external source from the public register, not the model itself`,
        );
      } else if (!sourceIds.has(record.sourceId)) {
        fail(`${at} cites unknown source "${record.sourceId}"`);
      }
    } else if (
      record.sourceId !== undefined &&
      record.sourceId !== MODEL_INTERNAL_SOURCE_ID &&
      !sourceIds.has(record.sourceId)
    ) {
      fail(`${at} cites unknown source "${record.sourceId}"`);
    }

    // 6. Measurements are only meaningful in a CRS the project registers to.
    if (
      record.coordinateReferenceSystem !== undefined &&
      !supportedCrs.has(record.coordinateReferenceSystem)
    ) {
      fail(
        `${at} uses unsupported coordinate reference system "${record.coordinateReferenceSystem}" (supported: ${SUPPORTED_COORDINATE_REFERENCE_SYSTEMS.join(", ")})`,
      );
    }
    if (record.subjectKind === "measurement" && record.coordinateReferenceSystem === undefined) {
      fail(`${at} is a measurement and must declare a coordinate reference system`);
    }

    // 7. An illustrative or interpreted feature must never read as observed.
    if (record.subjectKind === "simulation" && record.classification !== "illustrative") {
      fail(
        `${at} describes a simulation element and must be classified illustrative, not "${record.classification}"`,
      );
    }
    if (NON_OBSERVABLE_STATUSES.has(record.classification)) {
      const wording = `${record.claim} ${record.analystNotes ?? ""}`;
      if (assertsVerification(wording)) {
        fail(
          `${at} is ${record.classification} but its wording asserts verification; say interpreted or illustrative instead`,
        );
      }
    }

    if (record.measurementUncertaintyM !== undefined) {
      if (
        !Number.isFinite(record.measurementUncertaintyM) ||
        record.measurementUncertaintyM < 0
      ) {
        fail(`${at} measurement uncertainty must be a finite, non-negative number of metres`);
      }
    }
    if (record.sourceResolutionM !== undefined) {
      if (!Number.isFinite(record.sourceResolutionM) || record.sourceResolutionM <= 0) {
        fail(`${at} source resolution must be a finite, positive number of metres`);
      }
    }

    for (const [label, value] of [
      ["sourceDate", record.sourceDate],
      ["accessedAt", record.accessedAt],
    ] as const) {
      if (value !== undefined && !ISO_DATE.test(value)) {
        fail(`${at} ${label} "${value}" must be an ISO YYYY-MM-DD date`);
      }
    }

    if (record.sourceUrl !== undefined) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(record.sourceUrl);
      } catch {
        fail(`${at} has an unparseable source URL`);
      }
      if (parsed !== undefined && parsed.protocol !== "https:") {
        fail(`${at} source URL must use HTTPS, not "${parsed.protocol}"`);
      }
    }

    if (record.supersedes !== undefined && !knownRecordIds.has(record.supersedes)) {
      fail(`${at} supersedes unknown record "${record.supersedes}"`);
    }

    if (record.sourceHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(record.sourceHash)) {
      fail(`${at} source hash must be a lowercase "sha256:<64 hex>" digest`);
    }
  }

  /* -------------------------------------------------- coverage */
  const subjectsWithRecords = new Set(ledger.map((record) => record.subjectId));
  for (const structure of STRUCTURES) {
    if (!subjectsWithRecords.has(structure.id)) {
      fail(`Structure "${structure.id}" has no evidence record`);
    }
  }

  /* -------------------------------------------------- cross-checks */
  // A structure declared illustrative in the layout must not acquire an
  // observed or reported record from anywhere else in the pipeline.
  const declared = new Map(STRUCTURES.map((structure) => [structure.id, structure.evidence.status]));
  for (const record of ledger) {
    const status = declared.get(record.subjectId);
    if (status === undefined) continue;
    if (status === "illustrative" && record.classification !== "illustrative") {
      fail(
        `Evidence record "${record.id}" classifies illustrative feature "${record.subjectId}" as ${record.classification}`,
      );
    }
    if (status === "interpreted" && record.classification === "observed") {
      fail(
        `Evidence record "${record.id}" classifies interpreted feature "${record.subjectId}" as observed`,
      );
    }
  }

  return { errors, recordCount: ledger.length };
}
