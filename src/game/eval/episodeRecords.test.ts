import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MAX_RECORDS_BYTES,
  isGzip,
  parseEpisodeRecords,
  readEpisodeRecords,
} from "./episodeRecords";
import { EPISODE_DECISIONS_SCHEMA, type DecisionRecord } from "./records";
import { record } from "./testing/fixtures";

const ROOT = join(__dirname, "..", "..", "..");

/** Every archived episode's decision records under `docs/benchmarks/`. */
function archived(dir = join(ROOT, "docs", "benchmarks"), out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) archived(path, out);
    else if (name.endsWith(".eval.json.gz")) out.push(path);
  }
  return out;
}

function file(decisions: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: EPISODE_DECISIONS_SCHEMA,
    episodeId: "synthetic",
    brain: { id: "random", provider: "local" },
    decisions,
    failures: [],
    ...extra,
  });
}

const refusal = (text: string, limit?: number): string => {
  const parsed = parseEpisodeRecords(text, limit);
  if (parsed.ok) throw new Error("expected a refusal");
  return parsed.error;
};

const stream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new Response(new Uint8Array(bytes)).body!;

describe("episode decision records", () => {
  const files = archived();

  it("finds the archived episodes", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("accepts an archived episode, record for record", () => {
    const text = gunzipSync(readFileSync(files[0]!)).toString("utf8");
    const raw = JSON.parse(text) as { decisions: unknown[]; failures: unknown[] };
    const parsed = parseEpisodeRecords(text);
    expect(parsed.ok ? null : parsed.error).toBeNull();
    if (!parsed.ok) return;
    // Nothing dropped, nothing rewritten.
    expect(parsed.value.decisions).toEqual(raw.decisions);
    expect(parsed.value.failures).toEqual(raw.failures);
  });

  it("accepts every archived episode", { timeout: 60_000 }, () => {
    // A rule tightened past what the seat writes would refuse these first.
    const refused = files.flatMap((path) => {
      const parsed = parseEpisodeRecords(gunzipSync(readFileSync(path)).toString("utf8"));
      return parsed.ok ? [] : [`${path.slice(ROOT.length)}: ${parsed.error}`];
    });
    expect(refused).toEqual([]);
  });

  it("reads an archive whether or not a host has already decoded the gzip", async () => {
    const gz = readFileSync(files[0]!);
    expect(isGzip(gz)).toBe(true);
    const plain = gunzipSync(gz);
    expect(isGzip(plain)).toBe(false);
    const fromGzip = await readEpisodeRecords(stream(gz));
    const fromPlain = await readEpisodeRecords(stream(plain));
    expect(fromGzip.decisions.length).toBeGreaterThan(0);
    expect(fromPlain).toEqual(fromGzip);
  });

  it("accepts a well-formed file built from the record type", () => {
    const parsed = parseEpisodeRecords(file([record(), record(), record()]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.decisions).toHaveLength(3);
      expect(parsed.value.brain).toEqual({ id: "random", provider: "local" });
    }
  });

  it("refuses a file that names another schema", () => {
    expect(refusal(file([record()], { schema: "blacksite-episode-decisions/v9" }))).toBe(
      "unsupported decision-records schema: blacksite-episode-decisions/v9",
    );
    const wrongRecord = { ...record(), schema: "blacksite-decision/v0" };
    expect(refusal(file([wrongRecord]))).toBe(
      "decisions[0].schema: not a decision record",
    );
  });

  it("refuses a non-finite latency, naming the first bad record and field", () => {
    const records: DecisionRecord[] = [record(), record(), record(), record(), record()];
    records[3]!.accounting.wallLatencyMs = 123456.5;
    records[4]!.accounting.wallLatencyMs = 123456.5;
    // JSON has no Infinity, but `1e999` parses to it.
    const text = file(records).replaceAll("123456.5", "1e999");
    expect(refusal(text)).toBe(
      "decisions[3].accounting.wallLatencyMs: not a finite number",
    );
  });

  it("refuses an unknown validation status", () => {
    const bad = record();
    (bad.validation as { status: string }).status = "probably_fine";
    expect(refusal(file([record(), bad]))).toBe(
      "decisions[1].validation.status: not an allowed value",
    );
  });

  it("refuses a string where a number belongs", () => {
    const bad = record();
    (bad.outcome as unknown as Record<string, unknown>)["damageDealt"] = "12";
    expect(refusal(file([bad]))).toBe(
      "decisions[0].outcome.damageDealt: not a finite number",
    );
  });

  it("refuses an oversize input before parsing it", () => {
    expect(refusal("x".repeat(MAX_RECORDS_BYTES + 1))).toBe("larger than 64 MB");
    const text = file([record()]);
    expect(refusal(text, text.length - 1)).toMatch(/^larger than/);
  });

  it("refuses a small gzip that unpacks past the limit", async () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024, 0x20));
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(readEpisodeRecords(stream(bomb), 64 * 1024)).rejects.toThrow(
      "larger than",
    );
    await expect(
      readEpisodeRecords(stream(new Uint8Array(70 * 1024)), 64 * 1024),
    ).rejects.toThrow("larger than");
  });

  it("refuses what is not a record rather than dropping it", () => {
    expect(refusal(file([record(), "not a record"]))).toBe(
      "decisions[1]: expected an object",
    );
    expect(refusal(file([{ ...record(), note: "extra" }]))).toBe(
      "decisions[0].note: unexpected field",
    );
    const missing: Partial<DecisionRecord> = record();
    delete missing.outcome;
    expect(refusal(file([missing]))).toBe("decisions[0].outcome: missing");
    expect(refusal(JSON.stringify({ decisions: [] }))).toBe(
      "not an episode's decision records (expected decisions and failures)",
    );
    expect(refusal("{")).toBe("not JSON");
  });

  it("refuses a choice that was not among the options offered", () => {
    const bad = record({ frame: { move: "PRONE" } });
    bad.legal.move = bad.legal.move.filter((option) => option !== "PRONE");
    expect(refusal(file([bad]))).toBe(
      "decisions[0].frame.move: not among the options the record offered",
    );
  });

  it("refuses a confidence figure under a source of none", () => {
    const bad = record({
      confidence: {
        source: "none",
        perAxis: { move: { probability: 0.25, confidence: null } },
      },
    });
    expect(refusal(file([bad]))).toBe(
      'decisions[0].confidence.perAxis: figures under source "none"',
    );
  });

  it("refuses two records with one sequence number", () => {
    const first = record();
    expect(refusal(file([first, { ...record(), sequence: first.sequence }]))).toBe(
      "decisions[1].sequence: repeats an earlier record's",
    );
  });
});
