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
import { UNCERTAINTY_BASES, UNCERTAINTY_LEVELS } from "./uncertainty";

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
const VERIFICATION_WORD =
  /\b(verified|confirmed|authenticated|certified|authoritative|official)\b/gi;
const NEGATION_BEFORE = /\b(not|no|never|nor|neither|without|cannot|remains?|remain)\b/i;

function assertsVerification(text: string): boolean {
  VERIFICATION_WORD.lastIndex = 0;
  for (
    let match = VERIFICATION_WORD.exec(text);
    match !== null;
    match = VERIFICATION_WORD.exec(text)
  ) {
    const preceding = text.slice(Math.max(0, match.index - 60), match.index);
    if (!NEGATION_BEFORE.test(preceding)) return true;
  }
  return false;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RECORD_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

/**
 * Uncertainty rules.
 *
 * Structured uncertainty is only worth having if a number in it cannot be
 * invented, so each of these rules blocks a specific way of inventing one. The
 * expensive rule is the last: an `observed` record with no resolution and no
 * positional envelope is a claim that the model's coordinate *is* the feature's
 * coordinate, and no imagery this project cites supports that for anything.
 */
function validateUncertainty(
  record: EvidenceRecord,
  fail: (message: string) => void,
): void {
  const at = `Evidence record "${record.id}"`;
  const envelope = record.uncertainty;

  if (envelope === undefined) {
    // Only illustrative content may omit an envelope entirely: it models
    // nothing real, so there is nothing to bound. Every claim about the site
    // has to say how well it is known, even if the answer is "unknown".
    if (record.classification !== "illustrative") {
      fail(
        `${at} is ${record.classification} and must carry an uncertainty envelope; say "unknown" rather than omitting it`,
      );
    }
    return;
  }

  const numericFields = [
    ["horizontalMeters", envelope.horizontalMeters],
    ["footprintMeters", envelope.footprintMeters],
    ["heightMeters", envelope.heightMeters],
    ["orientationDegrees", envelope.orientationDegrees],
  ] as const;

  let hasNumber = false;
  for (const [label, value] of numericFields) {
    if (value === undefined) continue;
    hasNumber = true;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`${at} uncertainty ${label} must be a finite number, not ${String(value)}`);
    } else if (value < 0) {
      fail(
        `${at} uncertainty ${label} is negative (${value}); an uncertainty cannot be less than nothing`,
      );
    }
  }
  if (envelope.orientationDegrees !== undefined && envelope.orientationDegrees > 360) {
    fail(
      `${at} uncertainty orientationDegrees ${envelope.orientationDegrees} exceeds a full turn, so the unit is wrong`,
    );
  }

  // A number without a stated method is a number nobody can check.
  if (hasNumber) {
    if (envelope.method === undefined || envelope.method.trim().length === 0) {
      fail(
        `${at} states a numeric uncertainty and must document the method that produced it`,
      );
    }
    if (envelope.basis === undefined) {
      fail(
        `${at} states a numeric uncertainty and must declare its basis (one of: ${UNCERTAINTY_BASES.join(", ")})`,
      );
    } else if (!UNCERTAINTY_BASES.includes(envelope.basis)) {
      fail(`${at} uncertainty declares unknown basis "${String(envelope.basis)}"`);
    }
    if (envelope.sourceIds.length === 0 && envelope.basis === "stated-in-source") {
      fail(`${at} claims its uncertainty is stated in a source but cites no source`);
    }
  }

  for (const [label, value] of [
    ["earliestDate", envelope.earliestDate],
    ["latestDate", envelope.latestDate],
  ] as const) {
    if (value !== undefined && !ISO_DATE.test(value)) {
      fail(`${at} uncertainty ${label} "${value}" must be an ISO YYYY-MM-DD date`);
    }
  }
  if (
    envelope.earliestDate !== undefined &&
    envelope.latestDate !== undefined &&
    envelope.earliestDate > envelope.latestDate
  ) {
    fail(
      `${at} uncertainty range runs backwards: earliest ${envelope.earliestDate} is after latest ${envelope.latestDate}`,
    );
  }

  for (const [label, value] of [
    ["identification", envelope.identification],
    ["function", envelope.function],
  ] as const) {
    if (!UNCERTAINTY_LEVELS.includes(value)) {
      fail(
        `${at} uncertainty ${label} "${String(value)}" is not one of: ${UNCERTAINTY_LEVELS.join(", ")}`,
      );
    }
  }

  // An interpreted or illustrative subject cannot be "known". The identity was
  // assigned by this project; saying it is established inverts the whole point
  // of the classification.
  if (NON_OBSERVABLE_STATUSES.has(record.classification)) {
    if (envelope.identification === "known") {
      fail(
        `${at} is ${record.classification} but claims a known identification; an assigned identity is at best "possible"`,
      );
    }
    if (envelope.function === "known") {
      fail(
        `${at} is ${record.classification} but claims a known function; nothing cited establishes it`,
      );
    }
  }

  // Direct observation without a resolution or a positional envelope asserts
  // that the modeled coordinate is the real one. The cited imagery is 10 m; it
  // supports site-scale extent, never an exact position.
  if (record.classification === "observed") {
    const boundsPosition =
      envelope.horizontalMeters !== undefined ||
      envelope.footprintMeters !== undefined ||
      record.measurementUncertaintyM !== undefined ||
      record.sourceResolutionM !== undefined;
    if (!boundsPosition) {
      fail(
        `${at} claims direct observation but states no positional uncertainty and no source resolution, which asserts the modeled position is exact`,
      );
    }
    if (envelope.identification === "unknown") {
      fail(
        `${at} claims direct observation while recording an unknown identification; one of the two is wrong`,
      );
    }
  }
}

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
      fail(
        `${at} confidence ${String(record.confidence)} must be a finite number in [0, 1]`,
      );
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
      fail(
        `${at} claims geometry "${record.subjectId}" that does not exist in the layout`,
      );
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
    if (
      record.subjectKind === "measurement" &&
      record.coordinateReferenceSystem === undefined
    ) {
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
        fail(
          `${at} measurement uncertainty must be a finite, non-negative number of metres`,
        );
      }
    }
    if (record.sourceResolutionM !== undefined) {
      if (!Number.isFinite(record.sourceResolutionM) || record.sourceResolutionM <= 0) {
        fail(`${at} source resolution must be a finite, positive number of metres`);
      }
    }

    /* ------------------------------------------------ 8. uncertainty */
    validateUncertainty(record, fail);

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

    if (
      record.sourceHash !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(record.sourceHash)
    ) {
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
  const declared = new Map(
    STRUCTURES.map((structure) => [structure.id, structure.evidence.status]),
  );
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

  // A height tolerance may only exist if a cited source states one. This
  // project documents none, which is why `PROVE IT` can report that zero cubic
  // metres of modeled built volume are defended — every roofline is a modeling
  // decision. A `project-documented` or resolution-derived height would make
  // that headline false while looking like an improvement, so it is rejected
  // here rather than left to be noticed later.
  for (const record of ledger) {
    const height = record.uncertainty?.heightMeters;
    if (height === undefined) continue;
    if (record.uncertainty?.basis !== "stated-in-source") {
      fail(
        `Evidence record "${record.id}" states a height tolerance without basis "stated-in-source"; this project documents no height figure of its own`,
      );
    }
  }

  return { errors, recordCount: ledger.length };
}
