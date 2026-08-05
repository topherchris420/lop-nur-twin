/**
 * Negative tests for the evidence validator.
 *
 * `validate:data` proves the ledger currently passes. That is only half the
 * claim: a validator that never fires is indistinguishable from one that has
 * been quietly broken. Each case below feeds a deliberately malformed record
 * through `validateEvidenceLedger` and asserts the specific error fires, so
 * "the data is validated" means something a reviewer can check.
 *
 *   bun run test:evidence
 *
 * Exits non-zero if any rule fails to fire.
 */

import { EVIDENCE_LEDGER, PRIMARY_CRS, type EvidenceRecord } from "../src/lib/evidence";
import { validateEvidenceLedger } from "../src/lib/evidenceValidation";

const BASE: EvidenceRecord = {
  id: "ev-test-baseline",
  subjectId: "hangar-main",
  claim: "Main assembly hangar — a modeled footprint interpreted from public imagery.",
  classification: "interpreted",
  confidence: 0.55,
  sourceTitle: "Sentinel-2 L2A scene T45TXF, 2025-09-28",
  sourceUrl: "https://example.invalid/scene",
  sourceId: "sentinel-2-scene-2025",
  coordinateReferenceSystem: PRIMARY_CRS,
  subjectKind: "structure",
};

interface Case {
  name: string;
  record: EvidenceRecord;
  expect: RegExp;
}

const CASES: Case[] = [
  {
    name: "confidence above the valid range is rejected",
    record: { ...BASE, confidence: 1.4 },
    expect: /confidence 1.4 must be a finite number in \[0, 1\]/,
  },
  {
    name: "negative confidence is rejected",
    record: { ...BASE, confidence: -0.1 },
    expect: /must be a finite number in \[0, 1\]/,
  },
  {
    name: "non-finite confidence is rejected",
    record: { ...BASE, confidence: Number.NaN },
    expect: /must be a finite number in \[0, 1\]/,
  },
  {
    name: "unknown subject is rejected",
    record: { ...BASE, subjectId: "not-a-real-subject" },
    expect: /references unknown subject "not-a-real-subject"/,
  },
  {
    name: "missing geometry id is rejected",
    record: {
      ...BASE,
      subjectId: "measurement-runway-length",
      subjectKind: "structure",
    },
    expect:
      /claims geometry "measurement-runway-length" that does not exist in the layout/,
  },
  {
    name: "invalid classification is rejected",
    record: {
      ...BASE,
      classification: "assessed" as EvidenceRecord["classification"],
    },
    expect: /has invalid classification "assessed"/,
  },
  {
    name: "observed claim without a source URL is rejected",
    record: {
      ...BASE,
      classification: "observed",
      subjectId: "rwy-05-23",
      subjectKind: "pavement",
      sourceUrl: undefined,
    },
    expect: /is observed and must reference a source URL/,
  },
  {
    name: "reported claim citing no register entry is rejected",
    record: {
      ...BASE,
      classification: "reported",
      subjectId: "rwy-05-23",
      subjectKind: "pavement",
      sourceId: undefined,
    },
    expect: /must cite an external source from the public register/,
  },
  {
    name: "unknown source id is rejected",
    record: { ...BASE, sourceId: "sentinel-9-imaginary" as EvidenceRecord["sourceId"] },
    expect: /cites unknown source "sentinel-9-imaginary"/,
  },
  {
    name: "unsupported coordinate reference system is rejected",
    record: { ...BASE, coordinateReferenceSystem: "EPSG:3857" },
    expect: /uses unsupported coordinate reference system "EPSG:3857"/,
  },
  {
    name: "measurement without a CRS is rejected",
    record: {
      ...BASE,
      subjectId: "measurement-runway-length",
      subjectKind: "measurement",
      coordinateReferenceSystem: undefined,
    },
    expect: /is a measurement and must declare a coordinate reference system/,
  },
  {
    name: "illustrative feature labelled observed is rejected",
    record: {
      ...BASE,
      subjectId: "solar-field",
      classification: "observed",
      sourceUrl: "https://example.invalid/scene",
    },
    expect: /classifies illustrative feature "solar-field" as observed/,
  },
  {
    name: "interpreted feature labelled observed is rejected",
    record: {
      ...BASE,
      subjectId: "hangar-main",
      classification: "observed",
    },
    expect: /classifies interpreted feature "hangar-main" as observed/,
  },
  {
    name: "simulation element not labelled illustrative is rejected",
    record: {
      ...BASE,
      subjectId: "route-perimeter-patrol",
      subjectKind: "simulation",
      classification: "interpreted",
    },
    expect: /must be classified illustrative/,
  },
  {
    name: "interpreted claim asserting verification is rejected",
    record: {
      ...BASE,
      analystNotes: "The interior use of this hall is verified by the cited scene.",
    },
    expect: /wording asserts verification/,
  },
  {
    name: "duplicate record id is rejected",
    record: { ...BASE, id: EVIDENCE_LEDGER[0]!.id },
    expect: /is duplicated in the ledger/,
  },
  {
    name: "non-HTTPS source URL is rejected",
    record: { ...BASE, sourceUrl: "http://example.invalid/scene" },
    expect: /source URL must use HTTPS/,
  },
  {
    name: "malformed source date is rejected",
    record: { ...BASE, sourceDate: "September 2025" },
    expect: /sourceDate "September 2025" must be an ISO YYYY-MM-DD date/,
  },
  {
    name: "fabricated-looking source hash is rejected",
    record: { ...BASE, sourceHash: "not-a-digest" },
    expect: /source hash must be a lowercase/,
  },
  {
    name: "supersedes pointing at nothing is rejected",
    record: { ...BASE, supersedes: "ev-does-not-exist" },
    expect: /supersedes unknown record "ev-does-not-exist"/,
  },
];

let failures = 0;

// The real ledger has to keep passing, or every case below would "pass" by
// inheriting an unrelated error.
const baseline = validateEvidenceLedger(EVIDENCE_LEDGER);
if (baseline.errors.length > 0) {
  failures += 1;
  console.error(`FAIL  the shipped ledger must validate cleanly`);
  for (const error of baseline.errors) console.error(`        ${error}`);
}

const withBaseline = validateEvidenceLedger([...EVIDENCE_LEDGER, BASE]);
if (withBaseline.errors.length > 0) {
  failures += 1;
  console.error("FAIL  the baseline test record must itself be valid");
  for (const error of withBaseline.errors) console.error(`        ${error}`);
}

for (const testCase of CASES) {
  const { errors } = validateEvidenceLedger([...EVIDENCE_LEDGER, testCase.record]);
  const matched = errors.some((error) => testCase.expect.test(error));
  if (matched) {
    console.log(`ok    ${testCase.name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${testCase.name}`);
    console.error(`        expected an error matching ${testCase.expect}`);
    for (const error of errors) console.error(`        got: ${error}`);
  }
}

if (failures > 0) {
  console.error(`[test:evidence] ${failures} check(s) failed`);
  process.exit(1);
}

console.log(`[test:evidence] OK: ${CASES.length} validator rules fire as documented`);
