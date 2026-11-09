/**
 * The verifier trusts nothing an archive says about itself. A clean archive
 * passes; every kind of corruption or tampering below fails a named check,
 * including the careful kind that re-hashes the manifest to match.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { buildArchive, manifestText, parseRecords, recordsText, type Manifest } from "./archive.js";
import { parseProtocol, type Protocol, type Split } from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };
import type { MachineRecord } from "./report.js";
import { moved, syntheticRecords } from "./testkit.js";
import { replaySample, statusOf, verifyStatic, type ReplayResult } from "./verify.js";

const sourceText = JSON.stringify({ ...source, analysis: { ...source.analysis, resamples: 2000 } }, null, 2) + "\n";
const p: Protocol = parseProtocol(JSON.parse(sourceText));

const machine = (cleanSources: boolean): MachineRecord => ({
  schema: "eimb-machine/v1",
  commit: "0123456789abcdef0123456789abcdef01234567",
  cleanSources,
  platform: "test",
  arch: "test",
  node: "test",
  flySourceDigest: "test",
  shards: 1,
  collectedAt: "2026-11-08T00:00:00.000Z",
});

function archive(split: Split = "dev", clean = split === "heldout") {
  const records = syntheticRecords(p, split, moved("plasticity-active", "fedJ", 0.3, 0.02));
  const { files, manifest } = buildArchive(sourceText, p, split, records, machine(clean));
  return { files: { ...files, "manifest.json": manifestText(manifest) } as Record<string, string>, manifest };
}

const failed = (files: Record<string, string | undefined>, split: Split = "dev", frozen = p) =>
  verifyStatic(frozen, split, files)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);

/** Re-seal the manifest after editing a file, as a careful tamperer would. */
function reseal(files: Record<string, string>, name: string, text: string) {
  const m = JSON.parse(files["manifest.json"]!) as Manifest;
  (m.files as Record<string, string>)[name] = sha256(text);
  return { ...files, [name]: text, "manifest.json": manifestText(m) };
}

describe("a clean archive", () => {
  it("passes every static check, dev and held-out", () => {
    expect(failed(archive("dev").files)).toEqual([]);
    expect(failed(archive("heldout").files, "heldout")).toEqual([]);
    const v = verifyStatic(p, "dev", archive().files);
    expect(v.checks.find((c) => c.id === "verdict")!.detail).toMatch(/IMPROVEMENT/);
  });
});

describe("the verifier fails", () => {
  it("when a record is edited and the manifest is not", () => {
    const { files } = archive();
    const text = files["records.jsonl"]!.replace(/"fedJ":[0-9.]+/, '"fedJ":9.99');
    expect(failed({ ...files, "records.jsonl": text })).toContain("file-digests");
  });

  it("when a record is edited and the manifest re-sealed: the summary no longer follows", () => {
    const { files } = archive();
    const records = parseRecords(files["records.jsonl"]!);
    records[5] = { ...records[5]!, behaviour: { ...records[5]!.behaviour, fedJ: 9.99 } };
    const out = failed(reseal(files, "records.jsonl", recordsText(records)));
    expect(out).toEqual(["summary-rederived", "report-rerendered"]);
  });

  it("when the verdict is edited and re-sealed", () => {
    const { files } = archive();
    const text = files["summary.json"]!.replace('"overall": "IMPROVEMENT"', '"overall": "REGRESSION"');
    expect(text).not.toBe(files["summary.json"]);
    expect(failed(reseal(files, "summary.json", text))).toEqual(["summary-rederived"]);
  });

  it("when the report is edited and re-sealed", () => {
    const { files } = archive();
    const text = files["README.md"]!.replace("IMPROVEMENT", "NO_DEMONSTRATED_IMPROVEMENT");
    expect(failed(reseal(files, "README.md", text))).toEqual(["report-rerendered"]);
  });

  it("when the protocol changed after the run (in the archive or in the repository)", () => {
    const { files } = archive("heldout");
    const tightened = parseProtocol({ ...JSON.parse(sourceText), stopping: `${source.stopping} (edited)` });
    expect(failed(files, "heldout", tightened)).toEqual(
      expect.arrayContaining(["protocol-frozen", "seeds"]),
    );
    const archived = JSON.stringify({ ...JSON.parse(sourceText), durationS: 3600, lateFromS: 1800 });
    expect(failed(reseal(files, "protocol.json", archived), "heldout")).toContain("protocol-frozen");
  });

  it("when a held-out split was made from a working tree with uncommitted changes", () => {
    const { files } = archive("heldout", false);
    expect(failed(files, "heldout")).toEqual(["machine"]);
    // The same is fine for dev, which is labelled a development record.
    expect(failed(archive("dev", false).files)).toEqual([]);
  });

  it("when records are not canonical, not sorted, or a file is missing or extra", () => {
    const { files } = archive();
    const lines = files["records.jsonl"]!.split("\n").filter(Boolean);
    const pretty = lines.map((l, i) => (i === 0 ? JSON.stringify(JSON.parse(l), null, 1).replace(/\n/g, "") : l));
    expect(failed(reseal(files, "records.jsonl", pretty.join("\n") + "\n"))).toContain("records-parse");
    const swapped = [lines[1], lines[0], ...lines.slice(2)].join("\n") + "\n";
    expect(failed(reseal(files, "records.jsonl", swapped))).toContain("records-parse");
    expect(failed({ ...files, "machine.json": undefined })).toContain("file-digests");
    const m = JSON.parse(files["manifest.json"]!) as Manifest;
    (m.files as Record<string, string>)["extra.txt"] = sha256("x");
    expect(failed({ ...files, "extra.txt": "x", "manifest.json": manifestText(m) })).toContain("file-digests");
  });

  it("when the manifest is missing or unreadable", () => {
    const { files } = archive();
    expect(failed({ ...files, "manifest.json": undefined })).toEqual(["manifest"]);
    expect(failed({ ...files, "manifest.json": "{not json" })).toEqual(["manifest"]);
  });
});

describe("replay and status", () => {
  it("samples replay units from the manifest digest, every controller and condition first", () => {
    const records = syntheticRecords(p, "dev");
    const a = replaySample(records, "d1", 12);
    expect(a).toHaveLength(12);
    expect(canonicalJson(a)).toBe(canonicalJson(replaySample(records, "d1", 12)));
    expect(canonicalJson(a)).not.toBe(canonicalJson(replaySample(records, "d2", 12)));
    const kinds = new Set(a.map((r) => `${r.controller}|${r.condition}`));
    expect(kinds.size).toBe(12);
  });

  it("is VERIFIED only with a matched replay, and FAILED on a mismatch or a failed check", () => {
    const ok = [{ id: "x", passed: true, detail: "" }];
    const bad = [{ id: "x", passed: false, detail: "" }];
    const r = (status: ReplayResult["status"]): ReplayResult => ({ status, detail: "", units: [], mismatched: [] });
    expect(statusOf(ok, r("matched"))).toBe("VERIFIED");
    expect(statusOf(ok, r("skipped"))).toBe("VERIFIED_WITHOUT_REPLAY");
    expect(statusOf(ok, r("not-comparable"))).toBe("VERIFIED_WITHOUT_REPLAY");
    expect(statusOf(ok, r("mismatch"))).toBe("FAILED");
    expect(statusOf(bad, r("matched"))).toBe("FAILED");
  });
});
