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
  seals: { required: false, reproduced: 0 },
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
    expect(r.replay?.to?.sequence).toBe(316);
    expect(r.covered).toEqual({
      from: 100,
      to: 316,
      ticks: 216 * 3000,
      runs: 3,
      sealed: false,
    });
  });

  it("does not claim coverage across a gap", () => {
    const r = readPublicRecord("", lines(replay(100, 170), replay(313, 316)), me);
    expect(r.covered).toEqual({
      from: 313,
      to: 316,
      ticks: 3 * 3000,
      runs: 1,
      sealed: false,
    });
  });

  it("does not claim coverage across a failed replay", () => {
    const failed = replay(170, 243, {
      passed: false,
      to: point(171),
      difference: { sequence: 172, tick: 516000, field: "stateHash" },
    });
    const r = readPublicRecord("", lines(replay(100, 170), failed, replay(243, 316)), me);
    expect(r.covered).toEqual({
      from: 243,
      to: 316,
      ticks: 73 * 3000,
      runs: 1,
      sealed: false,
    });
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

  it("says seal for seal only if every run in the stretch required it", () => {
    const sealed = (from: number, to: number) =>
      replay(from, to, { seals: { required: true, reproduced: to - from } });
    expect(
      readPublicRecord("", lines(sealed(100, 170), sealed(170, 243)), me).covered?.sealed,
    ).toBe(true);
    expect(
      readPublicRecord("", lines(replay(100, 170), sealed(170, 243)), me).covered?.sealed,
    ).toBe(false);
    // A release that requires its seals must have reproduced every one of them.
    const short = replay(100, 170, { seals: { required: true, reproduced: 69 } });
    expect(readPublicRecord("", lines(short), me).replay).toBeNull();
  });

  it("does not believe a pass that does not add up", () => {
    const wrong = [
      // Everything claimed, nothing reproduced.
      replay(1, 999, { reproduced: 0 }),
      replay(1, 999, { ticks: 0 }),
      // Nothing after its start.
      replay(5, 5),
      // A seal that is not one.
      replay(1, 2, { to: { ...point(2), digest: "x" } }),
      // Nothing to say what ran it.
      replay(1, 2, { machine: null }),
      replay(1, 2, { seals: null }),
    ];
    for (const line of wrong)
      expect(
        readPublicRecord("", lines(line), me).replay,
        JSON.stringify(line),
      ).toBeNull();
    // A malformed difference is no reason to break the page.
    expect(
      readPublicRecord("", lines(replay(1, 2, { passed: false, difference: {} })), me)
        .replay,
    ).toBeNull();
  });

  it("shows a failure that came before any chain could be read", () => {
    const failed = {
      ...replay(1, 2),
      passed: false,
      reason: "the stores disagree at checkpoint 170",
      from: null,
      to: null,
      head: null,
      reproduced: 0,
      ticks: 0,
      seals: null,
      machine: null,
    };
    const r = readPublicRecord("", lines(replay(100, 170), failed), me);
    expect(r.replay?.reason).toMatch(/disagree/);
    expect(r.covered).toBeNull();
  });

  it("does not join a stretch across such a failure", () => {
    const failed = {
      ...replay(1, 2),
      passed: false,
      reason: "no verdict",
      from: null,
      to: null,
      head: null,
    };
    const r = readPublicRecord("", lines(replay(100, 170), failed, replay(170, 243)), me);
    expect(r.covered?.from).toBe(170);
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

  it("keeps saying so after a rewind, until the chain passes the highest it saw", () => {
    const rewound = readPublicRecord(
      [anchor(1500), anchor(1777), anchor(1500), anchor(1510)].join("\n") + "\n",
      "",
      me,
    );
    expect(rewound.newest?.checkpoint).toBe(1510);
    expect(rewound.highest).toBe(1777);
    expect(standing(rewound, { sequence: 1600 })).toBe("behind-ledger");
    expect(standing(rewound, { sequence: 1777 })).toBe("consistent");
    expect(rewound.lastRewind).toMatchObject({ from: 1777, to: 1500 });
  });

  it("records no rewind where there was none", () => {
    expect(record.lastRewind).toBeNull();
  });

  it("makes no claim without anchors", () => {
    expect(standing(readPublicRecord("", "", me), { sequence: 5 })).toBe("no-anchors");
  });
});
