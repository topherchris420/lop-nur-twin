import { describe, expect, it } from "vitest";
import { HeadlessBethesdaLife } from "./headless.js";
import { parseWitness, witness, type Witness } from "./observation.js";
import {
  assess,
  BACKUP_LATE_S,
  CHECKPOINT_LATE_S,
  parseBackupStatus,
  plain,
  problemKey,
  type BackupStatus,
  type Look,
} from "./watch.js";

const ID = "b".repeat(64);
const AT = Date.parse("2026-10-30T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const isoS = (ms: number) => iso(ms).replace(/\.\d+Z$/, "Z");
const life = new HeadlessBethesdaLife({
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
});

/** What the observer serves at AT, through the parser the watcher uses. */
function served(
  o: { individual?: string; committedAgoS?: number; observedAgoS?: number } = {},
): Look<Witness> {
  const observation = life.observation({
    individual: o.individual ?? ID,
    epoch: 11,
    checkpoint: {
      sequence: 1001,
      tick: 0,
      committedUtc: iso(AT - (o.committedAgoS ?? 60) * 1000),
    },
    checkpointing: false,
    observedUtc: iso(AT - (o.observedAgoS ?? 1) * 1000),
  });
  const w = witness(observation, AT);
  return { ok: true, value: parseWitness(JSON.parse(JSON.stringify(w))) };
}

const ARCHIVE = "bethesda-life-20261030T060411Z-cccccccccccc.tar.gz";

/** status.json as backup.sh writes it: each record's own line, as `cat` leaves them. */
function written(
  o: {
    keptAgoS?: number | null;
    offsiteAgoS?: number | null;
    result?: string;
    detail?: string | null;
    offsite?: string;
    individual?: string;
  } = {},
): string {
  const attempt = JSON.stringify({
    utc: isoS(AT - 600_000),
    result: o.result ?? "kept",
    detail: o.detail ?? null,
    offsite: o.offsite ?? "uploaded",
  });
  const keptAgoS = o.keptAgoS === undefined ? 3600 : o.keptAgoS;
  const offsiteAgoS = o.offsiteAgoS === undefined ? 3500 : o.offsiteAgoS;
  const kept =
    keptAgoS === null
      ? "null"
      : JSON.stringify({
          utc: isoS(AT - keptAgoS * 1000),
          archive: ARCHIVE,
          sha256: "d".repeat(64),
          bytes: 21_734_012,
          individual: o.individual ?? ID,
          checkpoint: 1001,
          tick: 6_006_000,
          release: "c".repeat(40),
        });
  const offsite =
    offsiteAgoS === null
      ? "null"
      : JSON.stringify({ utc: isoS(AT - offsiteAgoS * 1000), archive: ARCHIVE });
  return `{"schema":"bethesda-life-backup/v1","attempt":${attempt}\n,"kept":${kept}\n,"offsite":${offsite}\n}\n`;
}

const backup = (text = written()): Look<BackupStatus | null> => ({
  ok: true,
  value: parseBackupStatus(JSON.parse(text)),
});

const judge = (o: {
  witness?: Look<Witness>;
  backup?: Look<BackupStatus | null>;
  now?: number;
}) =>
  assess({
    witness: o.witness ?? served(),
    backup: o.backup ?? backup(),
    individual: ID,
    now: o.now ?? AT,
  });

const codes = (o: Parameters<typeof judge>[0]) => judge(o).map((p) => p.code);

describe("the watcher's judgement", () => {
  it("finds nothing wrong with a live life, checkpointed and backed up on and off its machine", () => {
    expect(judge({})).toEqual([]);
  });

  it("reports an observer that does not answer, and still judges the backups", () => {
    const problems = judge({
      witness: { ok: false, error: "fetch failed (ECONNREFUSED)" },
    });
    expect(problems).toEqual([
      {
        code: "unreachable",
        detail: "the observer did not answer: fetch failed (ECONNREFUSED)",
      },
    ]);
    expect(
      codes({
        witness: { ok: false, error: "timeout" },
        backup: backup(written({ keptAgoS: null })),
      }),
    ).toEqual(["unreachable", "backup"]);
  });

  it("reports a witness that is not live, with its reason", () => {
    const [problem] = judge({ witness: served({ observedAgoS: 30 }) });
    expect(problem).toEqual({
      code: "status",
      detail: "the witness is stale: no new observation for 30 s",
    });
  });

  it("reports an individual other than the deployed one", () => {
    expect(codes({ witness: served({ individual: "e".repeat(64) }) })).toEqual([
      "individual",
    ]);
  });

  it("reports a checkpoint more than 20 minutes old, and not one at 20", () => {
    expect(codes({ witness: served({ committedAgoS: CHECKPOINT_LATE_S }) })).toEqual([]);
    expect(judge({ witness: served({ committedAgoS: CHECKPOINT_LATE_S + 60 }) })).toEqual(
      [
        {
          code: "checkpoint",
          detail: "the newest checkpoint, 1001, was committed 21 min ago",
        },
      ],
    );
  });

  it("judges ages by the machine's clock, not the watcher's", () => {
    expect(judge({ now: AT + 10 * 86_400_000 })).toEqual([]);
  });

  it("reports a machine with no backup record once, not as an off-site failure too", () => {
    expect(judge({ backup: { ok: true, value: null } })).toEqual([
      {
        code: "backup",
        detail:
          "no backup has recorded anything: the timer is not installed, or has not run",
      },
    ]);
    expect(
      codes({ backup: { ok: false, error: "/v1/backup answered HTTP 502" } }),
    ).toEqual(["backup"]);
  });

  it("reports the newest archive kept more than 13 hours ago, with what the newest run did", () => {
    expect(codes({ backup: backup(written({ keptAgoS: BACKUP_LATE_S })) })).toEqual([]);
    const late = written({
      keptAgoS: BACKUP_LATE_S + 1800,
      offsiteAgoS: 3600,
      result: "skipped",
      detail: "3100 MB to spare beside the life, and the check needs 3400 MB",
      offsite: "not attempted",
    });
    expect(judge({ backup: backup(late) })).toEqual([
      {
        code: "backup",
        detail:
          "the newest archive kept is 13.5 h old; the newest run, at 2026-10-30T11:50:00Z: skipped (3100 MB to spare beside the life, and the check needs 3400 MB)",
      },
    ]);
  });

  it("reports an archive of another individual", () => {
    expect(codes({ backup: backup(written({ individual: "e".repeat(64) })) })).toEqual([
      "backup",
    ]);
  });

  it("reports archives that are not copied off the machine, with why not", () => {
    expect(
      judge({
        backup: backup(written({ offsiteAgoS: null, offsite: "not configured" })),
      }),
    ).toEqual([
      {
        code: "offsite",
        detail:
          "no archive has been copied off the machine; the newest run's copy: not configured",
      },
    ]);
    expect(
      judge({
        backup: backup(
          written({
            offsiteAgoS: BACKUP_LATE_S + 3600,
            offsite: "failed: curl exited 22",
          }),
        ),
      }),
    ).toEqual([
      {
        code: "offsite",
        detail:
          "the newest archive copied off the machine is 14.0 h old; the newest run's copy: failed: curl exited 22",
      },
    ]);
  });

  it("lets nothing from the machine mention, tag or quote in an issue", () => {
    expect(plain("@everyone <img src=x> `code`")).toBe("everyone img src=x code");
    const [problem] = judge({
      backup: backup(written({ offsiteAgoS: null, offsite: "failed: @someone <b>" })),
    });
    expect(problem?.detail).toContain("failed: someone b");
  });

  it("keys a run by the kinds of problem, so the same ones are not reported again", () => {
    expect(problemKey([])).toBe("");
    expect(
      problemKey([
        { code: "status", detail: "a" },
        { code: "checkpoint", detail: "b" },
        { code: "status", detail: "c" },
      ]),
    ).toBe("checkpoint,status");
  });
});

describe("the backup record", () => {
  it("parses what backup.sh writes, before any archive too", () => {
    const record = parseBackupStatus(JSON.parse(written()));
    expect(record.kept?.archive).toBe(ARCHIVE);
    expect(record.offsite?.archive).toBe(ARCHIVE);
    const first = parseBackupStatus(
      JSON.parse(
        written({ keptAgoS: null, offsiteAgoS: null, result: "failed", detail: "x" }),
      ),
    );
    expect(first).toMatchObject({ kept: null, offsite: null, attempt: { detail: "x" } });
  });

  it.each([
    ["another schema", (s: string) => s.replace("backup/v1", "backup/v2"), /schema/],
    [
      "an unknown field",
      (s: string) => s.replace('"schema"', '"x":1,"schema"'),
      /unexpected x/,
    ],
    [
      "an unknown result",
      (s: string) => s.replace('"kept","detail"', '"done","detail"'),
      /result/,
    ],
    [
      "a malformed archive name",
      (s: string) => s.replaceAll(ARCHIVE, "store.tar.gz"),
      /archive/,
    ],
    ["a negative size", (s: string) => s.replace("21734012", "-1"), /bytes/],
    [
      "a short individual",
      (s: string) => s.replace("b".repeat(64), "b".repeat(63)),
      /individual/,
    ],
  ])("refuses %s", (_what, change, error) => {
    expect(() => parseBackupStatus(JSON.parse(change(written())))).toThrow(error);
  });
});
