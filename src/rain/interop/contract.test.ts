import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { canonicalJson, sha256Bytes, sha256Json } from "../sha256";
import {
  AGENT_INTEROP_V1_MANIFEST_SHA256,
  approvalHolds,
  checkEventChain,
  checkRecord,
  type InteropSchemaName,
} from "./contract";

const ROOT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "interop",
  "agent-interop-v1",
);
const read = (rel: string) =>
  JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Record<string, unknown>;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)],
  );

describe("agent-interop/v1 contract", () => {
  it("matches its manifest, and the manifest matches the pin shared with James", () => {
    const manifest = readFileSync(join(ROOT, "MANIFEST.sha256"), "utf8");
    const lines = manifest.trimEnd().split("\n");
    const listed = new Map(lines.map((l) => [l.slice(66), l.slice(0, 64)]));
    const onDisk = walk(ROOT)
      .map((p) => relative(ROOT, p).split("\\").join("/"))
      .filter((p) => p !== "MANIFEST.sha256")
      .sort();
    expect([...listed.keys()].sort()).toEqual(onDisk);
    for (const rel of onDisk)
      expect(listed.get(rel), rel).toBe(sha256Bytes(readFileSync(join(ROOT, rel))));
    expect(sha256Bytes(Buffer.from(manifest))).toBe(AGENT_INTEROP_V1_MANIFEST_SHA256);
  });

  it("reproduces every canonical text and digest", () => {
    const { cases } = read("fixtures/canonical.json") as {
      cases: Array<{ name: string; value: unknown; canonical: string; sha256: string }>;
    };
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) {
      expect(canonicalJson(c.value), c.name).toBe(c.canonical);
      expect(sha256Json(c.value), c.name).toBe(c.sha256);
    }
  });

  it("accepts every positive fixture under its schema and digest", () => {
    const names: Array<[string, InteropSchemaName]> = [
      ["agent-identity.json", "agent-identity/v1"],
      ["agent-task.json", "agent-task/v1"],
      ["agent-memory.json", "agent-memory/v1"],
      ["agent-approval.json", "agent-approval/v1"],
      ["rain-interop-status.json", "rain-interop-status/v1"],
      ["rain-interop-evidence.json", "rain-interop-evidence/v1"],
      ["rain-interop-proposal.json", "rain-interop-proposal/v1"],
      ["rain-interop-receipt.json", "rain-interop-receipt/v1"],
      ["rain-interop-error.json", "rain-interop-error/v1"],
    ];
    for (const [file, schema] of names)
      expect(checkRecord(schema, read(`fixtures/${file}`)), file).toEqual([]);
    expect(
      checkEventChain(
        (read("fixtures/agent-event-chain.json") as { events: unknown[] }).events,
      ),
    ).toEqual([]);
    expect(
      approvalHolds(
        read("fixtures/agent-approval.json"),
        new Date("2026-11-16T12:05:00Z"),
      ),
    ).toBe(true);
    expect(
      approvalHolds(
        read("fixtures/agent-approval.json"),
        new Date("2026-11-16T12:10:01Z"),
      ),
    ).toBe(false);
  });

  it("refuses every negative fixture", () => {
    const { cases } = read("fixtures/negative.json") as {
      cases: Array<{ name: string; kind: string; value: unknown }>;
    };
    for (const c of cases) {
      if (c.kind === "agent-event-chain")
        expect(checkEventChain(c.value as unknown[]).length, c.name).toBeGreaterThan(0);
      else if (c.kind === "agent-approval/v1")
        expect(approvalHolds(c.value, new Date("2026-11-16T12:05:00Z")), c.name).toBe(
          false,
        );
      else
        expect(
          checkRecord(c.kind as InteropSchemaName, c.value).length,
          c.name,
        ).toBeGreaterThan(0);
    }
  });

  it("refuses unknown fields and a receipt that claims to authorize execution", () => {
    const receipt = {
      ...read("fixtures/rain-interop-receipt.json"),
      authorizes_execution: true,
    };
    expect(checkRecord("rain-interop-receipt/v1", receipt).length).toBeGreaterThan(0);
    const extra = { ...read("fixtures/agent-identity.json"), admin: true };
    expect(checkRecord("agent-identity/v1", extra).length).toBeGreaterThan(0);
  });
});
