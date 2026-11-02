import { describe, expect, it } from "vitest";
import { readPublicRecord, standing } from "./publicRecord";

const me = "a".repeat(64);
const other = "b".repeat(64);
const run = "https://github.com/topherchris420/lop-nur-twin/actions/runs/1";

const anchor = (checkpoint: number, individual = me) =>
  JSON.stringify({
    schema: "bethesda-life-ledger/v1",
    seenUtc: "2026-11-01T20:36:55.537Z",
    individual,
    checkpoint,
    tick: checkpoint * 3000,
    digest: "c".repeat(64),
    committedUtc: "2026-11-01T18:08:29.229Z",
    archive: "bethesda-life-20261101T181233Z-62bd12502c17.tar.gz",
    sha256: "d".repeat(64),
  });

const point = (sequence: number) => ({
  sequence,
  tick: sequence * 3000,
  digest: String(sequence).padStart(64, "0"),
});

const replay = (from: number, to: number, o: object = {}) => ({
  schema: "bethesda-life-replay/v1",
  seenUtc: "2026-11-02T07:40:00Z",
  passed: true,
  individual: me,
  from: point(from),
  to: point(to),
  head: point(to),
  reproduced: to - from,
  ticks: (to - from) * 3000,
  machine: { platform: "linux", arch: "arm64", node: "v24.22.1" },
  difference: null,
  stopped: null,
  run,
  ...o,
});

const lines = (...r: object[]) => r.map((x) => JSON.stringify(x)).join("\n") + "\n";

describe("reading the public record", () => {
  it("counts this individual's anchors only", () => {
    const r = readPublicRecord(
      [anchor(10), anchor(20, other), anchor(30)].join("\n") + "\n",
      "",
      me,
    );
    expect(r.anchors).toBe(2);
    expect(r.newest?.checkpoint).toBe(30);
    expect(r.replay).toBeNull();
    expect(r.covered).toBeNull();
  });

  it("refuses a broken ledger rather than reading what it can of it", () => {
    expect(() => readPublicRecord("not json\n", "", me)).toThrow(/line 1/);
  });

  it("joins replays that begin where the last ended into one covered stretch", () => {
    const r = readPublicRecord(
      "",
      lines(replay(100, 170), replay(170, 243), replay(243, 316)),
      me,
    );
    expect(r.replay?.to.sequence).toBe(316);
    expect(r.covered).toEqual({ from: 100, to: 316, ticks: 216 * 3000, runs: 3 });
  });

  it("does not claim coverage across a gap", () => {
    const r = readPublicRecord("", lines(replay(100, 170), replay(313, 316)), me);
    expect(r.covered).toEqual({ from: 313, to: 316, ticks: 3 * 3000, runs: 1 });
  });

  it("does not claim coverage across a failed replay", () => {
    const failed = replay(170, 243, {
      passed: false,
      to: point(171),
      difference: { sequence: 172, tick: 516000, field: "stateHash" },
    });
    const r = readPublicRecord("", lines(replay(100, 170), failed, replay(243, 316)), me);
    expect(r.covered).toEqual({ from: 243, to: 316, ticks: 73 * 3000, runs: 1 });
  });

  it("shows the newest replay's failure and claims nothing covered", () => {
    const failed = replay(170, 243, {
      passed: false,
      to: point(171),
      difference: { sequence: 172, tick: 516000, field: "stateHash" },
    });
    const r = readPublicRecord("", lines(replay(100, 170), failed), me);
    expect(r.replay?.passed).toBe(false);
    expect(r.replay?.difference?.sequence).toBe(172);
    expect(r.covered).toBeNull();
  });

  it("does not count a line that says it passed but did not reach its head", () => {
    const short = replay(100, 170, { head: point(200) });
    expect(readPublicRecord("", lines(short), me).replay).toBeNull();
    const stopped = replay(100, 170, { stopped: "another engine" });
    expect(readPublicRecord("", lines(stopped), me).replay).toBeNull();
    const differing = replay(100, 170, {
      difference: { sequence: 171, tick: 0, field: "digest" },
    });
    expect(readPublicRecord("", lines(differing), me).replay).toBeNull();
  });

  it("ignores another individual's replays, garbage, and links away from the repository", () => {
    const r = readPublicRecord(
      "",
      [
        "{not json",
        JSON.stringify(replay(1, 2, { individual: other })),
        JSON.stringify(replay(1, 2, { run: "https://example.com/actions/runs/1" })),
        JSON.stringify(replay(1, 2, { machine: { platform: "linux" } })),
        JSON.stringify(replay(1, 2, { seenUtc: "yesterday" })),
      ].join("\n"),
      me,
    );
    expect(r.replay).toBeNull();
  });
});

describe("the live chain against the public record", () => {
  const record = readPublicRecord(anchor(1777) + "\n", "", me);

  it("is consistent at or past the newest anchor", () => {
    expect(standing(record, { sequence: 1777 })).toBe("consistent");
    expect(standing(record, { sequence: 1940 })).toBe("consistent");
  });

  it("says so when the live chain is behind what was seen in public", () => {
    expect(standing(record, { sequence: 1776 })).toBe("behind-ledger");
  });

  it("makes no claim without anchors", () => {
    expect(standing(readPublicRecord("", "", me), { sequence: 5 })).toBe("no-anchors");
  });
});
