/**
 * A split's archive: the frozen protocol, the raw records, the machine record,
 * the summary and the report, bound together by a manifest of their SHA-256
 * digests. The manifest's own digest is the archive's identity; anything that
 * changes a byte of the evidence changes it.
 *
 * `verification.json` sits beside the manifest, not in it: it is a statement
 * about one manifest digest, written by `verify`, and it is stale the moment
 * the manifest changes (the test suite checks it is not).
 *
 * Pure: content in, content out. The CLI does the file I/O.
 */
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { summarize, type Summary } from "./analysis.js";
import { protocolDigest, unitKey, type Protocol, type Split } from "./protocol.js";
import { renderReport, type MachineRecord } from "./report.js";
import { RECORD_SCHEMA, type RunRecord } from "./runner.js";

export const MANIFEST_SCHEMA = "eimb-manifest/v1" as const;
export const VERIFICATION_SCHEMA = "eimb-verification/v1" as const;

/** The evidence files every archive holds, in this order. */
export const EVIDENCE_FILES = [
  "protocol.json",
  "records.jsonl",
  "machine.json",
  "summary.json",
  "README.md",
] as const;
export type EvidenceFile = (typeof EVIDENCE_FILES)[number];

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  protocol: string;
  protocolDigest: string;
  split: Split;
  records: number;
  files: Record<EvidenceFile, string>;
}

export const manifestDigest = (m: Manifest): string => sha256(canonicalJson(m));

/** The records file: one canonical record per line, sorted by unit. */
export function recordsText(records: readonly RunRecord[]): string {
  const sorted = [...records].sort((a, b) => (unitKey(a) < unitKey(b) ? -1 : 1));
  return sorted.map((r) => canonicalJson(r)).join("\n") + "\n";
}

export function parseRecords(text: string): RunRecord[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const r = JSON.parse(line) as RunRecord;
      if (r.schema !== RECORD_SCHEMA)
        throw new Error(`record ${i + 1}: not ${RECORD_SCHEMA}`);
      return r;
    });
}

export const summaryText = (s: Summary): string => JSON.stringify(s, null, 2) + "\n";
export const machineText = (m: MachineRecord): string =>
  JSON.stringify(m, null, 2) + "\n";
export const manifestText = (m: Manifest): string => JSON.stringify(m, null, 2) + "\n";

/** Every evidence file of a split, derived from the protocol source, the records and the machine record. */
export function buildArchive(
  protocolSource: string,
  protocol: Protocol,
  split: Split,
  records: readonly RunRecord[],
  machine: MachineRecord,
): { files: Record<EvidenceFile, string>; manifest: Manifest; summary: Summary } {
  const summary = summarize(protocol, split, records);
  const files: Record<EvidenceFile, string> = {
    "protocol.json": protocolSource,
    "records.jsonl": recordsText(records),
    "machine.json": machineText(machine),
    "summary.json": summaryText(summary),
    "README.md": renderReport(summary, protocol, machine),
  };
  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA,
    protocol: protocol.id,
    protocolDigest: protocolDigest(protocol),
    split,
    records: records.length,
    files: Object.fromEntries(EVIDENCE_FILES.map((f) => [f, sha256(files[f])])) as Record<
      EvidenceFile,
      string
    >,
  };
  return { files, manifest, summary };
}
