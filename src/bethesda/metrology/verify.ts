/**
 * The independent verifier: rebuilds a split's conclusions from its frozen
 * protocol and raw records, and fails on anything inconsistent or tampered.
 *
 * It trusts nothing the archive says about itself. It re-hashes every file
 * against the manifest, checks the archived protocol is byte-for-byte the
 * frozen one in `src/` (by digest) and that the records name it, re-derives the
 * held-out seeds from that digest, recomputes the summary from the records and
 * re-renders the report, and compares bytes. The CLI adds the last check this
 * module cannot make: re-simulating a sample of records on the platform they
 * were made on (`replay`).
 *
 * Pure: archive contents in, checks out.
 */
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { summarize, type Check } from "./analysis.js";
import {
  EVIDENCE_FILES,
  MANIFEST_SCHEMA,
  VERIFICATION_SCHEMA,
  manifestDigest,
  parseRecords,
  summaryText,
  type Manifest,
} from "./archive.js";
import {
  parseProtocol,
  protocolDigest,
  seedsOf,
  unitKey,
  type Protocol,
  type Split,
} from "./protocol.js";
import { renderReport, type MachineRecord } from "./report.js";
import type { RunRecord } from "./runner.js";

export type VerificationStatus = "VERIFIED" | "VERIFIED_WITHOUT_REPLAY" | "FAILED";

export interface ReplayResult {
  status: "matched" | "mismatch" | "not-comparable" | "skipped";
  detail: string;
  units: string[];
  mismatched: string[];
}

export interface Verification {
  schema: typeof VERIFICATION_SCHEMA;
  protocol: string;
  split: Split;
  manifestDigest: string | null;
  status: VerificationStatus;
  checks: Check[];
  replay: ReplayResult;
  verifier: { commit: string; platform: string; node: string };
  verifiedAt: string;
}

export interface StaticVerification {
  checks: Check[];
  manifest: Manifest | null;
  manifestDigest: string | null;
  records: RunRecord[] | null;
  machine: MachineRecord | null;
}

function tryJson<T>(text: string | undefined): T | null {
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Every check that needs no simulation. `frozen` is the protocol as the
 * repository holds it now; `files` the archive's files by name.
 */
export function verifyStatic(
  frozen: Protocol,
  split: Split,
  files: Record<string, string | undefined>,
): StaticVerification {
  const checks: Check[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const manifest = tryJson<Manifest>(files["manifest.json"]);
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA) {
    add("manifest", false, "manifest.json is missing, unreadable or not eimb-manifest/v1");
    return { checks, manifest: null, manifestDigest: null, records: null, machine: null };
  }
  const digest = manifestDigest(manifest);
  add("manifest", true, `manifest ${digest}`);

  const listed = Object.keys(manifest.files ?? {}).sort();
  const required = [...EVIDENCE_FILES].sort();
  const bad: string[] = [];
  for (const name of EVIDENCE_FILES) {
    const text = files[name];
    if (text === undefined) bad.push(`${name} missing`);
    else if (sha256(text) !== manifest.files[name]) bad.push(`${name} does not match its digest`);
  }
  if (canonicalJson(listed) !== canonicalJson(required)) bad.push("the manifest lists other files");
  add(
    "file-digests",
    bad.length === 0,
    bad.length ? bad.join("; ") : `${EVIDENCE_FILES.length} files match their SHA-256 digests`,
  );

  const frozenDigest = protocolDigest(frozen);
  let archived: Protocol | null = null;
  try {
    archived = parseProtocol(tryJson(files["protocol.json"]));
  } catch (e) {
    add("protocol-frozen", false, `protocol.json does not parse: ${(e as Error).message}`);
  }
  if (archived) {
    const d = protocolDigest(archived);
    add(
      "protocol-frozen",
      d === frozenDigest && d === manifest.protocolDigest && manifest.split === split,
      d === frozenDigest && d === manifest.protocolDigest
        ? `the archived protocol is the frozen one (${d.slice(0, 16)}…)`
        : `archived ${d.slice(0, 16)}…, manifest ${String(manifest.protocolDigest).slice(0, 16)}…, repository ${frozenDigest.slice(0, 16)}…: the protocol changed after the run, or the archive was altered`,
    );
  }

  let records: RunRecord[] | null = null;
  try {
    records = parseRecords(files["records.jsonl"] ?? "");
  } catch (e) {
    add("records-parse", false, (e as Error).message);
  }
  if (records) {
    const text = files["records.jsonl"] ?? "";
    const lines = text.split("\n").filter(Boolean);
    const canonical = lines.every((l, i) => l === canonicalJson(records![i]));
    const sorted = records.every((r, i) => i === 0 || unitKey(records![i - 1]!) < unitKey(r));
    add(
      "records-parse",
      records.length === manifest.records && canonical && sorted,
      `${records.length} records (manifest says ${manifest.records}); canonical ${canonical}; sorted ${sorted}`,
    );
    const want = seedsOf(frozen, split);
    const got = [...new Set(records.map((r) => r.seed))].sort((a, b) => a - b);
    add(
      "seeds",
      canonicalJson(got) === canonicalJson([...want].sort((a, b) => a - b)),
      split === "heldout"
        ? `held-out seeds re-derived from the protocol digest: ${got.length} of ${want.length} match`
        : `dev seeds as listed: ${got.length} of ${want.length} match`,
    );
  }

  const machine = tryJson<MachineRecord>(files["machine.json"]);
  if (!machine || machine.schema !== "eimb-machine/v1")
    add("machine", false, "machine.json is missing or not eimb-machine/v1");
  else
    add(
      "machine",
      split !== "heldout" || machine.cleanSources,
      machine.cleanSources
        ? `made from clean commit ${machine.commit}`
        : `made from a working tree at ${machine.commit}: a development record${split === "heldout" ? ", never a held-out result" : ""}`,
    );

  if (records && archived && machine) {
    const summary = summarize(frozen, split, records);
    const same = summaryText(summary) === files["summary.json"];
    add(
      "summary-rederived",
      same,
      same
        ? "the summary recomputed from the raw records matches byte for byte"
        : "the summary recomputed from the raw records differs from summary.json",
    );
    const report = renderReport(summary, frozen, machine);
    add(
      "report-rerendered",
      report === files["README.md"],
      report === files["README.md"]
        ? "the report re-rendered from the recomputed summary matches byte for byte"
        : "the re-rendered report differs from README.md",
    );
    add(
      "verdict",
      true,
      `recomputed verdict: ${summary.verdict.overall}${summary.validity.valid ? "" : " (the experiment itself is invalid)"}`,
    );
  }
  return { checks, manifest, manifestDigest: digest, records, machine };
}

/** Pick `k` units to re-simulate, spread over controllers and conditions, fixed by the manifest digest. */
export function replaySample(records: readonly RunRecord[], digest: string, k: number): RunRecord[] {
  const scored = records
    .filter((r) => r.status === "complete")
    .map((r) => ({ r, h: sha256(`${digest}:${unitKey(r)}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : 1));
  const out: RunRecord[] = [];
  const seen = new Set<string>();
  for (const { r } of scored) {
    if (out.length >= k) break;
    const key = `${r.controller}|${r.condition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  for (const { r } of scored) {
    if (out.length >= k) break;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

export function statusOf(checks: Check[], replay: ReplayResult): VerificationStatus {
  if (!checks.every((c) => c.passed) || replay.status === "mismatch") return "FAILED";
  return replay.status === "matched" ? "VERIFIED" : "VERIFIED_WITHOUT_REPLAY";
}
