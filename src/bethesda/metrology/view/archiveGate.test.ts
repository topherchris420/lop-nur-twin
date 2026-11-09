/**
 * The research view shows an archive only when the browser can check it. On
 * the committed dev archive the gate opens; on a summary changed by one byte, a
 * verification of another manifest, or one without a matched replay, it stays
 * shut and says why.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gateArchive, type ArchiveTexts } from "./archiveGate.js";

const dir = "docs/benchmarks/echo-metrology/plasticity-locomotor-v1/dev";
const texts: ArchiveTexts = {
  summary: readFileSync(`${dir}/summary.json`, "utf8"),
  manifest: readFileSync(`${dir}/manifest.json`, "utf8"),
  verification: readFileSync(`${dir}/verification.json`, "utf8"),
  protocol: readFileSync(`${dir}/protocol.json`, "utf8"),
};
const reasons = (t: ArchiveTexts) => {
  const g = gateArchive(t);
  return g.shown ? [] : g.reasons;
};

describe("the research view's gate", () => {
  it("opens on the committed, verified dev archive", () => {
    const g = gateArchive(texts);
    expect(g.shown).toBe(true);
    if (!g.shown) return;
    expect(g.summary.split).toBe("dev");
    // The seven conditions the frozen protocol says the candidate never met.
    expect(g.novel).toHaveLength(7);
    expect(g.novel).not.toContain("weak-legs");
  });

  it("stays shut on a summary that is not the one its manifest seals", () => {
    const summary = texts.summary!.replace('"split": "dev"', '"split": "dev" ');
    expect(reasons({ ...texts, summary })).toEqual([
      "summary.json does not match the digest its manifest records",
    ]);
  });

  it("stays shut on a protocol that is not the archived one", () => {
    const protocol = texts.protocol!.replace(
      '"novelToCandidate": true',
      '"novelToCandidate": false',
    );
    expect(protocol).not.toBe(texts.protocol);
    expect(reasons({ ...texts, protocol })).toEqual([
      "protocol.json does not match the digest its manifest records",
    ]);
  });

  it("stays shut when the verification is for another manifest, or did not replay", () => {
    const v = JSON.parse(texts.verification!) as Record<string, unknown>;
    const other = JSON.stringify({ ...v, manifestDigest: "0".repeat(64) });
    expect(reasons({ ...texts, verification: other })).toEqual([
      "the verification was made for another manifest",
    ]);
    const unreplayed = JSON.stringify({ ...v, status: "VERIFIED_WITHOUT_REPLAY" });
    expect(reasons({ ...texts, verification: unreplayed })).toEqual([
      "the verification status is VERIFIED_WITHOUT_REPLAY, not VERIFIED",
    ]);
  });

  it("stays shut on a missing or broken file", () => {
    expect(reasons({ ...texts, verification: undefined })).toEqual([
      "verification.json is missing",
    ]);
    expect(reasons({ ...texts, manifest: "{" })).toEqual(["manifest.json is not JSON"]);
  });
});
